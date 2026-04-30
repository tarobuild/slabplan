import assert from "node:assert/strict";
import { test } from "node:test";

import {
  _resetInFlightForTests,
  getInFlightCount,
  maxInFlightPerUser,
  releaseSlot,
  tryAcquireSlot,
} from "../src/lib/agent/inflight.ts";

test("default in-flight cap is 1", () => {
  const original = process.env.AGENT_MAX_INFLIGHT;
  delete process.env.AGENT_MAX_INFLIGHT;
  try {
    assert.equal(maxInFlightPerUser(), 1);
  } finally {
    if (original !== undefined) process.env.AGENT_MAX_INFLIGHT = original;
  }
});

test("AGENT_MAX_INFLIGHT env override is respected; junk falls back to default", () => {
  const original = process.env.AGENT_MAX_INFLIGHT;
  try {
    process.env.AGENT_MAX_INFLIGHT = "3";
    assert.equal(maxInFlightPerUser(), 3);

    process.env.AGENT_MAX_INFLIGHT = "not-a-number";
    assert.equal(maxInFlightPerUser(), 1);

    process.env.AGENT_MAX_INFLIGHT = "0";
    assert.equal(maxInFlightPerUser(), 1);

    process.env.AGENT_MAX_INFLIGHT = "-5";
    assert.equal(maxInFlightPerUser(), 1);
  } finally {
    if (original === undefined) delete process.env.AGENT_MAX_INFLIGHT;
    else process.env.AGENT_MAX_INFLIGHT = original;
  }
});

test("tryAcquireSlot enforces the per-user cap and releaseSlot frees it", () => {
  _resetInFlightForTests();
  const original = process.env.AGENT_MAX_INFLIGHT;
  process.env.AGENT_MAX_INFLIGHT = "1";
  try {
    const userId = "user-cap-1";
    assert.equal(tryAcquireSlot(userId), true);
    assert.equal(getInFlightCount(userId), 1);

    // Second concurrent acquire is rejected — the user already holds the
    // single allowed slot.
    assert.equal(tryAcquireSlot(userId), false);
    assert.equal(getInFlightCount(userId), 1);

    // After release, the slot is available again.
    releaseSlot(userId);
    assert.equal(getInFlightCount(userId), 0);
    assert.equal(tryAcquireSlot(userId), true);
    releaseSlot(userId);
  } finally {
    if (original === undefined) delete process.env.AGENT_MAX_INFLIGHT;
    else process.env.AGENT_MAX_INFLIGHT = original;
    _resetInFlightForTests();
  }
});

test("each user has its own slot — one user's hold doesn't block another", () => {
  _resetInFlightForTests();
  const original = process.env.AGENT_MAX_INFLIGHT;
  process.env.AGENT_MAX_INFLIGHT = "1";
  try {
    assert.equal(tryAcquireSlot("user-a"), true);
    // user-a is at the cap, but user-b has its own bucket.
    assert.equal(tryAcquireSlot("user-a"), false);
    assert.equal(tryAcquireSlot("user-b"), true);
    assert.equal(getInFlightCount("user-a"), 1);
    assert.equal(getInFlightCount("user-b"), 1);
  } finally {
    if (original === undefined) delete process.env.AGENT_MAX_INFLIGHT;
    else process.env.AGENT_MAX_INFLIGHT = original;
    _resetInFlightForTests();
  }
});

test("releaseSlot is safe to call when no slot is held (clean-up paths)", () => {
  _resetInFlightForTests();
  // No throw; counter stays at 0.
  releaseSlot("never-acquired");
  assert.equal(getInFlightCount("never-acquired"), 0);
  // Acquire then over-release doesn't go negative.
  assert.equal(tryAcquireSlot("uA"), true);
  releaseSlot("uA");
  releaseSlot("uA");
  assert.equal(getInFlightCount("uA"), 0);
});

test("a try/finally pattern around tryAcquireSlot guarantees release even on throw", async () => {
  // Mirrors the route's contract: any code path after a successful acquire
  // — including DB failures during auto-title or history load — MUST end
  // up releasing the slot, otherwise the user gets stuck at the cap until
  // process restart. This is a regression guard for the
  // "in-flight slot leak on async failures" review finding.
  _resetInFlightForTests();
  const original = process.env.AGENT_MAX_INFLIGHT;
  process.env.AGENT_MAX_INFLIGHT = "1";
  try {
    const userId = "leak-guard-user";

    async function simulateRouteHandler(shouldThrow: boolean) {
      if (!tryAcquireSlot(userId)) {
        throw new Error("expected free slot for the test");
      }
      try {
        // Simulate "post-acquire async work that may fail" — e.g. the
        // history-load DB query that sits between the slot acquire and
        // `runAgentTurn`'s own try/finally.
        await Promise.resolve();
        if (shouldThrow) throw new Error("simulated DB failure");
      } finally {
        releaseSlot(userId);
      }
    }

    // First call throws — the finally must still release the slot.
    await assert.rejects(simulateRouteHandler(true), /simulated DB failure/);
    assert.equal(getInFlightCount(userId), 0);

    // Slot is free for a fresh request.
    await simulateRouteHandler(false);
    assert.equal(getInFlightCount(userId), 0);

    // And several throw-then-success cycles never leak.
    for (let i = 0; i < 5; i += 1) {
      await assert.rejects(simulateRouteHandler(true));
      assert.equal(getInFlightCount(userId), 0);
    }
  } finally {
    if (original === undefined) delete process.env.AGENT_MAX_INFLIGHT;
    else process.env.AGENT_MAX_INFLIGHT = original;
    _resetInFlightForTests();
  }
});

test("with cap=2, the third concurrent acquire is rejected", () => {
  _resetInFlightForTests();
  const original = process.env.AGENT_MAX_INFLIGHT;
  process.env.AGENT_MAX_INFLIGHT = "2";
  try {
    assert.equal(tryAcquireSlot("u"), true);
    assert.equal(tryAcquireSlot("u"), true);
    assert.equal(tryAcquireSlot("u"), false);
    releaseSlot("u");
    // After releasing one, a new acquire fits again.
    assert.equal(tryAcquireSlot("u"), true);
    assert.equal(getInFlightCount("u"), 2);
  } finally {
    if (original === undefined) delete process.env.AGENT_MAX_INFLIGHT;
    else process.env.AGENT_MAX_INFLIGHT = original;
    _resetInFlightForTests();
  }
});
