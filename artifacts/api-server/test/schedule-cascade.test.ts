import assert from "node:assert/strict";
import { test } from "node:test";

// `@workspace/db` constructs a Pool at import time and refuses to load
// without a connection string. None of the tests in this file actually
// touch the database — the cascade helper is pure — but importing
// schedule.ts transitively pulls in the db client. Set a placeholder URL
// before the dynamic import below.
process.env.DATABASE_URL ??=
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test_unused";
delete process.env.SUPABASE_DATABASE_URL;

const {
  computeJobScheduleCascade,
  startScheduleAutoCompleteSweeper,
} = await import("../src/routes/schedule.ts");

test("computeJobScheduleCascade returns an empty map for empty input", () => {
  const result = computeJobScheduleCascade([], [], []);
  assert.equal(result.size, 0);
});

test("computeJobScheduleCascade does not change items that already match their workDays", () => {
  const result = computeJobScheduleCascade(
    [
      {
        id: "a",
        title: "A",
        startDate: "2026-01-05", // Mon
        endDate: "2026-01-09", // Fri
        workDays: 5,
      },
    ],
    [],
    [],
  );

  const a = result.get("a");
  assert.ok(a);
  assert.equal(a.startDate, "2026-01-05");
  assert.equal(a.endDate, "2026-01-09");
});

test("computeJobScheduleCascade recomputes endDate when persisted endDate is wrong", () => {
  const result = computeJobScheduleCascade(
    [
      {
        id: "a",
        title: "A",
        startDate: "2026-01-05", // Mon
        endDate: "2026-01-05", // wrong — should be Friday for 5 work days
        workDays: 5,
      },
    ],
    [],
    [],
  );

  const a = result.get("a");
  assert.ok(a);
  assert.equal(a.startDate, "2026-01-05");
  assert.equal(a.endDate, "2026-01-09");
});

test("computeJobScheduleCascade resolves a finish-to-start predecessor chain", () => {
  // B must start the business day after A finishes (lag 0).
  const result = computeJobScheduleCascade(
    [
      {
        id: "a",
        title: "A",
        startDate: "2026-01-05",
        endDate: "2026-01-07", // Mon-Wed
        workDays: 3,
      },
      {
        id: "b",
        title: "B",
        startDate: "2026-01-05", // wrong — should be pushed past A
        endDate: "2026-01-05",
        workDays: 2,
      },
    ],
    [
      {
        scheduleItemId: "b",
        predecessorId: "a",
        dependencyType: "finish_to_start",
        lagDays: 0,
      },
    ],
    [],
  );

  const a = result.get("a");
  const b = result.get("b");
  assert.ok(a);
  assert.ok(b);
  assert.equal(a.endDate, "2026-01-07");
  // After A's Wed end + 0 lag = next business day is Thu Jan 8.
  assert.equal(b.startDate, "2026-01-08");
  // 2 work days starting Thu = Thu + Fri = Fri Jan 9.
  assert.equal(b.endDate, "2026-01-09");
});

test("computeJobScheduleCascade is pure: same input twice yields identical results", () => {
  const items = [
    {
      id: "a",
      title: "A",
      startDate: "2026-01-05",
      endDate: "2026-01-05", // wrong — exercises the cascade
      workDays: 5,
    },
  ];
  const first = computeJobScheduleCascade(items, [], []);
  const second = computeJobScheduleCascade(items, [], []);

  assert.equal(first.get("a")?.endDate, second.get("a")?.endDate);
  // The original input array must be untouched (the helper clones internally).
  assert.equal(items[0].endDate, "2026-01-05");
});

test("computeJobScheduleCascade ignores predecessor edges to deleted items", () => {
  // Predecessor refers to "ghost" which is not in items[]. The cascade
  // must skip the orphan edge and leave B unchanged.
  const result = computeJobScheduleCascade(
    [
      {
        id: "b",
        title: "B",
        startDate: "2026-01-05",
        endDate: "2026-01-09",
        workDays: 5,
      },
    ],
    [
      {
        scheduleItemId: "b",
        predecessorId: "ghost",
        dependencyType: "finish_to_start",
        lagDays: 0,
      },
    ],
    [],
  );

  const b = result.get("b");
  assert.ok(b);
  assert.equal(b.startDate, "2026-01-05");
  assert.equal(b.endDate, "2026-01-09");
});

test("startScheduleAutoCompleteSweeper returns a handle with stop() and runNow(); stop() is idempotent", async () => {
  // Use a long interval so the timer never actually fires during the test.
  // The initial runNow() call inside startScheduleAutoCompleteSweeper will
  // attempt a DB query — the helper traps errors so a missing DB does not
  // crash the test runner. We only assert on the handle shape and that
  // stop() can be invoked repeatedly without throwing.
  const handle = startScheduleAutoCompleteSweeper({ intervalMs: 60_000 });

  assert.equal(typeof handle.stop, "function");
  assert.equal(typeof handle.runNow, "function");

  handle.stop();
  // Calling stop a second time must not throw — index.ts shutdown logic
  // can race with signal handlers.
  handle.stop();

  // Also exercise runNow directly. It traps errors internally and resolves
  // to a number even when the DB query fails.
  const flipped = await handle.runNow();
  assert.equal(typeof flipped, "number");
});

test("computeJobScheduleCascade respects start-to-start with lag", () => {
  // C must start at least 2 business days after A starts.
  const result = computeJobScheduleCascade(
    [
      {
        id: "a",
        title: "A",
        startDate: "2026-01-05", // Mon
        endDate: "2026-01-09",
        workDays: 5,
      },
      {
        id: "c",
        title: "C",
        startDate: "2026-01-05", // wrong — should be pushed
        endDate: "2026-01-05",
        workDays: 1,
      },
    ],
    [
      {
        scheduleItemId: "c",
        predecessorId: "a",
        dependencyType: "start_to_start",
        lagDays: 2,
      },
    ],
    [],
  );

  const c = result.get("c");
  assert.ok(c);
  // Start-to-Start with 2 business-day lag from Mon Jan 5 = Wed Jan 7.
  assert.equal(c.startDate, "2026-01-07");
  assert.equal(c.endDate, "2026-01-07");
});
