import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import {
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Edit3,
  Filter,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Plus,
  Settings2,
} from "lucide-react"
import { api } from "@/lib/api"
import {
  dateKey,
  DEFAULT_SCHEDULE_COLOR,
  fmtDate,
  fmtDateTime,
  itemEndDate,
  itemOverlapsDateRange,
  todayStr,
  type ScheduleItemRecord,
  type ScheduleSettings,
  type ScheduleSettingsOption,
} from "@/lib/schedule"
import { cn } from "@/lib/utils"
import { ScheduleItemDialog } from "@/components/schedule/ScheduleItemDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"

type AppUser = {
  id: string
  fullName: string
  email: string
  role: string
  avatarUrl: string | null
}

type ActivityEntry = {
  id: string
  entityType: string
  entityId: string
  action: string
  metadata: Record<string, unknown> | null
  createdAt: string
  userName: string | null
}

type ViewMode = "calendar" | "list" | "gantt"
type ScheduleSection = "schedule" | "baseline" | "workday-exceptions"
type CalendarPeriod = "month" | "week" | "day" | "agenda"
type ListDisplayMode = "phases" | "notes"
type GanttScale = "day" | "week" | "month" | "year"
type SortDirection = "asc" | "desc"
type SortKey =
  | "idNumber"
  | "title"
  | "complete"
  | "phase"
  | "duration"
  | "start"
  | "end"
  | "assigned"
  | "accepted"
  | "pending"
  | "declined"
  | "files"

type FilterState = {
  preset: string
  title: string
  assignedTo: string
  status: string
  tags: string[]
  phases: string[]
}

type TimelineHeaderUnit = {
  key: string
  label: string
  start: Date
  end: Date
  width: number
}

type DayTimelineSegment = {
  item: ScheduleItemRecord
  lane: number
  laneCount: number
  startHour: number
  endHour: number
}

type MonthWeekSegment = {
  item: ScheduleItemRecord
  lane: number
  startIndex: number
  endIndex: number
}

type GanttRow =
  | {
      key: string
      type: "phase"
      label: string
    }
  | {
      key: string
      type: "item"
      item: ScheduleItemRecord
    }

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const CALENDAR_PERIODS: Array<{ value: CalendarPeriod; label: string }> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "agenda", label: "Agenda" },
]
const GANTT_SCALES: Array<{ value: GanttScale; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
]
const FILTER_PRESETS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All Schedule Items" },
  { value: "upcoming", label: "Upcoming Work" },
  { value: "completed", label: "Completed Items" },
  { value: "unassigned", label: "Unassigned Work" },
]
const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "none", label: "None" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
  { value: "in_progress", label: "In Progress" },
  { value: "incomplete", label: "Incomplete" },
  { value: "past_due", label: "Past Due" },
  { value: "unconfirmed", label: "Unconfirmed" },
] as const
const DAY_START_HOUR = 6
const DAY_END_HOUR = 19
const HOUR_HEIGHT = 56
const LIST_PAGE_SIZE = 10
const DAY_WIDTH_BY_SCALE: Record<GanttScale, number> = {
  day: 48,
  week: 18,
  month: 8,
  year: 3,
}

function getApiError(err: unknown, fallback: string) {
  if (typeof err === "object" && err !== null) {
    const value = err as { response?: { data?: { message?: string } }; message?: string }
    return value.response?.data?.message ?? value.message ?? fallback
  }

  return fallback
}

function parseDate(value: string) {
  return new Date(`${value}T12:00:00`)
}

function cloneDate(date: Date) {
  return new Date(date.getTime())
}

function addDays(date: Date, amount: number) {
  const next = cloneDate(date)
  next.setDate(next.getDate() + amount)
  return next
}

function addMonths(date: Date, amount: number) {
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

function startOfWeek(date: Date) {
  const next = cloneDate(date)
  next.setDate(next.getDate() - next.getDay())
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfWeek(date: Date) {
  return addDays(startOfWeek(date), 6)
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1)
}

function endOfYear(date: Date) {
  return new Date(date.getFullYear(), 11, 31)
}

function diffInDays(start: Date, end: Date) {
  const left = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const right = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.round((right.getTime() - left.getTime()) / 86_400_000)
}

function isWeekend(date: Date) {
  const day = date.getDay()
  return day === 0 || day === 6
}

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date)
}

function formatRangeLabel(start: Date, end: Date) {
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

function formatLongDate(date: Date) {
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

function formatHourLabel(hour: number) {
  const period = hour >= 12 ? "PM" : "AM"
  const normalized = hour % 12 === 0 ? 12 : hour % 12
  return `${normalized}:00 ${period}`
}

function colorWithAlpha(value: string | null | undefined, alpha: number) {
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

function buildMonthWeeks(date: Date) {
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

function buildWeekSegments(week: string[], items: ScheduleItemRecord[]) {
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
    const boundedEnd = itemEndDate(item) === day ? endHour ?? boundedStart + 1 : DAY_END_HOUR

    return {
      startHour: Math.max(DAY_START_HOUR, boundedStart),
      endHour: Math.max(boundedStart + 0.75, Math.min(DAY_END_HOUR, boundedEnd || DAY_END_HOUR)),
    }
  }

  const boundedStart = item.startDate === day ? 8 : DAY_START_HOUR
  const boundedEnd = itemEndDate(item) === day ? 17 : DAY_END_HOUR

  return {
    startHour: Math.max(DAY_START_HOUR, boundedStart),
    endHour: Math.max(boundedStart + 1, Math.min(DAY_END_HOUR, boundedEnd)),
  }
}

function buildDayTimelineSegments(day: string, items: ScheduleItemRecord[]) {
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

function buildMonthGroups(start: Date, end: Date, dayWidth: number) {
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

function buildScaleUnits(scale: GanttScale, start: Date, end: Date, dayWidth: number) {
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

function titleCaseStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function buildFilterPreset(preset: string): FilterState {
  if (preset === "upcoming") {
    return {
      preset,
      title: "",
      assignedTo: "",
      status: "upcoming",
      tags: [],
      phases: [],
    }
  }

  if (preset === "completed") {
    return {
      preset,
      title: "",
      assignedTo: "",
      status: "completed",
      tags: [],
      phases: [],
    }
  }

  if (preset === "unassigned") {
    return {
      preset,
      title: "",
      assignedTo: "__unassigned__",
      status: "all",
      tags: [],
      phases: [],
    }
  }

  return {
    preset: "all",
    title: "",
    assignedTo: "",
    status: "all",
    tags: [],
    phases: [],
  }
}

function countActiveFilters(filters: FilterState) {
  return [
    filters.title.trim().length > 0,
    filters.assignedTo !== "",
    filters.status !== "all",
    filters.tags.length > 0,
    filters.phases.length > 0,
  ].filter(Boolean).length
}

function mergeUniqueIds(current: string[], nextIds: string[]) {
  return Array.from(new Set([...current, ...nextIds]))
}

function matchesStatus(item: ScheduleItemRecord, status: string) {
  const accepted = 0
  const pending = 0
  const declined = 0

  switch (status) {
    case "all":
      return true
    case "none":
      return !item.status
    case "upcoming":
      return item.status === "upcoming"
    case "completed":
      return item.isComplete || item.status === "completed"
    case "in_progress":
      return item.status === "in_progress"
    case "incomplete":
      return !item.isComplete && item.status !== "completed"
    case "past_due":
      return item.status === "overdue"
    case "unconfirmed":
      return accepted === 0 && pending === 0 && declined === 0
    default:
      return true
  }
}

function compareValues(left: string | number, right: string | number, direction: SortDirection) {
  if (left < right) {
    return direction === "asc" ? -1 : 1
  }

  if (left > right) {
    return direction === "asc" ? 1 : -1
  }

  return 0
}

function computeCriticalPathIds(items: ScheduleItemRecord[]) {
  const visibleItems = items.filter((item) => item.showOnGantt !== false)
  const itemMap = new Map(visibleItems.map((item) => [item.id, item]))
  const memo = new Map<string, { score: number; path: string[] }>()
  const visiting = new Set<string>()

  function visit(itemId: string): { score: number; path: string[] } {
    if (memo.has(itemId)) {
      return memo.get(itemId)!
    }

    if (visiting.has(itemId)) {
      const fallback = { score: itemMap.get(itemId)?.workDays ?? 1, path: [itemId] }
      memo.set(itemId, fallback)
      return fallback
    }

    visiting.add(itemId)
    const item = itemMap.get(itemId)

    if (!item) {
      const missing = { score: 0, path: [] }
      memo.set(itemId, missing)
      visiting.delete(itemId)
      return missing
    }

    const predecessors = item.predecessors.filter((predecessor) => itemMap.has(predecessor.scheduleItemId))

    if (predecessors.length === 0) {
      const base = {
        score: Math.max(item.workDays, 1),
        path: [item.id],
      }
      memo.set(itemId, base)
      visiting.delete(itemId)
      return base
    }

    let best = { score: 0, path: [] as string[] }

    for (const predecessor of predecessors) {
      const candidate = visit(predecessor.scheduleItemId)

      if (candidate.score > best.score) {
        best = candidate
      }
    }

    const result = {
      score: best.score + Math.max(item.workDays, 1),
      path: [...best.path, item.id],
    }

    memo.set(itemId, result)
    visiting.delete(itemId)
    return result
  }

  let bestPath = { score: 0, path: [] as string[] }

  for (const item of visibleItems) {
    const candidate = visit(item.id)

    if (candidate.score > bestPath.score) {
      bestPath = candidate
    }
  }

  return new Set(bestPath.path)
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="rounded-xl border border-dashed border-[#D6DDE8] bg-[#F8FAFC] px-6 py-14 text-center">
      <CalendarDays className="mx-auto mb-4 size-8 text-slate-300" />
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{description}</p>
      {actionLabel && onAction ? (
        <Button type="button" className="mt-5" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

function MultiSelectPopover({
  placeholder,
  options,
  selected,
  onChange,
}: {
  placeholder: string
  options: ScheduleSettingsOption[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between border-[#E5E7EB] bg-white font-normal text-slate-700"
        >
          <span className="truncate">
            {selected.length > 0
              ? `${selected.length} selected`
              : placeholder}
          </span>
          <ChevronDown className="size-4 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder={`Search ${placeholder.toLowerCase()}`} />
          <CommandList>
            <CommandEmpty>No matches found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected.includes(option.id)

                return (
                  <CommandItem
                    key={option.id}
                    value={option.name}
                    onSelect={() => {
                      onChange(
                        isSelected
                          ? selected.filter((value) => value !== option.id)
                          : [...selected, option.id],
                      )
                    }}
                  >
                    <div
                      className={cn(
                        "flex size-4 items-center justify-center rounded border border-slate-300",
                        isSelected && "border-blue-600 bg-blue-600 text-white",
                      )}
                    >
                      {isSelected ? <Check className="size-3" /> : null}
                    </div>
                    <span className="truncate">{option.name}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function AssigneeSelect({
  users,
  value,
  onChange,
}: {
  users: AppUser[]
  value: string
  onChange: (value: string) => void
}) {
  const selectedUser = users.find((user) => user.id === value)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between border-[#E5E7EB] bg-white font-normal text-slate-700"
        >
          <span className="truncate">{selectedUser?.fullName || "All team members"}</span>
          <ChevronDown className="size-4 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder="Search team members" />
          <CommandList>
            <CommandEmpty>No team members found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="All team members" onSelect={() => onChange("")}>
                <div
                  className={cn(
                    "flex size-4 items-center justify-center rounded border border-slate-300",
                    value === "" && "border-blue-600 bg-blue-600 text-white",
                  )}
                >
                  {value === "" ? <Check className="size-3" /> : null}
                </div>
                All team members
              </CommandItem>
              <CommandItem value="Unassigned" onSelect={() => onChange("__unassigned__")}>
                <div
                  className={cn(
                    "flex size-4 items-center justify-center rounded border border-slate-300",
                    value === "__unassigned__" && "border-blue-600 bg-blue-600 text-white",
                  )}
                >
                  {value === "__unassigned__" ? <Check className="size-3" /> : null}
                </div>
                Unassigned
              </CommandItem>
              {users.map((user) => (
                <CommandItem key={user.id} value={user.fullName} onSelect={() => onChange(user.id)}>
                  <div
                    className={cn(
                      "flex size-4 items-center justify-center rounded border border-slate-300",
                      value === user.id && "border-blue-600 bg-blue-600 text-white",
                    )}
                  >
                    {value === user.id ? <Check className="size-3" /> : null}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate">{user.fullName}</p>
                    <p className="text-xs text-slate-400">{user.role.replaceAll("_", " ")}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function SortableHead({
  label,
  sortKey,
  activeSortKey,
  direction,
  onSort,
  className,
}: {
  label: string
  sortKey: SortKey
  activeSortKey: SortKey
  direction: SortDirection
  onSort: (key: SortKey) => void
  className?: string
}) {
  const isActive = activeSortKey === sortKey

  return (
    <TableHead className={className}>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500",
          isActive && "text-slate-900",
        )}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            isActive && direction === "asc" && "rotate-180",
            !isActive && "text-slate-300",
          )}
        />
      </button>
    </TableHead>
  )
}

export default function JobSchedulePage() {
  const { jobId } = useParams<{ jobId: string }>()
  const monthPickerRef = useRef<HTMLInputElement | null>(null)
  const ganttTimelineRef = useRef<HTMLDivElement | null>(null)

  const [items, setItems] = useState<ScheduleItemRecord[]>([])
  const [users, setUsers] = useState<AppUser[]>([])
  const [settings, setSettings] = useState<ScheduleSettings>({ phases: [], tags: [] })
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<ActivityEntry[]>([])
  const [section, setSection] = useState<ScheduleSection>("schedule")
  const [viewMode, setViewMode] = useState<ViewMode>("calendar")
  const [calendarPeriod, setCalendarPeriod] = useState<CalendarPeriod>("month")
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(() => new Date())
  const [calendarExpanded, setCalendarExpanded] = useState(false)
  const [listDisplayMode, setListDisplayMode] = useState<ListDisplayMode>("phases")
  const [sortKey, setSortKey] = useState<SortKey>("start")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [listPage, setListPage] = useState(1)
  const [selectedListIds, setSelectedListIds] = useState<string[]>([])
  const [ganttScale, setGanttScale] = useState<GanttScale>("day")
  const [ganttShowPhases, setGanttShowPhases] = useState(true)
  const [ganttCriticalPath, setGanttCriticalPath] = useState(false)
  const [ganttFullscreen, setGanttFullscreen] = useState(false)
  const [scheduleOffline, setScheduleOffline] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(() => buildFilterPreset("all"))
  const [draftFilters, setDraftFilters] = useState<FilterState>(() => buildFilterPreset("all"))

  async function fetchItems() {
    if (!jobId) {
      return
    }

    const response = await api.get<{ items: ScheduleItemRecord[] }>(`/jobs/${jobId}/schedule`)
    setItems(response.data.items ?? [])
  }

  async function fetchSettings() {
    if (!jobId) {
      return
    }

    const response = await api.get<ScheduleSettings>(`/jobs/${jobId}/schedule/settings`)
    setSettings({
      phases: response.data.phases ?? [],
      tags: response.data.tags ?? [],
    })
  }

  async function fetchUsers() {
    const response = await api.get<{ users: AppUser[] }>("/users")
    setUsers(response.data.users ?? [])
  }

  async function fetchHistory() {
    if (!jobId) {
      return
    }

    setHistoryLoading(true)

    try {
      const response = await api.get<{ entries: ActivityEntry[] }>(`/activity?jobId=${jobId}&page=1&limit=100`)
      setHistoryEntries(
        (response.data.entries ?? []).filter((entry) => entry.entityType.startsWith("schedule_")),
      )
    } catch (err) {
      toast.error(getApiError(err, "Failed to load schedule history"))
    } finally {
      setHistoryLoading(false)
    }
  }

  async function loadData() {
    if (!jobId) {
      return
    }

    setLoading(true)

    try {
      await Promise.all([fetchItems(), fetchUsers(), fetchSettings()])
    } catch (err) {
      toast.error(getApiError(err, "Failed to load schedule"))
    } finally {
      setLoading(false)
    }
  }

  async function refreshScheduleData() {
    await fetchItems()

    if (historyOpen) {
      await fetchHistory()
    }
  }

  useEffect(() => {
    void loadData()
  }, [jobId])

  useEffect(() => {
    if (historyOpen) {
      void fetchHistory()
    }
  }, [historyOpen, jobId])

  useEffect(() => {
    if (filterOpen) {
      setDraftFilters(appliedFilters)
    }
  }, [appliedFilters, filterOpen])

  useEffect(() => {
    const availableIds = new Set(items.map((item) => item.id))
    setSelectedListIds((current) => current.filter((id) => availableIds.has(id)))
  }, [items])

  const todayIso = todayStr()
  const itemNumberById = useMemo(
    () => new Map(items.map((item, index) => [item.id, index + 1])),
    [items],
  )

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (appliedFilters.title.trim()) {
        const searchValue = appliedFilters.title.trim().toLowerCase()
        const noteText = item.notes || item.notesStream?.[0]?.note || ""

        if (
          !item.title.toLowerCase().includes(searchValue)
          && !noteText.toLowerCase().includes(searchValue)
        ) {
          return false
        }
      }

      if (appliedFilters.assignedTo === "__unassigned__" && item.assigneeIds.length > 0) {
        return false
      }

      if (appliedFilters.assignedTo && appliedFilters.assignedTo !== "__unassigned__" && !item.assigneeIds.includes(appliedFilters.assignedTo)) {
        return false
      }

      if (!matchesStatus(item, appliedFilters.status)) {
        return false
      }

      if (appliedFilters.tags.length > 0 && !appliedFilters.tags.every((tagId) => item.tags.includes(settings.tags.find((tag) => tag.id === tagId)?.name || ""))) {
        return false
      }

      if (appliedFilters.phases.length > 0 && !appliedFilters.phases.includes(item.phaseId || "")) {
        return false
      }

      return true
    })
  }, [appliedFilters, items, settings.tags])

  const currentRangeLabel = useMemo(() => {
    if (calendarPeriod === "month") {
      return formatMonthLabel(calendarAnchorDate)
    }

    if (calendarPeriod === "week") {
      return formatRangeLabel(startOfWeek(calendarAnchorDate), endOfWeek(calendarAnchorDate))
    }

    if (calendarPeriod === "day") {
      return formatLongDate(calendarAnchorDate)
    }

    return "Upcoming Schedule"
  }, [calendarAnchorDate, calendarPeriod])

  const monthWeeks = useMemo(() => buildMonthWeeks(calendarAnchorDate), [calendarAnchorDate])

  const sortedListItems = useMemo(() => {
    const sorted = [...filteredItems]

    sorted.sort((left, right) => {
      const idNumberLeft = itemNumberById.get(left.id) ?? 0
      const idNumberRight = itemNumberById.get(right.id) ?? 0
      const assignedLeft = left.assignees.map((assignee) => assignee.fullName || "").join(", ")
      const assignedRight = right.assignees.map((assignee) => assignee.fullName || "").join(", ")
      const leftFiles = left.attachments.length
      const rightFiles = right.attachments.length

      switch (sortKey) {
        case "idNumber":
          return compareValues(idNumberLeft, idNumberRight, sortDirection)
        case "title":
          return compareValues(left.title.toLowerCase(), right.title.toLowerCase(), sortDirection)
        case "complete":
          return compareValues(Number(left.isComplete), Number(right.isComplete), sortDirection)
        case "phase":
          return compareValues((left.phaseName || "").toLowerCase(), (right.phaseName || "").toLowerCase(), sortDirection)
        case "duration":
          return compareValues(left.workDays, right.workDays, sortDirection)
        case "start":
          return compareValues(left.startDate, right.startDate, sortDirection)
        case "end":
          return compareValues(itemEndDate(left), itemEndDate(right), sortDirection)
        case "assigned":
          return compareValues(assignedLeft.toLowerCase(), assignedRight.toLowerCase(), sortDirection)
        case "accepted":
        case "pending":
        case "declined":
          return 0
        case "files":
          return compareValues(leftFiles, rightFiles, sortDirection)
        default:
          return 0
      }
    })

    return sorted
  }, [filteredItems, itemNumberById, sortDirection, sortKey])

  const totalListPages = Math.max(1, Math.ceil(sortedListItems.length / LIST_PAGE_SIZE))

  useEffect(() => {
    setListPage((current) => Math.min(current, totalListPages))
  }, [totalListPages])

  const paginatedListItems = useMemo(() => {
    const startIndex = (listPage - 1) * LIST_PAGE_SIZE
    return sortedListItems.slice(startIndex, startIndex + LIST_PAGE_SIZE)
  }, [listPage, sortedListItems])

  const groupedListItems = useMemo(() => {
    if (listDisplayMode !== "phases") {
      return [{ label: "All Items", items: paginatedListItems }]
    }

    const groups = new Map<string, ScheduleItemRecord[]>()

    for (const item of paginatedListItems) {
      const label = item.phaseName || "No Phase"
      const existing = groups.get(label) ?? []
      existing.push(item)
      groups.set(label, existing)
    }

    return Array.from(groups.entries()).map(([label, groupedItems]) => ({
      label,
      items: groupedItems,
    }))
  }, [listDisplayMode, paginatedListItems])

  const currentPageIds = paginatedListItems.map((item) => item.id)
  const allCurrentPageSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedListIds.includes(id))

  const ganttItems = useMemo(
    () => filteredItems.filter((item) => item.showOnGantt !== false),
    [filteredItems],
  )

  const criticalPathIds = useMemo(() => computeCriticalPathIds(ganttItems), [ganttItems])

  const ganttRange = useMemo(() => {
    if (ganttItems.length === 0) {
      const today = new Date()
      return {
        start: addDays(startOfWeek(today), -7),
        end: addDays(endOfWeek(today), 14),
      }
    }

    const starts = ganttItems.map((item) => parseDate(item.startDate))
    const ends = ganttItems.map((item) => parseDate(itemEndDate(item)))
    const minStart = starts.reduce((left, right) => (left < right ? left : right))
    const maxEnd = ends.reduce((left, right) => (left > right ? left : right))

    return {
      start: addDays(startOfWeek(minStart), -7),
      end: addDays(endOfWeek(maxEnd), 7),
    }
  }, [ganttItems])

  const dayWidth = DAY_WIDTH_BY_SCALE[ganttScale]
  const timelineDays = diffInDays(ganttRange.start, ganttRange.end) + 1
  const timelineWidth = Math.max(760, timelineDays * dayWidth)
  const monthGroups = useMemo(
    () => buildMonthGroups(ganttRange.start, ganttRange.end, dayWidth),
    [dayWidth, ganttRange.end, ganttRange.start],
  )
  const scaleUnits = useMemo(
    () => buildScaleUnits(ganttScale, ganttRange.start, ganttRange.end, dayWidth),
    [dayWidth, ganttRange.end, ganttRange.start, ganttScale],
  )
  const todayOffsetPx = diffInDays(ganttRange.start, parseDate(todayIso)) * dayWidth

  const ganttRows = useMemo(() => {
    if (!ganttShowPhases) {
      return ganttItems.map((item) => ({
        key: item.id,
        type: "item",
        item,
      })) satisfies GanttRow[]
    }

    const groups = new Map<string, ScheduleItemRecord[]>()

    for (const item of ganttItems) {
      const label = item.phaseName || "No Phase"
      const existing = groups.get(label) ?? []
      existing.push(item)
      groups.set(label, existing)
    }

    return Array.from(groups.entries()).flatMap(([label, groupedItems]) => [
      {
        key: `phase-${label}`,
        type: "phase",
        label,
      } satisfies GanttRow,
      ...groupedItems.map((item) => ({
        key: item.id,
        type: "item",
        item,
      }) satisfies GanttRow),
    ])
  }, [ganttItems, ganttShowPhases])

  function openNewItem() {
    setActiveItemId(null)
    setDialogOpen(true)
  }

  function openExistingItem(itemId: string) {
    setActiveItemId(itemId)
    setDialogOpen(true)
  }

  function navigateCalendar(direction: -1 | 1) {
    setCalendarAnchorDate((current) => {
      if (calendarPeriod === "month") {
        return addMonths(current, direction)
      }

      if (calendarPeriod === "week") {
        return addDays(current, 7 * direction)
      }

      if (calendarPeriod === "day") {
        return addDays(current, direction)
      }

      return addDays(current, 30 * direction)
    })
  }

  function jumpToToday() {
    setCalendarAnchorDate(new Date())
  }

  function openDatePicker() {
    const input = monthPickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null
    input?.showPicker?.()
    input?.click()
  }

  function handleSort(nextSortKey: SortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
      return
    }

    setSortKey(nextSortKey)
    setSortDirection("asc")
  }

  function scrollGanttToToday() {
    const container = ganttTimelineRef.current

    if (!container) {
      return
    }

    container.scrollTo({
      left: Math.max(todayOffsetPx - container.clientWidth / 2, 0),
      behavior: "smooth",
    })
  }

  const isEmpty = !loading && filteredItems.length === 0
  const activeFilterCount = countActiveFilters(appliedFilters)
  const listStart = sortedListItems.length === 0 ? 0 : (listPage - 1) * LIST_PAGE_SIZE + 1
  const listEnd = Math.min(listPage * LIST_PAGE_SIZE, sortedListItems.length)
  const draftPresetValue = FILTER_PRESETS.some((preset) => preset.value === draftFilters.preset)
    ? draftFilters.preset
    : "custom"

  return (
    <>
      {ganttFullscreen ? <div className="fixed inset-0 z-40 bg-slate-950/45" /> : null}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Schedule</h1>
        </div>

        <Tabs
          value={section}
          onValueChange={(value) => setSection(value as ScheduleSection)}
          className="space-y-4"
        >
          <TabsList className="h-auto rounded-xl border border-[#E5E7EB] bg-white p-1">
            <TabsTrigger value="schedule" className="h-9 rounded-lg px-4">
              Schedule
            </TabsTrigger>
            <TabsTrigger value="baseline" className="h-9 rounded-lg px-4">
              Baseline
            </TabsTrigger>
            <TabsTrigger value="workday-exceptions" className="h-9 rounded-lg px-4">
              Workday Exceptions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="schedule" className="mt-0 space-y-4">
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex overflow-hidden rounded-lg border border-[#D8E0EA] bg-[#F8FAFC]">
                    <button
                      type="button"
                      className={cn(
                        "flex h-10 items-center gap-2 px-4 text-sm font-medium transition-colors",
                        viewMode === "calendar"
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:bg-white",
                      )}
                      onClick={() => setViewMode("calendar")}
                    >
                      <CalendarDays className="size-4" />
                      Calendar
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex h-10 items-center gap-2 border-l border-[#D8E0EA] px-4 text-sm font-medium transition-colors",
                        viewMode === "list"
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:bg-white",
                      )}
                      onClick={() => setViewMode("list")}
                    >
                      <BarChart3 className="size-4" />
                      List
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex h-10 items-center gap-2 border-l border-[#D8E0EA] px-4 text-sm font-medium transition-colors",
                        viewMode === "gantt"
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:bg-white",
                      )}
                      onClick={() => setViewMode("gantt")}
                    >
                      <BarChart3 className="size-4" />
                      Gantt
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-[#E5E7EB] bg-white"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings2 className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-[#E5E7EB] bg-white"
                    onClick={() => setHistoryOpen(true)}
                  >
                    <Clock3 className="size-4" />
                  </Button>
                  <div className="flex h-10 items-center gap-3 rounded-lg border border-[#E5E7EB] px-3">
                    <span className="text-sm font-medium text-slate-700">Schedule Offline</span>
                    <Switch checked={scheduleOffline} onCheckedChange={setScheduleOffline} />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-[#E5E7EB] bg-white"
                      >
                        <MoreHorizontal className="size-4" />
                        More Actions
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={() => toast.info("Template import arrives in the next piece.")}>
                        Import From Templates
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toast.info("Conflict tracking is not wired yet.")}>
                        Track Conflicts
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={items.length === 0}
                        onClick={() => toast.info("Assigned-user notifications are not wired yet.")}
                      >
                        Notify Assigned Users
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toast.info("Bulk delete is not wired yet.")}>
                        Delete All Items
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toast.info("PDF export is not wired yet.")}>
                        Export to PDF
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-[#E5E7EB] bg-white"
                    onClick={() => setFilterOpen(true)}
                  >
                    <Filter className="size-4" />
                    Filter
                    {activeFilterCount > 0 ? (
                      <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                        {activeFilterCount}
                      </Badge>
                    ) : null}
                  </Button>
                  <Button type="button" size="sm" onClick={openNewItem}>
                    <Plus className="size-4" />
                    New Schedule Item
                  </Button>
                </div>
              </div>
            </div>

            {viewMode === "calendar" ? (
              <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-[#E5E7EB] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={calendarPeriod}
                      onValueChange={(value) => {
                        setCalendarPeriod(value as CalendarPeriod)
                        setCalendarExpanded(false)
                      }}
                    >
                      <SelectTrigger className="h-10 w-[150px] border-[#E5E7EB]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CALENDAR_PERIODS.map((period) => (
                          <SelectItem key={period.value} value={period.value}>
                            {period.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" className="h-10 border-[#E5E7EB]" onClick={jumpToToday}>
                      Today
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-[#E5E7EB] p-2 text-slate-500 transition hover:bg-slate-50"
                      onClick={() => navigateCalendar(-1)}
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-[#E5E7EB] px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
                      onClick={openDatePicker}
                    >
                      {currentRangeLabel}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-[#E5E7EB] p-2 text-slate-500 transition hover:bg-slate-50"
                      onClick={() => navigateCalendar(1)}
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 border-[#E5E7EB]"
                    disabled={calendarExpanded}
                    onClick={() => setCalendarExpanded(true)}
                  >
                    Expand All
                  </Button>
                </div>

                <input
                  ref={monthPickerRef}
                  type="date"
                  className="sr-only"
                  value={dateKey(calendarAnchorDate)}
                  onChange={(event) => {
                    if (event.target.value) {
                      setCalendarAnchorDate(parseDate(event.target.value))
                    }
                  }}
                />

                <div className="p-4">
                  {loading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Skeleton key={index} className="h-28 w-full" />
                      ))}
                    </div>
                  ) : isEmpty ? (
                    <EmptyState
                      title={items.length === 0 ? "No schedule items yet" : "No schedule items match this filter"}
                      description={
                        items.length === 0
                          ? "Add the first schedule item to start coordinating fabrication, delivery, and install work."
                          : "Adjust your filters or create another schedule item to populate this calendar."
                      }
                      actionLabel={items.length === 0 ? "New Schedule Item" : "Clear Filters"}
                      onAction={
                        items.length === 0
                          ? openNewItem
                          : () => {
                              const reset = buildFilterPreset("all")
                              setAppliedFilters(reset)
                              setDraftFilters(reset)
                            }
                      }
                    />
                  ) : calendarPeriod === "month" ? (
                    <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
                      <div className="grid grid-cols-7 border-b border-[#E5E7EB] bg-[#F8FAFC]">
                        {DAYS_OF_WEEK.map((day, index) => (
                          <div key={day} className="px-3 py-3 text-center">
                            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{day}</p>
                            {index === 0 || index === 6 ? (
                              <p className="mt-1 text-[11px] text-slate-400">Non-workday</p>
                            ) : null}
                          </div>
                        ))}
                      </div>

                      <div>
                        {monthWeeks.map((week) => {
                          const segments = buildWeekSegments(week, filteredItems)
                          const visibleSegments = calendarExpanded
                            ? segments
                            : segments.filter((segment) => segment.lane < 4)
                          const hiddenCount = segments.length - visibleSegments.length
                          const maxLane = visibleSegments.reduce((max, segment) => Math.max(max, segment.lane), -1)
                          const laneCount = Math.max(maxLane + 1, 1)
                          const rowHeight = 88 + laneCount * 30 + (hiddenCount > 0 ? 18 : 0)
                          const currentMonthPrefix = `${calendarAnchorDate.getFullYear()}-${String(calendarAnchorDate.getMonth() + 1).padStart(2, "0")}`

                          return (
                            <div
                              key={week[0]}
                              className="relative grid grid-cols-7 border-b border-[#E5E7EB] last:border-b-0"
                              style={{ minHeight: `${rowHeight}px` }}
                            >
                              {week.map((day) => {
                                const isCurrentMonth = day.startsWith(currentMonthPrefix)
                                const isToday = day === todayIso
                                const parsedDay = parseDate(day)

                                return (
                                  <div
                                    key={day}
                                    className={cn(
                                      "border-r border-[#E5E7EB] p-2 last:border-r-0",
                                      isCurrentMonth ? "bg-white" : "bg-slate-50/70",
                                    )}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <span
                                        className={cn(
                                          "flex size-7 items-center justify-center rounded-full text-xs font-medium",
                                          isToday
                                            ? "bg-blue-600 text-white"
                                            : isCurrentMonth
                                            ? "text-slate-700"
                                            : "text-slate-300",
                                        )}
                                      >
                                        {parsedDay.getDate()}
                                      </span>
                                      {isWeekend(parsedDay) ? (
                                        <span className="text-[11px] text-slate-400">Non-workday</span>
                                      ) : null}
                                    </div>
                                  </div>
                                )
                              })}

                              <div className="pointer-events-none absolute inset-x-0 top-10 bottom-2">
                                {visibleSegments.map((segment) => (
                                  <button
                                    key={`${segment.item.id}-${segment.startIndex}-${segment.endIndex}-${segment.lane}`}
                                    type="button"
                                    className="pointer-events-auto absolute flex h-6 items-center overflow-hidden rounded-full px-3 text-left text-xs font-medium text-white shadow-sm transition hover:opacity-95"
                                    style={{
                                      backgroundColor: segment.item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                      left: `calc(${(segment.startIndex / 7) * 100}% + 4px)`,
                                      width: `calc(${((segment.endIndex - segment.startIndex + 1) / 7) * 100}% - 8px)`,
                                      top: `${segment.lane * 30}px`,
                                    }}
                                    onClick={() => openExistingItem(segment.item.id)}
                                  >
                                    <span className="truncate">
                                      {segment.item.isComplete ? "✓ " : ""}
                                      {segment.item.title}
                                    </span>
                                  </button>
                                ))}

                                {hiddenCount > 0 ? (
                                  <div className="absolute bottom-0 right-3 text-[11px] font-medium text-slate-400">
                                    +{hiddenCount} more item{hiddenCount === 1 ? "" : "s"}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : calendarPeriod === "week" ? (
                    <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
                      <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-[#E5E7EB] bg-[#F8FAFC]">
                        <div className="border-r border-[#E5E7EB] p-3" />
                        {Array.from({ length: 7 }).map((_, index) => {
                          const day = addDays(startOfWeek(calendarAnchorDate), index)
                          const dayKey = dateKey(day)
                          const isToday = dayKey === todayIso

                          return (
                            <div key={dayKey} className="border-r border-[#E5E7EB] p-3 last:border-r-0">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-semibold text-slate-900">
                                  {new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(day)}
                                </p>
                                <span
                                  className={cn(
                                    "flex size-7 items-center justify-center rounded-full text-xs font-medium",
                                    isToday ? "bg-blue-600 text-white" : "text-slate-600",
                                  )}
                                >
                                  {day.getDate()}
                                </span>
                              </div>
                              {isWeekend(day) ? <p className="mt-1 text-[11px] text-slate-400">Non-workday</p> : null}
                            </div>
                          )
                        })}
                      </div>

                      <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))]">
                        <div className="border-r border-[#E5E7EB] bg-[#F8FAFC]">
                          {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }).map((_, index) => {
                            const hour = DAY_START_HOUR + index

                            return (
                              <div
                                key={hour}
                                className="flex h-14 items-start justify-end border-b border-[#E5E7EB] px-2 py-1 text-[11px] text-slate-400 last:border-b-0"
                              >
                                {formatHourLabel(hour)}
                              </div>
                            )
                          })}
                        </div>

                        {Array.from({ length: 7 }).map((_, index) => {
                          const day = addDays(startOfWeek(calendarAnchorDate), index)
                          const dayKey = dateKey(day)
                          const segments = buildDayTimelineSegments(dayKey, filteredItems)

                          return (
                            <div
                              key={dayKey}
                              className="relative border-r border-[#E5E7EB] last:border-r-0"
                              style={{ height: `${(DAY_END_HOUR - DAY_START_HOUR + 1) * HOUR_HEIGHT}px` }}
                            >
                              {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }).map((_, hourIndex) => (
                                <div
                                  key={hourIndex}
                                  className={cn(
                                    "h-14 border-b border-[#E5E7EB] last:border-b-0",
                                    isWeekend(day) && "bg-slate-50/50",
                                  )}
                                />
                              ))}

                              {segments.map((segment) => {
                                const top = (segment.startHour - DAY_START_HOUR) * HOUR_HEIGHT + 4
                                const height = Math.max((segment.endHour - segment.startHour) * HOUR_HEIGHT - 8, 32)
                                const width = `calc(${100 / segment.laneCount}% - 8px)`
                                const left = `calc(${segment.lane * (100 / segment.laneCount)}% + 4px)`

                                return (
                                  <button
                                    key={`${segment.item.id}-${segment.lane}`}
                                    type="button"
                                    className="absolute overflow-hidden rounded-xl border px-2 py-1 text-left text-xs font-medium text-white shadow-sm"
                                    style={{
                                      top,
                                      height,
                                      width,
                                      left,
                                      backgroundColor: segment.item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                      borderColor: colorWithAlpha(segment.item.displayColor, 0.75),
                                    }}
                                    onClick={() => openExistingItem(segment.item.id)}
                                  >
                                    <span className="block truncate">{segment.item.title}</span>
                                    <span className="block truncate text-[10px] text-white/80">
                                      {segment.item.isHourly && segment.item.startTime
                                        ? `${segment.item.startTime.slice(0, 5)}${segment.item.endTime ? ` - ${segment.item.endTime.slice(0, 5)}` : ""}`
                                        : `${segment.item.workDays} workday${segment.item.workDays === 1 ? "" : "s"}`}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : calendarPeriod === "day" ? (
                    <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
                      <div className="border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{formatLongDate(calendarAnchorDate)}</p>
                            {isWeekend(calendarAnchorDate) ? (
                              <p className="text-[11px] text-slate-400">Non-workday</p>
                            ) : null}
                          </div>
                          {dateKey(calendarAnchorDate) === todayIso ? (
                            <span className="flex size-8 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                              {calendarAnchorDate.getDate()}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid grid-cols-[88px_minmax(0,1fr)]">
                        <div className="border-r border-[#E5E7EB] bg-[#F8FAFC]">
                          {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }).map((_, index) => {
                            const hour = DAY_START_HOUR + index

                            return (
                              <div
                                key={hour}
                                className="flex h-14 items-start justify-end border-b border-[#E5E7EB] px-3 py-1 text-[11px] text-slate-400 last:border-b-0"
                              >
                                {formatHourLabel(hour)}
                              </div>
                            )
                          })}
                        </div>

                        <div
                          className={cn(
                            "relative",
                            isWeekend(calendarAnchorDate) && "bg-slate-50/50",
                          )}
                          style={{ height: `${(DAY_END_HOUR - DAY_START_HOUR + 1) * HOUR_HEIGHT}px` }}
                        >
                          {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }).map((_, hourIndex) => (
                            <div key={hourIndex} className="h-14 border-b border-[#E5E7EB] last:border-b-0" />
                          ))}

                          {buildDayTimelineSegments(dateKey(calendarAnchorDate), filteredItems).map((segment) => {
                            const top = (segment.startHour - DAY_START_HOUR) * HOUR_HEIGHT + 6
                            const height = Math.max((segment.endHour - segment.startHour) * HOUR_HEIGHT - 10, 34)
                            const width = `calc(${100 / segment.laneCount}% - 12px)`
                            const left = `calc(${segment.lane * (100 / segment.laneCount)}% + 6px)`

                            return (
                              <button
                                key={`${segment.item.id}-${segment.lane}`}
                                type="button"
                                className="absolute overflow-hidden rounded-xl border px-3 py-2 text-left text-sm font-medium text-white shadow-sm"
                                style={{
                                  top,
                                  height,
                                  width,
                                  left,
                                  backgroundColor: segment.item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                  borderColor: colorWithAlpha(segment.item.displayColor, 0.75),
                                }}
                                onClick={() => openExistingItem(segment.item.id)}
                              >
                                <span className="block truncate">{segment.item.title}</span>
                                <span className="mt-1 block text-xs text-white/80">
                                  {segment.item.isHourly && segment.item.startTime
                                    ? `${segment.item.startTime.slice(0, 5)}${segment.item.endTime ? ` - ${segment.item.endTime.slice(0, 5)}` : ""}`
                                    : `${segment.item.workDays} workday${segment.item.workDays === 1 ? "" : "s"}`}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
                      <div className="grid grid-cols-[140px_minmax(0,1fr)_120px_120px_120px] border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                        <div>Date</div>
                        <div>Title</div>
                        <div>Phase</div>
                        <div>Assigned To</div>
                        <div>Status</div>
                      </div>
                      <div className="divide-y divide-[#E5E7EB]">
                        {filteredItems
                          .filter((item) => itemEndDate(item) >= dateKey(calendarAnchorDate))
                          .sort((left, right) => left.startDate.localeCompare(right.startDate))
                          .map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className="grid w-full grid-cols-[140px_minmax(0,1fr)_120px_120px_120px] items-start gap-4 px-4 py-4 text-left transition hover:bg-slate-50"
                              onClick={() => openExistingItem(item.id)}
                            >
                              <div className="text-sm text-slate-500">{fmtDate(item.startDate)}</div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="size-2.5 rounded-full"
                                    style={{ backgroundColor: item.displayColor || DEFAULT_SCHEDULE_COLOR }}
                                  />
                                  <span className="truncate font-medium text-slate-900">{item.title}</span>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                  {item.workDays} workday{item.workDays === 1 ? "" : "s"} • ends {fmtDate(itemEndDate(item))}
                                </p>
                              </div>
                              <div className="text-sm text-slate-500">{item.phaseName || "—"}</div>
                              <div className="text-sm text-slate-500">
                                {item.assignees.length > 0
                                  ? item.assignees.map((assignee) => assignee.fullName || "Unknown").join(", ")
                                  : "—"}
                              </div>
                              <div>
                                <Badge variant="outline" className="border-[#D8E0EA] bg-white text-slate-600">
                                  {titleCaseStatus(item.status)}
                                </Badge>
                              </div>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {viewMode === "list" ? (
              <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-[#E5E7EB] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Schedule Items</h2>
                    <p className="text-sm text-slate-500">The list view uses the same schedule items and filters as calendar and gantt.</p>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" className="border-[#E5E7EB] bg-white">
                        View
                        <ChevronDown className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => setListDisplayMode("phases")}>
                        Phases
                        {listDisplayMode === "phases" ? <Check className="ml-auto size-4" /> : null}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setListDisplayMode("notes")}>
                        Notes
                        {listDisplayMode === "notes" ? <Check className="ml-auto size-4" /> : null}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="p-4">
                  {loading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Skeleton key={index} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : isEmpty ? (
                    <EmptyState
                      title={items.length === 0 ? "No schedule items yet" : "No schedule items match this filter"}
                      description={
                        items.length === 0
                          ? "Create the first schedule item to populate this table."
                          : "Adjust the active filter to see matching schedule items here."
                      }
                      actionLabel={items.length === 0 ? "New Schedule Item" : "Clear Filters"}
                      onAction={
                        items.length === 0
                          ? openNewItem
                          : () => {
                              const reset = buildFilterPreset("all")
                              setAppliedFilters(reset)
                              setDraftFilters(reset)
                            }
                      }
                    />
                  ) : (
                    <>
                      <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-[#F8FAFC] hover:bg-[#F8FAFC]">
                              <TableHead className="w-12">
                                <Checkbox
                                  checked={allCurrentPageSelected}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setSelectedListIds((current) => mergeUniqueIds(current, currentPageIds))
                                      return
                                    }

                                    setSelectedListIds((current) =>
                                      current.filter((id) => !currentPageIds.includes(id)),
                                    )
                                  }}
                                />
                              </TableHead>
                              <SortableHead label="ID #" sortKey="idNumber" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                              <SortableHead label="Title" sortKey="title" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                              <SortableHead label="Complete" sortKey="complete" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                              <SortableHead label="Phase" sortKey="phase" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                              <SortableHead label="Duration" sortKey="duration" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                              <SortableHead label="Start" sortKey="start" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                              <SortableHead label="End" sortKey="end" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                              <SortableHead label="Assigned To" sortKey="assigned" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                              <SortableHead label="Accepted" sortKey="accepted" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                              <SortableHead label="Pending" sortKey="pending" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                              <SortableHead label="Declined" sortKey="declined" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                              <SortableHead label="Files" sortKey="files" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {groupedListItems.map((group) => (
                              <Fragment key={group.label}>
                                {listDisplayMode === "phases" ? (
                                  <TableRow className="hover:bg-white">
                                    <TableCell colSpan={13} className="bg-slate-50 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                                      {group.label}
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                                {group.items.map((item) => (
                                  <TableRow key={item.id} className="hover:bg-slate-50">
                                    <TableCell>
                                      <Checkbox
                                        checked={selectedListIds.includes(item.id)}
                                        onCheckedChange={(checked) => {
                                          setSelectedListIds((current) =>
                                            checked
                                              ? mergeUniqueIds(current, [item.id])
                                              : current.filter((value) => value !== item.id),
                                          )
                                        }}
                                      />
                                    </TableCell>
                                    <TableCell className="text-sm text-slate-500">{itemNumberById.get(item.id) ?? "—"}</TableCell>
                                    <TableCell className="max-w-[260px]">
                                      <button
                                        type="button"
                                        className="flex max-w-full items-start gap-2 text-left"
                                        onClick={() => openExistingItem(item.id)}
                                      >
                                        <span
                                          className="mt-1 size-2.5 shrink-0 rounded-full"
                                          style={{ backgroundColor: item.displayColor || DEFAULT_SCHEDULE_COLOR }}
                                        />
                                        <span className="min-w-0">
                                          <span className="block truncate font-medium text-blue-700 hover:underline">
                                            {item.title}
                                          </span>
                                          {listDisplayMode === "notes" && (item.notes || item.notesStream?.[0]?.note) ? (
                                            <span className="mt-1 block truncate text-xs text-slate-500">
                                              {(item.notes || item.notesStream?.[0]?.note || "").replace(/\s+/g, " ")}
                                            </span>
                                          ) : null}
                                        </span>
                                      </button>
                                    </TableCell>
                                    <TableCell>
                                      {item.isComplete ? (
                                        <CheckCircle2 className="size-4 text-emerald-600" />
                                      ) : (
                                        <Circle className="size-4 text-slate-300" />
                                      )}
                                    </TableCell>
                                    <TableCell className="text-sm text-slate-500">{item.phaseName || "—"}</TableCell>
                                    <TableCell className="text-sm text-slate-500">{item.workDays} days</TableCell>
                                    <TableCell className="text-sm text-slate-500">{fmtDate(item.startDate)}</TableCell>
                                    <TableCell className="text-sm text-slate-500">{fmtDate(itemEndDate(item))}</TableCell>
                                    <TableCell className="text-sm text-slate-500">
                                      {item.assignees.length > 0
                                        ? item.assignees.map((assignee) => assignee.fullName || "Unknown").join(", ")
                                        : "—"}
                                    </TableCell>
                                    <TableCell className="text-sm text-slate-500">0</TableCell>
                                    <TableCell className="text-sm text-slate-500">0</TableCell>
                                    <TableCell className="text-sm text-slate-500">0</TableCell>
                                    <TableCell className="text-sm text-slate-500">{item.attachments.length}</TableCell>
                                  </TableRow>
                                ))}
                              </Fragment>
                            ))}
                          </TableBody>
                        </Table>
                      </div>

                      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-slate-500">
                          {selectedListIds.length > 0 ? `${selectedListIds.length} selected` : "No rows selected"}
                        </p>
                        <div className="flex items-center gap-2 sm:justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="border-[#E5E7EB] bg-white"
                            disabled={listPage === 1}
                            onClick={() => setListPage((current) => Math.max(1, current - 1))}
                          >
                            Previous
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="border-[#E5E7EB] bg-white"
                            disabled={listPage === totalListPages}
                            onClick={() => setListPage((current) => Math.min(totalListPages, current + 1))}
                          >
                            Next
                          </Button>
                          <span className="text-sm text-slate-500">
                            {listStart}–{listEnd} of {sortedListItems.length} items
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {viewMode === "gantt" ? (
              <div
                className={cn(
                  "rounded-xl border border-[#E5E7EB] bg-white shadow-sm",
                  ganttFullscreen && "fixed inset-4 z-50 flex flex-col",
                )}
              >
                <div className="flex flex-col gap-3 border-b border-[#E5E7EB] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={ganttScale} onValueChange={(value) => setGanttScale(value as GanttScale)}>
                      <SelectTrigger className="h-10 w-[130px] border-[#E5E7EB]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GANTT_SCALES.map((scale) => (
                          <SelectItem key={scale.value} value={scale.value}>
                            {scale.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" className="h-10 border-[#E5E7EB]" onClick={scrollGanttToToday}>
                      Today
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 lg:justify-end">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <span>Phases</span>
                      <Switch checked={ganttShowPhases} onCheckedChange={setGanttShowPhases} />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <span>Critical Path</span>
                      <Switch checked={ganttCriticalPath} onCheckedChange={setGanttCriticalPath} />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 border-[#E5E7EB] bg-white"
                      onClick={() => setGanttFullscreen((current) => !current)}
                    >
                      {ganttFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                    </Button>
                  </div>
                </div>

                <div className={cn("p-4", ganttFullscreen && "flex-1 overflow-hidden")}>
                  {loading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Skeleton key={index} className="h-14 w-full" />
                      ))}
                    </div>
                  ) : ganttItems.length === 0 ? (
                    <EmptyState
                      title={items.length === 0 ? "No gantt items yet" : "No gantt items match this filter"}
                      description={
                        items.length === 0
                          ? "Create a schedule item with Show on Gantt enabled to build the job timeline."
                          : "Adjust the current filters or enable Show on Gantt on more schedule items."
                      }
                      actionLabel={items.length === 0 ? "New Schedule Item" : "Clear Filters"}
                      onAction={
                        items.length === 0
                          ? openNewItem
                          : () => {
                              const reset = buildFilterPreset("all")
                              setAppliedFilters(reset)
                              setDraftFilters(reset)
                            }
                      }
                    />
                  ) : (
                    <div className={cn("overflow-hidden rounded-xl border border-[#E5E7EB]", ganttFullscreen && "h-full")}>
                      <div className={cn("flex", ganttFullscreen && "h-full flex-col")}>
                        <div className={cn("flex", ganttFullscreen && "min-h-0 flex-1")}>
                          <div className="w-[340px] shrink-0 border-r border-[#E5E7EB]">
                            <div className="grid grid-cols-[minmax(0,1fr)_108px_88px_72px_72px] border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                              <div>Title</div>
                              <div>Start</div>
                              <div>Workdays</div>
                              <div />
                              <div />
                            </div>

                            <div className={cn("divide-y divide-[#E5E7EB]", ganttFullscreen && "max-h-full overflow-y-auto")}>
                              {ganttRows.map((row) =>
                                row.type === "phase" ? (
                                  <div key={row.key} className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                                    {row.label}
                                  </div>
                                ) : (
                                  <div
                                    key={row.key}
                                    className="grid w-full grid-cols-[minmax(0,1fr)_108px_88px_72px_72px] items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => openExistingItem(row.item.id)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault()
                                        openExistingItem(row.item.id)
                                      }
                                    }}
                                  >
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span
                                          className="size-2.5 shrink-0 rounded-full"
                                          style={{ backgroundColor: row.item.displayColor || DEFAULT_SCHEDULE_COLOR }}
                                        />
                                        <span className="truncate font-medium text-slate-900">{row.item.title}</span>
                                      </div>
                                    </div>
                                    <div className="text-sm text-slate-500">{fmtDate(row.item.startDate)}</div>
                                    <div className="text-sm text-slate-500">{row.item.workDays}</div>
                                    <button
                                      type="button"
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] text-slate-500 transition hover:bg-white"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        openExistingItem(row.item.id)
                                      }}
                                    >
                                      <Edit3 className="size-4" />
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] text-slate-500 transition hover:bg-white"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        openNewItem()
                                      }}
                                    >
                                      <Plus className="size-4" />
                                    </button>
                                  </div>
                                ),
                              )}
                            </div>
                          </div>

                          <div ref={ganttTimelineRef} className="min-w-0 flex-1 overflow-auto">
                            <div style={{ width: `${timelineWidth}px` }}>
                              <div className="sticky top-0 z-10 bg-white">
                                <div className="flex border-b border-[#E5E7EB] bg-[#F8FAFC]">
                                  {monthGroups.map((group) => (
                                    <div
                                      key={group.key}
                                      className="border-r border-[#E5E7EB] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 last:border-r-0"
                                      style={{ width: `${group.width}px` }}
                                    >
                                      {group.label}
                                    </div>
                                  ))}
                                </div>
                                <div className="relative flex border-b border-[#E5E7EB] bg-white">
                                  {scaleUnits.map((unit) => (
                                    <div
                                      key={unit.key}
                                      className="border-r border-[#E5E7EB] px-2 py-2 text-center text-xs font-medium text-slate-500 last:border-r-0"
                                      style={{ width: `${unit.width}px` }}
                                    >
                                      {unit.label}
                                    </div>
                                  ))}
                                  <div
                                    className="pointer-events-none absolute bottom-[-6px] z-20"
                                    style={{ left: `${todayOffsetPx - 6}px` }}
                                  >
                                    <div className="size-3 rotate-45 bg-blue-600" />
                                  </div>
                                </div>
                              </div>

                              <div className="relative">
                                <div
                                  className="pointer-events-none absolute inset-y-0 z-10 w-px bg-blue-500/60"
                                  style={{ left: `${todayOffsetPx}px` }}
                                />

                                {ganttRows.map((row) =>
                                  row.type === "phase" ? (
                                    <div key={row.key} className="h-[38px] border-b border-[#E5E7EB] bg-slate-50" />
                                  ) : (
                                    <button
                                      key={row.key}
                                      type="button"
                                      className="relative block h-[54px] w-full border-b border-[#E5E7EB] text-left transition hover:bg-slate-50"
                                      onClick={() => openExistingItem(row.item.id)}
                                    >
                                      {scaleUnits.map((unit) => (
                                        <div
                                          key={`${row.item.id}-${unit.key}`}
                                          className="absolute inset-y-0 border-r border-[#EEF2F7] last:border-r-0"
                                          style={{
                                            left: `${diffInDays(ganttRange.start, unit.start) * dayWidth}px`,
                                            width: `${unit.width}px`,
                                          }}
                                        />
                                      ))}

                                      <div
                                        className={cn(
                                          "absolute top-[12px] overflow-hidden rounded-full border shadow-sm",
                                          ganttCriticalPath && criticalPathIds.has(row.item.id)
                                            ? "border-amber-500 ring-2 ring-amber-200"
                                            : "border-transparent",
                                        )}
                                        style={{
                                          left: `${diffInDays(ganttRange.start, parseDate(row.item.startDate)) * dayWidth}px`,
                                          width: `${(diffInDays(parseDate(row.item.startDate), parseDate(itemEndDate(row.item))) + 1) * dayWidth}px`,
                                          height: "28px",
                                          backgroundColor: colorWithAlpha(row.item.displayColor, 0.18),
                                        }}
                                      >
                                        <div
                                          className="h-full"
                                          style={{
                                            width: `${Math.max(0, Math.min(100, row.item.progress ?? 0))}%`,
                                            backgroundColor: row.item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                          }}
                                        />
                                        <div className="pointer-events-none absolute inset-0 flex items-center px-3 text-xs font-medium text-slate-900">
                                          <span className="truncate">{row.item.title}</span>
                                        </div>
                                      </div>
                                    </button>
                                  ),
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 border-t border-[#E5E7EB] bg-blue-50/70 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Try Draft mode. Make changes confidently with features like undo and redo.</p>
                        </div>
                        <Button
                          type="button"
                          className="sm:w-auto"
                          disabled={scheduleOffline}
                          onClick={() => setScheduleOffline(true)}
                        >
                          Switch to Draft mode
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="baseline" className="mt-0">
            <EmptyState
              title="Baseline is coming in Piece 4"
              description="Baseline snapshots, comparisons, and controls will live here. This placeholder keeps the schedule tab structure in place for the next piece."
            />
          </TabsContent>

          <TabsContent value="workday-exceptions" className="mt-0">
            <EmptyState
              title="Workday Exceptions are coming in Piece 4"
              description="Job-specific non-workdays and extra workdays will be managed here once the exception workflow is added."
            />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg border-[#E5E7EB] bg-white">
          <DialogHeader>
            <DialogTitle>Schedule Settings</DialogTitle>
            <DialogDescription>
              Schedule settings are part of Piece 4. This placeholder confirms the toolbar action and keeps the modal entry point in place.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-full max-w-xl border-[#E5E7EB] bg-white p-0 sm:max-w-xl">
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-[#E5E7EB] px-6 py-5">
              <SheetTitle>Schedule history</SheetTitle>
              <SheetDescription>
                A chronological record of schedule changes for this job.
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="flex-1">
              <div className="space-y-3 p-6">
                {historyLoading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-20 w-full" />
                  ))
                ) : historyEntries.length === 0 ? (
                  <EmptyState
                    title="No changes made."
                    description="You haven't made any changes to the schedule yet. When you do, you'll see a record of them here."
                  />
                ) : (
                  historyEntries.map((entry) => {
                    const description = typeof entry.metadata?.description === "string"
                      ? entry.metadata.description
                      : titleCaseStatus(entry.action)

                    return (
                      <div key={entry.id} className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">{description}</p>
                            <p className="mt-1 text-sm text-slate-500">
                              {entry.userName || "System"} • {fmtDateTime(entry.createdAt)}
                            </p>
                          </div>
                          <Badge variant="outline" className="border-[#E5E7EB] bg-[#F8FAFC] text-slate-600">
                            {titleCaseStatus(entry.action)}
                          </Badge>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="right" className="w-full max-w-xl border-[#E5E7EB] bg-white p-0 sm:max-w-xl">
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-[#E5E7EB] px-6 py-5">
              <SheetTitle>Filter Schedule</SheetTitle>
              <SheetDescription>
                Apply the same filters across Calendar, List, and Gantt.
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="flex-1">
              <div className="space-y-5 p-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Standard Filter</label>
                  <Select
                    value={draftPresetValue}
                    onValueChange={(value) => setDraftFilters(buildFilterPreset(value))}
                  >
                    <SelectTrigger className="border-[#E5E7EB]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FILTER_PRESETS.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                          {preset.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom" disabled>
                        Custom Filter
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Title</label>
                  <Input
                    value={draftFilters.title}
                    className="border-[#E5E7EB]"
                    placeholder="Search by title or note"
                    onChange={(event) => setDraftFilters((current) => ({ ...current, preset: "custom", title: event.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Assigned To</label>
                  <AssigneeSelect
                    users={users}
                    value={draftFilters.assignedTo}
                    onChange={(value) => setDraftFilters((current) => ({ ...current, preset: "custom", assignedTo: value }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Status</label>
                  <Select
                    value={draftFilters.status}
                    onValueChange={(value) => setDraftFilters((current) => ({ ...current, preset: "custom", status: value }))}
                  >
                    <SelectTrigger className="border-[#E5E7EB]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status.value} value={status.value}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Tags</label>
                  <MultiSelectPopover
                    placeholder="Select tags"
                    options={settings.tags}
                    selected={draftFilters.tags}
                    onChange={(next) => setDraftFilters((current) => ({ ...current, preset: "custom", tags: next }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Phases</label>
                  <MultiSelectPopover
                    placeholder="Select phases"
                    options={settings.phases}
                    selected={draftFilters.phases}
                    onChange={(next) => setDraftFilters((current) => ({ ...current, preset: "custom", phases: next }))}
                  />
                </div>
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between gap-3 border-t border-[#E5E7EB] px-6 py-5">
              <Button
                type="button"
                variant="outline"
                className="border-[#E5E7EB]"
                onClick={() => {
                  const reset = buildFilterPreset("all")
                  setDraftFilters(reset)
                  setAppliedFilters(reset)
                  setFilterOpen(false)
                  setListPage(1)
                }}
              >
                Clear all
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setAppliedFilters(draftFilters)
                  setListPage(1)
                  setFilterOpen(false)
                }}
              >
                Apply filter
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {jobId ? (
        <ScheduleItemDialog
          open={dialogOpen}
          onOpenChange={(nextOpen) => {
            setDialogOpen(nextOpen)

            if (!nextOpen) {
              setActiveItemId(null)
            }
          }}
          jobId={jobId}
          itemId={activeItemId}
          items={items}
          users={users}
          settings={settings}
          refreshSettings={fetchSettings}
          onRefresh={refreshScheduleData}
        />
      ) : null}
    </>
  )
}
