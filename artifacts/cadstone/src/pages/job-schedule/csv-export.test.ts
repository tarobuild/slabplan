import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { ScheduleItemRecord } from "@/lib/schedule"
import {
  buildBaselineCsvRows,
  buildExceptionsCsvRows,
  buildScheduleCsvRows,
  rowsToCsv,
} from "./csv-export.ts"

function scheduleItem(overrides: Partial<ScheduleItemRecord>): ScheduleItemRecord {
  return {
    id: "item",
    jobId: "job",
    title: "Task",
    displayColor: null,
    startDate: "2026-05-18",
    endDate: "2026-05-19",
    workDays: 2,
    isHourly: false,
    startTime: null,
    endTime: null,
    progress: 25,
    reminder: null,
    showOnGantt: true,
    visibleToEstimators: true,
    visibleToInstallers: true,
    visibleToOfficeStaff: true,
    isComplete: false,
    isPersonalTodo: false,
    notes: null,
    tags: [],
    phaseId: null,
    phaseName: "Fabrication",
    assigneeIds: [],
    assignees: [{ id: "u1", fullName: "Ada Crew", email: "ada@example.com" }],
    predecessors: [],
    notesStream: [],
    noteCount: 0,
    attachments: [],
    relatedTodos: [],
    relatedTodoCount: 0,
    createdBy: null,
    createdByName: null,
    createdByAvatarUrl: null,
    createdAt: "2026-05-18T12:00:00.000Z",
    updatedAt: "2026-05-18T12:00:00.000Z",
    deletedAt: null,
    status: "open",
    ...overrides,
  }
}

describe("schedule CSV exports", () => {
  test("builds distinct CSV datasets for schedule, baseline, and exceptions", () => {
    const schedule = buildScheduleCsvRows([scheduleItem({ title: 'Cut "A"' })])
    assert.deepEqual(schedule[0], [
      "Title",
      "Start Date",
      "End Date",
      "Work Days",
      "Start Time",
      "End Time",
      "Phase",
      "Status",
      "Progress",
      "Assigned",
    ])
    assert.equal(schedule[1]?.[0], 'Cut "A"')

    const baseline = buildBaselineCsvRows({
      id: "baseline",
      jobId: "job",
      capturedAt: "2026-05-18T12:00:00.000Z",
      capturedBy: null,
      capturedByName: "Manager",
      items: [
        {
          scheduleItemId: "item",
          title: "Template",
          baselineStartDate: "2026-05-18",
          baselineEndDate: "2026-05-20",
          currentStartDate: "2026-05-19",
          currentEndDate: "2026-05-21",
          shiftDays: 1,
        },
      ],
    })
    assert.equal(baseline[0]?.[0], "Item Title")
    assert.equal(baseline[1]?.[5], 1)

    const exceptions = buildExceptionsCsvRows([
      {
        id: "exception",
        title: "Holiday",
        type: "non_workday",
        startDate: "2026-07-04",
        endDate: "2026-07-04",
        sameEveryYear: true,
        categoryId: null,
        categoryName: "Holiday",
        appliesToAllJobs: true,
        jobIds: [],
        notes: "Observed",
      },
    ])
    assert.equal(exceptions[0]?.[0], "Title")
    assert.equal(exceptions[1]?.[1], "non_workday")
  })

  test("escapes CSV cells with quotes, commas, and newlines", () => {
    assert.equal(rowsToCsv([['A, "B"', "line\nbreak"]]), '"A, ""B""","line\nbreak"')
  })

  test("quotes carriage returns and neutralizes spreadsheet formulas", () => {
    assert.equal(rowsToCsv([["line\rbreak", "=SUM(A1:A2)", "+123", "-123", "@cmd"]]), '"line\rbreak",\'=SUM(A1:A2),\'+123,\'-123,\'@cmd')
  })
})
