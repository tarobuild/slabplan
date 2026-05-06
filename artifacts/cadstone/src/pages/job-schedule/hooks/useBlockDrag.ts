import { useEffect, useRef, type Dispatch, type MutableRefObject, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react"

import type { ScheduleItemRecord } from "@/lib/schedule"

import {
  clampMinutes,
  DRAG_SNAP_MINUTES,
  minutesFromClientY,
  rawMinutesFromClientY,
  snapMinutes,
  TIMED_GRID_TOTAL_MINUTES,
  TOUCH_LONG_PRESS_MOVE_TOLERANCE,
  TOUCH_LONG_PRESS_MS,
  timeStringToGridMinutes,
  type BlockDrag,
  type BlockDragColumn,
  type BlockDragMode,
} from "../drag"

interface UseBlockDragParams {
  blockDragRef: MutableRefObject<BlockDrag | null>
  setBlockDrag: Dispatch<SetStateAction<BlockDrag | null>>
  blockClickSuppressRef: MutableRefObject<string | null>
  isBlockDraggable: (item: ScheduleItemRecord) => boolean
  dismissUndoBlockDragToast: () => void
  commitBlockDrag: (drag: BlockDrag) => Promise<void> | void
}

interface UseBlockDragResult {
  handleBlockPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    item: ScheduleItemRecord,
    dayKey: string,
    mode: BlockDragMode,
  ) => void
}

/**
 * Owns the block-drag state machine for hourly schedule blocks in the
 * calendar (move, resize-start, resize-end). Returns the pointerDown handler
 * to attach to draggable block surfaces. Window pointer listeners are
 * attached synchronously inside the handler so the very first pointermove —
 * which can arrive in the same tick — is captured. Listeners are stored in
 * refs so they can be detached on up/cancel and on unmount.
 *
 * Touch path: phones/tablets get drag behind a 400ms long-press so plain
 * taps still open the editor and quick swipes still scroll the page. Once
 * armed, a non-passive touchmove suppressor stops native scroll for the
 * remainder of the drag.
 */
export function useBlockDrag({
  blockDragRef,
  setBlockDrag,
  blockClickSuppressRef,
  isBlockDraggable,
  dismissUndoBlockDragToast,
  commitBlockDrag,
}: UseBlockDragParams): UseBlockDragResult {
  const moveHandlerRef = useRef<((event: PointerEvent) => void) | null>(null)
  const upHandlerRef = useRef<((event: PointerEvent) => void) | null>(null)
  const cancelHandlerRef = useRef<((event: PointerEvent) => void) | null>(null)
  // Long-press wait + non-passive touchmove suppressor for the touch
  // path. The suppressor is installed only after the long-press arms,
  // so a quick swipe starting on a block still scrolls the page.
  const blockTouchLongPressCleanupRef = useRef<(() => void) | null>(null)
  const blockTouchMovePreventRef = useRef<((event: TouchEvent) => void) | null>(null)

  function detachBlockTouchScrollPrevention() {
    if (blockTouchMovePreventRef.current) {
      window.removeEventListener("touchmove", blockTouchMovePreventRef.current)
      blockTouchMovePreventRef.current = null
    }
  }

  function detachListeners() {
    if (moveHandlerRef.current) {
      window.removeEventListener("pointermove", moveHandlerRef.current)
      moveHandlerRef.current = null
    }
    if (upHandlerRef.current) {
      window.removeEventListener("pointerup", upHandlerRef.current)
      upHandlerRef.current = null
    }
    if (cancelHandlerRef.current) {
      window.removeEventListener("pointercancel", cancelHandlerRef.current)
      cancelHandlerRef.current = null
    }
    detachBlockTouchScrollPrevention()
  }

  useEffect(() => {
    return () => {
      detachListeners()
      blockTouchLongPressCleanupRef.current?.()
      blockTouchLongPressCleanupRef.current = null
    }
  }, [])

  function handleBlockPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    item: ScheduleItemRecord,
    dayKey: string,
    mode: BlockDragMode,
  ) {
    if (event.button !== 0) {
      return
    }
    if (!isBlockDraggable(item)) {
      return
    }

    if (event.pointerType === "touch") {
      // Long-press to arm: phone users get drag without losing
      // native scroll for plain taps or swipes.
      const columnEl = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-timed-day]")
      if (!columnEl) {
        return
      }
      blockTouchLongPressCleanupRef.current?.()

      const startX = event.clientX
      const startY = event.clientY
      const pointerId = event.pointerId
      let lastClientX = startX
      let lastClientY = startY
      let armed = false
      let timerId: number | null = null

      const onPreMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return
        }
        lastClientX = moveEvent.clientX
        lastClientY = moveEvent.clientY
        if (armed) {
          return
        }
        const dx = moveEvent.clientX - startX
        const dy = moveEvent.clientY - startY
        if (Math.hypot(dx, dy) > TOUCH_LONG_PRESS_MOVE_TOLERANCE) {
          teardownPre()
        }
      }
      const onPreUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
          return
        }
        // Released before arm — fall through to the click handler so
        // a quick tap still opens the editor.
        teardownPre()
      }
      const onPreCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) {
          return
        }
        teardownPre()
      }

      function teardownPre() {
        if (timerId !== null) {
          window.clearTimeout(timerId)
          timerId = null
        }
        window.removeEventListener("pointermove", onPreMove)
        window.removeEventListener("pointerup", onPreUp)
        window.removeEventListener("pointercancel", onPreCancel)
        blockTouchLongPressCleanupRef.current = null
      }

      timerId = window.setTimeout(() => {
        timerId = null
        armed = true
        teardownPre()
        try {
          if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            navigator.vibrate(20)
          }
        } catch {
          // vibration is best-effort
        }
        // Suppress the trailing click so the editor doesn't open after
        // the drag commits.
        blockClickSuppressRef.current = item.id
        beginBlockDrag(item, dayKey, mode, pointerId, columnEl, lastClientX, lastClientY)
        // Install touchmove suppressor AFTER beginBlockDrag — it calls
        // detachListeners which would otherwise clear it. Subsequent
        // pointerup/cancel inside beginBlockDrag detach it via the same path.
        const preventTouchScroll = (touchEvent: TouchEvent) => {
          if (touchEvent.cancelable) {
            touchEvent.preventDefault()
          }
        }
        blockTouchMovePreventRef.current = preventTouchScroll
        window.addEventListener("touchmove", preventTouchScroll, { passive: false })
      }, TOUCH_LONG_PRESS_MS)

      blockTouchLongPressCleanupRef.current = teardownPre
      window.addEventListener("pointermove", onPreMove)
      window.addEventListener("pointerup", onPreUp)
      window.addEventListener("pointercancel", onPreCancel)
      return
    }

    const columnEl = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-timed-day]")
    if (!columnEl) {
      return
    }

    event.stopPropagation()
    event.preventDefault()
    beginBlockDrag(item, dayKey, mode, event.pointerId, columnEl, event.clientX, event.clientY)
  }

  function beginBlockDrag(
    item: ScheduleItemRecord,
    dayKey: string,
    mode: BlockDragMode,
    pointerId: number,
    columnEl: HTMLElement,
    clientX: number,
    clientY: number,
  ) {
    const startMin = timeStringToGridMinutes(item.startTime)
    const endMin = timeStringToGridMinutes(item.endTime)
    if (startMin === null || endMin === null) {
      return
    }

    dismissUndoBlockDragToast()

    const columns: BlockDragColumn[] = []
    const parent = columnEl.parentElement
    const siblings = parent?.querySelectorAll<HTMLElement>("[data-timed-day]")
    if (siblings && siblings.length > 0) {
      siblings.forEach((node) => {
        const key = node.dataset.timedDay
        if (!key) {
          return
        }
        const rect = node.getBoundingClientRect()
        columns.push({
          dayKey: key,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          height: rect.height,
        })
      })
    }
    if (columns.length === 0) {
      const rect = columnEl.getBoundingClientRect()
      columns.push({
        dayKey,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        height: rect.height,
      })
    }

    const myColumn = columns.find((col) => col.dayKey === dayKey) ?? columns[0]
    const pointerRaw = rawMinutesFromClientY(clientY, myColumn.top, myColumn.height)
    const anchorOffset = pointerRaw - startMin

    const next: BlockDrag = {
      itemId: item.id,
      pointerId,
      mode,
      durationMinutes: endMin - startMin,
      anchorOffsetMinutes: anchorOffset,
      startMinutes: startMin,
      endMinutes: endMin,
      dayKey,
      origStartMinutes: startMin,
      origEndMinutes: endMin,
      origDayKey: dayKey,
      rectTop: myColumn.top,
      rectHeight: myColumn.height,
      moved: false,
      columns,
    }
    blockDragRef.current = next
    setBlockDrag(next)

    detachListeners()

    const handleMove = (moveEvent: PointerEvent) => {
      const current = blockDragRef.current
      if (!current || current.pointerId !== moveEvent.pointerId) {
        return
      }

      let activeColumn = current.columns.find((col) => col.dayKey === current.dayKey) ?? current.columns[0]
      if (current.mode === "move" && current.columns.length > 1) {
        const hit = current.columns.find(
          (col) => moveEvent.clientX >= col.left && moveEvent.clientX <= col.right,
        )
        if (hit) {
          activeColumn = hit
        }
      }

      let nextStart = current.startMinutes
      let nextEnd = current.endMinutes
      let nextDayKey = current.dayKey

      if (current.mode === "move") {
        const pointerRaw = rawMinutesFromClientY(moveEvent.clientY, activeColumn.top, activeColumn.height)
        let start = clampMinutes(snapMinutes(pointerRaw - current.anchorOffsetMinutes))
        let endVal = start + current.durationMinutes
        if (endVal > TIMED_GRID_TOTAL_MINUTES) {
          endVal = TIMED_GRID_TOTAL_MINUTES
          start = Math.max(0, endVal - current.durationMinutes)
        }
        nextStart = start
        nextEnd = endVal
        nextDayKey = activeColumn.dayKey
      } else if (current.mode === "resize-start") {
        const pointer = minutesFromClientY(moveEvent.clientY, activeColumn.top, activeColumn.height)
        let start = pointer
        if (start > current.endMinutes - DRAG_SNAP_MINUTES) {
          start = current.endMinutes - DRAG_SNAP_MINUTES
        }
        nextStart = clampMinutes(start)
      } else {
        const pointer = minutesFromClientY(moveEvent.clientY, activeColumn.top, activeColumn.height)
        let endVal = pointer
        if (endVal < current.startMinutes + DRAG_SNAP_MINUTES) {
          endVal = current.startMinutes + DRAG_SNAP_MINUTES
        }
        nextEnd = clampMinutes(endVal)
      }

      const moved =
        current.moved ||
        nextStart !== current.origStartMinutes ||
        nextEnd !== current.origEndMinutes ||
        nextDayKey !== current.origDayKey

      const nextDrag: BlockDrag = {
        ...current,
        startMinutes: nextStart,
        endMinutes: nextEnd,
        dayKey: nextDayKey,
        rectTop: activeColumn.top,
        rectHeight: activeColumn.height,
        moved,
      }
      blockDragRef.current = nextDrag
      setBlockDrag(nextDrag)
    }

    const handleUp = (upEvent: PointerEvent) => {
      const current = blockDragRef.current
      if (!current || current.pointerId !== upEvent.pointerId) {
        return
      }
      detachListeners()
      blockDragRef.current = null
      setBlockDrag(null)
      if (current.moved) {
        blockClickSuppressRef.current = current.itemId
        void commitBlockDrag(current)
      }
    }

    const handleCancel = (cancelEvent: PointerEvent) => {
      const current = blockDragRef.current
      if (!current || current.pointerId !== cancelEvent.pointerId) {
        return
      }
      detachListeners()
      blockDragRef.current = null
      setBlockDrag(null)
    }

    moveHandlerRef.current = handleMove
    upHandlerRef.current = handleUp
    cancelHandlerRef.current = handleCancel
    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    window.addEventListener("pointercancel", handleCancel)
  }

  return { handleBlockPointerDown }
}
