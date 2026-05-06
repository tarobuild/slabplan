import assert from "node:assert/strict";
import { test } from "node:test";

import { __testing } from "../src/routes/reports.ts";

const { resolveRange, percentile, rangeQuerySchema } = __testing;

test("rangeQuerySchema rejects custom without from/to", () => {
  const r = rangeQuerySchema.safeParse({ range: "custom" });
  assert.equal(r.success, false);
});

test("rangeQuerySchema accepts last_30 default", () => {
  const r = rangeQuerySchema.safeParse({});
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.range, "last_90");
});

test("resolveRange last_30 returns 30-day window ending today", () => {
  const today = new Date().toISOString().slice(0, 10);
  const range = resolveRange({ range: "last_30", format: "json" });
  assert.equal(range.to, today);
  const days =
    (new Date(`${range.to}T00:00:00Z`).getTime() -
      new Date(`${range.from}T00:00:00Z`).getTime()) /
    (24 * 60 * 60 * 1000);
  assert.equal(Math.round(days), 30);
});

test("resolveRange ytd starts on Jan 1 of current year", () => {
  const range = resolveRange({ range: "ytd", format: "json" });
  assert.ok(range.from.endsWith("-01-01"));
});

test("resolveRange custom passes through", () => {
  const range = resolveRange({
    range: "custom",
    from: "2025-01-01",
    to: "2025-03-31",
    format: "json",
  });
  assert.deepEqual(range, { from: "2025-01-01", to: "2025-03-31" });
});

test("percentile returns 0 on empty input", () => {
  assert.equal(percentile([], 90), 0);
});

test("percentile p90 of 1..10 is 9", () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(sorted, 90), 9);
});

test("percentile p50 of 1..10 is 5", () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(sorted, 50), 5);
});

test("rangeQuerySchema rejects from > to", () => {
  const r = rangeQuerySchema.safeParse({
    range: "custom",
    from: "2025-12-31",
    to: "2025-01-01",
  });
  assert.equal(r.success, false);
});
