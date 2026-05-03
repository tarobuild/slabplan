import assert from "node:assert/strict";
import { test } from "node:test";

// `normalizeStoppedReason` itself doesn't touch the DB or Anthropic, but
// it lives in the agent module tree and a sibling import (`../logger`)
// pulls in pino which is fine in isolation. Keep the env defaults in case
// a future refactor adds a transitive import that needs them.
process.env.LOG_LEVEL ??= "silent";

const { normalizeStoppedReason } = await import(
  "../src/lib/agent/stopped-reason.ts"
);
const { agentMessageStoppedReasons } = await import("@workspace/db/schema");

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
