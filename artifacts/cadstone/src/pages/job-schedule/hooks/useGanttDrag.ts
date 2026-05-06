import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react"

import {
  calculateWorkDaysBetween,
  dateKey,
  type ScheduleWorkdayException,
} from "@/lib/schedule"

import { addDays, parseDate } from "../calendar-utils"
import type { GanttDrag } from "../drag"

interface UseGanttDragParams {
  ganttDrag: GanttDrag | null
  ganttDragRef: MutableRefObject<GanttDrag | null>
  setGanttDrag: Dispatch<SetStateAction<GanttDrag | null>>
  ganttClickSuppressRef: MutableRefObject<string | null>
  workdayExceptions: ScheduleWorkdayException[]
  commitGanttDrag: (drag: GanttDrag) => Promise<void> | void
}

/**
 * Manages window-level pointer listeners while a Gantt bar is being dragged
 * (move or right-edge resize). Computes the next start date / workdays and
 * commits the drag on pointerup, while suppressing the click that follows.
 */
export function useGanttDrag({
  ganttDrag,
  ganttDragRef,
  setGanttDrag,
  ganttClickSuppressRef,
  workdayExceptions,
  commitGanttDrag,
}: UseGanttDragParams) {
  useEffect(() => {
    if (!ganttDrag) {
      return
    }

    function handleMove(event: PointerEvent) {
      const current = ganttDragRef.current
      if (!current || current.pointerId !== event.pointerId) {
        return
      }

      const deltaPx = event.clientX - current.anchorClientX
      const deltaDays = current.dayWidth > 0 ? Math.round(deltaPx / current.dayWidth) : 0

      let nextStartDate = current.origStartDate
      let nextWorkDays = current.origWorkDays

      if (current.mode === "move") {
        const start = addDays(parseDate(current.origStartDate), deltaDays)
        nextStartDate = dateKey(start)
      } else {
        const targetEnd = addDays(parseDate(current.origEndDate), deltaDays)
        const targetEndKey = dateKey(targetEnd)
        nextWorkDays =
          targetEndKey < current.origStartDate
            ? 1
            : calculateWorkDaysBetween(
                current.origStartDate,
                targetEndKey,
                workdayExceptions,
              )
      }

      if (nextStartDate === current.startDate && nextWorkDays === current.workDays) {
        return
      }

      const moved =
        current.moved ||
        nextStartDate !== current.origStartDate ||
        nextWorkDays !== current.origWorkDays

      const next: GanttDrag = {
        ...current,
        startDate: nextStartDate,
        workDays: nextWorkDays,
        moved,
      }
      ganttDragRef.current = next
      setGanttDrag(next)
    }

    function handleUp(event: PointerEvent) {
      const current = ganttDragRef.current
      if (!current || current.pointerId !== event.pointerId) {
        return
      }
      ganttDragRef.current = null
      setGanttDrag(null)
      if (current.moved) {
        ganttClickSuppressRef.current = current.itemId
        void commitGanttDrag(current)
      }
    }

    function handleCancel(event: PointerEvent) {
      const current = ganttDragRef.current
      if (!current || current.pointerId !== event.pointerId) {
        return
      }
      ganttDragRef.current = null
      setGanttDrag(null)
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
  }, [ganttDrag?.pointerId])
}
