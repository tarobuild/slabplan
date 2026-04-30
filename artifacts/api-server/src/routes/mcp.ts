import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  createMcpHttpHandler,
  type ResolvedMcpRequest,
} from "@workspace/mcp-server/http";
import type { ToolAuditHook } from "@workspace/mcp-server";
import { db } from "@workspace/db";
import { activityLog } from "@workspace/db/schema";
import { readBearerToken } from "../middleware/require-auth";
import {
  isPatToken,
  resolvePersonalAccessToken,
} from "../lib/personal-access-tokens";
import { getMcpInternalSecret } from "../middleware/mcp-context";
import { logger } from "../lib/logger";


const router: IRouter = Router();

type AuditPayload = {
  toolName: string;
  patId: string;
  userId: string;
  startedAt: Date;
  durationMs: number;
  ok: boolean;
  errorStatus?: number;
  errorMessage?: string;
};

async function writeMcpAuditRow(payload: AuditPayload): Promise<void> {
  try {
    await db.insert(activityLog).values({
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

const buildAuditHook = (resolved: ResolvedMcpRequest): ToolAuditHook => {
  return async (event) => {
    await writeMcpAuditRow({
      toolName: event.toolName,
      patId: resolved.patId,
      userId: resolved.userId,
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
      return { pat: token, patId: resolved.patId, userId: resolved.userId };
    } catch {
      return null;
    }
  },
});

router.all("/mcp", async (req: Request, res: Response) => {
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

// PAT-only audit endpoint used by the stdio MCP binary to self-report tool
// calls. Never mutates business entities — only writes the activity row.
router.post("/mcp/audit", async (req: Request, res: Response) => {
  const token = readBearerToken(req);
  if (!token || !isPatToken(token)) {
    res.status(401).json({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "MCP audit requires a Personal Access Token (cs_pat_...).",
    });
    return;
  }

  let resolved;
  try {
    resolved = await resolvePersonalAccessToken(token);
  } catch {
    res.status(401).json({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "PAT is revoked, expired, or unknown.",
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

  await writeMcpAuditRow({
    toolName: parsed.data.toolName,
    patId: resolved.patId,
    userId: resolved.userId,
    startedAt: new Date(parsed.data.startedAt),
    durationMs: parsed.data.durationMs,
    ok: parsed.data.ok,
    errorStatus: parsed.data.errorStatus,
    errorMessage: parsed.data.errorMessage,
  });

  res.json({ ok: true });
});

export default router;
