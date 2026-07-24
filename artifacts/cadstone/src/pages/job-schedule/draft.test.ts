import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { ScheduleItemRecord, ScheduleSettings } from "@/lib/schedule"
import { normalizeDraftScheduleItems } from "./draft.ts"

const settings: ScheduleSettings = {
  defaultView: "calendar_month",
  showTimesOnMonthView: true,
  showJobNameOnAllListedJobs: true,
  automaticallyMarkItemsComplete: false,
  includeHeaderOnPdfExports: true,
  phases: [],
  tags: [],
  workdayExceptionCategories: [],
}

function scheduleItem(overrides: Partial<ScheduleItemRecord>): ScheduleItemRecord {
  return {
    id: "item",
    jobId: "job",
    title: "Task",
    displayColor: null,
    startDate: "2026-05-18",
    endDate: "2026-05-18",
    workDays: 1,
    isHourly: false,
    startTime: null,
    endTime: null,
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

function normalize(items: ScheduleItemRecord[]) {
  return normalizeDraftScheduleItems(items, [], settings, [])
}

describe("normalizeDraftScheduleItems finish-based dependencies", () => {
  test("keeps a finish-to-finish successor that already ends on the required date", () => {
    const predecessor = scheduleItem({
      id: "a",
      title: "A",
      startDate: "2026-05-18",
      endDate: "2026-05-22",
      workDays: 5,
    })
    const successor = scheduleItem({
      id: "b",
      title: "B",
      startDate: "2026-05-20",
      endDate: "2026-05-22",
      workDays: 3,
      predecessors: [
        {
          scheduleItemId: "a",
          title: "A",
          dependencyType: "finish_to_finish",
          lagDays: 0,
        },
      ],
    })

    const result = normalize([predecessor, successor]).find((item) => item.id === "b")

    assert.equal(result?.startDate, "2026-05-20")
    assert.equal(result?.endDate, "2026-05-22")
    assert.equal(result?.hasConflict, false)
  })

  test("moves a finish-to-finish successor only enough to meet the required finish date", () => {
    const predecessor = scheduleItem({
      id: "a",
      title: "A",
      startDate: "2026-05-18",
      endDate: "2026-05-22",
      workDays: 5,
    })
    const successor = scheduleItem({
      id: "b",
      title: "B",
      startDate: "2026-05-19",
      endDate: "2026-05-21",
      workDays: 3,
      predecessors: [
        {
          scheduleItemId: "a",
          title: "A",
          dependencyType: "finish_to_finish",
          lagDays: 0,
        },
      ],
    })

    const result = normalize([predecessor, successor]).find((item) => item.id === "b")

    assert.equal(result?.startDate, "2026-05-20")
    assert.equal(result?.endDate, "2026-05-22")
    assert.equal(result?.hasConflict, false)
  })

  test("keeps a start-to-finish successor that already ends on the required date", () => {
    const predecessor = scheduleItem({
      id: "a",
      title: "A",
      startDate: "2026-05-22",
      endDate: "2026-05-22",
      workDays: 1,
    })
    const successor = scheduleItem({
      id: "b",
      title: "B",
      startDate: "2026-05-20",
      endDate: "2026-05-22",
      workDays: 3,
      predecessors: [
        {
          scheduleItemId: "a",
          title: "A",
          dependencyType: "start_to_finish",
          lagDays: 0,
        },
      ],
    })

    const result = normalize([predecessor, successor]).find((item) => item.id === "b")

    assert.equal(result?.startDate, "2026-05-20")
    assert.equal(result?.endDate, "2026-05-22")
    assert.equal(result?.hasConflict, false)
  })

  test("marks circular dependencies without drifting dates", () => {
    const first = scheduleItem({
      id: "a",
      title: "A",
      startDate: "2026-05-18",
      endDate: "2026-05-18",
      predecessors: [
        {
          scheduleItemId: "b",
          title: "B",
          dependencyType: "finish_to_start",
          lagDays: 0,
        },
      ],
    })
    const second = scheduleItem({
      id: "b",
      title: "B",
      startDate: "2026-05-19",
      endDate: "2026-05-19",
      predecessors: [
        {
          scheduleItemId: "a",
          title: "A",
          dependencyType: "finish_to_start",
          lagDays: 0,
        },
      ],
    })

    const once = normalize([first, second])
    const twice = normalize(once)
    const normalizedFirst = once.find((item) => item.id === "a")
    const normalizedSecond = once.find((item) => item.id === "b")

    assert.equal(normalizedFirst?.startDate, "2026-05-18")
    assert.equal(normalizedSecond?.startDate, "2026-05-19")
    assert.equal(twice.find((item) => item.id === "a")?.startDate, "2026-05-18")
    assert.equal(twice.find((item) => item.id === "b")?.startDate, "2026-05-19")
    assert.equal(normalizedFirst?.hasConflict, true)
    assert.match(normalizedFirst?.conflictReasons?.join(" ") ?? "", /circular dependency/i)
  })
})
