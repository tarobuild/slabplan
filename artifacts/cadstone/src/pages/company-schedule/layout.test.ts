import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildLanes,
  ganttSpan,
  getViewWindow,
  intersectRange,
  itemHref,
  parseAnchor,
  parseGanttScale,
  rowsOnDay,
  shiftAnchor,
  type ScheduleRow,
} from "./layout.ts"

function row(id: string, startDate: string, endDate: string): ScheduleRow {
  return { id, jobId: "job-1", title: id, startDate, endDate } as ScheduleRow
}

test("each calendar mode has its own date window", () => {
  const week = getViewWindow("week", "2026-09-30")
  const month = getViewWindow("month", "2026-09-30")
  const gantt = getViewWindow("gantt", "2026-09-30")
  assert.equal(week.days.length, 7)
  assert.equal(week.start, "2026-09-27")
  assert.equal(week.end, "2026-10-03")
  assert.equal(month.days.length % 7, 0)
  assert.ok(month.days.includes("2026-09-01"))
  assert.ok(month.days.includes("2026-09-30"))
  assert.equal(gantt.days.length, 35)
  assert.equal(gantt.start, "2026-09-20")
})

test("Gantt Day, Week, Month and Year scales have meaningful ranges", () => {
  const day = getViewWindow("gantt", "2026-09-30", "day")
  const week = getViewWindow("gantt", "2026-09-30", "week")
  const month = getViewWindow("gantt", "2026-09-30", "month")
  const year = getViewWindow("gantt", "2026-09-30", "year")
  assert.equal(day.days.length, 35)
  assert.equal(week.days.length, 84)
  assert.equal(week.start, "2026-09-13")
  assert.equal(week.end, "2026-12-05")
  assert.equal(month.start, "2026-08-01")
  assert.equal(month.end, "2027-07-31")
  assert.equal(year.start, "2025-01-01")
  assert.equal(year.end, "2027-12-31")
  assert.equal(parseGanttScale("invalid"), "day")
  assert.equal(parseGanttScale("month"), "month")
  assert.ok(getViewWindow("gantt", "2028-02-29", "year").days.includes("2028-02-29"))
})

test("Gantt navigation follows its selected scale without month-end rollover", () => {
  assert.equal(shiftAnchor("gantt", "2026-09-30", 1, "day"), "2026-10-28")
  assert.equal(shiftAnchor("gantt", "2026-09-30", 1, "week"), "2026-12-16")
  assert.equal(shiftAnchor("gantt", "2026-01-31", 1, "month"), "2026-12-01")
  assert.equal(shiftAnchor("gantt", "2026-01-31", -1, "month"), "2025-02-01")
  assert.equal(shiftAnchor("gantt", "2028-02-29", -1, "year"), "2026-01-01")
})

test("month navigation is safe at month and leap-year boundaries", () => {
  assert.equal(shiftAnchor("month", "2026-01-31", 1), "2026-02-01")
  assert.equal(shiftAnchor("month", "2026-01-31", -1), "2025-12-01")
  assert.ok(getViewWindow("month", "2028-02-20").days.includes("2028-02-29"))
  assert.equal(shiftAnchor("week", "2026-12-30", 1), "2027-01-06")
})

test("invalid date anchors fail back to today instead of rolling over", () => {
  for (const value of [null, "bad", "2026-02-31", "2026-13-01", "2026-00-10"]) {
    assert.equal(parseAnchor(value, "2026-09-30"), "2026-09-30")
  }
  assert.equal(parseAnchor("2028-02-29", "2026-09-30"), "2028-02-29")
})

test("From/To narrow the visible period, including an excluded period", () => {
  const window = { start: "2026-09-27", end: "2026-10-03" }
  assert.deepEqual(intersectRange(window, "2026-09-29", "2026-10-01"), {
    from: "2026-09-29", to: "2026-10-01",
  })
  assert.deepEqual(intersectRange(window), { from: window.start, to: window.end })
  assert.equal(intersectRange(window, "2026-10-10"), null)
  assert.equal(intersectRange(window, null, "2026-09-01"), null)
})

test("overlapping tasks occupy different lanes, adjacent tasks reuse lanes", () => {
  const days = getViewWindow("week", "2026-09-30").days
  const segments = buildLanes(days, [
    row("long", "2026-09-26", "2026-10-05"),
    row("first", "2026-09-27", "2026-09-28"),
    row("second", "2026-09-29", "2026-09-30"),
    row("outside", "2026-11-01", "2026-11-02"),
  ])
  assert.equal(segments.length, 3)
  assert.equal(segments[0].lane, 0)
  assert.equal(segments[0].continuesBefore, true)
  assert.equal(segments[0].continuesAfter, true)
  assert.equal(segments[1].lane, 1)
  assert.equal(segments[2].lane, 1)
  assert.equal(segments[2].startIndex, 2)
})

test("Gantt spans clip to the window without losing continuation markers", () => {
  const window = { start: "2026-09-27", end: "2026-10-03" }
  assert.deepEqual(ganttSpan(row("long", "2026-09-20", "2026-10-10"), window), {
    startIndex: 0, endIndex: 6, continuesBefore: true, continuesAfter: true,
  })
  assert.equal(ganttSpan(row("outside", "2026-10-04", "2026-10-05"), window), null)
})

test("day agendas include multi-day work on each covered day", () => {
  const item = row("multi-day", "2026-09-28", "2026-09-30")
  assert.deepEqual(rowsOnDay("2026-09-29", [item]), [item])
  assert.deepEqual(rowsOnDay("2026-10-01", [item]), [])
  assert.equal(itemHref(item), "/jobs/job-1/schedule?focus=multi-day")
})
