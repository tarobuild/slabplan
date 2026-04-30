import { pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCadstoneMcpServer, type ToolAuditHook } from "./server";

export async function runStdioServer(): Promise<void> {
  const baseUrl = process.env["CADSTONE_API_URL"];
  const pat = process.env["CADSTONE_PAT"];

  if (!baseUrl) {
    process.stderr.write("CADSTONE_API_URL is required (e.g. https://your-app.replit.app)\n");
    process.exit(2);
  }
  if (!pat || !pat.startsWith("cs_pat_")) {
    process.stderr.write("CADSTONE_PAT must be a Personal Access Token starting with cs_pat_\n");
    process.exit(2);
  }

  const auditHook = createStdioAuditHook(baseUrl, pat);
  const server = createCadstoneMcpServer({ baseUrl, pat, auditHook });
  const transport = new StdioServerTransport();

  transport.onerror = (err) => {
    process.stderr.write(`[cadstone-mcp] transport error: ${err.message}\n`);
  };

  await server.connect(transport);

  await new Promise<void>((resolve) => {
    const close = () => resolve();
    transport.onclose = close;
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
  });

  await server.close().catch(() => {
    /* ignore */
  });
}

export function createStdioAuditHook(baseUrl: string, pat: string): ToolAuditHook {
  const auditUrl = `${baseUrl.replace(/\/$/, "")}/api/mcp/audit`;
  return async (event) => {
    const body: Record<string, unknown> = {
      toolName: event.toolName,
      startedAt: event.startedAt.toISOString(),
      durationMs: event.durationMs,
      ok: event.outcome.ok,
    };
    if (!event.outcome.ok) {
      body["errorStatus"] = event.outcome.status;
      body["errorMessage"] = event.outcome.message;
    }

    try {
      const res = await fetch(auditUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pat}`,
          "Content-Type": "application/json",
          "User-Agent": "cadstone-mcp-stdio/0.1",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        process.stderr.write(
          `[cadstone-mcp] audit POST returned ${res.status} for ${event.toolName}\n`,
        );
      }
    } catch (err) {
      process.stderr.write(
        `[cadstone-mcp] audit POST failed for ${event.toolName}: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const entryUrl = pathToFileURL(path.resolve(entry)).href;
    if (entryUrl !== import.meta.url) return false;
    // Guard against false positives when this module is bundled into a
    // larger application (e.g. api-server's dist/index.mjs) where
    // import.meta.url may equal argv[1] even though we never want the
    // CLI to auto-run. The bin script sets MCP_STDIO_DIRECT=1 to opt in.
    return process.env["MCP_STDIO_DIRECT"] === "1";
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  runStdioServer().catch((err) => {
    process.stderr.write(
      `[cadstone-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
