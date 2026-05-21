import { api, refreshSession } from "./api"
import { apiUrl } from "./api-origin"
import { useAuthStore } from "@/store/auth"

export type AgentCitation = {
  kind:
    | "job"
    | "lead"
    | "client"
    | "file"
    | "folder"
    | "daily_log"
    | "schedule_item"
    | "user"
    | "activity"
  id: string
  label?: string
  jobId?: string
}

export type AgentToolCall = {
  id: string
  name: string
  input: unknown
  status: "pending" | "ok" | "error"
  resultSummary?: string
  errorMessage?: string
  durationMs?: number
  citations?: AgentCitation[]
}

// Mirror of `agentMessageStoppedReasons` in `lib/db/src/schema/agent.ts`.
// Kept in sync manually because the Vite client can't import from the
// server's @workspace/db package without dragging the drizzle/pg deps into
// the browser bundle. If you add a value server-side, add it here too.
export const agentMessageStoppedReasons = [
  "end_turn",
  "max_tokens",
  "stop_sequence",
  "tool_use",
  "pause_turn",
  "refusal",
  "aborted",
  "api_error",
  "max_iterations",
  "length",
  "content_filter",
  "tool_calls",
  "error",
] as const
export type AgentMessageStoppedReason = (typeof agentMessageStoppedReasons)[number]

export type AgentMessage = {
  id: string
  conversationId: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  toolCalls: AgentToolCall[] | null
  citations: AgentCitation[] | null
  inputTokens: number | null
  outputTokens: number | null
  stoppedReason: AgentMessageStoppedReason | null
  createdAt: string
}

export type AgentConversation = {
  id: string
  userId: string
  title: string
  pinned: boolean
  lastMessageAt: string
  createdAt: string
  updatedAt: string
}

export type AgentUsage = {
  yearMonth: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  requests: number
  cap: number
  remaining: number
  exceeded: boolean
}

export async function listConversations(): Promise<AgentConversation[]> {
  const res = await api.get<{ conversations: AgentConversation[] }>(
    "/agent/conversations",
  )
  return res.data.conversations
}

export async function createConversation(): Promise<AgentConversation> {
  const res = await api.post<{ conversation: AgentConversation }>(
    "/agent/conversations",
    {},
  )
  return res.data.conversation
}

export async function patchConversation(
  id: string,
  body: { title?: string; pinned?: boolean },
): Promise<AgentConversation> {
  const res = await api.patch<{ conversation: AgentConversation }>(
    `/agent/conversations/${id}`,
    body,
  )
  return res.data.conversation
}

export async function deleteConversation(id: string): Promise<void> {
  await api.delete(`/agent/conversations/${id}`)
}

export async function listMessages(id: string): Promise<AgentMessage[]> {
  const res = await api.get<{ messages: AgentMessage[] }>(
    `/agent/conversations/${id}/messages`,
  )
  return res.data.messages
}

export async function getUsage(): Promise<AgentUsage> {
  const res = await api.get<AgentUsage>("/agent/usage")
  return res.data
}

export type StreamEvent =
  | { type: "status"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | {
      type: "tool_result"
      id: string
      ok: boolean
      summary: string
      durationMs: number
      citations: AgentCitation[]
      errorMessage?: string
    }
  | { type: "delta"; text: string }
  | {
      type: "done"
      messageId: string
      stoppedReason?: AgentMessageStoppedReason
      usage: { inputTokens: number; outputTokens: number }
      citations: AgentCitation[]
    }
  | { type: "error"; message: string }
  | { type: "user_message"; message: AgentMessage }

export type StreamHandlers = {
  onEvent: (event: StreamEvent) => void
  onDone: () => void
  onError: (message: string) => void
}

export type StreamHandle = {
  abort: () => void
}

/**
 * Send a message to a conversation and stream Server-Sent Events back.
 *
 * We use fetch + ReadableStream rather than EventSource because EventSource
 * doesn't support custom headers (we need Authorization: Bearer …).
 */
export function streamSendMessage(
  conversationId: string,
  content: string,
  handlers: StreamHandlers,
): StreamHandle {
  const controller = new AbortController()
  const buildHeaders = (token: string | null) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-Requested-With": "XMLHttpRequest",
    }
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }

  const send = (token: string | null) =>
    fetch(apiUrl(`/api/agent/conversations/${conversationId}/messages`), {
      method: "POST",
      headers: buildHeaders(token),
      credentials: "include",
      signal: controller.signal,
      body: JSON.stringify({ content }),
    })

  void (async () => {
    try {
      let res = await send(useAuthStore.getState().accessToken)

      if (res.status === 401 && !controller.signal.aborted) {
        const refreshedToken = await refreshSession()
        if (refreshedToken && !controller.signal.aborted) {
          res = await send(refreshedToken)
        }
      }

      if (!res.ok || !res.body) {
        let message = `Request failed (${res.status})`
        try {
          const data = (await res.json()) as { detail?: string; title?: string }
          message = data.detail ?? data.title ?? message
        } catch {
          /* ignore */
        }
        handlers.onError(message)
        handlers.onDone()
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE frames are separated by blank lines.
        let idx: number
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const lines = frame.split("\n")
          let eventName: string | null = null
          let dataPayload = ""
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim()
            } else if (line.startsWith("data:")) {
              dataPayload += (dataPayload ? "\n" : "") + line.slice(5).trimStart()
            }
          }
          if (!dataPayload) continue
          try {
            const parsed = JSON.parse(dataPayload) as
              | StreamEvent
              | { message: AgentMessage }
            if (eventName === "user_message") {
              handlers.onEvent({
                type: "user_message",
                message: (parsed as { message: AgentMessage }).message,
              })
            } else {
              handlers.onEvent(parsed as StreamEvent)
            }
          } catch (err) {
            console.warn("agent stream parse failed", err, dataPayload)
          }
        }
      }
      handlers.onDone()
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        handlers.onDone()
        return
      }
      const message = err instanceof Error ? err.message : "Stream failed"
      handlers.onError(message)
      handlers.onDone()
    }
  })()

  return {
    abort: () => controller.abort(),
  }
}
