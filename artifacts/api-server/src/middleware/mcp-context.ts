import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type McpContext = {
  toolName: string;
  patId: string;
  userId: string;
};

const storage = new AsyncLocalStorage<McpContext>();

const TOOL_HEADER = "x-mcp-tool";
const INTERNAL_HEADER = "x-mcp-internal";
const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_/-]{0,63}$/;

const MCP_INTERNAL_SECRET = crypto.randomBytes(32).toString("base64url");

export function getMcpInternalSecret(): string {
  return MCP_INTERNAL_SECRET;
}

export function captureMcpContext(req: Request, _res: Response, next: NextFunction) {
  const toolHeader = req.headers[TOOL_HEADER];
  const internalHeader = req.headers[INTERNAL_HEADER];
  const toolName = Array.isArray(toolHeader) ? toolHeader[0] : toolHeader;
  const internalSecret = Array.isArray(internalHeader) ? internalHeader[0] : internalHeader;
  const patId = req.auth?.patId;
  const userId = req.auth?.userId;

  if (
    typeof toolName === "string" &&
    toolName.length > 0 &&
    TOOL_NAME_PATTERN.test(toolName) &&
    typeof internalSecret === "string" &&
    typeof patId === "string" &&
    patId.length > 0 &&
    typeof userId === "string" &&
    secretsMatch(internalSecret, MCP_INTERNAL_SECRET)
  ) {
    storage.run({ toolName, patId, userId }, () => next());
    return;
  }

  next();
}

function secretsMatch(candidate: string, expected: string): boolean {
  const candidateBuf = Buffer.from(candidate, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (candidateBuf.length !== expectedBuf.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(candidateBuf, expectedBuf);
  } catch {
    return false;
  }
}

export function getMcpContext(): McpContext | undefined {
  return storage.getStore();
}

function runWithMcpContext<T>(ctx: McpContext, fn: () => T): T {
  return storage.run(ctx, fn);
}
