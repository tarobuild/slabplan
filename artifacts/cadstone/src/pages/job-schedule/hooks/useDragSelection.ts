import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react"

import { DRAG_MOVE_THRESHOLD_MINUTES, minutesFromClientY, type DragSelection } from "../drag"

interface UseDragSelectionParams {
  dragSelection: DragSelection | null
  dragSelectionRef: MutableRefObject<DragSelection | null>
  setDragSelection: Dispatch<SetStateAction<DragSelection | null>>
  commitTimedSelection: (selection: DragSelection) => void
}

/**
 * Manages window-level pointer listeners for the drag-to-create selection
 * gesture in calendar week/day views. Activates whenever a drag selection
 * is in flight and detaches automatically when it ends.
 */
export function useDragSelection({
  dragSelection,
  dragSelectionRef,
  setDragSelection,
  commitTimedSelection,
}: UseDragSelectionParams) {
  useEffect(() => {
    if (!dragSelection) {
      return
    }

    function handleMove(event: PointerEvent) {
      const current = dragSelectionRef.current
      if (!current || current.pointerId !== event.pointerId) {
        return
      }
      const minutes = minutesFromClientY(event.clientY, current.rectTop, current.rectHeight)
      const start = Math.min(current.anchorMinutes, minutes)
      const end = Math.max(current.anchorMinutes, minutes)
      const moved = current.moved || Math.abs(minutes - current.anchorMinutes) >= DRAG_MOVE_THRESHOLD_MINUTES
      const next: DragSelection = { ...current, startMinutes: start, endMinutes: end, moved }
      dragSelectionRef.current = next
      setDragSelection(next)
    }

    function handleUp(event: PointerEvent) {
      const current = dragSelectionRef.current
      if (!current || current.pointerId !== event.pointerId) {
        return
      }
      dragSelectionRef.current = null
      setDragSelection(null)
      commitTimedSelection(current)
    }

    function handleCancel(event: PointerEvent) {
      const current = dragSelectionRef.current
      if (!current || current.pointerId !== event.pointerId) {
        return
      }
      dragSelectionRef.current = null
      setDragSelection(null)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    window.addEventListener("pointercancel", handleCancel)
    return () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
      window.removeEventListener("pointercancel", handleCancel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragSelection?.pointerId])
}
