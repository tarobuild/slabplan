import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient, ApiError, type ApiClientOptions } from "./api-client";
import { TOOL_DEFINITIONS, TOOL_OUTPUT_SCHEMAS } from "./tools";
import { listResources, parseResourceUri, readResource } from "./resources";

export type CreateCadstoneMcpServerOptions = {
  baseUrl: string;
  pat: string;
  fetchImpl?: ApiClientOptions["fetchImpl"];
  userAgent?: string;
  internalSecret?: string;
  auditHook?: ToolAuditHook;
};

export type ToolAuditOutcome =
  | { ok: true; status: number | null }
  | { ok: false; status: number; message: string };

export type ToolAuditHook = (event: {
  toolName: string;
  startedAt: Date;
  durationMs: number;
  outcome: ToolAuditOutcome;
}) => void | Promise<void>;

const SERVER_INFO = {
  name: "cadstone-mcp",
  title: "CAD Stone Networks",
  version: "0.1.0",
} as const;

const SERVER_INSTRUCTIONS = `
You are connected to CAD Stone Networks, a construction-management workspace.
Authenticate with a Personal Access Token (cs_pat_…). Tool calls map directly
onto the documented REST API at /openapi.json — read it for the exact request
shapes you can send via the \`request\` escape-hatch tool. Every tool call is
recorded in the activity log with actor "agent_via_mcp".
`.trim();

export function createCadstoneMcpServer(opts: CreateCadstoneMcpServerOptions): McpServer {
  const client = new ApiClient({
    baseUrl: opts.baseUrl,
    token: opts.pat,
    fetchImpl: opts.fetchImpl,
    userAgent: opts.userAgent,
    internalSecret: opts.internalSecret,
  });

  const server = new McpServer(SERVER_INFO, {
    capabilities: {
      tools: {},
      resources: { listChanged: false },
      logging: {},
    },
    instructions: SERVER_INSTRUCTIONS,
  });

  const auditHook = opts.auditHook;

  for (const def of TOOL_DEFINITIONS) {
    const outputSchema = TOOL_OUTPUT_SCHEMAS[def.name];
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema,
        ...(outputSchema ? { outputSchema } : {}),
      },
      async (args: Record<string, unknown>) => {
        const startedAt = new Date();
        try {
          const data = await def.handler(client, args ?? {});
          const result = toToolResult(data);
          if (auditHook) {
            await auditHook({
              toolName: def.name,
              startedAt,
              durationMs: Date.now() - startedAt.getTime(),
              outcome: { ok: true, status: null },
            });
          }
          return result;
        } catch (err) {
          if (auditHook) {
            const status = err instanceof ApiError ? err.status : 500;
            const message = err instanceof Error ? err.message : String(err);
            await auditHook({
              toolName: def.name,
              startedAt,
              durationMs: Date.now() - startedAt.getTime(),
              outcome: { ok: false, status, message },
            });
          }
          return toToolError(def.name, err);
        }
      },
    );
  }

  server.registerResource(
    "cadstone-entity",
    new ResourceTemplate("cadstone://{kind}/{id}", {
      list: async () => {
        const items = await listResources(client);
        return {
          resources: items.map((r) => ({
            uri: r.uri,
            name: r.name,
            description: r.description,
            mimeType: r.mimeType,
          })),
        };
      },
    }),
    { description: "Browse CAD Stone jobs, leads, clients, files, and folders." },
    async (uri) => {
      const startedAt = new Date();
      const parsed = parseResourceUri(uri.href);
      const auditName = parsed
        ? `resources/read:${parsed.kind}`
        : "resources/read:unknown";
      try {
        if (!parsed) {
          throw new Error(`Unsupported CAD Stone URI: ${uri.href}`);
        }
        const content = await readResource(client, uri.href);
        if (auditHook) {
          await auditHook({
            toolName: auditName,
            startedAt,
            durationMs: Date.now() - startedAt.getTime(),
            outcome: { ok: true, status: null },
          });
        }
        return {
          contents: [
            {
              uri: content.uri,
              mimeType: content.mimeType,
              text: content.text,
            },
          ],
        };
      } catch (err) {
        if (auditHook) {
          const status = err instanceof ApiError ? err.status : 500;
          const message = err instanceof Error ? err.message : String(err);
          await auditHook({
            toolName: auditName,
            startedAt,
            durationMs: Date.now() - startedAt.getTime(),
            outcome: { ok: false, status, message },
          });
        }
        throw err;
      }
    },
  );

  return server;
}

function toToolResult(data: unknown) {
  let text: string;
  if (typeof data === "string") {
    text = data;
  } else {
    try {
      text = JSON.stringify(data, null, 2);
    } catch {
      text = String(data);
    }
  }

  const result: {
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: { [x: string]: unknown };
  } = {
    content: [{ type: "text", text }],
  };

  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    result.structuredContent = data as { [x: string]: unknown };
  }
  return result;
}

function toToolError(toolName: string, err: unknown) {
  const status = err instanceof ApiError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  const detail = err instanceof ApiError ? err.problem : undefined;
  const text = JSON.stringify(
    { tool: toolName, status, error: message, detail: detail ?? null },
    null,
    2,
  );
  return {
    isError: true,
    content: [{ type: "text" as const, text }],
  };
}
