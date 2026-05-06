import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isChangeOrderPending,
  isInvoicePastDue,
  isScheduleItemOverdue,
  jobsMissingDailyLogs,
  workingDaysBetween,
} from "../src/lib/at-risk.ts";

test("schedule item is overdue when end date is before today and not done", () => {
  assert.equal(
    isScheduleItemOverdue(
      { id: "a", endDate: "2026-05-01", isComplete: false, progress: 30 },
      "2026-05-06",
    ),
    true,
  );
});

test("schedule item is not overdue when complete", () => {
  assert.equal(
    isScheduleItemOverdue(
      { id: "a", endDate: "2026-05-01", isComplete: true, progress: 50 },
      "2026-05-06",
    ),
    false,
  );
});

test("schedule item is not overdue when progress >= 100", () => {
  assert.equal(
    isScheduleItemOverdue(
      { id: "a", endDate: "2026-05-01", isComplete: false, progress: 100 },
      "2026-05-06",
    ),
    false,
  );
});

test("schedule item is not overdue when end date is today or later", () => {
  assert.equal(
    isScheduleItemOverdue(
      { id: "a", endDate: "2026-05-06", isComplete: false, progress: 0 },
      "2026-05-06",
    ),
    false,
  );
  assert.equal(
    isScheduleItemOverdue(
      { id: "a", endDate: "2026-05-10", isComplete: false, progress: 0 },
      "2026-05-06",
    ),
    false,
  );
});

test("schedule item without end date is never overdue", () => {
  assert.equal(
    isScheduleItemOverdue(
      { id: "a", endDate: null, isComplete: false, progress: 0 },
      "2026-05-06",
    ),
    false,
  );
});

test("change order is pending only when status is exactly 'pending'", () => {
  assert.equal(isChangeOrderPending({ id: "1", status: "pending" }), true);
  assert.equal(isChangeOrderPending({ id: "1", status: "approved" }), false);
  assert.equal(isChangeOrderPending({ id: "1", status: "rejected" }), false);
});

test("invoice is past due when unpaid and older than netDays", () => {
  assert.equal(
    isInvoicePastDue(
      { id: "i", invoiceDate: "2026-03-01", totalCents: 10000, paidCents: 0 },
      "2026-05-06",
    ),
    true,
  );
});

test("fully paid invoice is never past due", () => {
  assert.equal(
    isInvoicePastDue(
      { id: "i", invoiceDate: "2025-01-01", totalCents: 10000, paidCents: 10000 },
      "2026-05-06",
    ),
    false,
  );
});

test("invoice within net window is not past due", () => {
  assert.equal(
    isInvoicePastDue(
      { id: "i", invoiceDate: "2026-04-20", totalCents: 10000, paidCents: 0 },
      "2026-05-06",
      30,
    ),
    false,
  );
});

test("workingDaysBetween counts only Mon-Fri", () => {
  // 2026-05-01 (Fri) → 2026-05-08 (Fri): exclusive of from, inclusive of to.
  // Days: Sat, Sun, Mon, Tue, Wed, Thu, Fri → 5 working days.
  assert.equal(workingDaysBetween("2026-05-01", "2026-05-08"), 5);
});

test("workingDaysBetween returns 0 when from >= to", () => {
  assert.equal(workingDaysBetween("2026-05-08", "2026-05-08"), 0);
  assert.equal(workingDaysBetween("2026-05-09", "2026-05-08"), 0);
});

test("jobsMissingDailyLogs flags jobs with no log at all", () => {
  const map = new Map<string, string | null>([
    ["job-a", null],
    ["job-b", "2026-05-05"],
  ]);
  const out = jobsMissingDailyLogs(["job-a", "job-b"], map, "2026-05-06", 3);
  assert.deepEqual(out, ["job-a"]);
});

test("jobsMissingDailyLogs flags jobs whose last log is >= N working days ago", () => {
  // last log 2026-04-27 (Mon), today 2026-05-06 (Wed) →
  // working days strictly after 04-27 inclusive of 05-06:
  //   Tue 04-28, Wed 04-29, Thu 04-30, Fri 05-01, Mon 05-04, Tue 05-05, Wed 05-06 = 7
  const map = new Map<string, string | null>([["job-a", "2026-04-27"]]);
  const out = jobsMissingDailyLogs(["job-a"], map, "2026-05-06", 3);
  assert.deepEqual(out, ["job-a"]);
});

test("jobsMissingDailyLogs does NOT flag jobs logged today", () => {
  const map = new Map<string, string | null>([["job-a", "2026-05-06"]]);
  const out = jobsMissingDailyLogs(["job-a"], map, "2026-05-06", 3);
  assert.deepEqual(out, []);
});
