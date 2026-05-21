import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  createMcpHttpHandler,
  type ResolvedMcpRequest,
} from "@workspace/mcp-server/http";
import {
  type ToolAuditHook,
  TOOL_DEFINITIONS,
} from "@workspace/mcp-server";
import { db } from "@workspace/db";
import { activityLog } from "@workspace/db/schema";
import { readBearerToken } from "../middleware/require-auth";
import {
  isPatToken,
  resolvePersonalAccessToken,
} from "../lib/personal-access-tokens";
import { getMcpInternalSecret } from "../middleware/mcp-context";
import { logger } from "../lib/logger";


// ---------------------------------------------------------------------------
// Shared audit writer
// ---------------------------------------------------------------------------

type AuditPayload = {
  toolName: string;
  patId: string;
  userId: string;
  organizationId?: string | null;
  startedAt: Date;
  durationMs: number;
  ok: boolean;
  errorStatus?: number;
  errorMessage?: string;
};

async function writeMcpAuditRow(payload: AuditPayload): Promise<void> {
  try {
    await db.insert(activityLog).values({
      organizationId: payload.organizationId ?? null,
      entityType: "mcp_tool_call",
      entityId: payload.patId,
      action: payload.toolName,
      userId: payload.userId,
      metadata: {
        actor: `agent_via_mcp(${payload.userId}, ${payload.patId}, ${payload.toolName})`,
        actorKind: "agent_via_mcp",
        toolName: payload.toolName,
        patId: payload.patId,
        startedAt: payload.startedAt.toISOString(),
        durationMs: payload.durationMs,
        ok: payload.ok,
        ...(payload.ok
          ? {}
          : { errorStatus: payload.errorStatus, errorMessage: payload.errorMessage }),
      },
    });
  } catch (err) {
    // Audit failures must not break the tool call. Log and continue.
    logger.warn(
      { err, toolName: payload.toolName, patId: payload.patId },
      "Failed to write MCP tool-call audit row",
    );
  }
}

// ---------------------------------------------------------------------------
// MCP streamable-HTTP transport router
// Mounted BEFORE requireAuth — the handler performs its own PAT-only auth
// and emits JSON-RPC-friendly errors.
// ---------------------------------------------------------------------------

const buildAuditHook = (resolved: ResolvedMcpRequest): ToolAuditHook => {
  return async (event) => {
    await writeMcpAuditRow({
      toolName: event.toolName,
      patId: resolved.patId,
      userId: resolved.userId,
      organizationId: resolved.organizationId ?? null,
      startedAt: event.startedAt,
      durationMs: event.durationMs,
      ok: event.outcome.ok,
      ...(event.outcome.ok
        ? {}
        : { errorStatus: event.outcome.status, errorMessage: event.outcome.message }),
    });
  };
};

const mcpHandler = createMcpHttpHandler({
  internalSecret: getMcpInternalSecret(),
  buildAuditHook,
  resolvePat: async (req): Promise<ResolvedMcpRequest | null> => {
    const token = readBearerToken(req as Request);
    if (!token) return null;
    if (!isPatToken(token)) return null;
    try {
      const resolved = await resolvePersonalAccessToken(token);
      return {
        pat: token,
        patId: resolved.patId,
        userId: resolved.userId,
        organizationId: resolved.organizationId ?? null,
      };
    } catch {
      return null;
    }
  },
});

export const mcpTransportRouter: IRouter = Router();

mcpTransportRouter.all("/mcp", async (req: Request, res: Response) => {
  try {
    await mcpHandler(req, res);
  } catch (err) {
    logger.error({ err }, "MCP HTTP handler crashed");
    if (!res.headersSent) {
      res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "MCP transport error.",
      });
    }
  }
});

// ---------------------------------------------------------------------------
// MCP stdio audit router
// Mounted AFTER requireAuth and the per-identity rate limiter so that:
//   1. Read-only PATs are rejected (requireAuth enforces scope on POST).
//   2. Flood attempts are subject to the same per-identity bucket as every
//      other authenticated endpoint.
//   3. Non-PAT session tokens are rejected (patId presence check below).
// ---------------------------------------------------------------------------

// Derive the allowlist from the single source of truth for registered tools.
// Any tool name not in this set is rejected at the audit endpoint, preventing
// callers from inventing fictitious tool names in the log.
const KNOWN_TOOL_NAMES: ReadonlySet<string> = new Set(
  TOOL_DEFINITIONS.map((t) => t.name),
);

// Maximum clock skew allowed between the caller's reported startedAt and server
// wall-clock time. Prevents backdating (past) and future-dating (future) of
// audit entries. The stdio binary submits this immediately after tool execution,
// so 5 minutes is generous even on slow networks.
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

const auditPayloadSchema = z.object({
  toolName: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_/:-]*$/, "Invalid tool name."),
  startedAt: z.string().datetime(),
  durationMs: z.number().int().min(0).max(10 * 60 * 1000),
  ok: z.boolean(),
  errorStatus: z.number().int().min(0).max(599).optional(),
  errorMessage: z.string().max(2_000).optional(),
});

export const mcpAuditRouter: IRouter = Router();

// PAT-only audit endpoint used by the stdio MCP binary to self-report tool
// calls. Never mutates business entities — only writes the activity row.
// Auth and rate limiting are handled by upstream middleware (requireAuth +
// createPerUserApiRateLimit). This handler additionally:
//   - Requires a PAT (not an interactive session token).
//   - Validates toolName against the server-side allowlist of real tools.
//   - Rejects timestamps that are too old or too far in the future.
mcpAuditRouter.post("/mcp/audit", async (req: Request, res: Response) => {
  const auth = req.auth;

  // Require a PAT — interactive session tokens must not create audit rows.
  if (!auth?.patId) {
    res.status(403).json({
      type: "about:blank",
      title: "Forbidden",
      status: 403,
      detail: "MCP audit requires a Personal Access Token (cs_pat_...).",
    });
    return;
  }

  const parsed = auditPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail: "Invalid MCP audit payload.",
      errors: parsed.error.flatten(),
    });
    return;
  }

  // Reject unknown tool names — only registered tools may appear in the log.
  if (!KNOWN_TOOL_NAMES.has(parsed.data.toolName)) {
    res.status(422).json({
      type: "about:blank",
      title: "Unprocessable Entity",
      status: 422,
      detail: `Unknown MCP tool: "${parsed.data.toolName}".`,
    });
    return;
  }

  // Reject timestamps that deviate too far from server wall-clock time.
  // This prevents both backdating (fabricating historical events) and
  // future-dating (pre-staging events that haven't occurred yet).
  const startedAt = new Date(parsed.data.startedAt);
  const skewMs = Math.abs(Date.now() - startedAt.getTime());
  if (skewMs > MAX_TIMESTAMP_SKEW_MS) {
    res.status(422).json({
      type: "about:blank",
      title: "Unprocessable Entity",
      status: 422,
      detail: "startedAt deviates too far from server time (max ±5 minutes).",
    });
    return;
  }

  await writeMcpAuditRow({
    toolName: parsed.data.toolName,
    patId: auth.patId,
    userId: auth.userId,
    organizationId: auth.organizationId ?? null,
    startedAt,
    durationMs: parsed.data.durationMs,
    ok: parsed.data.ok,
    errorStatus: parsed.data.errorStatus,
    errorMessage: parsed.data.errorMessage,
  });

  res.json({ ok: true });
});
