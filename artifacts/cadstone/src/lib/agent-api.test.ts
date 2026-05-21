import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import type { StreamEvent } from "./agent-api.ts"
import type { AuthUser } from "@/store/auth"

const { authApi } = await import("./api.ts")
const { streamSendMessage } = await import("./agent-api.ts")
const { useAuthStore } = await import("@/store/auth")

const originalFetch = globalThis.fetch
const originalAuthPost = authApi.post

const testUser: AuthUser = {
  id: "user-1",
  email: "user@example.com",
  fullName: "User One",
  role: "admin",
  avatarUrl: null,
  phone: null,
}

afterEach(() => {
  globalThis.fetch = originalFetch
  authApi.post = originalAuthPost
  useAuthStore.getState().clearAuth()
})

function sseResponse(event: StreamEvent) {
  const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  return new Response(frame, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

test("streamSendMessage refreshes once and retries after a 401", async () => {
  useAuthStore.getState().setAuth(testUser, "expired-token")
  authApi.post = (async () => ({
    data: {
      accessToken: "fresh-token",
      user: testUser,
    },
  })) as typeof authApi.post

  const requests: Array<{ authorization: string | null }> = []
  globalThis.fetch = (async (_input, init) => {
    const headers = new Headers(init?.headers)
    requests.push({ authorization: headers.get("Authorization") })
    if (requests.length === 1) {
      return new Response(JSON.stringify({ detail: "expired" }), { status: 401 })
    }
    return sseResponse({
      type: "done",
      messageId: "msg-1",
      usage: { inputTokens: 1, outputTokens: 2 },
      citations: [],
    })
  }) as typeof fetch

  const events: StreamEvent[] = []
  await new Promise<void>((resolve, reject) => {
    streamSendMessage("conversation-1", "hello", {
      onEvent: (event) => events.push(event),
      onDone: resolve,
      onError: reject,
    })
  })

  assert.deepEqual(requests, [
    { authorization: "Bearer expired-token" },
    { authorization: "Bearer fresh-token" },
  ])
  assert.equal(events.at(-1)?.type, "done")
})
