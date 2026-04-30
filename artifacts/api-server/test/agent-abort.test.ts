import assert from "node:assert/strict";
import { test } from "node:test";

// The orchestrator imports the Anthropic singleton at module load, and that
// client throws on import unless these env vars are present. The test never
// makes a real network call; we monkey-patch `messages.create` below.
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://127.0.0.1:0";
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-key-not-used";
// Same story for the DB pool; recordUsage is wrapped in try/catch in the
// orchestrator so a failed insert downgrades to a logger.warn instead of
// breaking the test, but importing `@workspace/db` requires a DATABASE_URL
// at module load.
process.env.DATABASE_URL ??=
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";
process.env.LOG_LEVEL ??= "silent";

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

test("aborting mid-stream stops downstream work within ~1s and skips persistence", async () => {
  await withMockedAnthropic(
    (_body, options) => {
      // Simulate Anthropic that hangs forever unless the caller aborts.
      // The SDK passes the user-provided AbortSignal through under
      // `options.signal`; honoring it is what proves the orchestrator
      // plumbed the controller all the way down to the API call.
      return new Promise((_resolve, reject) => {
        const signal = (options as { signal?: AbortSignal } | undefined)
          ?.signal;
        if (!signal) {
          reject(new Error("orchestrator did not pass signal to anthropic"));
          return;
        }
        if (signal.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          },
          { once: true },
        );
      }) as ReturnType<AnthropicMessagesCreate>;
    },
    async () => {
      const controller = new AbortController();
      const emitted: unknown[] = [];
      let savedAssistantMessage = false;

      const startedAt = Date.now();

      // Abort after a short delay so the orchestrator is genuinely
      // "in-flight" when the cancel arrives.
      setTimeout(() => controller.abort(), 50);

      const result = await runAgentTurn({
        userId: "abort-test-user",
        bearerToken: "test-bearer",
        baseUrl: "http://127.0.0.1:1",
        history: [],
        userMessage: "hello",
        signal: controller.signal,
        emit: (event) => emitted.push(event),
        saveAssistantMessage: async () => {
          savedAssistantMessage = true;
          return { id: "should-not-happen" };
        },
      });

      const elapsed = Date.now() - startedAt;

      // Returned within ~1s — the abort short-circuits the hung call.
      assert.ok(
        elapsed < 1000,
        `orchestrator should unwind within 1s of abort, took ${elapsed}ms`,
      );
      assert.equal(result.aborted, true);
      assert.equal(result.ok, false);
      assert.equal(result.messageId, undefined);

      // Critical: no partial assistant row was persisted, and no `done`
      // event was emitted (the SSE consumer is gone).
      assert.equal(savedAssistantMessage, false);
      assert.ok(
        !emitted.some((e) => (e as { type?: string }).type === "done"),
        "must not emit `done` after abort",
      );
    },
  );
});

test("usage from a partial response is still metered when the run aborts before completion", async () => {
  // First call returns successfully WITH usage (so the orchestrator has
  // tokens to record), and asks the model to continue with a tool call.
  // Second call hangs until aborted. Verifies that on the abort path the
  // already-spent tokens are not lost.
  let createCallCount = 0;
  await withMockedAnthropic(
    (_body, options) => {
      createCallCount += 1;
      if (createCallCount === 1) {
        return Promise.resolve({
          id: "msg_partial",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 1234, output_tokens: 567 },
          content: [
            { type: "text", text: "Working on it…" },
            // No tool_use block — the model "asked" to continue but we
            // simulate the plain text + a tool_use stop reason. This
            // forces the orchestrator into another iteration so the
            // hang-on-abort fires on call #2.
            {
              type: "tool_use",
              id: "toolu_xyz",
              name: "search",
              input: { query: "ignored" },
            },
          ],
        }) as never;
      }
      return new Promise((_resolve, reject) => {
        const signal = (options as { signal?: AbortSignal } | undefined)
          ?.signal;
        signal?.addEventListener(
          "abort",
          () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          },
          { once: true },
        );
      }) as ReturnType<AnthropicMessagesCreate>;
    },
    async () => {
      const controller = new AbortController();
      // Abort after the first call completes and the second begins.
      setTimeout(() => controller.abort(), 100);

      // We read what the orchestrator returns rather than monkey-patching
      // the bound `recordUsage` reference inside the module. The contract
      // is: `result.totalInputTokens / totalOutputTokens` reflects what
      // was passed into `recordUsage` on this run, and the orchestrator
      // calls `recordUsage` BEFORE the abort short-circuits the
      // saveAssistantMessage path — see the "Always meter what we already
      // spent, even on abort" block in `lib/agent/orchestrator.ts`.
      const result = await runAgentTurn({
        userId: "abort-meter-user",
        bearerToken: "test-bearer",
        baseUrl: "http://127.0.0.1:1",
        history: [],
        userMessage: "hello",
        signal: controller.signal,
        // The first call's text block triggers a tool fetch through the
        // ApiClient — that fetch will attempt to hit 127.0.0.1:1 and the
        // signal will abort it. Capture emitted events for sanity only.
        emit: () => {},
        saveAssistantMessage: async () => ({ id: "should-not-happen" }),
      });

      assert.equal(result.aborted, true);
      assert.equal(result.totalInputTokens, 1234);
      assert.equal(result.totalOutputTokens, 567);
    },
  );
});
