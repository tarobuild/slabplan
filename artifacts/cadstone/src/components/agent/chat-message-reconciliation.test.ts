import assert from "node:assert/strict"
import test from "node:test"
import type { AgentMessage } from "@/lib/agent-api"
import { reconcileFailedSendMessages } from "./chat-message-reconciliation.ts"

function message(overrides: Partial<AgentMessage>): AgentMessage {
  return {
    id: "msg-1",
    conversationId: "conversation-1",
    role: "assistant",
    content: "",
    toolCalls: null,
    citations: null,
    inputTokens: null,
    outputTokens: null,
    stoppedReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

test("failed stream startup removes optimistic user and assistant placeholder", () => {
  const next = reconcileFailedSendMessages(
    [
      message({ id: "old", content: "Earlier answer" }),
      message({ id: "pending-user", role: "user", content: "hello" }),
      message({ id: "pending-assistant", role: "assistant", content: "" }),
    ],
    {
      optimisticUserId: "pending-user",
      placeholderId: "pending-assistant",
      message: "network down",
      hasPersistedUserMessage: false,
    },
  )

  assert.deepEqual(
    next.map((m) => m.id),
    ["old"],
  )
})

test("failed stream after persisted user keeps the turn with an explicit failure", () => {
  const next = reconcileFailedSendMessages(
    [
      message({ id: "persisted-user", role: "user", content: "hello" }),
      message({ id: "pending-assistant", role: "assistant", content: "" }),
    ],
    {
      optimisticUserId: "pending-user",
      placeholderId: "pending-assistant",
      message: "model unavailable",
      hasPersistedUserMessage: true,
    },
  )

  assert.equal(next.length, 2)
  assert.equal(next[0]?.id, "persisted-user")
  assert.equal(next[1]?.content, "(Message failed: model unavailable)")
})
