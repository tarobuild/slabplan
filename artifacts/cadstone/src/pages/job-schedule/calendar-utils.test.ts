import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { ScheduleItemRecord } from "@/lib/schedule"
import { buildDayTimelineSegments, previewBoundsForDay } from "./calendar-utils.ts"
import { DAY_END_EXCLUSIVE_HOUR, TIMED_GRID_TOTAL_MINUTES, minutesToTimeString } from "./drag.ts"

function scheduleItem(overrides: Partial<ScheduleItemRecord>): ScheduleItemRecord {
  return {
    id: "item",
    jobId: "job",
    title: "Timed task",
    displayColor: null,
    startDate: "2026-05-18",
    endDate: "2026-05-18",
    workDays: 1,
    isHourly: true,
    startTime: "19:00",
    endTime: "20:00",
    progress: 0,
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
    phaseName: null,
    assigneeIds: [],
    assignees: [],
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

describe("timed grid day boundary", () => {
  test("drag time conversion and rendered bounds agree at the bottom edge", () => {
    assert.equal(minutesToTimeString(TIMED_GRID_TOTAL_MINUTES), "20:00")
    assert.equal(DAY_END_EXCLUSIVE_HOUR, 20)

    const [segment] = buildDayTimelineSegments("2026-05-18", [
      scheduleItem({ startTime: "19:00", endTime: "20:00" }),
    ])
    assert.equal(segment?.startHour, 19)
    assert.equal(segment?.endHour, DAY_END_EXCLUSIVE_HOUR)

    const previewBounds = previewBoundsForDay("2026-05-18", {
      isHourly: true,
      startDate: "2026-05-18",
      endDate: "2026-05-18",
      startTime: "19:00",
      endTime: "20:00",
    } as never)
    assert.equal(previewBounds?.startHour, 19)
    assert.equal(previewBounds?.endHour, DAY_END_EXCLUSIVE_HOUR)
  })
})
