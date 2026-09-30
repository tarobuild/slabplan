import type { ScheduleItem } from "@workspace/api-client-react"
import { dateKey } from "@/lib/schedule"
import {
  addDays,
  buildMonthWeeks,
  diffInDays,
  formatMonthLabel,
  formatRangeLabel,
  parseDate,
  startOfWeek,
} from "../job-schedule/calendar-utils"
import { GANTT_SCALES } from "../job-schedule/constants"
import type { GanttScale } from "../job-schedule/types"

// Pure layout helpers for the company Schedule views (Gantt, Week, Month).
// They only arrange rows the API already returned for the visible period.

export type ScheduleRow = ScheduleItem & {
  jobTitle?: string | null
  clientId?: string | null
  clientName?: string | null
}

export type CalendarViewMode = "gantt" | "week" | "month"

export const GANTT_WINDOW_DAYS = 35

export function localDateKey(date = new Date()) {
  return dateKey(date)
}

export function deriveStatus(item: ScheduleRow, today = localDateKey()): { label: string; tone: string } {
  if (item.isComplete) return { label: "Complete", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" }
  if (item.endDate && item.endDate < today) return { label: "Overdue", tone: "border-rose-200 bg-rose-50 text-rose-700" }
  if (item.startDate && item.startDate <= today && item.endDate && item.endDate >= today) {
    return { label: "In progress", tone: "border-blue-200 bg-blue-50 text-blue-700" }
  }
  return { label: "Upcoming", tone: "border-slate-200 bg-slate-50 text-slate-600" }
}

export function rowEndDate(row: Pick<ScheduleRow, "startDate" | "endDate">) {
  return row.endDate || row.startDate
}

export function rowColor(row: Pick<ScheduleRow, "displayColor" | "phaseColor">) {
  return row.displayColor || row.phaseColor || "#94a3b8"
}

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/

/** The period anchor from `?date=`, falling back to today for bad input. */
export function parseAnchor(value: string | null | undefined, today = localDateKey()) {
  if (value && DATE_PARAM.test(value)) {
    const parsed = parseDate(value)
    if (!Number.isNaN(parsed.getTime()) && dateKey(parsed) === value) return value
  }
  return today
}

export type ViewWindow = { start: string; end: string; days: string[]; label: string }

export function parseGanttScale(value: string | null): GanttScale {
  return GANTT_SCALES.find((scale) => scale.value === value)?.value ?? "day"
}

export function getViewWindow(mode: CalendarViewMode, anchor: string, scale: GanttScale = "day"): ViewWindow {
  const anchorDate = parseDate(anchor)
  if (mode === "week") {
    const start = startOfWeek(anchorDate)
    const days = Array.from({ length: 7 }, (_, index) => dateKey(addDays(start, index)))
    return { start: days[0], end: days[6], days, label: formatRangeLabel(start, addDays(start, 6)) }
  }
  if (mode === "month") {
    const days = buildMonthWeeks(anchorDate).flat()
    return { start: days[0], end: days[days.length - 1], days, label: formatMonthLabel(anchorDate) }
  }
  let start = addDays(startOfWeek(anchorDate), -7)
  let end = addDays(start, GANTT_WINDOW_DAYS - 1)
  if (scale === "week") {
    start = addDays(startOfWeek(anchorDate), -14)
    end = addDays(start, 83)
  } else if (scale === "month") {
    start = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1)
    end = new Date(start.getFullYear(), start.getMonth() + 12, 0)
  } else if (scale === "year") {
    start = new Date(anchorDate.getFullYear() - 1, 0, 1)
    end = new Date(anchorDate.getFullYear() + 1, 11, 31)
  }
  const days = Array.from({ length: diffInDays(start, end) + 1 }, (_, index) => dateKey(addDays(start, index)))
  return {
    start: days[0],
    end: days[days.length - 1],
    days,
    label: formatRangeLabel(start, end),
  }
}

/** Moves the anchor one period back (-1) or forward (+1). */
export function shiftAnchor(mode: CalendarViewMode, anchor: string, direction: -1 | 1, scale: GanttScale = "day") {
  const anchorDate = parseDate(anchor)
  if (mode === "week") return dateKey(addDays(anchorDate, 7 * direction))
  if (mode === "month") {
    return dateKey(new Date(anchorDate.getFullYear(), anchorDate.getMonth() + direction, 1))
  }
  if (scale === "week") return dateKey(addDays(anchorDate, 77 * direction))
  if (scale === "month") return dateKey(new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 11 * direction, 1))
  if (scale === "year") return dateKey(new Date(anchorDate.getFullYear() + 2 * direction, 0, 1))
  return dateKey(addDays(anchorDate, 28 * direction))
}

/**
 * The date range to request: the visible period narrowed by any From/To
 * filter the user set. `null` means the filters exclude the whole period.
 */
export function intersectRange(
  window: { start: string; end: string },
  from?: string | null,
  to?: string | null,
): { from: string; to: string } | null {
  const effectiveFrom = from && from > window.start ? from : window.start
  const effectiveTo = to && to < window.end ? to : window.end
  return effectiveFrom <= effectiveTo ? { from: effectiveFrom, to: effectiveTo } : null
}

export type LaneSegment = {
  row: ScheduleRow
  lane: number
  startIndex: number
  endIndex: number
  /** The item continues before/after the visible days. */
  continuesBefore: boolean
  continuesAfter: boolean
}

/** Packs rows overlapping `days` into non-overlapping horizontal lanes. */
export function buildLanes(days: string[], rows: ScheduleRow[]): LaneSegment[] {
  if (days.length === 0) return []
  const first = days[0]
  const last = days[days.length - 1]
  const laneEnds: string[] = []
  return rows
    .filter((row) => row.startDate <= last && rowEndDate(row) >= first)
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        rowEndDate(b).localeCompare(rowEndDate(a)) ||
        a.title.localeCompare(b.title),
    )
    .map((row) => {
      const segStart = row.startDate > first ? row.startDate : first
      const segEnd = rowEndDate(row) < last ? rowEndDate(row) : last
      let lane = 0
      while (laneEnds[lane] && laneEnds[lane] >= segStart) lane += 1
      laneEnds[lane] = segEnd
      return {
        row,
        lane,
        startIndex: days.indexOf(segStart),
        endIndex: days.indexOf(segEnd),
        continuesBefore: row.startDate < first,
        continuesAfter: rowEndDate(row) > last,
      }
    })
}

/** Rows that touch a single day, in start order. */
export function rowsOnDay(day: string, rows: ScheduleRow[]) {
  return rows
    .filter((row) => row.startDate <= day && rowEndDate(row) >= day)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
}

export type GanttSpan = {
  startIndex: number
  endIndex: number
  continuesBefore: boolean
  continuesAfter: boolean
}

/** Column span of a row inside the Gantt window, or null if outside it. */
export function ganttSpan(row: ScheduleRow, window: { start: string; end: string }): GanttSpan | null {
  const end = rowEndDate(row)
  if (row.startDate > window.end || end < window.start) return null
  const windowStart = parseDate(window.start)
  const lastIndex = diffInDays(windowStart, parseDate(window.end))
  const startIndex = Math.max(0, diffInDays(windowStart, parseDate(row.startDate)))
  const endIndex = Math.min(lastIndex, diffInDays(windowStart, parseDate(end)))
  return {
    startIndex,
    endIndex,
    continuesBefore: row.startDate < window.start,
    continuesAfter: end > window.end,
  }
}

export type JobGroup = {
  key: string
  jobId: string | null
  jobTitle: string
  clientName: string | null
  rows: ScheduleRow[]
}

/** Groups rows by job, ordered by each job's earliest item. */
export function groupRowsByJob(rows: ScheduleRow[]): JobGroup[] {
  const map = new Map<string, JobGroup>()
  for (const row of rows) {
    const key = row.jobId ?? "__none__"
    const group = map.get(key) ?? {
      key,
      jobId: row.jobId ?? null,
      jobTitle: row.jobTitle ?? "Unknown job",
      clientName: row.clientName ?? null,
      rows: [],
    }
    group.rows.push(row)
    map.set(key, group)
  }
  const groups = Array.from(map.values())
  for (const group of groups) {
    group.rows.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
  }
  return groups.sort(
    (a, b) =>
      a.rows[0].startDate.localeCompare(b.rows[0].startDate) || a.jobTitle.localeCompare(b.jobTitle),
  )
}

/** Opens the item's job schedule using the existing deep-link URL. */
export function itemHref(row: Pick<ScheduleRow, "id" | "jobId">) {
  return row.jobId ? `/jobs/${row.jobId}/schedule?focus=${row.id}` : "/jobs"
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

export function formatSpan(row: Pick<ScheduleRow, "startDate" | "endDate">) {
  const start = SHORT_DATE.format(parseDate(row.startDate))
  const end = rowEndDate(row)
  return end === row.startDate ? start : `${start} – ${SHORT_DATE.format(parseDate(end))}`
}
