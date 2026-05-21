import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isAxiosError } from "axios"
import { toast } from "sonner"
import { api } from "@/lib/api"
import {
  DEFAULT_PRESETS,
  type Annotation,
  type AnnotationToolType,
  type DraftAnnotation,
  type ToolPreset,
} from "./annotation-types"
import type { MarkupTool } from "./PdfMarkupToolbar"

type ServerAnnotation = Omit<
  Annotation,
  "thickness" | "opacity" | "normalizedX" | "normalizedY" | "normalizedW" | "normalizedH"
> & {
  thickness: number | string
  opacity: number | string
  normalizedX: number | string
  normalizedY: number | string
  normalizedW: number | string
  normalizedH: number | string
}

function normalizeAnnotation(raw: ServerAnnotation): Annotation {
  return {
    ...raw,
    thickness: Number(raw.thickness),
    opacity: Number(raw.opacity),
    normalizedX: Number(raw.normalizedX),
    normalizedY: Number(raw.normalizedY),
    normalizedW: Number(raw.normalizedW),
    normalizedH: Number(raw.normalizedH),
  }
}

let tempIdCounter = 0
function nextTempId(): string {
  tempIdCounter += 1
  return `tmp-${Date.now().toString(36)}-${tempIdCounter}`
}

type HistoryEntry =
  | {
      kind: "create"
      tempId: string
      serverId: string | null
      // Captured so redo can recreate after an undo wiped the drafts/server row.
      draft: Omit<DraftAnnotation, "tempId">
    }
  | { kind: "delete"; annotation: Annotation }
  | { kind: "update"; before: Annotation; after: Annotation }

export type AnnotationPatch = Partial<
  Pick<
    Annotation,
    | "color"
    | "thickness"
    | "opacity"
    | "normalizedX"
    | "normalizedY"
    | "normalizedW"
    | "normalizedH"
    | "content"
    | "pathData"
  >
>

export type UsePdfAnnotationsOptions = {
  fileId: string | null
  enabled: boolean
}

export type UsePdfAnnotationsResult = {
  annotations: Annotation[]
  drafts: DraftAnnotation[]
  loading: boolean
  loadError: string | null
  refresh: () => Promise<void>
  // Tool state
  active: MarkupTool
  setActive: (tool: MarkupTool) => void
  presets: Record<AnnotationToolType, ToolPreset>
  updatePreset: (tool: AnnotationToolType, preset: ToolPreset) => void
  presetForActive: ToolPreset
  // Visibility / filter
  showMarkup: boolean
  setShowMarkup: (next: boolean) => void
  filterMine: boolean
  setFilterMine: (next: boolean) => void
  // Mutations
  createAnnotation: (draft: Omit<DraftAnnotation, "tempId">) => void
  deleteAnnotation: (annotationId: string) => Promise<void>
  updateAnnotation: (
    annotationId: string,
    patch: AnnotationPatch,
  ) => Promise<void>
  // Undo / redo
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

export function usePdfAnnotations(
  options: UsePdfAnnotationsOptions,
): UsePdfAnnotationsResult {
  const { fileId, enabled } = options
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [drafts, setDrafts] = useState<DraftAnnotation[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [presets, setPresets] = useState<Record<AnnotationToolType, ToolPreset>>(
    () => ({ ...DEFAULT_PRESETS }),
  )
  const [active, setActive] = useState<MarkupTool>("highlighter")
  const [showMarkup, setShowMarkup] = useState(true)
  const [filterMine, setFilterMine] = useState(false)

  const undoStackRef = useRef<HistoryEntry[]>([])
  const redoStackRef = useRef<HistoryEntry[]>([])
  const draftsRef = useRef<DraftAnnotation[]>([])
  const pendingCreateTimersRef = useRef<Map<string, number>>(new Map())
  const cancelledCreateTempIdsRef = useRef<Set<string>>(new Set())
  const refreshSeqRef = useRef(0)
  const [, forceHistoryTick] = useState(0)
  const tickHistory = useCallback(() => forceHistoryTick((t) => t + 1), [])

  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])

  const cancelPendingCreate = useCallback((tempId: string) => {
    const timer = pendingCreateTimersRef.current.get(tempId)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      pendingCreateTimersRef.current.delete(tempId)
    }
    cancelledCreateTempIdsRef.current.add(tempId)
  }, [])

  const clearPendingCreates = useCallback(() => {
    for (const [tempId, timer] of pendingCreateTimersRef.current.entries()) {
      window.clearTimeout(timer)
      cancelledCreateTempIdsRef.current.add(tempId)
    }
    pendingCreateTimersRef.current.clear()
  }, [])

  const refresh = useCallback(async () => {
    const refreshSeq = refreshSeqRef.current + 1
    refreshSeqRef.current = refreshSeq
    if (!fileId) {
      setAnnotations([])
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.get<{ annotations: ServerAnnotation[] }>(
        `/files/${fileId}/annotations`,
      )
      if (refreshSeqRef.current !== refreshSeq) return
      setAnnotations(res.data.annotations.map(normalizeAnnotation))
    } catch (err) {
      if (refreshSeqRef.current !== refreshSeq) return
      if (isAxiosError(err) && err.response?.status === 401) {
        // Don't surface noise if the user is not signed in.
        setAnnotations([])
      } else {
        setLoadError("Failed to load markup.")
      }
    } finally {
      if (refreshSeqRef.current === refreshSeq) {
        setLoading(false)
      }
    }
  }, [fileId])

  useEffect(() => {
    if (!fileId || !enabled) {
      refreshSeqRef.current += 1
      clearPendingCreates()
      setAnnotations([])
      setDrafts([])
      undoStackRef.current = []
      redoStackRef.current = []
      tickHistory()
      return
    }
    void refresh()
    return clearPendingCreates
  }, [fileId, enabled, refresh, tickHistory, clearPendingCreates])

  const presetForActive = useMemo(() => {
    if (active === "eraser" || active === "select") {
      return presets.pen
    }
    return presets[active]
  }, [active, presets])

  const updatePreset = useCallback((tool: AnnotationToolType, preset: ToolPreset) => {
    setPresets((prev) => ({ ...prev, [tool]: preset }))
  }, [])

  const persistDraft = useCallback(
    async (draft: DraftAnnotation) => {
      if (!fileId) return
      if (
        cancelledCreateTempIdsRef.current.has(draft.tempId) ||
        !draftsRef.current.some((pending) => pending.tempId === draft.tempId)
      ) {
        pendingCreateTimersRef.current.delete(draft.tempId)
        cancelledCreateTempIdsRef.current.delete(draft.tempId)
        return
      }
      try {
        const res = await api.post<{ annotation: ServerAnnotation }>(
          `/files/${fileId}/annotations`,
          {
            page: draft.page,
            toolType: draft.toolType,
            color: draft.color,
            thickness: draft.thickness,
            opacity: draft.opacity,
            normalizedX: draft.normalizedX,
            normalizedY: draft.normalizedY,
            normalizedW: draft.normalizedW,
            normalizedH: draft.normalizedH,
            content: draft.content,
            pathData: draft.pathData,
          },
        )
        const created = normalizeAnnotation(res.data.annotation)
        if (
          cancelledCreateTempIdsRef.current.has(draft.tempId) ||
          !draftsRef.current.some((pending) => pending.tempId === draft.tempId)
        ) {
          pendingCreateTimersRef.current.delete(draft.tempId)
          cancelledCreateTempIdsRef.current.delete(draft.tempId)
          setDrafts((prev) => prev.filter((d) => d.tempId !== draft.tempId))
          api.delete(`/files/${fileId}/annotations/${created.id}`).catch(() => {
            toast.error("Failed to undo. Reverted.")
          })
          return
        }
        setAnnotations((prev) => [...prev, created])
        setDrafts((prev) => prev.filter((d) => d.tempId !== draft.tempId))
        pendingCreateTimersRef.current.delete(draft.tempId)
        cancelledCreateTempIdsRef.current.delete(draft.tempId)
        // Update the matching undo entry with the real server id so that an
        // undo (which deletes the just-created annotation) can hit the
        // server.
        for (const entry of undoStackRef.current) {
          if (entry.kind === "create" && entry.tempId === draft.tempId) {
            entry.serverId = created.id
          }
        }
        tickHistory()
      } catch (err) {
        // Roll back the optimistic draft.
        setDrafts((prev) => prev.filter((d) => d.tempId !== draft.tempId))
        pendingCreateTimersRef.current.delete(draft.tempId)
        cancelledCreateTempIdsRef.current.delete(draft.tempId)
        // Remove the stale undo entry if it's the most recent.
        undoStackRef.current = undoStackRef.current.filter(
          (e) => !(e.kind === "create" && e.tempId === draft.tempId),
        )
        tickHistory()
        if (isAxiosError(err) && err.response?.status === 403) {
          toast.error("You don't have permission to add markup to this file.")
        } else {
          toast.error("Failed to save markup.")
        }
      }
    },
    [fileId, tickHistory],
  )

  const createAnnotation = useCallback(
    (draft: Omit<DraftAnnotation, "tempId">) => {
      if (!fileId) return
      const tempId = nextTempId()
      const fullDraft: DraftAnnotation = {
        ...draft,
        fileId,
        tempId,
      }
      setDrafts((prev) => [...prev, fullDraft])
      undoStackRef.current = [
        ...undoStackRef.current,
        { kind: "create", tempId, serverId: null, draft: { ...draft, fileId } },
      ]
      redoStackRef.current = []
      tickHistory()
      // Debounce: persist after a short delay so quick successive strokes
      // don't queue dozens of in-flight requests for the same draft.
      const timer = window.setTimeout(() => {
        pendingCreateTimersRef.current.delete(tempId)
        void persistDraft(fullDraft)
      }, 300)
      pendingCreateTimersRef.current.set(tempId, timer)
    },
    [fileId, persistDraft, tickHistory],
  )

  const deleteAnnotation = useCallback(
    async (annotationId: string) => {
      if (!fileId) return
      // Optimistic removal.
      const removed = annotations.find((a) => a.id === annotationId)
      if (!removed) return
      setAnnotations((prev) => prev.filter((a) => a.id !== annotationId))
      undoStackRef.current = [
        ...undoStackRef.current,
        { kind: "delete", annotation: removed },
      ]
      redoStackRef.current = []
      tickHistory()
      try {
        await api.delete(`/files/${fileId}/annotations/${annotationId}`)
      } catch (err) {
        // Roll back.
        setAnnotations((prev) => [...prev, removed])
        undoStackRef.current = undoStackRef.current.filter(
          (e) => !(e.kind === "delete" && e.annotation.id === annotationId),
        )
        tickHistory()
        if (isAxiosError(err) && err.response?.status === 403) {
          toast.error("You don't have permission to delete that markup.")
        } else {
          toast.error("Failed to delete markup.")
        }
      }
    },
    [annotations, fileId, tickHistory],
  )

  const updateAnnotation = useCallback(
    async (annotationId: string, patch: AnnotationPatch) => {
      if (!fileId) return
      const before = annotations.find((a) => a.id === annotationId)
      if (!before) return
      const after: Annotation = { ...before, ...patch }
      // Optimistic apply.
      setAnnotations((prev) => prev.map((a) => (a.id === annotationId ? after : a)))
      try {
        const res = await api.patch<{ annotation: ServerAnnotation }>(
          `/files/${fileId}/annotations/${annotationId}`,
          patch,
        )
        const fresh = normalizeAnnotation(res.data.annotation)
        setAnnotations((prev) =>
          prev.map((a) => (a.id === annotationId ? fresh : a)),
        )
        undoStackRef.current = [
          ...undoStackRef.current,
          { kind: "update", before, after: fresh },
        ]
        redoStackRef.current = []
        tickHistory()
      } catch (err) {
        // Roll back.
        setAnnotations((prev) =>
          prev.map((a) => (a.id === annotationId ? before : a)),
        )
        if (isAxiosError(err) && err.response?.status === 403) {
          toast.error("You don't have permission to edit that markup.")
        } else {
          toast.error("Failed to save changes.")
        }
      }
    },
    [annotations, fileId, tickHistory],
  )

  const undo = useCallback(() => {
    const entry = undoStackRef.current.pop()
    if (!entry || !fileId) {
      tickHistory()
      return
    }
    if (entry.kind === "create") {
      // Undo a create — remove the annotation locally and on server.
      const serverId = entry.serverId
      cancelPendingCreate(entry.tempId)
      setDrafts((prev) => prev.filter((d) => d.tempId !== entry.tempId))
      let removedFromServer: Annotation | null = null
      if (serverId) {
        removedFromServer = annotations.find((a) => a.id === serverId) ?? null
        if (removedFromServer) {
          setAnnotations((prev) => prev.filter((a) => a.id !== serverId))
          api
            .delete(`/files/${fileId}/annotations/${serverId}`)
            .catch(() => {
              if (removedFromServer) {
                setAnnotations((prev) => [...prev, removedFromServer!])
              }
              toast.error("Failed to undo. Reverted.")
            })
        }
      }
      // Push a redo entry so the same draft can be re-created.
      redoStackRef.current = [
        ...redoStackRef.current,
        { kind: "create", tempId: entry.tempId, serverId: null, draft: entry.draft },
      ]
    } else if (entry.kind === "delete") {
      // Undo a delete — recreate the annotation server-side as a new row.
      const a = entry.annotation
      const tempId = nextTempId()
      const draft: DraftAnnotation = {
        tempId,
        fileId: a.fileId,
        page: a.page,
        toolType: a.toolType,
        color: a.color,
        thickness: a.thickness,
        opacity: a.opacity,
        normalizedX: a.normalizedX,
        normalizedY: a.normalizedY,
        normalizedW: a.normalizedW,
        normalizedH: a.normalizedH,
        content: a.content,
        pathData: a.pathData,
      }
      setDrafts((prev) => [...prev, draft])
      void persistDraft(draft)
      // The redo for a delete-undo is to delete the freshly-recreated row.
      // We capture the original annotation so redo() can re-issue a delete.
      redoStackRef.current = [
        ...redoStackRef.current,
        { kind: "delete", annotation: a },
      ]
    } else {
      // Undo an update — restore the previous values both locally and on
      // the server. Look up the row by its server id (the update history
      // entry was only pushed after a successful server response).
      const targetId = entry.after.id
      const before = entry.before
      const after = entry.after
      const exists = annotations.some((a) => a.id === targetId)
      if (exists) {
        setAnnotations((prev) =>
          prev.map((a) => (a.id === targetId ? before : a)),
        )
        api
          .patch(`/files/${fileId}/annotations/${targetId}`, {
            color: before.color,
            thickness: before.thickness,
            opacity: before.opacity,
            normalizedX: before.normalizedX,
            normalizedY: before.normalizedY,
            normalizedW: before.normalizedW,
            normalizedH: before.normalizedH,
            content: before.content,
            pathData: before.pathData,
          })
          .catch(() => {
            // Roll back the local revert to keep UI in sync with server.
            setAnnotations((prev) =>
              prev.map((a) => (a.id === targetId ? after : a)),
            )
            toast.error("Failed to undo. Reverted.")
          })
        redoStackRef.current = [
          ...redoStackRef.current,
          { kind: "update", before, after },
        ]
      }
    }
    tickHistory()
  }, [annotations, cancelPendingCreate, fileId, persistDraft, tickHistory])

  const redo = useCallback(() => {
    const entry = redoStackRef.current.pop()
    if (!entry || !fileId) {
      tickHistory()
      return
    }
    if (entry.kind === "create") {
      // Re-apply a create that was previously undone using its captured draft.
      const tempId = nextTempId()
      const fullDraft: DraftAnnotation = { ...entry.draft, fileId, tempId }
      setDrafts((prev) => [...prev, fullDraft])
      undoStackRef.current = [
        ...undoStackRef.current,
        { kind: "create", tempId, serverId: null, draft: entry.draft },
      ]
      void persistDraft(fullDraft)
    } else if (entry.kind === "update") {
      // Re-apply an update — push the "after" values back.
      const targetId = entry.after.id
      const before = entry.before
      const after = entry.after
      const exists = annotations.some((a) => a.id === targetId)
      if (!exists) {
        tickHistory()
        return
      }
      setAnnotations((prev) =>
        prev.map((a) => (a.id === targetId ? after : a)),
      )
      api
        .patch(`/files/${fileId}/annotations/${targetId}`, {
          color: after.color,
          thickness: after.thickness,
          opacity: after.opacity,
          normalizedX: after.normalizedX,
          normalizedY: after.normalizedY,
          normalizedW: after.normalizedW,
          normalizedH: after.normalizedH,
          content: after.content,
          pathData: after.pathData,
        })
        .catch(() => {
          setAnnotations((prev) =>
            prev.map((a) => (a.id === targetId ? before : a)),
          )
          toast.error("Failed to redo. Reverted.")
        })
      undoStackRef.current = [
        ...undoStackRef.current,
        { kind: "update", before, after },
      ]
    } else {
      // Re-apply a delete — find the most recently re-created matching row
      // (created via the undo of the original delete) and delete it.
      const a = entry.annotation
      const candidate =
        annotations
          .filter(
            (cand) =>
              cand.toolType === a.toolType &&
              cand.page === a.page &&
              cand.normalizedX === a.normalizedX &&
              cand.normalizedY === a.normalizedY &&
              cand.content === a.content,
          )
          .sort((x, y) =>
            new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime(),
          )[0] ?? null
      if (!candidate) {
        // Nothing to redo against.
        tickHistory()
        return
      }
      setAnnotations((prev) => prev.filter((row) => row.id !== candidate.id))
      undoStackRef.current = [
        ...undoStackRef.current,
        { kind: "delete", annotation: candidate },
      ]
      api
        .delete(`/files/${fileId}/annotations/${candidate.id}`)
        .catch(() => {
          setAnnotations((prev) => [...prev, candidate])
          toast.error("Failed to redo. Reverted.")
        })
    }
    tickHistory()
  }, [annotations, fileId, persistDraft, tickHistory])

  const canUndo = undoStackRef.current.length > 0
  const canRedo = redoStackRef.current.length > 0

  return {
    annotations,
    drafts,
    loading,
    loadError,
    refresh,
    active,
    setActive,
    presets,
    updatePreset,
    presetForActive,
    showMarkup,
    setShowMarkup,
    filterMine,
    setFilterMine,
    createAnnotation,
    deleteAnnotation,
    updateAnnotation,
    canUndo,
    canRedo,
    undo,
    redo,
  }
}
