import assert from "node:assert/strict";
import { test } from "node:test";

import { dashboardScheduleQuerySchema } from "../src/routes/dashboard.ts";

test("dashboard schedule query accepts an empty query (defaults applied at the route)", () => {
  const result = dashboardScheduleQuerySchema.safeParse({});
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.start, undefined);
    assert.equal(result.data.end, undefined);
  }
});

test("dashboard schedule query accepts a valid YYYY-MM-DD range", () => {
  const result = dashboardScheduleQuerySchema.safeParse({
    start: "2026-04-01",
    end: "2026-05-31",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.start, "2026-04-01");
    assert.equal(result.data.end, "2026-05-31");
  }
});

test("dashboard schedule query accepts an equal start and end (single-day window)", () => {
  const result = dashboardScheduleQuerySchema.safeParse({
    start: "2026-04-30",
    end: "2026-04-30",
  });
  assert.equal(result.success, true);
});

test("dashboard schedule query rejects a malformed start date string", () => {
  const result = dashboardScheduleQuerySchema.safeParse({
    start: "not-a-date",
    end: "2026-05-31",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) => i.path[0] === "start");
    assert.ok(issue, "expected a validation issue on `start`");
    assert.match(issue!.message, /YYYY-MM-DD/);
  }
});

test("dashboard schedule query rejects partial / non-padded date strings", () => {
  const result = dashboardScheduleQuerySchema.safeParse({
    start: "2026-4-1",
  });
  assert.equal(result.success, false);
});

test("dashboard schedule query rejects calendar-impossible dates like Feb 30", () => {
  const result = dashboardScheduleQuerySchema.safeParse({
    start: "2026-02-30",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) => i.path[0] === "start");
    assert.ok(issue, "expected a validation issue on `start`");
    assert.match(issue!.message, /real calendar date/);
  }
});

test("dashboard schedule query rejects a reversed range (start after end)", () => {
  const result = dashboardScheduleQuerySchema.safeParse({
    start: "2026-06-01",
    end: "2026-05-01",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) => i.path[0] === "start");
    assert.ok(issue, "expected a cross-field issue tied to `start`");
    assert.match(issue!.message, /on or before `end`/);
  }
});

test("dashboard schedule query rejects an empty-string start (no implicit coercion)", () => {
  const result = dashboardScheduleQuerySchema.safeParse({
    start: "",
    end: "2026-05-31",
  });
  assert.equal(result.success, false);
});

test("dashboard schedule query rejects non-string types (no implicit coercion from arrays)", () => {
  const result = dashboardScheduleQuerySchema.safeParse({
    start: ["2026-01-01", "2026-12-31"],
  });
  assert.equal(result.success, false);
});
