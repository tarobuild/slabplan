import { TOOL_DEFINITIONS, type McpToolDefinition } from "@workspace/mcp-server";
import { zodToJsonSchema } from "zod-to-json-schema";

// In-app agent is read-only by design (Task #109). Only the tools below are
// surfaced to Claude. Write tools (create/update/delete/move/rename, todo
// flips, schedule completion, file/folder mutations, attach_file, etc.)
// are intentionally absent — there is no way for the model to reach them.
export const READ_ONLY_AGENT_TOOL_NAMES = [
  "list_jobs",
  "get_job",
  "list_leads",
  "get_lead",
  "list_clients",
  "get_client",
  "list_contacts",
  "get_contact",
  "list_daily_logs",
  "get_daily_log",
  "list_schedule_items",
  "get_schedule_item",
  "list_folders",
  "get_folder",
  "list_files",
  "get_file",
  "search",
  "read_activity",
  "list_users",
  "whoami",
] as const;

type AgentToolName = (typeof READ_ONLY_AGENT_TOOL_NAMES)[number];

const READ_ONLY_SET = new Set<string>(READ_ONLY_AGENT_TOOL_NAMES);

export const AGENT_TOOL_DEFINITIONS: McpToolDefinition[] = TOOL_DEFINITIONS.filter(
  (def) => READ_ONLY_SET.has(def.name),
);

export type AnthropicToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

function toAnthropicSchema(def: McpToolDefinition): AnthropicToolDefinition["input_schema"] {
  const raw = zodToJsonSchema(def.inputSchema, { target: "openApi3" }) as Record<
    string,
    unknown
  >;
  // Anthropic tool input_schema must be a JSON Schema object with type "object".
  return {
    type: "object",
    properties: (raw.properties as Record<string, unknown>) ?? {},
    required: Array.isArray(raw.required) ? (raw.required as string[]) : undefined,
  };
}

export function buildAnthropicTools(): AnthropicToolDefinition[] {
  return AGENT_TOOL_DEFINITIONS.map((def) => ({
    name: def.name,
    description: def.description,
    input_schema: toAnthropicSchema(def),
  }));
}

export function findAgentTool(name: string): McpToolDefinition | undefined {
  return AGENT_TOOL_DEFINITIONS.find((def) => def.name === name);
}
