import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { toastApiError } from "@/lib/api-errors"
import {
  calculateBusinessEndDate,
  itemEndDate,
  type ScheduleItemPayload,
  type ScheduleItemRecord,
  type ScheduleWorkdayException,
} from "@/lib/schedule"
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  DRAG_SNAP_MINUTES,
  TIMED_GRID_TOTAL_MINUTES,
  minutesFromClientY,
  minutesToTimeString,
  timeStringToGridMinutes,
  type BlockDrag,
  type DragSelection,
  type GanttDrag,
  type GanttDragMode,
} from "../drag"
import { isDraftScheduleItemId, schedulePayloadFromItem } from "../draft"
import { useBlockDrag } from "./useBlockDrag"
import { useDragSelection } from "./useDragSelection"
import { useGanttDrag } from "./useGanttDrag"

export interface UseScheduleDragHandlersOptions {
  jobId: string | undefined
  items: ScheduleItemRecord[]
  setItems: React.Dispatch<React.SetStateAction<ScheduleItemRecord[]>>
  workdayExceptions: ScheduleWorkdayException[]
  dayWidth: number
  scheduleOffline: boolean
  refreshScheduleData: () => Promise<void>
  openQuickCreate: (startDate: string, startTime?: string, endTime?: string) => void
}

export function useScheduleDragHandlers({
  jobId,
  items,
  setItems,
  workdayExceptions,
  dayWidth,
  scheduleOffline,
  refreshScheduleData,
  openQuickCreate,
}: UseScheduleDragHandlersOptions) {
  const [dragSelection, setDragSelection] = useState<DragSelection | null>(null)
  const dragSelectionRef = useRef<DragSelection | null>(null)
  const [blockDrag, setBlockDrag] = useState<BlockDrag | null>(null)
  const blockDragRef = useRef<BlockDrag | null>(null)
  const blockClickSuppressRef = useRef<string | null>(null)
  const undoBlockDragToastIdRef = useRef<string | number | null>(null)
  const [ganttDrag, setGanttDrag] = useState<GanttDrag | null>(null)
  const ganttDragRef = useRef<GanttDrag | null>(null)
  const ganttClickSuppressRef = useRef<string | null>(null)
  const undoGanttDragToastIdRef = useRef<string | number | null>(null)

  function openHourBlockFromMinutes(dayKey: string, anchorMinutes: number) {
    const hour = Math.min(DAY_END_HOUR, Math.floor(anchorMinutes / 60) + DAY_START_HOUR)
    const startTime = `${String(hour).padStart(2, "0")}:00`
    const endTime = `${String(Math.min(hour + 1, DAY_END_HOUR + 1)).padStart(2, "0")}:00`
    openQuickCreate(dayKey, startTime, endTime)
  }

  function commitTimedSelection(dragState: DragSelection) {
    const dayKey = dragState.dayKey
    if (!dragState.moved) {
      openHourBlockFromMinutes(dayKey, dragState.anchorMinutes)
      return
    }
    let start = dragState.startMinutes
    let end = dragState.endMinutes
    if (end - start < DRAG_SNAP_MINUTES) {
      end = Math.min(TIMED_GRID_TOTAL_MINUTES, start + DRAG_SNAP_MINUTES)
      if (end - start < DRAG_SNAP_MINUTES) {
        start = Math.max(0, end - DRAG_SNAP_MINUTES)
      }
    }
    openQuickCreate(dayKey, minutesToTimeString(start), minutesToTimeString(end))
  }

  function isBlockDraggable(item: ScheduleItemRecord) {
    if (!item.isHourly) {
      return false
    }
    if (!item.startTime || !item.endTime) {
      return false
    }
    if (itemEndDate(item) !== item.startDate) {
      return false
    }
    const start = timeStringToGridMinutes(item.startTime)
    const end = timeStringToGridMinutes(item.endTime)
    if (start === null || end === null) {
      return false
    }
    if (start < 0 || end > TIMED_GRID_TOTAL_MINUTES || end <= start) {
      return false
    }
    return true
  }

  function dismissUndoBlockDragToast() {
    if (undoBlockDragToastIdRef.current !== null) {
      toast.dismiss(undoBlockDragToastIdRef.current)
      undoBlockDragToastIdRef.current = null
    }
  }

  async function undoBlockDrag(snapshot: {
    itemId: string
    startDate: string
    startTime: string | null
    endTime: string | null
    isHourly: boolean
  }) {
    let snapshotTarget: ScheduleItemRecord | null = null
    let previousItems: ScheduleItemRecord[] | null = null
    setItems((current) => {
      const target = current.find((entry) => entry.id === snapshot.itemId)
      if (!target) {
        return current
      }
      snapshotTarget = target
      previousItems = current
      return current.map((entry) =>
        entry.id === snapshot.itemId
          ? {
              ...entry,
              startDate: snapshot.startDate,
              startTime: snapshot.startTime,
              endTime: snapshot.endTime,
              isHourly: snapshot.isHourly,
            }
          : entry,
      )
    })
    if (!snapshotTarget || !previousItems) {
      return
    }

    try {
      const payload: ScheduleItemPayload = {
        ...schedulePayloadFromItem(snapshotTarget),
        startDate: snapshot.startDate,
        isHourly: snapshot.isHourly,
        startTime: snapshot.isHourly ? snapshot.startTime : null,
        endTime: snapshot.isHourly ? snapshot.endTime : null,
      }
      await api.put(`/schedule-items/${snapshot.itemId}`, payload)
      await refreshScheduleData()
      toast.success("Schedule change undone")
    } catch (error) {
      setItems(previousItems)
      toastApiError(error, "Failed to undo schedule change")
    }
  }

  async function commitBlockDrag(drag: BlockDrag) {
    const target = items.find((entry) => entry.id === drag.itemId)
    if (!target) {
      return
    }
    const newStartTime = minutesToTimeString(drag.startMinutes)
    const newEndTime = minutesToTimeString(drag.endMinutes)
    const newStartDate = drag.mode === "move" ? drag.dayKey : target.startDate
    if (
      newStartDate === target.startDate &&
      newStartTime === target.startTime &&
      newEndTime === target.endTime
    ) {
      return
    }

    const previousSnapshot = {
      itemId: target.id,
      startDate: target.startDate,
      startTime: target.startTime,
      endTime: target.endTime,
      isHourly: !!target.isHourly,
    }
    const itemTitle = target.title
    const previousItems = items
    const optimistic = items.map((entry) =>
      entry.id === target.id
        ? {
            ...entry,
            startDate: newStartDate,
            endDate: newStartDate,
            startTime: newStartTime,
            endTime: newEndTime,
            isHourly: true,
          }
        : entry,
    )
    setItems(optimistic)

    try {
      const payload: ScheduleItemPayload = {
        ...schedulePayloadFromItem(target),
        startDate: newStartDate,
        isHourly: true,
        startTime: newStartTime,
        endTime: newEndTime,
      }
      await api.put(`/schedule-items/${target.id}`, payload)
      await refreshScheduleData()
      dismissUndoBlockDragToast()
      const label = itemTitle.trim() ? `Moved "${itemTitle}"` : "Schedule block updated"
      const toastId = toast.success(label, {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            undoBlockDragToastIdRef.current = null
            void undoBlockDrag(previousSnapshot)
          },
        },
        onDismiss: (current) => {
          if (undoBlockDragToastIdRef.current === current.id) {
            undoBlockDragToastIdRef.current = null
          }
        },
        onAutoClose: (current) => {
          if (undoBlockDragToastIdRef.current === current.id) {
            undoBlockDragToastIdRef.current = null
          }
        },
      })
      undoBlockDragToastIdRef.current = toastId
    } catch (error) {
      setItems(previousItems)
      toastApiError(error, "Failed to update schedule item")
    }
  }

  function dismissUndoGanttDragToast() {
    if (undoGanttDragToastIdRef.current !== null) {
      toast.dismiss(undoGanttDragToastIdRef.current)
      undoGanttDragToastIdRef.current = null
    }
  }

  function isGanttBarDraggable(item: ScheduleItemRecord) {
    if (scheduleOffline) {
      return false
    }
    if (isDraftScheduleItemId(item.id)) {
      return false
    }
    return true
  }

  function handleGanttBarPointerDown(
    event: React.PointerEvent<HTMLElement>,
    item: ScheduleItemRecord,
    mode: GanttDragMode,
  ) {
    if (event.button !== 0) {
      return
    }
    if (event.pointerType !== "mouse") {
      return
    }
    if (!isGanttBarDraggable(item)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()

    dismissUndoGanttDragToast()

    const safeWorkDays = Math.max(item.workDays, 1)
    const next: GanttDrag = {
      itemId: item.id,
      pointerId: event.pointerId,
      mode,
      origStartDate: item.startDate,
      origWorkDays: safeWorkDays,
      origEndDate: calculateBusinessEndDate(
        item.startDate,
        safeWorkDays,
        workdayExceptions,
      ),
      startDate: item.startDate,
      workDays: safeWorkDays,
      anchorClientX: event.clientX,
      dayWidth,
      moved: false,
    }
    ganttDragRef.current = next
    setGanttDrag(next)
  }

  async function undoGanttDrag(snapshot: {
    itemId: string
    startDate: string
    workDays: number
  }) {
    let snapshotTarget: ScheduleItemRecord | null = null
    let previousItems: ScheduleItemRecord[] | null = null
    setItems((current) => {
      const target = current.find((entry) => entry.id === snapshot.itemId)
      if (!target) {
        return current
      }
      snapshotTarget = target
      previousItems = current
      const restoredEndDate = calculateBusinessEndDate(
        snapshot.startDate,
        snapshot.workDays,
        workdayExceptions,
      )
      return current.map((entry) =>
        entry.id === snapshot.itemId
          ? {
              ...entry,
              startDate: snapshot.startDate,
              workDays: snapshot.workDays,
              endDate: restoredEndDate,
            }
          : entry,
      )
    })
    if (!snapshotTarget || !previousItems) {
      return
    }

    try {
      const payload: ScheduleItemPayload = {
        ...schedulePayloadFromItem(snapshotTarget),
        startDate: snapshot.startDate,
        workDays: snapshot.workDays,
      }
      await api.put(`/schedule-items/${snapshot.itemId}`, payload)
      await refreshScheduleData()
      toast.success("Schedule change undone")
    } catch (error) {
      setItems(previousItems)
      toastApiError(error, "Failed to undo schedule change")
    }
  }

  async function commitGanttDrag(drag: GanttDrag) {
    const target = items.find((entry) => entry.id === drag.itemId)
    if (!target) {
      return
    }
    const newStartDate = drag.mode === "move" ? drag.startDate : target.startDate
    const newWorkDays = drag.mode === "resize-end" ? drag.workDays : Math.max(target.workDays, 1)
    if (newStartDate === target.startDate && newWorkDays === Math.max(target.workDays, 1)) {
      return
    }

    const previousSnapshot = {
      itemId: target.id,
      startDate: target.startDate,
      workDays: Math.max(target.workDays, 1),
    }
    const itemTitle = target.title
    const previousItems = items
    const optimisticEndDate = calculateBusinessEndDate(newStartDate, newWorkDays, workdayExceptions)
    const optimistic = items.map((entry) =>
      entry.id === target.id
        ? {
            ...entry,
            startDate: newStartDate,
            workDays: newWorkDays,
            endDate: optimisticEndDate,
          }
        : entry,
    )
    setItems(optimistic)

    try {
      const payload: ScheduleItemPayload = {
        ...schedulePayloadFromItem(target),
        startDate: newStartDate,
        workDays: newWorkDays,
      }
      await api.put(`/schedule-items/${target.id}`, payload)
      await refreshScheduleData()
      dismissUndoGanttDragToast()
      const label = itemTitle.trim() ? `Updated "${itemTitle}"` : "Schedule item updated"
      const toastId = toast.success(label, {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            undoGanttDragToastIdRef.current = null
            void undoGanttDrag(previousSnapshot)
          },
        },
        onDismiss: (current) => {
          if (undoGanttDragToastIdRef.current === current.id) {
            undoGanttDragToastIdRef.current = null
          }
        },
        onAutoClose: (current) => {
          if (undoGanttDragToastIdRef.current === current.id) {
            undoGanttDragToastIdRef.current = null
          }
        },
      })
      undoGanttDragToastIdRef.current = toastId
    } catch (error) {
      setItems(previousItems)
      toastApiError(error, "Failed to update schedule item")
    }
  }

  function handleTimedColumnPointerDown(event: React.PointerEvent<HTMLDivElement>, dayKey: string) {
    if (event.button !== 0) {
      return
    }
    const targetEl = event.target as HTMLElement | null
    if (targetEl && targetEl !== event.currentTarget && targetEl.closest("button")) {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const anchorMinutes = minutesFromClientY(event.clientY, rect.top, rect.height)

    if (event.pointerType !== "mouse") {
      openHourBlockFromMinutes(dayKey, anchorMinutes)
      return
    }

    event.preventDefault()

    const next: DragSelection = {
      dayKey,
      pointerId: event.pointerId,
      rectTop: rect.top,
      rectHeight: rect.height,
      anchorMinutes,
      startMinutes: anchorMinutes,
      endMinutes: anchorMinutes,
      moved: false,
    }
    dragSelectionRef.current = next
    setDragSelection(next)
  }

  useDragSelection({
    dragSelection,
    dragSelectionRef,
    setDragSelection,
    commitTimedSelection,
  })

  const { handleBlockPointerDown } = useBlockDrag({
    blockDragRef,
    setBlockDrag,
    blockClickSuppressRef,
    isBlockDraggable,
    dismissUndoBlockDragToast,
    commitBlockDrag,
  })

  useGanttDrag({
    ganttDrag,
    ganttDragRef,
    setGanttDrag,
    ganttClickSuppressRef,
    workdayExceptions,
    commitGanttDrag,
  })

  useEffect(() => {
    return () => {
      if (undoBlockDragToastIdRef.current !== null) {
        toast.dismiss(undoBlockDragToastIdRef.current)
        undoBlockDragToastIdRef.current = null
      }
      if (undoGanttDragToastIdRef.current !== null) {
        toast.dismiss(undoGanttDragToastIdRef.current)
        undoGanttDragToastIdRef.current = null
      }
    }
  }, [jobId])

  return {
    dragSelection,
    blockDrag,
    blockClickSuppressRef,
    ganttDrag,
    ganttClickSuppressRef,
    handleBlockPointerDown,
    handleGanttBarPointerDown,
    handleTimedColumnPointerDown,
    isBlockDraggable,
    isGanttBarDraggable,
  }
}
