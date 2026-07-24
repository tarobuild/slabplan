import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  calculateBusinessEndDate,
  classifyWorkday,
  type ScheduleWorkdayException,
} from "./schedule"

const yearEndShutdown: ScheduleWorkdayException = {
  id: "holiday-shutdown",
  title: "Year-end shutdown",
  type: "non_workday",
  startDate: "2026-12-24",
  endDate: "2027-01-01",
  sameEveryYear: true,
  categoryId: null,
  categoryName: null,
  appliesToAllJobs: true,
  jobIds: [],
  notes: null,
}

function localDate(value: string) {
  return new Date(`${value}T00:00:00`)
}

describe("yearly workday exceptions", () => {
  test("sameEveryYear ranges can wrap across New Year", () => {
    for (const value of ["2026-12-24", "2026-12-31", "2027-01-01"]) {
      const result = classifyWorkday(localDate(value), [yearEndShutdown])
      assert.equal(result.isWorkday, false, `${value} should be inside the yearly shutdown`)
      assert.equal(result.label, "Year-end shutdown")
    }

    const outside = classifyWorkday(localDate("2027-01-05"), [yearEndShutdown])
    assert.equal(outside.type, null)
    assert.equal(outside.isWorkday, true)
  })

  test("business end date skips wraparound yearly exceptions", () => {
    assert.equal(
      calculateBusinessEndDate("2026-12-23", 2, [yearEndShutdown]),
      "2027-01-04",
    )
  })
})
