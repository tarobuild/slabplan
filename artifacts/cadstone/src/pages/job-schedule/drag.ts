export const DAY_START_HOUR = 6
export const DAY_END_HOUR = 19
export const HOUR_HEIGHT = 56
export const TIMED_GRID_TOTAL_MINUTES = (DAY_END_HOUR - DAY_START_HOUR + 1) * 60
export const DRAG_SNAP_MINUTES = 15
export const DRAG_MOVE_THRESHOLD_MINUTES = 8
export const TOUCH_LONG_PRESS_MS = 400
export const TOUCH_LONG_PRESS_MOVE_TOLERANCE = 10

export type DragSelection = {
  dayKey: string
  pointerId: number
  rectTop: number
  rectHeight: number
  anchorMinutes: number
  startMinutes: number
  endMinutes: number
  moved: boolean
}

export type BlockDragColumn = {
  dayKey: string
  left: number
  right: number
  top: number
  height: number
}

export type BlockDragMode = "move" | "resize-start" | "resize-end"

export type BlockDrag = {
  itemId: string
  pointerId: number
  mode: BlockDragMode
  durationMinutes: number
  anchorOffsetMinutes: number
  startMinutes: number
  endMinutes: number
  dayKey: string
  origStartMinutes: number
  origEndMinutes: number
  origDayKey: string
  rectTop: number
  rectHeight: number
  moved: boolean
  columns: BlockDragColumn[]
}

export type GanttDragMode = "move" | "resize-end"

export type GanttDrag = {
  itemId: string
  pointerId: number
  mode: GanttDragMode
  origStartDate: string
  origWorkDays: number
  origEndDate: string
  startDate: string
  workDays: number
  anchorClientX: number
  dayWidth: number
  moved: boolean
}

export function snapMinutes(min: number, step = DRAG_SNAP_MINUTES) {
  return Math.round(min / step) * step
}

export function clampMinutes(min: number) {
  return Math.max(0, Math.min(TIMED_GRID_TOTAL_MINUTES, min))
}

export function minutesFromClientY(clientY: number, rectTop: number, rectHeight: number) {
  if (rectHeight <= 0) {
    return 0
  }
  const offset = Math.max(0, Math.min(rectHeight, clientY - rectTop))
  const minutes = (offset / rectHeight) * TIMED_GRID_TOTAL_MINUTES
  return clampMinutes(snapMinutes(minutes))
}

export function rawMinutesFromClientY(clientY: number, rectTop: number, rectHeight: number) {
  if (rectHeight <= 0) {
    return 0
  }
  const offset = Math.max(0, Math.min(rectHeight, clientY - rectTop))
  return (offset / rectHeight) * TIMED_GRID_TOTAL_MINUTES
}

export function minutesToTimeString(absMin: number) {
  const total = DAY_START_HOUR * 60 + clampMinutes(absMin)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

export function timeStringToGridMinutes(value: string | null | undefined) {
  if (!value) {
    return null
  }
  const [hStr, mStr] = value.split(":")
  const h = Number(hStr)
  const m = Number(mStr)
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return null
  }
  return (h - DAY_START_HOUR) * 60 + m
}
