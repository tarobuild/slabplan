import assert from "node:assert/strict"
import { test } from "node:test"

import type { ScheduleItemRecord } from "@/lib/schedule"
import {
  createScheduleDraftPublishProgress,
  publishScheduleDraftChanges,
} from "./useScheduleDraft.ts"

function makeItem(overrides: Partial<ScheduleItemRecord> = {}): ScheduleItemRecord {
  const now = "2026-01-01T00:00:00.000Z"
  return {
    id: "schedule-1",
    jobId: "job-1",
    title: "Template",
    displayColor: "#64748b",
    startDate: "2026-01-05",
    endDate: "2026-01-06",
    workDays: 2,
    isHourly: false,
    startTime: null,
    endTime: null,
    progress: 0,
    reminder: "",
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
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    status: "upcoming",
    ...overrides,
  }
}

test("draft publish sends one atomic bulk request for creates updates deletes and notes", async () => {
  const progress = createScheduleDraftPublishProgress()
  const persistedItem = makeItem({
    id: "schedule-existing",
    title: "Existing task",
    notesStream: [
      {
        id: "legacy-schedule-existing",
        note: "Original",
        createdAt: "2026-01-01T00:00:00.000Z",
        authorId: null,
        authorName: "You",
        authorAvatarUrl: null,
        isLegacy: true,
      },
    ],
  })
  const deletedItem = makeItem({
    id: "schedule-delete",
    title: "Delete me",
  })
  const createdItem = makeItem({
    id: "draft-item-alpha",
    title: "New draft task",
    notesStream: [
      {
        id: "draft-note-alpha",
        note: "Carry this note once",
        createdAt: "2026-01-01T00:00:00.000Z",
        authorId: null,
        authorName: "You",
        authorAvatarUrl: null,
        isLegacy: false,
      },
    ],
    predecessors: [
      {
        scheduleItemId: "schedule-existing",
        title: "Existing task",
        dependencyType: "finish_to_start",
        lagDays: 0,
      },
    ],
  })
  const changedItem = makeItem({
    ...persistedItem,
    title: "Existing task updated",
    notesStream: [
      ...(persistedItem.notesStream ?? []),
      {
        id: "draft-note-existing",
        note: "Persisted note",
        createdAt: "2026-01-01T00:00:00.000Z",
        authorId: null,
        authorName: "You",
        authorAvatarUrl: null,
        isLegacy: false,
      },
    ],
  })
  const calls: Array<{ method: string; url: string; payload?: unknown }> = []

  const apiClient = {
    async post<T>(url: string, payload?: unknown) {
      calls.push({ method: "POST", url, payload })
      return { data: { success: true, createdItemIdsByClientId: { "draft-item-alpha": "schedule-created" } } as T }
    },
  }

  await publishScheduleDraftChanges({
    jobId: "job-1",
    persistedItems: [persistedItem, deletedItem],
    draftItems: [changedItem, createdItem],
    publishProgress: progress,
    apiClient,
  })

  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    "POST /jobs/job-1/schedule/draft-publish",
  ])

  const payload = calls[0]!.payload as {
    create: Array<{ clientId: string; payload: { title: string; predecessors: Array<{ scheduleItemId: string }> } }>
    update: Array<{ id: string; payload: { title: string } }>
    deleteIds: string[]
    notes: Array<{ clientNoteId: string; clientItemId?: string; scheduleItemId?: string; note: string }>
  }
  assert.equal(payload.create[0]!.clientId, "draft-item-alpha")
  assert.equal(payload.create[0]!.payload.predecessors[0]!.scheduleItemId, "schedule-existing")
  assert.deepEqual(payload.update.map((entry) => [entry.id, entry.payload.title]), [
    ["schedule-existing", "Existing task updated"],
  ])
  assert.deepEqual(payload.deleteIds, ["schedule-delete"])
  assert.deepEqual(payload.notes, [
    {
      clientNoteId: "draft-note-existing",
      scheduleItemId: "schedule-existing",
      note: "Persisted note",
    },
    {
      clientNoteId: "draft-note-alpha",
      clientItemId: "draft-item-alpha",
      note: "Carry this note once",
    },
  ])
  assert.equal(progress.createdItemIdsByDraftId.get("draft-item-alpha"), "schedule-created")
  assert.equal(progress.postedDraftNoteIds.has("draft-note-alpha"), true)
  assert.equal(progress.postedDraftNoteIds.has("draft-note-existing"), true)
  assert.equal(progress.deletedPersistedItemIds.has("schedule-delete"), true)
})
