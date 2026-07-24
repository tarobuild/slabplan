import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { ScheduleItemRecord } from "@/lib/schedule"
import { isScheduleBlockDraggable } from "./useScheduleDragHandlers.ts"

function scheduleItem(overrides: Partial<ScheduleItemRecord> = {}): ScheduleItemRecord {
  return {
    id: "item-1",
    jobId: "job-1",
    title: "Install",
    displayColor: null,
    startDate: "2026-05-18",
    endDate: "2026-05-18",
    workDays: 1,
    isHourly: true,
    startTime: "09:00",
    endTime: "10:00",
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

describe("isScheduleBlockDraggable", () => {
  test("allows a valid persisted hourly block outside draft mode", () => {
    assert.equal(isScheduleBlockDraggable(scheduleItem(), false), true)
  })

  test("blocks persisted hourly blocks while schedule draft mode is active", () => {
    assert.equal(isScheduleBlockDraggable(scheduleItem(), true), false)
  })

  test("blocks draft item IDs from the persisted drag path", () => {
    assert.equal(
      isScheduleBlockDraggable(scheduleItem({ id: "draft-item-123" }), false),
      false,
    )
  })
})
