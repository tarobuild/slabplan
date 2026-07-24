import { useMemo, useRef, useState } from "react"
import { api } from "@/lib/api"
import {
  calculateBusinessEndDate,
  DEFAULT_SCHEDULE_COLOR,
  type ScheduleItemPayload,
  type ScheduleItemRecord,
  type ScheduleSettings,
  type ScheduleWorkdayException,
} from "@/lib/schedule"
import { toast } from "sonner"
import { toastApiError } from "@/lib/api-errors"
import {
  cloneScheduleItems,
  isDraftScheduleItemId,
  isDraftScheduleNoteId,
  normalizeDraftScheduleItems,
  schedulePayloadFromItem,
  scheduleDraftSignature,
} from "../draft"
import type { AppUser } from "../types"
import { useDraftHistoryRefs } from "./useDraftHistoryRefs"

interface UseScheduleDraftOptions {
  jobId: string | undefined
  items: ScheduleItemRecord[]
  users: AppUser[]
  settings: ScheduleSettings
  workdayExceptions: ScheduleWorkdayException[]
  refreshScheduleData: () => Promise<void>
  activeItemId: string | null
  setDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  setActiveItemId: React.Dispatch<React.SetStateAction<string | null>>
  setTrackedConflictIds: React.Dispatch<React.SetStateAction<string[]>>
}

interface ScheduleDraftPublishApi {
  post<T = unknown>(url: string, payload?: unknown): Promise<{ data: T }>
}

interface ScheduleDraftPublishResponse {
  success: true
  createdItemIdsByClientId: Record<string, string>
}

export interface ScheduleDraftPublishProgress {
  createdItemIdsByDraftId: Map<string, string>
  postedDraftNoteIds: Set<string>
  deletedPersistedItemIds: Set<string>
}

export function createScheduleDraftPublishProgress(): ScheduleDraftPublishProgress {
  return {
    createdItemIdsByDraftId: new Map(),
    postedDraftNoteIds: new Set(),
    deletedPersistedItemIds: new Set(),
  }
}

export async function publishScheduleDraftChanges({
  jobId,
  persistedItems,
  draftItems,
  publishProgress,
  apiClient = api,
}: {
  jobId: string
  persistedItems: ScheduleItemRecord[]
  draftItems: ScheduleItemRecord[]
  publishProgress: ScheduleDraftPublishProgress
  apiClient?: ScheduleDraftPublishApi
}) {
  const persistedById = new Map(persistedItems.map((item) => [item.id, item]))
  const currentDraftItems = cloneScheduleItems(draftItems)
  const currentDraftById = new Map(currentDraftItems.map((item) => [item.id, item]))
  const createdDraftItems = currentDraftItems.filter((item) => isDraftScheduleItemId(item.id))
  const changedPersistedItems = currentDraftItems.filter((item) => {
    if (isDraftScheduleItemId(item.id)) {
      return false
    }

    const persisted = persistedById.get(item.id)
    return persisted ? scheduleDraftSignature(item) !== scheduleDraftSignature(persisted) : false
  })
  const deletedPersistedItems = persistedItems.filter((item) => !currentDraftById.has(item.id))
  const draftNotes = currentDraftItems.flatMap((item) =>
    item.notesStream
      .filter((note) => isDraftScheduleNoteId(note.id))
      .filter((note) => !publishProgress.postedDraftNoteIds.has(note.id))
      .map((note) => {
        const payload = {
          clientNoteId: note.id,
          note: note.note.trim(),
        }
        return isDraftScheduleItemId(item.id)
          ? { ...payload, clientItemId: item.id }
          : { ...payload, scheduleItemId: item.id }
      })
      .filter((note) => Boolean(note.note)),
  )

  const response = await apiClient.post<ScheduleDraftPublishResponse>(
    `/jobs/${jobId}/schedule/draft-publish`,
    {
      create: createdDraftItems.map((item) => ({
        clientId: item.id,
        payload: schedulePayloadFromItem(item),
      })),
      update: changedPersistedItems.map((item) => ({
        id: item.id,
        payload: schedulePayloadFromItem(item),
      })),
      deleteIds: deletedPersistedItems
        .filter((item) => !publishProgress.deletedPersistedItemIds.has(item.id))
        .map((item) => item.id),
      notes: draftNotes,
    },
  )

  for (const [draftId, persistedId] of Object.entries(response.data.createdItemIdsByClientId)) {
    publishProgress.createdItemIdsByDraftId.set(draftId, persistedId)
  }
  for (const note of draftNotes) {
    publishProgress.postedDraftNoteIds.add(note.clientNoteId)
  }
  for (const item of deletedPersistedItems) {
    publishProgress.deletedPersistedItemIds.add(item.id)
  }
}

export function useScheduleDraft({
  jobId,
  items,
  users,
  settings,
  workdayExceptions,
  refreshScheduleData,
  activeItemId,
  setDialogOpen,
  setActiveItemId,
  setTrackedConflictIds,
}: UseScheduleDraftOptions) {
  const [scheduleOffline, setScheduleOffline] = useState(false)
  const [draftItems, setDraftItems] = useState<ScheduleItemRecord[]>([])
  const [draftPast, setDraftPast] = useState<ScheduleItemRecord[][]>([])
  const [draftFuture, setDraftFuture] = useState<ScheduleItemRecord[][]>([])
  const [draftPublishing, setDraftPublishing] = useState(false)
  const draftItemsRef = useRef<ScheduleItemRecord[]>([])
  const draftPastRef = useRef<ScheduleItemRecord[][]>([])
  const draftFutureRef = useRef<ScheduleItemRecord[][]>([])
  const draftPublishProgressRef = useRef<ScheduleDraftPublishProgress>(
    createScheduleDraftPublishProgress(),
  )

  useDraftHistoryRefs({
    draftItems,
    draftItemsRef,
    draftPast,
    draftPastRef,
    draftFuture,
    draftFutureRef,
  })

  function replaceDraftState(
    nextItems: ScheduleItemRecord[],
    nextPast: ScheduleItemRecord[][] = draftPastRef.current,
    nextFuture: ScheduleItemRecord[][] = draftFutureRef.current,
  ) {
    draftItemsRef.current = nextItems
    draftPastRef.current = nextPast
    draftFutureRef.current = nextFuture
    setDraftItems(nextItems)
    setDraftPast(nextPast)
    setDraftFuture(nextFuture)
  }

  function resetDraftPublishProgress() {
    draftPublishProgressRef.current = createScheduleDraftPublishProgress()
  }

  function resetDraftFromPersisted(nextItems = items) {
    resetDraftPublishProgress()
    replaceDraftState(
      normalizeDraftScheduleItems(cloneScheduleItems(nextItems), users, settings, workdayExceptions),
      [],
      [],
    )
  }

  function syncWithFetchedItems(nextItems: ScheduleItemRecord[]) {
    if (scheduleOffline) {
      return
    }
    const cloned = cloneScheduleItems(nextItems)
    setDraftItems(cloned)
    setDraftPast([])
    setDraftFuture([])
    draftItemsRef.current = cloneScheduleItems(nextItems)
    draftPastRef.current = []
    draftFutureRef.current = []
    resetDraftPublishProgress()
  }

  function enterDraftMode() {
    setScheduleOffline(true)
    replaceDraftState(
      normalizeDraftScheduleItems(cloneScheduleItems(items), users, settings, workdayExceptions),
      [],
      [],
    )
    resetDraftPublishProgress()
    setTrackedConflictIds([])
  }

  function applyDraftMutation(
    updater: (current: ScheduleItemRecord[]) => ScheduleItemRecord[],
  ) {
    const currentItems = cloneScheduleItems(
      scheduleOffline ? draftItemsRef.current : items,
    )
    const nextItems = normalizeDraftScheduleItems(
      updater(currentItems),
      users,
      settings,
      workdayExceptions,
    )
    replaceDraftState(
      nextItems,
      [...draftPastRef.current, currentItems].slice(-50),
      [],
    )
    return nextItems
  }

  function handleDraftUndo() {
    const previous = draftPastRef.current.at(-1)

    if (!previous) {
      return
    }

    replaceDraftState(
      previous,
      draftPastRef.current.slice(0, -1),
      [...draftFutureRef.current, cloneScheduleItems(draftItemsRef.current)].slice(-50),
    )
  }

  function handleDraftRedo() {
    const next = draftFutureRef.current.at(-1)

    if (!next) {
      return
    }

    replaceDraftState(
      next,
      [...draftPastRef.current, cloneScheduleItems(draftItemsRef.current)].slice(-50),
      draftFutureRef.current.slice(0, -1),
    )
  }

  const hasDraftChanges = useMemo(() => {
    if (!scheduleOffline) {
      return false
    }

    if (items.length !== draftItems.length) {
      return true
    }

    const draftById = new Map(draftItems.map((item) => [item.id, item]))

    return items.some((item) => {
      const draftItem = draftById.get(item.id)

      if (!draftItem) {
        return true
      }

      return scheduleDraftSignature(item) !== scheduleDraftSignature(draftItem)
    }) || draftItems.some((item) => isDraftScheduleItemId(item.id))
  }, [draftItems, items, scheduleOffline])

  function handleDiscardDraft() {
    if (hasDraftChanges) {
      const confirmed = window.confirm("Discard all unpublished draft changes?")

      if (!confirmed) {
        return
      }
    }

    setScheduleOffline(false)
    resetDraftFromPersisted()
    setTrackedConflictIds([])

    if (activeItemId && isDraftScheduleItemId(activeItemId)) {
      setDialogOpen(false)
      setActiveItemId(null)
    }
  }

  async function handleDraftSaveItem({
    itemId,
    payload,
    note,
  }: {
    itemId: string | null
    payload: ScheduleItemPayload
    note: string | null
  }) {
    const now = new Date().toISOString()
    const nextId = itemId || `draft-item-${crypto.randomUUID()}`
    const nextItems = applyDraftMutation((currentItems) => {
      const existing = itemId ? currentItems.find((item) => item.id === itemId) ?? null : null
      const noteEntries = note
        ? [
            {
              id: `draft-note-${crypto.randomUUID()}`,
              note,
              createdAt: now,
              authorId: null,
              authorName: "You",
              authorAvatarUrl: null,
              isLegacy: false,
            },
          ]
        : []

      const nextItem: ScheduleItemRecord = {
        ...(existing ?? {
          id: nextId,
          jobId,
          notes: payload.notes,
          notesStream: [],
          attachments: [],
          relatedTodos: [],
          createdBy: null,
          createdByName: "Draft",
          createdByAvatarUrl: null,
          createdAt: now,
          deletedAt: null,
          status: "upcoming",
          hasConflict: false,
          conflictReasons: [],
          noteCount: 0,
          relatedTodoCount: 0,
          assignees: [],
          phaseName: null,
          phaseColor: null,
          isPersonalTodo: false,
        }),
        id: nextId,
        jobId: jobId ?? existing?.jobId ?? null,
        title: payload.title,
        displayColor: payload.displayColor || DEFAULT_SCHEDULE_COLOR,
        startDate: payload.startDate,
        endDate: calculateBusinessEndDate(payload.startDate, payload.workDays, workdayExceptions),
        workDays: payload.workDays,
        isHourly: payload.isHourly,
        startTime: payload.isHourly ? payload.startTime : null,
        endTime: payload.isHourly ? payload.endTime : null,
        progress: payload.progress,
        reminder: payload.reminder,
        showOnGantt: payload.showOnGantt,
        visibleToEstimators: payload.visibleToEstimators,
        visibleToInstallers: payload.visibleToInstallers,
        visibleToOfficeStaff: payload.visibleToOfficeStaff,
        isComplete: payload.isComplete,
        notes: payload.notes,
        tags: [...payload.tags],
        phaseId: payload.phaseId,
        assigneeIds: [...payload.assigneeIds],
        predecessors: payload.predecessors.map((predecessor) => ({
          ...predecessor,
          title:
            currentItems.find((candidate) => candidate.id === predecessor.scheduleItemId)?.title
            || "Unknown task",
        })),
        notesStream: [...noteEntries, ...(existing?.notesStream ?? [])],
        attachments: existing?.attachments ?? [],
        relatedTodos: existing?.relatedTodos ?? [],
        createdBy: existing?.createdBy ?? null,
        createdByName: existing?.createdByName ?? "Draft",
        createdByAvatarUrl: existing?.createdByAvatarUrl ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: existing?.deletedAt ?? null,
        status: existing?.status ?? "upcoming",
        hasConflict: existing?.hasConflict ?? false,
        conflictReasons: existing?.conflictReasons ?? [],
        noteCount: 0,
        relatedTodoCount: existing?.relatedTodoCount ?? 0,
        assignees: existing?.assignees ?? [],
        phaseName: existing?.phaseName ?? null,
        phaseColor: existing?.phaseColor ?? null,
      }

      if (existing) {
        return currentItems.map((item) => (item.id === itemId ? nextItem : item))
      }

      return [...currentItems, nextItem]
    })

    const savedItem = nextItems.find((item) => item.id === nextId)

    if (!savedItem) {
      throw new Error("Draft item was not saved")
    }

    return savedItem
  }

  async function handleDraftAddNote(itemId: string, note: string) {
    const now = new Date().toISOString()
    const nextItems = applyDraftMutation((currentItems) =>
      currentItems.map((item) =>
        item.id === itemId
          ? {
              ...item,
              notesStream: [
                {
                  id: `draft-note-${crypto.randomUUID()}`,
                  note,
                  createdAt: now,
                  authorId: null,
                  authorName: "You",
                  authorAvatarUrl: null,
                  isLegacy: false,
                },
                ...item.notesStream,
              ],
              updatedAt: now,
            }
          : item,
      ),
    )

    const updatedItem = nextItems.find((item) => item.id === itemId)

    if (!updatedItem) {
      throw new Error("Draft item was not found")
    }

    return updatedItem
  }

  async function handleDraftDeleteItem(itemId: string) {
    applyDraftMutation((currentItems) => currentItems.filter((item) => item.id !== itemId))
  }

  async function handlePublishDraft() {
    if (!jobId) {
      return
    }

    if (!hasDraftChanges) {
      setScheduleOffline(false)
      resetDraftFromPersisted()
      toast.info("No draft changes to publish")
      return
    }

    setDraftPublishing(true)

    try {
      await publishScheduleDraftChanges({
        jobId,
        persistedItems: items,
        draftItems: draftItemsRef.current,
        publishProgress: draftPublishProgressRef.current,
      })
      setScheduleOffline(false)
      try {
        await refreshScheduleData()
      } catch (refreshError) {
        setScheduleOffline(true)
        throw refreshError
      }
      resetDraftPublishProgress()
      setDialogOpen(false)
      setActiveItemId(null)
      setTrackedConflictIds([])
      toast.success("Draft changes published")
    } catch (error) {
      toastApiError(error, "Failed to publish draft changes")
    } finally {
      setDraftPublishing(false)
    }
  }

  return {
    scheduleOffline,
    draftItems,
    draftPast,
    draftFuture,
    draftPublishing,
    draftItemsRef,
    hasDraftChanges,
    syncWithFetchedItems,
    enterDraftMode,
    handleDiscardDraft,
    handleDraftUndo,
    handleDraftRedo,
    applyDraftMutation,
    handleDraftSaveItem,
    handleDraftAddNote,
    handleDraftDeleteItem,
    handlePublishDraft,
  }
}
