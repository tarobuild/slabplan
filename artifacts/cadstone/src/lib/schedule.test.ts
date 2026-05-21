import assert from "node:assert/strict"
import { test } from "node:test"
import { classifyWorkday, type ScheduleWorkdayException } from "./schedule.ts"

const yearlyShutdown: ScheduleWorkdayException = {
  id: "shutdown",
  title: "Holiday shutdown",
  type: "non_workday",
  startDate: "2026-12-24",
  endDate: "2027-01-02",
  sameEveryYear: true,
  categoryId: null,
  categoryName: null,
  appliesToAllJobs: true,
  jobIds: [],
  notes: null,
}

test("same-year workday exceptions can wrap across New Year", () => {
  assert.equal(
    classifyWorkday(new Date("2026-12-31T12:00:00.000Z"), [yearlyShutdown]).isWorkday,
    false,
  )
  assert.equal(
    classifyWorkday(new Date("2027-01-01T12:00:00.000Z"), [yearlyShutdown]).isWorkday,
    false,
  )
  assert.equal(
    classifyWorkday(new Date("2027-07-01T12:00:00.000Z"), [yearlyShutdown]).isWorkday,
    true,
  )
})
