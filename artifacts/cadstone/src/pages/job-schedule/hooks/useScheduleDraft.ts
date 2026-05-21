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
  remapDraftPayload,
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
  const draftPublishKeyRef = useRef<string | null>(null)

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

  function resetDraftFromPersisted(nextItems = items) {
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
    draftPublishKeyRef.current = null
    const cloned = cloneScheduleItems(nextItems)
    setDraftItems(cloned)
    setDraftPast([])
    setDraftFuture([])
    draftItemsRef.current = cloneScheduleItems(nextItems)
    draftPastRef.current = []
    draftFutureRef.current = []
  }

  function enterDraftMode() {
    draftPublishKeyRef.current = null
    setScheduleOffline(true)
    replaceDraftState(
      normalizeDraftScheduleItems(cloneScheduleItems(items), users, settings, workdayExceptions),
      [],
      [],
    )
    setTrackedConflictIds([])
  }

  function applyDraftMutation(
    updater: (current: ScheduleItemRecord[]) => ScheduleItemRecord[],
  ) {
    draftPublishKeyRef.current = null
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
    draftPublishKeyRef.current = null
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
        endDate: payload.endDate ?? calculateBusinessEndDate(payload.startDate, payload.workDays, workdayExceptions),
        manualEndDate: payload.endDate,
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
      draftPublishKeyRef.current = null
      resetDraftFromPersisted()
      toast.info("No draft changes to publish")
      return
    }

    setDraftPublishing(true)
    const publishKey = draftPublishKeyRef.current ?? crypto.randomUUID()
    draftPublishKeyRef.current = publishKey

    const idempotencyHeaders = (operation: string) => ({
      "Idempotency-Key": `schedule-draft:${jobId}:${publishKey}:${operation}`,
    })

    try {
      const persistedById = new Map(items.map((item) => [item.id, item]))
      const currentDraftItems = cloneScheduleItems(draftItemsRef.current)
      const currentDraftById = new Map(currentDraftItems.map((item) => [item.id, item]))
      const draftIdMap = new Map<string, string>()
      const createdDraftItems = currentDraftItems.filter((item) => isDraftScheduleItemId(item.id))
      const changedPersistedItems = currentDraftItems.filter((item) => {
        if (isDraftScheduleItemId(item.id)) {
          return false
        }

        const persisted = persistedById.get(item.id)
        return persisted ? scheduleDraftSignature(item) !== scheduleDraftSignature(persisted) : false
      })
      const deletedPersistedItems = items.filter((item) => !currentDraftById.has(item.id))

      const createResults = await Promise.all(
        createdDraftItems.map(async (item) => {
          const payload = remapDraftPayload(schedulePayloadFromItem(item), draftIdMap, {
            dropUnresolvedPredecessors: true,
          })
          const response = await api.post<{ item: ScheduleItemRecord }>(
            `/jobs/${jobId}/schedule`,
            payload,
            { headers: idempotencyHeaders(`create:${item.id}`) },
          )
          return [item.id, response.data.item.id] as const
        }),
      )

      for (const [draftId, persistedId] of createResults) {
        draftIdMap.set(draftId, persistedId)
      }

      await Promise.all([...createdDraftItems, ...changedPersistedItems].map((item) => {
        const targetId = draftIdMap.get(item.id) || item.id
        const payload = remapDraftPayload(schedulePayloadFromItem(item), draftIdMap)
        const originalId = isDraftScheduleItemId(item.id) ? item.id : targetId
        return api.put(
          `/schedule-items/${targetId}`,
          payload,
          { headers: idempotencyHeaders(`upsert:${originalId}`) },
        )
      }))

      await Promise.all(currentDraftItems.map(async (item) => {
        const targetId = draftIdMap.get(item.id) || item.id
        const draftNotes = item.notesStream
          .filter((note) => isDraftScheduleNoteId(note.id))
          .map((note) => ({ id: note.id, note: note.note.trim() }))
          .filter((note) => note.note.length > 0)

        for (const note of draftNotes) {
          await api.post(
            `/schedule-items/${targetId}/notes`,
            { note: note.note },
            { headers: idempotencyHeaders(`note:${note.id}`) },
          )
        }
      }))

      await Promise.all(deletedPersistedItems.map((item) =>
        api.delete(
          `/schedule-items/${item.id}`,
          { headers: idempotencyHeaders(`delete:${item.id}`) },
        )
      ))

      setDialogOpen(false)
      setActiveItemId(null)
      setScheduleOffline(false)
      draftPublishKeyRef.current = null
      setTrackedConflictIds([])
      await refreshScheduleData()
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
