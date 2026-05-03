import type { Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import type {
  AgentCitation,
  AgentMessage,
  AgentMessageStoppedReason,
  AgentToolCall,
} from "@workspace/db/schema";
import { ApiClient, ApiError } from "@workspace/mcp-server";
import { extractCitations, summarizeToolResult } from "./citations";
import { normalizeStoppedReason } from "./stopped-reason";
import { buildAnthropicTools, findAgentTool } from "./tools";
import { recordUsage } from "./usage";
import { logger } from "../logger";

const AGENT_MODEL = process.env.AGENT_MODEL || "claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 4096;
const MAX_TOOL_ITERATIONS = 8;
const MAX_HISTORY_MESSAGES = 30;

const SYSTEM_PROMPT = `You are the in-app assistant for CAD Stone Networks, a construction management platform. You help signed-in users find and understand information across jobs, leads, files, daily logs, schedule items, contacts, clients, and activity.

CRITICAL RULES:
1. You are READ-ONLY. You cannot create, modify, move, rename, or delete anything. Tools you have access to only fetch data. If a user asks to make a change, tell them they need to do it themselves in the UI and (if possible) point them to the right page.
2. Always ground your answers in tool results. If you cannot find the data, say so plainly — do NOT invent record IDs, names, dates, or values. It is better to say "I couldn't find that" than to guess.
3. When you reference a record (a job, lead, client, file, daily log, schedule item, etc.), the UI will automatically render a clickable chip from the record's id in the tool result. You don't need to format URLs yourself — just mention the record naturally (e.g. "the foundation pour log on March 12").
4. Respect the user's permissions: tool calls run as the calling user. If a tool returns "not found" or empty, that may mean the record exists but the user can't see it; don't speculate.
5. Keep answers tight. Pull only the data you need; prefer search before listing everything; cite specific records with their titles and dates.

You have read tools like \`search\`, \`list_jobs\`, \`get_job\`, \`list_daily_logs\`, \`get_daily_log\`, \`list_files\`, \`get_file\`, \`list_schedule_items\`, \`list_leads\`, \`get_lead\`, \`list_clients\`, \`read_activity\`, \`list_users\`, and \`whoami\`. Start with \`search\` for broad queries.`;

type AnthropicMessage = {
  role: "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
          }
        | {
            type: "tool_result";
            tool_use_id: string;
            content: string;
            is_error?: boolean;
          }
      >;
};

export type AgentOrchestratorEvent =
  | { type: "status"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      id: string;
      ok: boolean;
      summary: string;
      durationMs: number;
      citations: AgentCitation[];
      errorMessage?: string;
    }
  | { type: "delta"; text: string }
  | {
      type: "done";
      messageId: string;
      stoppedReason?: AgentMessageStoppedReason;
      usage: { inputTokens: number; outputTokens: number };
      citations: AgentCitation[];
    }
  | { type: "error"; message: string };

export type AgentOrchestratorOptions = {
  userId: string;
  bearerToken: string;
  baseUrl: string;
  history: AgentMessage[];
  userMessage: string;
  emit: (event: AgentOrchestratorEvent) => void;
  saveAssistantMessage: (payload: {
    text: string;
    toolCalls: AgentToolCall[];
    citations: AgentCitation[];
    inputTokens: number;
    outputTokens: number;
    stoppedReason?: AgentMessageStoppedReason;
  }) => Promise<{ id: string }>;
  /**
   * Aborted when the SSE consumer drops the connection. Plumbed all the way
   * down into the Anthropic SDK and the MCP `ApiClient` so an in-flight
   * Anthropic stream and the next tool call both terminate within ~1s of
   * `req.on("close")` firing instead of running to completion against a
   * client that is no longer listening.
   */
  signal?: AbortSignal;
};

export type AgentOrchestratorResult = {
  ok: boolean;
  aborted: boolean;
  messageId?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
};

function buildHistoryForApi(history: AgentMessage[], userText: string): AnthropicMessage[] {
  const trimmed = history.slice(-MAX_HISTORY_MESSAGES);
  const out: AnthropicMessage[] = [];
  for (const m of trimmed) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const text = m.content?.trim() ? m.content : "(no response)";
      out.push({ role: "assistant", content: text });
    }
  }
  out.push({ role: "user", content: userText });
  return out;
}

export async function runAgentTurn(
  opts: AgentOrchestratorOptions,
): Promise<AgentOrchestratorResult> {
  const tools = buildAnthropicTools();
  const signal = opts.signal;
  const apiClient = new ApiClient({
    baseUrl: opts.baseUrl,
    token: opts.bearerToken,
    userAgent: "cadstone-in-app-agent/0.1",
    signal,
  });

  const messages = buildHistoryForApi(opts.history, opts.userMessage);
  let assistantText = "";
  const toolCalls: AgentToolCall[] = [];
  const citations: AgentCitation[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let stoppedReason: AgentMessageStoppedReason | undefined;
  const isAborted = () => signal?.aborted === true;

  function pushCitations(more: AgentCitation[]) {
    for (const c of more) {
      if (!citations.some((existing) => existing.kind === c.kind && existing.id === c.id)) {
        citations.push(c);
      }
    }
  }

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    if (isAborted()) {
      stoppedReason = "aborted";
      break;
    }
    if (iter > 0) {
      opts.emit({ type: "status", text: "Thinking…" });
    }

    let response;
    try {
      response = await anthropic.messages.create(
        {
          model: AGENT_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SYSTEM_PROMPT,
          tools,
          messages: messages as never,
        },
        signal ? { signal } : undefined,
      );
    } catch (err) {
      // If the SSE consumer dropped mid-stream the SDK rejects with an
      // AbortError; treat that as a clean abort, not an "api_error" we'd
      // surface in the UI.
      if (isAborted() || isAbortError(err)) {
        stoppedReason = "aborted";
        break;
      }
      logger.error({ err }, "Agent: anthropic.messages.create failed");
      const message =
        err instanceof Error ? err.message : "Failed to call the assistant.";
      opts.emit({ type: "error", message });
      stoppedReason = "api_error";
      break;
    }

    if (response.usage) {
      totalInputTokens += response.usage.input_tokens ?? 0;
      totalOutputTokens += response.usage.output_tokens ?? 0;
    }

    // Mirror the assistant's content into our history so subsequent turns
    // include both text and tool_use blocks (Anthropic requires that).
    const assistantContentForHistory: AnthropicMessage["content"] = [];

    let toolResultsForNextTurn: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }> = [];

    for (const block of response.content) {
      if (block.type === "text") {
        if (block.text) {
          assistantText += (assistantText ? "\n\n" : "") + block.text;
          opts.emit({ type: "delta", text: block.text });
          assistantContentForHistory.push({ type: "text", text: block.text });
        }
      } else if (block.type === "tool_use") {
        // Honor an abort that arrived while we were processing the previous
        // block in the same response — stop dispatching the next tool call
        // immediately rather than letting the loop walk the rest of the
        // model's planned fan-out.
        if (isAborted()) {
          stoppedReason = "aborted";
          break;
        }
        const toolName = block.name;
        const input = (block.input ?? {}) as Record<string, unknown>;
        opts.emit({ type: "tool_call", id: block.id, name: toolName, input });
        assistantContentForHistory.push({
          type: "tool_use",
          id: block.id,
          name: toolName,
          input,
        });

        const def = findAgentTool(toolName);
        const startedAt = Date.now();
        if (!def) {
          const errMsg = `Tool "${toolName}" is not available.`;
          toolResultsForNextTurn.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: errMsg,
            is_error: true,
          });
          toolCalls.push({
            id: block.id,
            name: toolName,
            input,
            status: "error",
            errorMessage: errMsg,
            durationMs: 0,
            citations: [],
          });
          opts.emit({
            type: "tool_result",
            id: block.id,
            ok: false,
            summary: errMsg,
            durationMs: 0,
            citations: [],
            errorMessage: errMsg,
          });
          continue;
        }

        try {
          const data = await def.handler(apiClient, { ...input });
          const durationMs = Date.now() - startedAt;
          const citationsForCall = extractCitations(toolName, data);
          const summary = summarizeToolResult(data);
          pushCitations(citationsForCall);
          toolCalls.push({
            id: block.id,
            name: toolName,
            input,
            status: "ok",
            resultSummary: summary,
            durationMs,
            citations: citationsForCall,
          });
          opts.emit({
            type: "tool_result",
            id: block.id,
            ok: true,
            summary,
            durationMs,
            citations: citationsForCall,
          });

          // Send the FULL JSON back to the model; the summary is for UI only.
          let serialized: string;
          try {
            serialized = JSON.stringify(data);
          } catch {
            serialized = String(data);
          }
          // Cap individual tool results to keep context manageable.
          const MAX_TOOL_RESULT_CHARS = 24_000;
          if (serialized.length > MAX_TOOL_RESULT_CHARS) {
            serialized = `${serialized.slice(0, MAX_TOOL_RESULT_CHARS)}\n... (truncated; ${serialized.length - MAX_TOOL_RESULT_CHARS} more chars)`;
          }
          toolResultsForNextTurn.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: serialized,
          });
        } catch (err) {
          // The active tool call's underlying fetch was aborted because the
          // SSE consumer dropped. Don't surface that as a tool error to the
          // model (or to the UI we're no longer streaming to) — just stop.
          if (isAborted() || isAbortError(err)) {
            stoppedReason = "aborted";
            break;
          }
          const durationMs = Date.now() - startedAt;
          const status = err instanceof ApiError ? err.status : 500;
          const message =
            err instanceof Error ? err.message : "Tool call failed.";
          toolCalls.push({
            id: block.id,
            name: toolName,
            input,
            status: "error",
            errorMessage: message,
            durationMs,
            citations: [],
          });
          opts.emit({
            type: "tool_result",
            id: block.id,
            ok: false,
            summary: `${status}: ${message}`,
            durationMs,
            citations: [],
            errorMessage: message,
          });
          toolResultsForNextTurn.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error ${status}: ${message}`,
            is_error: true,
          });
        }
      }
    }

    if (stoppedReason === "aborted") break;

    if (assistantContentForHistory.length > 0) {
      messages.push({ role: "assistant", content: assistantContentForHistory });
    }

    if (toolResultsForNextTurn.length > 0) {
      messages.push({ role: "user", content: toolResultsForNextTurn });
    }

    if (response.stop_reason !== "tool_use") {
      // Coerce any value the SDK returns (including ones we haven't added
      // to the allow-list yet) to a sentinel the DB CHECK accepts; see
      // `./stopped-reason.ts`.
      stoppedReason = normalizeStoppedReason(response.stop_reason ?? undefined);
      break;
    }

    if (iter === MAX_TOOL_ITERATIONS - 1) {
      stoppedReason = "max_iterations";
      const note =
        "I reached my tool-call budget for this turn. If I missed something, ask me to continue.";
      assistantText += (assistantText ? "\n\n" : "") + note;
      opts.emit({ type: "delta", text: `\n\n${note}` });
    }
  }

  const aborted = stoppedReason === "aborted" || isAborted();

  // Always meter what we already spent, even on abort. The Anthropic call
  // that returned the tokens has already left the building — the user's
  // monthly cap must reflect that, or aborting becomes a free retry.
  if (totalInputTokens > 0 || totalOutputTokens > 0) {
    try {
      await recordUsage(opts.userId, totalInputTokens, totalOutputTokens);
    } catch (err) {
      logger.warn({ err }, "Agent: failed to record usage");
    }
  }

  // On abort, do NOT persist a partial assistant message and do NOT emit
  // anything more on the SSE stream — the consumer is gone, and writing a
  // half-baked row to the conversation would surface a mangled bubble in
  // the UI on the next page load.
  if (aborted) {
    return {
      ok: false,
      aborted: true,
      totalInputTokens,
      totalOutputTokens,
    };
  }

  const saved = await opts.saveAssistantMessage({
    text: assistantText,
    toolCalls,
    citations,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    stoppedReason,
  });

  opts.emit({
    type: "done",
    messageId: saved.id,
    stoppedReason,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    citations,
  });

  return {
    ok: true,
    aborted: false,
    messageId: saved.id,
    totalInputTokens,
    totalOutputTokens,
  };
}

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    // Anthropic SDK 0.x and undici both surface a `code` of "ABORT_ERR" for
    // aborted fetches; check both shapes so a future SDK upgrade still routes
    // cancellation through the clean-abort path.
    const code = (err as Error & { code?: string }).code;
    if (code === "ABORT_ERR" || code === "ECONNRESET") return true;
  }
  return false;
}

export function writeSse(res: Response, event: AgentOrchestratorEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
