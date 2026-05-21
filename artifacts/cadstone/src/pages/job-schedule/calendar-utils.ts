import {
  DEFAULT_SCHEDULE_COLOR,
  dateKey,
  itemEndDate,
  itemOverlapsDateRange,
  type ScheduleItemRecord,
} from "@/lib/schedule"
import type { SchedulePreview } from "@/components/schedule/ScheduleItemDialog"
import type { DayTimelineSegment, MonthWeekSegment, TimelineHeaderUnit } from "./types"
import type { GanttScale } from "./types"
import { DAY_END_HOUR, DAY_START_HOUR } from "./drag"

const DAY_END_EXCLUSIVE_HOUR = DAY_END_HOUR + 1

export function parseDate(value: string) {
  return new Date(`${value}T12:00:00`)
}

function cloneDate(date: Date) {
  return new Date(date.getTime())
}

export function addDays(date: Date, amount: number) {
  const next = cloneDate(date)
  next.setDate(next.getDate() + amount)
  return next
}

export function addMonths(date: Date, amount: number) {
  const next = cloneDate(date)
  next.setMonth(next.getMonth() + amount)
  return next
}

function addYears(date: Date, amount: number) {
  const next = cloneDate(date)
  next.setFullYear(next.getFullYear() + amount)
  return next
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

export function startOfWeek(date: Date) {
  const next = cloneDate(date)
  next.setDate(next.getDate() - next.getDay())
  next.setHours(0, 0, 0, 0)
  return next
}

export function endOfWeek(date: Date) {
  return addDays(startOfWeek(date), 6)
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1)
}

function endOfYear(date: Date) {
  return new Date(date.getFullYear(), 11, 31)
}

export function diffInDays(start: Date, end: Date) {
  const left = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const right = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.round((right.getTime() - left.getTime()) / 86_400_000)
}

function isWeekend(date: Date) {
  const day = date.getDay()
  return day === 0 || day === 6
}

export function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date)
}

export function formatRangeLabel(start: Date, end: Date) {
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()

  if (sameMonth) {
    return `${new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
    }).format(start)}-${new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      year: "numeric",
    }).format(end)}`
  }

  return `${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(start)} - ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(end)}`
}

export function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function formatCompactDay(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    weekday: "short",
  })
    .format(date)
    .replace(",", "")
}

function formatShortMonthDay(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date)
}

export function formatHourLabel(hour: number) {
  const period = hour >= 12 ? "PM" : "AM"
  const normalized = hour % 12 === 0 ? 12 : hour % 12
  return `${normalized}:00 ${period}`
}

export function colorWithAlpha(value: string | null | undefined, alpha: number) {
  const safeValue = value || DEFAULT_SCHEDULE_COLOR
  const normalized = safeValue.replace("#", "")
  const hex = normalized.length === 3
    ? normalized
        .split("")
        .map((part) => `${part}${part}`)
        .join("")
    : normalized

  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function buildMonthWeeks(date: Date) {
  const firstDay = startOfMonth(date)
  const lastDay = endOfMonth(date)
  const rangeStart = startOfWeek(firstDay)
  const rangeEnd = endOfWeek(lastDay)
  const weeks: string[][] = []
  const cursor = cloneDate(rangeStart)

  while (cursor <= rangeEnd) {
    const week: string[] = []

    for (let index = 0; index < 7; index += 1) {
      week.push(dateKey(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }

    weeks.push(week)
  }

  return weeks
}

export function buildWeekSegments(week: string[], items: ScheduleItemRecord[]) {
  const weekStart = week[0]
  const weekEnd = week[6]
  const laneEndDates: string[] = []

  return items
    .filter((item) => itemOverlapsDateRange(item, weekStart, weekEnd))
    .sort((left, right) => {
      const startCompare = left.startDate.localeCompare(right.startDate)

      if (startCompare !== 0) {
        return startCompare
      }

      const endCompare = itemEndDate(right).localeCompare(itemEndDate(left))

      if (endCompare !== 0) {
        return endCompare
      }

      return left.title.localeCompare(right.title)
    })
    .map((item) => {
      const segmentStart = item.startDate > weekStart ? item.startDate : weekStart
      const segmentEnd = itemEndDate(item) < weekEnd ? itemEndDate(item) : weekEnd
      const startIndex = week.indexOf(segmentStart)
      const endIndex = week.indexOf(segmentEnd)

      let lane = 0

      while (laneEndDates[lane] && laneEndDates[lane] >= segmentStart) {
        lane += 1
      }

      laneEndDates[lane] = segmentEnd

      return {
        item,
        lane,
        startIndex,
        endIndex,
      } satisfies MonthWeekSegment
    })
}

function parseTimeToHour(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const [hours, minutes] = value.split(":").map((part) => Number(part))

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null
  }

  return hours + minutes / 60
}

function getDaySegmentBounds(item: ScheduleItemRecord, day: string) {
  const startHour = parseTimeToHour(item.startTime)
  const endHour = parseTimeToHour(item.endTime)

  if (item.isHourly) {
    const boundedStart = item.startDate === day ? startHour ?? 8 : DAY_START_HOUR
    const boundedEnd = itemEndDate(item) === day ? endHour ?? boundedStart + 1 : DAY_END_EXCLUSIVE_HOUR

    return {
      startHour: Math.max(DAY_START_HOUR, boundedStart),
      endHour: Math.max(boundedStart + 0.75, Math.min(DAY_END_EXCLUSIVE_HOUR, boundedEnd || DAY_END_EXCLUSIVE_HOUR)),
    }
  }

  const boundedStart = item.startDate === day ? 8 : DAY_START_HOUR
  const boundedEnd = itemEndDate(item) === day ? 17 : DAY_END_HOUR

  return {
    startHour: Math.max(DAY_START_HOUR, boundedStart),
    endHour: Math.max(boundedStart + 1, Math.min(DAY_END_HOUR, boundedEnd)),
  }
}

export function previewSegmentForWeek(week: string[], preview: SchedulePreview) {
  const weekStart = week[0]
  const weekEnd = week[6]

  if (preview.endDate < weekStart || preview.startDate > weekEnd) {
    return null
  }

  const segmentStart = preview.startDate > weekStart ? preview.startDate : weekStart
  const segmentEnd = preview.endDate < weekEnd ? preview.endDate : weekEnd
  const startIndex = week.indexOf(segmentStart)
  const endIndex = week.indexOf(segmentEnd)

  return { startIndex, endIndex }
}

export function previewBoundsForDay(day: string, preview: SchedulePreview) {
  if (preview.startDate > day || preview.endDate < day) {
    return null
  }

  if (preview.isHourly) {
    const startHour = preview.startDate === day ? parseTimeToHour(preview.startTime) ?? DAY_START_HOUR : DAY_START_HOUR
    const endHour = preview.endDate === day ? parseTimeToHour(preview.endTime) ?? startHour + 1 : DAY_END_EXCLUSIVE_HOUR
    const boundedStart = Math.max(DAY_START_HOUR, Math.min(DAY_END_HOUR, startHour))
    const boundedEnd = Math.max(boundedStart + 0.5, Math.min(DAY_END_EXCLUSIVE_HOUR, endHour || boundedStart + 1))

    return { startHour: boundedStart, endHour: boundedEnd }
  }

  const startHour = preview.startDate === day ? 8 : DAY_START_HOUR
  const endHour = preview.endDate === day ? 17 : DAY_END_HOUR
  return {
    startHour: Math.max(DAY_START_HOUR, startHour),
    endHour: Math.max(startHour + 1, Math.min(DAY_END_HOUR, endHour)),
  }
}

export function buildDayTimelineSegments(day: string, items: ScheduleItemRecord[]) {
  const laneEndHours: number[] = []
  const segments = items
    .filter((item) => itemOverlapsDateRange(item, day, day))
    .sort((left, right) => {
      const leftBounds = getDaySegmentBounds(left, day)
      const rightBounds = getDaySegmentBounds(right, day)

      if (leftBounds.startHour !== rightBounds.startHour) {
        return leftBounds.startHour - rightBounds.startHour
      }

      return rightBounds.endHour - leftBounds.endHour
    })
    .map((item) => {
      const bounds = getDaySegmentBounds(item, day)
      let lane = 0

      while (typeof laneEndHours[lane] === "number" && laneEndHours[lane] > bounds.startHour) {
        lane += 1
      }

      laneEndHours[lane] = bounds.endHour

      return {
        item,
        lane,
        startHour: bounds.startHour,
        endHour: bounds.endHour,
      }
    })

  const laneCount = Math.max(1, segments.reduce((max, segment) => Math.max(max, segment.lane + 1), 0))

  return segments.map((segment) => ({
    ...segment,
    laneCount,
  })) satisfies DayTimelineSegment[]
}

export function buildMonthGroups(start: Date, end: Date, dayWidth: number) {
  const groups: TimelineHeaderUnit[] = []
  let cursor = startOfMonth(start)

  while (cursor <= end) {
    const groupStart = cursor < start ? start : cursor
    const groupEnd = endOfMonth(cursor) > end ? end : endOfMonth(cursor)
    const days = diffInDays(groupStart, groupEnd) + 1

    groups.push({
      key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
      label: formatMonthLabel(cursor),
      start: groupStart,
      end: groupEnd,
      width: days * dayWidth,
    })

    cursor = addMonths(cursor, 1)
  }

  return groups
}

export function buildScaleUnits(scale: GanttScale, start: Date, end: Date, dayWidth: number) {
  const units: TimelineHeaderUnit[] = []

  if (scale === "day") {
    let cursor = cloneDate(start)

    while (cursor <= end) {
      units.push({
        key: dateKey(cursor),
        label: formatCompactDay(cursor),
        start: cloneDate(cursor),
        end: cloneDate(cursor),
        width: dayWidth,
      })
      cursor = addDays(cursor, 1)
    }

    return units
  }

  if (scale === "week") {
    let cursor = startOfWeek(start)

    while (cursor <= end) {
      const unitStart = cursor < start ? start : cursor
      const unitEnd = endOfWeek(cursor) > end ? end : endOfWeek(cursor)
      const days = diffInDays(unitStart, unitEnd) + 1

      units.push({
        key: `week-${dateKey(cursor)}`,
        label: formatShortMonthDay(unitStart),
        start: unitStart,
        end: unitEnd,
        width: days * dayWidth,
      })

      cursor = addDays(cursor, 7)
    }

    return units
  }

  if (scale === "month") {
    let cursor = startOfMonth(start)

    while (cursor <= end) {
      const unitStart = cursor < start ? start : cursor
      const unitEnd = endOfMonth(cursor) > end ? end : endOfMonth(cursor)
      const days = diffInDays(unitStart, unitEnd) + 1

      units.push({
        key: `month-${dateKey(cursor)}`,
        label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(cursor),
        start: unitStart,
        end: unitEnd,
        width: days * dayWidth,
      })

      cursor = addMonths(cursor, 1)
    }

    return units
  }

  let cursor = startOfYear(start)

  while (cursor <= end) {
    const unitStart = cursor < start ? start : cursor
    const unitEnd = endOfYear(cursor) > end ? end : endOfYear(cursor)
    const days = diffInDays(unitStart, unitEnd) + 1

    units.push({
      key: `year-${cursor.getFullYear()}`,
      label: String(cursor.getFullYear()),
      start: unitStart,
      end: unitEnd,
      width: days * dayWidth,
    })

    cursor = addYears(cursor, 1)
  }

  return units
}
