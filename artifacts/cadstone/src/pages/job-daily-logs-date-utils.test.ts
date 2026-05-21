import assert from "node:assert/strict"
import test from "node:test"
import {
  addDays,
  getDateRangeForPreset,
  localDateString,
} from "./job-daily-logs-date-utils.ts"

test("localDateString uses the user's local calendar day near UTC midnight", () => {
  assert.equal(localDateString(new Date("2026-05-20T01:00:00.000Z")), "2026-05-19")
})

test("date presets use local date-only values", () => {
  assert.deepEqual(
    getDateRangeForPreset("today", new Date("2026-05-20T01:00:00.000Z")),
    { from: "2026-05-19", to: "2026-05-19" },
  )
  assert.deepEqual(
    getDateRangeForPreset("today_tomorrow", new Date("2026-05-20T01:00:00.000Z")),
    { from: "2026-05-19", to: "2026-05-20" },
  )
})

test("addDays advances local calendar dates", () => {
  assert.equal(localDateString(addDays(new Date(2026, 4, 19, 18), 1)), "2026-05-20")
})
