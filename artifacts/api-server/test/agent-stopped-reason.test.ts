import assert from "node:assert/strict";
import { test } from "node:test";

// `normalizeStoppedReason` itself doesn't touch the DB or Anthropic, but
// it lives in the agent module tree and a sibling import (`../logger`)
// pulls in pino which is fine in isolation. Keep the env defaults in case
// a future refactor adds a transitive import that needs them.
process.env.LOG_LEVEL ??= "silent";
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://127.0.0.1:0";
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-key-not-used";
process.env.DATABASE_URL ??=
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

const { normalizeStoppedReason } = await import(
  "../src/lib/agent/stopped-reason.ts"
);
const { agentMessageStoppedReasons } = await import("@workspace/db/schema");
const { anthropic } = await import("@workspace/integrations-anthropic-ai");
const { runAgentTurn } = await import("../src/lib/agent/orchestrator.ts");

type AnthropicMessagesCreate = typeof anthropic.messages.create;

function withMockedAnthropic(
  mock: (...args: Parameters<AnthropicMessagesCreate>) => Promise<unknown>,
  run: () => Promise<void>,
): Promise<void> {
  const original = anthropic.messages.create.bind(anthropic.messages);
  (anthropic.messages as unknown as { create: unknown }).create = mock;
  return run().finally(() => {
    (anthropic.messages as unknown as { create: typeof original }).create =
      original;
  });
}

test("normalizeStoppedReason passes through every allowed value", () => {
  for (const value of agentMessageStoppedReasons) {
    assert.equal(normalizeStoppedReason(value), value);
  }
});

test("normalizeStoppedReason returns undefined for null/undefined", () => {
  assert.equal(normalizeStoppedReason(null), undefined);
  assert.equal(normalizeStoppedReason(undefined), undefined);
});

test("normalizeStoppedReason coerces unknown values to api_error", () => {
  // Simulate a future Anthropic SDK release shipping a brand-new
  // stop_reason that hasn't been added to the CHECK allow-list yet. The
  // orchestrator must NOT pass this straight through to the DB or the
  // assistant turn would fail to persist with a CHECK violation.
  assert.equal(
    normalizeStoppedReason("safety_review"),
    "api_error",
  );
  assert.equal(normalizeStoppedReason(""), "api_error");
  assert.equal(
    normalizeStoppedReason("model_overloaded"),
    "api_error",
  );
});

test("agentMessageStoppedReasons includes the api_error sentinel", () => {
  // The normalizer's fallback must itself be in the allow-list, otherwise
  // it would just trade one CHECK violation for another.
  assert.ok(
    (agentMessageStoppedReasons as readonly string[]).includes("api_error"),
  );
});

test("unknown successful model stop reasons still save the assistant message", async () => {
  await withMockedAnthropic(
    () =>
      Promise.resolve({
        id: "msg_unknown_stop",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        stop_reason: "safety_review",
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 5 },
        content: [{ type: "text", text: "Here is the answer." }],
      }) as ReturnType<AnthropicMessagesCreate>,
    async () => {
      const emitted: unknown[] = [];
      let savedStoppedReason: string | undefined;

      const result = await runAgentTurn({
        userId: "unknown-stop-user",
        bearerToken: "test-bearer",
        baseUrl: "http://127.0.0.1:1",
        history: [],
        userMessage: "hello",
        emit: (event) => emitted.push(event),
        saveAssistantMessage: async (payload) => {
          savedStoppedReason = payload.stoppedReason;
          return { id: "saved-message" };
        },
      });

      assert.equal(result.ok, true);
      assert.equal(result.aborted, false);
      assert.equal(result.messageId, "saved-message");
      assert.equal(savedStoppedReason, "api_error");
      assert.ok(
        emitted.some((event) => (event as { type?: string }).type === "done"),
        "successful response with an unknown stop_reason must still emit done",
      );
    },
  );
});
