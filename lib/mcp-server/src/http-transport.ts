import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  createCadstoneMcpServer,
  type CreateCadstoneMcpServerOptions,
  type ToolAuditHook,
} from "./server";

/**
 * Express-compatible request handler for the streamable-HTTP MCP transport.
 *
 * The transport spec is stateless from our perspective: every request gets a
 * fresh per-PAT MCP server and a fresh transport, so two simultaneous PATs
 * can never see each other's state. This is the exact pattern recommended by
 * the SDK's stateless example.
 *
 * Auth is the caller's responsibility — pass `getPat(req)` so the host app
 * can pull the token from `Authorization: Bearer …`, the session cookie,
 * a query parameter, or wherever else.
 */
export type ResolvedMcpRequest = {
  /** Validated PAT secret (`cs_pat_…`) */
  pat: string;
  /** PAT row id (audit-logged on every tool call). */
  patId: string;
  /** Owning user id of the PAT (audit-logged on every tool call). */
  userId: string;
};

export type CreateMcpHttpHandlerOptions = {
  /** Base URL the MCP server should hit (defaults to `http://localhost:${PORT}`). */
  baseUrl?: string;
  /**
   * Resolves the calling PAT from the incoming request. Return a fully
   * validated PAT (already checked against the database for revocation /
   * expiry) or null to reject.
   */
  resolvePat: (
    req: IncomingMessage,
  ) => ResolvedMcpRequest | null | Promise<ResolvedMcpRequest | null>;
  /** Optional fetch override used by the MCP server. */
  fetchImpl?: CreateCadstoneMcpServerOptions["fetchImpl"];
  /**
   * Per-process secret forwarded to the api-server's loopback REST routes
   * to prove that calls came from the in-process MCP transport (and so
   * activity rows can safely be tagged `agent_via_mcp`).
   */
  internalSecret?: string;
  /**
   * Audit hook called for every tool invocation (success or failure). The
   * api-server uses this to write a row to `activity_log` so reads — which
   * never trigger a `writeActivity` from the REST routes — are still
   * attributable to the MCP caller.
   */
  buildAuditHook?: (resolved: ResolvedMcpRequest) => ToolAuditHook;
};

export function createMcpHttpHandler(opts: CreateMcpHttpHandlerOptions) {
  return async function mcpHttpHandler(
    req: IncomingMessage & { body?: unknown },
    res: ServerResponse,
  ): Promise<void> {
    let resolved: ResolvedMcpRequest | null;
    try {
      resolved = await opts.resolvePat(req);
    } catch (err) {
      writeJson(res, 500, {
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: err instanceof Error ? err.message : "PAT resolution failed",
      });
      return;
    }

    if (!resolved) {
      writeJson(res, 401, {
        type: "https://cadstone.app/problems/unauthorized",
        title: "Unauthorized",
        status: 401,
        detail:
          "Missing, invalid, expired, or revoked Personal Access Token. Send `Authorization: Bearer cs_pat_…`.",
      });
      return;
    }

    const baseUrl = opts.baseUrl ?? defaultBaseUrl();
    const auditHook = opts.buildAuditHook ? opts.buildAuditHook(resolved) : undefined;
    const server = createCadstoneMcpServer({
      baseUrl,
      pat: resolved.pat,
      fetchImpl: opts.fetchImpl,
      internalSecret: opts.internalSecret,
      auditHook,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    res.on("close", () => {
      transport.close().catch(() => {
        /* ignore — connection already gone */
      });
      server.close().catch(() => {
        /* ignore */
      });
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        writeJson(res, 500, {
          type: "about:blank",
          title: "Internal Server Error",
          status: 500,
          detail: err instanceof Error ? err.message : "MCP request failed",
        });
      }
    }
  };
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/problem+json");
  res.end(JSON.stringify(body));
}

function defaultBaseUrl(): string {
  // Matches the api-server's default in artifacts/api-server/src/index.ts so
  // that when both processes run with PORT unset, the MCP transport can still
  // reach the loopback REST API.
  const port = process.env["PORT"] ?? "8080";
  return `http://127.0.0.1:${port}`;
}
