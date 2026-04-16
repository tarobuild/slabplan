import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Download,
  Edit3,
  Filter,
  ListChecks,
  Loader2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  RotateCw,
  Settings2,
} from "lucide-react"
import { api } from "@/lib/api"
import { useDocumentTitle } from "@/hooks/use-document-title"
import {
  addBusinessDays,
  calculateBusinessEndDate,
  classifyWorkday,
  dateKey,
  DEFAULT_SCHEDULE_COLOR,
  deriveScheduleStatus,
  fmtClockRange,
  fmtDate,
  fmtDateTime,
  itemEndDate,
  itemOverlapsDateRange,
  SCHEDULE_COLOR_OPTIONS,
  SCHEDULE_DEFAULT_VIEW_OPTIONS,
  type ScheduleItemPayload,
  todayStr,
  type ScheduleBaselineRecord,
  type ScheduleItemRecord,
  type ScheduleSettings,
  type ScheduleSettingsOption,
  type ScheduleViewModeDefault,
  type ScheduleWorkdayException,
} from "@/lib/schedule"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
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
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
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
import { Textarea } from "@/components/ui/textarea"
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

type ActivityEntryChange = {
  field: string
  label: string
  from: string
  to: string
}

type JobOption = {
  id: string
  title: string
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
  | "files"

type FilterState = {
  preset: string
  title: string
  assignedTo: string
  status: string
  tags: string[]
  phases: string[]
}

type ScheduleSettingsForm = {
  defaultView: ScheduleViewModeDefault
  showTimesOnMonthView: boolean
  showJobNameOnAllListedJobs: boolean
  automaticallyMarkItemsComplete: boolean
  includeHeaderOnPdfExports: boolean
  phases: Array<{
    id: string
    name: string
    color: string
    isNew?: boolean
  }>
}

type WorkdayExceptionForm = {
  id: string | null
  title: string
  type: "non_workday" | "extra_workday"
  startDate: string
  endDate: string
  sameEveryYear: boolean
  categoryId: string | null
  appliesToAllJobs: boolean
  jobIds: string[]
  notes: string
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

type ScheduleTemplate = {
  id: string
  name: string
  description: string
  items: Array<{
    title: string
    workDays: number
    displayColor?: string
  }>
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
const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  {
    id: "standard-countertop-install",
    name: "Standard Countertop Install",
    description: "Template, fabrication, install, and final inspection milestones for a typical countertop project.",
    items: [
      { title: "Template", workDays: 1, displayColor: "#2563eb" },
      { title: "Fabrication", workDays: 2, displayColor: "#6b7280" },
      { title: "Install", workDays: 1, displayColor: "#16a34a" },
      { title: "Final Inspection", workDays: 1, displayColor: "#f59e0b" },
    ],
  },
  {
    id: "backsplash-project",
    name: "Backsplash Project",
    description: "Measurement, material selection, fabrication, and install schedule for backsplash work.",
    items: [
      { title: "Measurement", workDays: 1, displayColor: "#7c3aed" },
      { title: "Material Selection", workDays: 1, displayColor: "#ec4899" },
      { title: "Fabrication", workDays: 2, displayColor: "#6b7280" },
      { title: "Install", workDays: 1, displayColor: "#16a34a" },
    ],
  },
  {
    id: "custom-stone-work",
    name: "Custom Stone Work",
    description: "Design through punch list workflow for custom stone fabrication and installation.",
    items: [
      { title: "Design", workDays: 2, displayColor: "#0f766e" },
      { title: "Template", workDays: 1, displayColor: "#2563eb" },
      { title: "Fabrication", workDays: 3, displayColor: "#6b7280" },
      { title: "Dry Fit", workDays: 1, displayColor: "#f97316" },
      { title: "Final Install", workDays: 1, displayColor: "#16a34a" },
      { title: "Punch List", workDays: 1, displayColor: "#f59e0b" },
    ],
  },
]
const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "none", label: "None" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
  { value: "in_progress", label: "In Progress" },
  { value: "incomplete", label: "Incomplete" },
  { value: "past_due", label: "Past Due" },
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
const DEFAULT_SETTINGS: ScheduleSettings = {
  phases: [],
  tags: [],
  defaultView: "calendar_month",
  showTimesOnMonthView: false,
  showJobNameOnAllListedJobs: true,
  automaticallyMarkItemsComplete: false,
  includeHeaderOnPdfExports: true,
  workdayExceptionCategories: [],
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

function getActivityEntryChanges(metadata: Record<string, unknown> | null) {
  const rawChanges = metadata?.changes

  if (!Array.isArray(rawChanges)) {
    return []
  }

  return rawChanges.filter((change): change is ActivityEntryChange => {
    if (typeof change !== "object" || change === null) {
      return false
    }

    const candidate = change as Partial<ActivityEntryChange>
    return (
      typeof candidate.field === "string"
      && typeof candidate.label === "string"
      && typeof candidate.from === "string"
      && typeof candidate.to === "string"
    )
  })
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

function applyDefaultViewChoice(
  defaultView: ScheduleViewModeDefault,
  setViewMode: (value: ViewMode) => void,
  setCalendarPeriod: (value: CalendarPeriod) => void,
) {
  if (defaultView === "list") {
    setViewMode("list")
    return
  }

  if (defaultView === "gantt") {
    setViewMode("gantt")
    return
  }

  setViewMode("calendar")
  setCalendarPeriod(defaultView.replace("calendar_", "") as CalendarPeriod)
}

function buildSettingsForm(settings: ScheduleSettings): ScheduleSettingsForm {
  return {
    defaultView: settings.defaultView,
    showTimesOnMonthView: settings.showTimesOnMonthView,
    showJobNameOnAllListedJobs: settings.showJobNameOnAllListedJobs,
    automaticallyMarkItemsComplete: settings.automaticallyMarkItemsComplete,
    includeHeaderOnPdfExports: settings.includeHeaderOnPdfExports,
    phases: settings.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      color: phase.color || DEFAULT_SCHEDULE_COLOR,
    })),
  }
}

function defaultExceptionForm(jobId: string, startDate = todayStr()): WorkdayExceptionForm {
  return {
    id: null,
    title: "",
    type: "non_workday",
    startDate,
    endDate: startDate,
    sameEveryYear: false,
    categoryId: null,
    appliesToAllJobs: false,
    jobIds: jobId ? [jobId] : [],
    notes: "",
  }
}

function mergeUniqueIds(current: string[], nextIds: string[]) {
  return Array.from(new Set([...current, ...nextIds]))
}

function matchesStatus(item: ScheduleItemRecord, status: string) {
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
                        isSelected && "border-orange-600 bg-orange-600 text-white",
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
                    value === "" && "border-orange-600 bg-orange-600 text-white",
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
                    value === "__unassigned__" && "border-orange-600 bg-orange-600 text-white",
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
                      value === user.id && "border-orange-600 bg-orange-600 text-white",
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

function isDraftScheduleItemId(id: string) {
  return id.startsWith("draft-item-")
}

function isDraftScheduleNoteId(id: string) {
  return id.startsWith("draft-note-")
}

function cloneScheduleItems(items: ScheduleItemRecord[]) {
  return items.map((item) => ({
    ...item,
    tags: [...item.tags],
    assigneeIds: [...item.assigneeIds],
    assignees: item.assignees.map((assignee) => ({ ...assignee })),
    predecessors: item.predecessors.map((predecessor) => ({ ...predecessor })),
    notesStream: item.notesStream.map((note) => ({ ...note })),
    attachments: item.attachments.map((attachment) => ({ ...attachment })),
    relatedTodos: item.relatedTodos.map((todo) => ({ ...todo })),
    conflictReasons: item.conflictReasons ? [...item.conflictReasons] : [],
  }))
}

function schedulePayloadFromItem(item: ScheduleItemRecord): ScheduleItemPayload {
  return {
    title: item.title,
    displayColor: item.displayColor || DEFAULT_SCHEDULE_COLOR,
    assigneeIds: [...item.assigneeIds].sort(),
    startDate: item.startDate,
    workDays: Math.max(item.workDays, 1),
    endDate: null,
    isHourly: !!item.isHourly,
    startTime: item.isHourly ? item.startTime : null,
    endTime: item.isHourly ? item.endTime : null,
    progress: Math.max(0, Math.min(100, item.progress ?? 0)),
    reminder: item.reminder || "none",
    notes: item.notes ?? null,
    notifyUserIds: [],
    tags: [...item.tags].sort((left, right) => left.localeCompare(right)),
    predecessors: item.predecessors
      .map((predecessor) => ({
        scheduleItemId: predecessor.scheduleItemId,
        dependencyType: predecessor.dependencyType,
        lagDays: predecessor.lagDays,
      }))
      .sort((left, right) => {
        if (left.scheduleItemId !== right.scheduleItemId) {
          return left.scheduleItemId.localeCompare(right.scheduleItemId)
        }

        if (left.dependencyType !== right.dependencyType) {
          return left.dependencyType.localeCompare(right.dependencyType)
        }

        return left.lagDays - right.lagDays
      }),
    phaseId: item.phaseId,
    showOnGantt: item.showOnGantt ?? true,
    visibleToEstimators: item.visibleToEstimators ?? true,
    visibleToInstallers: item.visibleToInstallers ?? true,
    visibleToOfficeStaff: item.visibleToOfficeStaff ?? true,
    isComplete: item.isComplete ?? false,
  }
}

function schedulePayloadSignature(item: ScheduleItemRecord) {
  return JSON.stringify(schedulePayloadFromItem(item))
}

function scheduleDraftSignature(item: ScheduleItemRecord) {
  return JSON.stringify({
    payload: schedulePayloadFromItem(item),
    draftNotes: item.notesStream
      .filter((note) => isDraftScheduleNoteId(note.id))
      .map((note) => note.note),
  })
}

function resolveDraftPredecessorStartDate(
  startDate: string,
  workDays: number,
  predecessors: ScheduleItemPayload["predecessors"],
  predecessorMap: Map<string, { startDate: string; endDate: string }>,
  workdayExceptions: ScheduleWorkdayException[],
) {
  let resolvedStartDate = startDate

  for (const predecessor of predecessors) {
    const linked = predecessorMap.get(predecessor.scheduleItemId)

    if (!linked) {
      continue
    }

    if (predecessor.dependencyType === "finish_to_start") {
      const candidate = addBusinessDays(linked.endDate, predecessor.lagDays + 1, workdayExceptions)
      if (candidate > resolvedStartDate) {
        resolvedStartDate = candidate
      }
      continue
    }

    if (predecessor.dependencyType === "start_to_start") {
      const candidate = addBusinessDays(linked.startDate, predecessor.lagDays, workdayExceptions)
      if (candidate > resolvedStartDate) {
        resolvedStartDate = candidate
      }
      continue
    }

    if (predecessor.dependencyType === "finish_to_finish") {
      const desiredEnd = addBusinessDays(linked.endDate, predecessor.lagDays, workdayExceptions)
      const candidateStart = calculateBusinessEndDate(desiredEnd, Math.max(workDays, 1), workdayExceptions)
      if (candidateStart > resolvedStartDate) {
        resolvedStartDate = candidateStart
      }
      continue
    }

    const desiredEnd = addBusinessDays(linked.startDate, predecessor.lagDays, workdayExceptions)
    const candidateStart = calculateBusinessEndDate(desiredEnd, Math.max(workDays, 1), workdayExceptions)
    if (candidateStart > resolvedStartDate) {
      resolvedStartDate = candidateStart
    }
  }

  return resolvedStartDate
}

function draftConflictReasons(
  item: Pick<ScheduleItemRecord, "title" | "startDate" | "endDate" | "predecessors">,
  predecessorMap: Map<string, { title: string; startDate: string; endDate: string }>,
  workdayExceptions: ScheduleWorkdayException[],
) {
  const reasons: string[] = []

  for (const predecessor of item.predecessors) {
    const linked = predecessorMap.get(predecessor.scheduleItemId)

    if (!linked) {
      continue
    }

    if (predecessor.dependencyType === "finish_to_start") {
      const requiredStart = addBusinessDays(linked.endDate, predecessor.lagDays + 1, workdayExceptions)
      if (item.startDate < requiredStart) {
        reasons.push(`${item.title} starts before ${linked.title} finishes`)
      }
      continue
    }

    if (predecessor.dependencyType === "start_to_start") {
      const requiredStart = addBusinessDays(linked.startDate, predecessor.lagDays, workdayExceptions)
      if (item.startDate < requiredStart) {
        reasons.push(`${item.title} starts before ${linked.title} is allowed to start it`)
      }
      continue
    }

    if (predecessor.dependencyType === "finish_to_finish") {
      const requiredEnd = addBusinessDays(linked.endDate, predecessor.lagDays, workdayExceptions)
      if (item.endDate < requiredEnd) {
        reasons.push(`${item.title} finishes before ${linked.title} requirement is met`)
      }
      continue
    }

    const requiredEnd = addBusinessDays(linked.startDate, predecessor.lagDays, workdayExceptions)
    if (item.endDate < requiredEnd) {
      reasons.push(`${item.title} finishes before ${linked.title} start dependency is met`)
    }
  }

  return reasons
}

function normalizeDraftScheduleItems(
  items: ScheduleItemRecord[],
  users: AppUser[],
  settings: ScheduleSettings,
  workdayExceptions: ScheduleWorkdayException[],
) {
  const userMap = new Map(users.map((user) => [user.id, user]))
  const phaseMap = new Map(settings.phases.map((phase) => [phase.id, phase]))
  let normalized = cloneScheduleItems(items).map((item) => ({
    ...item,
    displayColor: item.displayColor || DEFAULT_SCHEDULE_COLOR,
    workDays: Math.max(item.workDays, 1),
    progress: Math.max(0, Math.min(100, item.progress ?? 0)),
    isHourly: !!item.isHourly,
    startTime: item.isHourly ? item.startTime || "08:00" : null,
    reminder: item.reminder || "none",
    showOnGantt: item.showOnGantt ?? true,
    visibleToEstimators: item.visibleToEstimators ?? true,
    visibleToInstallers: item.visibleToInstallers ?? true,
    visibleToOfficeStaff: item.visibleToOfficeStaff ?? true,
    isComplete: item.isComplete ?? false,
    tags: [...item.tags],
    assigneeIds: Array.from(new Set(item.assigneeIds)),
    predecessors: item.predecessors.map((predecessor) => ({
      ...predecessor,
      lagDays: Math.max(0, predecessor.lagDays),
    })),
  }))

  for (let pass = 0; pass < Math.max(normalized.length * 2, 1); pass += 1) {
    const predecessorMap = new Map(
      normalized.map((item) => [
        item.id,
        {
          startDate: item.startDate,
          endDate: item.endDate,
        },
      ]),
    )

    let changed = false

    normalized = normalized.map((item) => {
      const nextStartDate = item.predecessors.length > 0
        ? resolveDraftPredecessorStartDate(
            item.startDate,
            item.workDays,
            item.predecessors.map((predecessor) => ({
              scheduleItemId: predecessor.scheduleItemId,
              dependencyType: predecessor.dependencyType,
              lagDays: predecessor.lagDays,
            })),
            predecessorMap,
            workdayExceptions,
          )
        : item.startDate
      const nextEndDate = calculateBusinessEndDate(nextStartDate, item.workDays, workdayExceptions)

      if (nextStartDate !== item.startDate || nextEndDate !== item.endDate) {
        changed = true
      }

      return {
        ...item,
        startDate: nextStartDate,
        endDate: nextEndDate,
      }
    })

    if (!changed) {
      break
    }
  }

  const normalizedMap = new Map(
    normalized.map((item) => [
      item.id,
      {
        title: item.title,
        startDate: item.startDate,
        endDate: item.endDate,
      },
    ]),
  )

  return normalized.map((item) => {
    const phase = item.phaseId ? phaseMap.get(item.phaseId) : null
    const assignees = item.assigneeIds
      .map((assigneeId) => userMap.get(assigneeId))
      .filter((assignee): assignee is AppUser => !!assignee)
      .map((assignee) => ({
        id: assignee.id,
        fullName: assignee.fullName,
        email: assignee.email,
        role: assignee.role,
        avatarUrl: assignee.avatarUrl,
      }))
    const predecessors = item.predecessors.map((predecessor) => ({
      ...predecessor,
      title: normalizedMap.get(predecessor.scheduleItemId)?.title || predecessor.title || "Unknown task",
    }))
    const conflictReasons = draftConflictReasons(
      {
        title: item.title,
        startDate: item.startDate,
        endDate: item.endDate,
        predecessors,
      },
      normalizedMap,
      workdayExceptions,
    )

    return {
      ...item,
      phaseName: phase?.name ?? null,
      phaseColor: phase?.color ?? null,
      assignees,
      predecessors,
      noteCount: item.notesStream.length,
      relatedTodoCount: item.relatedTodos.length,
      status: deriveScheduleStatus({
        startDate: item.startDate,
        endDate: item.endDate,
        progress: item.progress ?? 0,
        isComplete: item.isComplete ?? false,
      }),
      hasConflict: conflictReasons.length > 0,
      conflictReasons,
    }
  })
}

function remapDraftPayload(
  payload: ScheduleItemPayload,
  draftIdMap: Map<string, string>,
  options: {
    dropUnresolvedPredecessors?: boolean
  } = {},
) {
  return {
    ...payload,
    predecessors: payload.predecessors.flatMap((predecessor) => {
      const mappedId = draftIdMap.get(predecessor.scheduleItemId)

      if (isDraftScheduleItemId(predecessor.scheduleItemId)) {
        if (!mappedId && options.dropUnresolvedPredecessors) {
          return []
        }

        if (!mappedId) {
          return []
        }
      }

      return [
        {
          ...predecessor,
          scheduleItemId: mappedId || predecessor.scheduleItemId,
        },
      ]
    }),
  }
}

export default function JobSchedulePage() {
  useDocumentTitle("Schedule")
  const { jobId } = useParams<{ jobId: string }>()
  const currentUser = useAuthStore((s) => s.user)
  const monthPickerRef = useRef<HTMLInputElement | null>(null)
  const ganttTimelineRef = useRef<HTMLDivElement | null>(null)
  const scheduleExportRef = useRef<HTMLDivElement | null>(null)
  const baselineExportRef = useRef<HTMLDivElement | null>(null)
  const exceptionsExportRef = useRef<HTMLDivElement | null>(null)
  const appliedDefaultViewRef = useRef(false)

  const [items, setItems] = useState<ScheduleItemRecord[]>([])
  const [users, setUsers] = useState<AppUser[]>([])
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [settings, setSettings] = useState<ScheduleSettings>(DEFAULT_SETTINGS)
  const [settingsForm, setSettingsForm] = useState<ScheduleSettingsForm>(() => buildSettingsForm(DEFAULT_SETTINGS))
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [baseline, setBaseline] = useState<ScheduleBaselineRecord | null>(null)
  const [workdayExceptions, setWorkdayExceptions] = useState<ScheduleWorkdayException[]>([])
  const [workdayForm, setWorkdayForm] = useState<WorkdayExceptionForm>(() => defaultExceptionForm(jobId || ""))
  const [workdayEditorOpen, setWorkdayEditorOpen] = useState(false)
  const [workdaySaving, setWorkdaySaving] = useState(false)
  const [categoryDraft, setCategoryDraft] = useState("")
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false)
  const [editingCategories, setEditingCategories] = useState<Record<string, string>>({})
  const [trackedConflictIds, setTrackedConflictIds] = useState<string[]>([])
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
  const [draftItems, setDraftItems] = useState<ScheduleItemRecord[]>([])
  const [draftPast, setDraftPast] = useState<ScheduleItemRecord[][]>([])
  const [draftFuture, setDraftFuture] = useState<ScheduleItemRecord[][]>([])
  const [draftPublishing, setDraftPublishing] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [templateApplyingId, setTemplateApplyingId] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [todosPanelOpen, setTodosPanelOpen] = useState(false)
  const [todoTitle, setTodoTitle] = useState("")
  const [todoDueDate, setTodoDueDate] = useState("")
  const [todoScheduleMode, setTodoScheduleMode] = useState<"preset" | "specific">("preset")
  const [todoTimeOfDay, setTodoTimeOfDay] = useState("")
  const [todoSpecificTime, setTodoSpecificTime] = useState("")
  const [todoSaving, setTodoSaving] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [dialogInitDate, setDialogInitDate] = useState<string | null>(null)
  const [dialogInitStartTime, setDialogInitStartTime] = useState<string | null>(null)
  const [dialogInitEndTime, setDialogInitEndTime] = useState<string | null>(null)
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(() => buildFilterPreset("all"))
  const [draftFilters, setDraftFilters] = useState<FilterState>(() => buildFilterPreset("all"))
  const draftItemsRef = useRef<ScheduleItemRecord[]>([])
  const draftPastRef = useRef<ScheduleItemRecord[][]>([])
  const draftFutureRef = useRef<ScheduleItemRecord[][]>([])

  const myTodos = useMemo(
    () => items.filter((item) => item.isPersonalTodo && item.createdBy === currentUser?.id),
    [items, currentUser?.id],
  )

  const incompleteTodoCount = useMemo(
    () => myTodos.filter((t) => !t.isComplete).length,
    [myTodos],
  )

  function resetTodoForm() {
    setTodoTitle("")
    setTodoDueDate("")
    setTodoScheduleMode("preset")
    setTodoTimeOfDay("")
    setTodoSpecificTime("")
  }

  async function handleAddPersonalTodo() {
    if (!todoTitle.trim() || !jobId || todoSaving) return
    setTodoSaving(true)
    try {
      const presetMap: Record<string, { start: string; end: string }> = {
        "First thing in the morning": { start: "07:00", end: "09:00" },
        "Midday": { start: "11:00", end: "13:00" },
        "End of day": { start: "15:00", end: "17:00" },
      }
      let startTime: string | null = null
      let endTime: string | null = null
      let isHourly = false

      const resolvedTime = todoScheduleMode === "specific" && todoSpecificTime
        ? `Specific: ${todoSpecificTime}`
        : todoTimeOfDay || undefined

      if (resolvedTime?.startsWith("Specific: ")) {
        const raw = resolvedTime.replace("Specific: ", "")
        startTime = raw.length === 5 ? raw : raw.substring(0, 5)
        const hour = parseInt(startTime.split(":")[0], 10)
        endTime = `${String(Math.min(hour + 1, 23)).padStart(2, "0")}:${startTime.split(":")[1]}`
        isHourly = true
      } else if (resolvedTime && presetMap[resolvedTime]) {
        startTime = presetMap[resolvedTime].start
        endTime = presetMap[resolvedTime].end
        isHourly = true
      }

      await api.post(`/jobs/${jobId}/schedule`, {
        title: todoTitle.trim(),
        startDate: todoDueDate || todayStr(),
        workDays: 1,
        isHourly,
        startTime,
        endTime,
        isPersonalTodo: true,
        assigneeIds: currentUser ? [currentUser.id] : [],
        showOnGantt: false,
      })
      resetTodoForm()
      await refreshScheduleData()
      toast.success("Personal to-do added")
    } catch (err) {
      toast.error(getApiError(err, "Failed to add to-do"))
    } finally {
      setTodoSaving(false)
    }
  }

  async function handleTogglePersonalTodo(item: ScheduleItemRecord) {
    try {
      await api.put(`/schedule-items/${item.id}`, {
        title: item.title,
        startDate: item.startDate,
        workDays: item.workDays,
        isComplete: !item.isComplete,
        isHourly: item.isHourly ?? false,
        startTime: item.startTime,
        endTime: item.endTime,
        assigneeIds: item.assigneeIds,
        progress: item.isComplete ? 0 : 100,
      })
      await refreshScheduleData()
    } catch (err) {
      toast.error(getApiError(err, "Failed to update to-do"))
    }
  }

  async function fetchItems() {
    if (!jobId) {
      return
    }

    const collected: ScheduleItemRecord[] = []
    let cursor: string | null = null
    // The backend caps each page at 500 items. Fetch pages in sequence until
    // drained so the calendar continues to see the full job schedule.
    // Safety cap prevents an infinite loop if the server returns a stuck cursor.
    for (let pageGuard = 0; pageGuard < 20; pageGuard += 1) {
      const query: Record<string, string> = { limit: "500" }
      if (cursor) {
        query.cursor = cursor
      }
      const response = await api.get<{
        items: ScheduleItemRecord[]
        nextCursor: string | null
      }>(`/jobs/${jobId}/schedule`, { params: query })
      collected.push(...(response.data.items ?? []))
      cursor = response.data.nextCursor ?? null
      if (!cursor) {
        break
      }
    }
    const nextItems = collected
    setItems(nextItems)

    if (!scheduleOffline) {
      setDraftItems(cloneScheduleItems(nextItems))
      setDraftPast([])
      setDraftFuture([])
      draftItemsRef.current = cloneScheduleItems(nextItems)
      draftPastRef.current = []
      draftFutureRef.current = []
    }
  }

  async function fetchBaseline() {
    if (!jobId) {
      return
    }

    const response = await api.get<{ baseline: ScheduleBaselineRecord | null }>(`/jobs/${jobId}/schedule/baseline`)
    setBaseline(response.data.baseline ?? null)
  }

  async function fetchWorkdayExceptions() {
    if (!jobId) {
      return
    }

    const response = await api.get<{ exceptions: ScheduleWorkdayException[] }>(`/jobs/${jobId}/workday-exceptions`)
    setWorkdayExceptions(response.data.exceptions ?? [])
  }

  async function fetchSettings() {
    if (!jobId) {
      return
    }

    const response = await api.get<ScheduleSettings>(`/jobs/${jobId}/schedule/settings`)
    const nextSettings: ScheduleSettings = {
      ...DEFAULT_SETTINGS,
      ...response.data,
      phases: response.data.phases ?? [],
      tags: response.data.tags ?? [],
      workdayExceptionCategories: response.data.workdayExceptionCategories ?? [],
    }
    setSettings(nextSettings)
    setSettingsForm(buildSettingsForm(nextSettings))
    setEditingCategories(
      Object.fromEntries((nextSettings.workdayExceptionCategories ?? []).map((category) => [category.id, category.name])),
    )

    if (!appliedDefaultViewRef.current) {
      applyDefaultViewChoice(nextSettings.defaultView, setViewMode, setCalendarPeriod)
      appliedDefaultViewRef.current = true
    }
  }

  async function fetchUsers() {
    const response = await api.get<{ users: AppUser[] }>("/users")
    setUsers(response.data.users ?? [])
  }

  async function fetchJobs() {
    const response = await api.get<{ jobs: JobOption[] }>("/jobs", {
      params: {
        page: 1,
        pageSize: 100,
      },
    })
    setJobs(response.data.jobs ?? [])
  }

  async function fetchHistory() {
    if (!jobId) {
      return
    }

    setHistoryLoading(true)

    try {
      const response = await api.get<{ data: ActivityEntry[] }>(`/activity?jobId=${jobId}&page=1&limit=100`)
      setHistoryEntries(
        (response.data.data ?? []).filter((entry) => entry.entityType.startsWith("schedule_")),
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
      await Promise.all([fetchItems(), fetchUsers(), fetchJobs(), fetchSettings(), fetchBaseline(), fetchWorkdayExceptions()])
    } catch (err) {
      toast.error(getApiError(err, "Failed to load schedule"))
    } finally {
      setLoading(false)
    }
  }

  async function refreshScheduleData() {
    await Promise.all([fetchItems(), fetchBaseline(), fetchWorkdayExceptions()])

    if (historyOpen) {
      await fetchHistory()
    }
  }

  useEffect(() => {
    void loadData()
  }, [jobId])

  useEffect(() => {
    if (!jobId) {
      return
    }

    setWorkdayForm(defaultExceptionForm(jobId))
    setWorkdayEditorOpen(false)
    setTrackedConflictIds([])
  }, [jobId])

  useEffect(() => {
    draftItemsRef.current = draftItems
  }, [draftItems])

  useEffect(() => {
    draftPastRef.current = draftPast
  }, [draftPast])

  useEffect(() => {
    draftFutureRef.current = draftFuture
  }, [draftFuture])

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

  const activeItems = scheduleOffline ? draftItems : items

  useEffect(() => {
    const availableIds = new Set(activeItems.map((item) => item.id))
    setSelectedListIds((current) => current.filter((id) => availableIds.has(id)))
  }, [activeItems])

  const todayIso = todayStr()
  const itemNumberById = useMemo(
    () => new Map(activeItems.map((item, index) => [item.id, index + 1])),
    [activeItems],
  )
  const availableTagOptions = useMemo(() => {
    const tagMap = new Map(settings.tags.map((tag) => [tag.name.toLowerCase(), tag]))

    for (const item of activeItems) {
      for (const tagName of item.tags) {
        const key = tagName.toLowerCase()

        if (!tagMap.has(key)) {
          tagMap.set(key, {
            id: `tag:${key}`,
            name: tagName,
          })
        }
      }
    }

    return Array.from(tagMap.values()).sort((left, right) => left.name.localeCompare(right.name))
  }, [activeItems, settings.tags])

  const filteredItems = useMemo(() => {
    return activeItems.filter((item) => {
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

      if (appliedFilters.tags.length > 0 && !appliedFilters.tags.every((tagId) => item.tags.includes(availableTagOptions.find((tag) => tag.id === tagId)?.name || ""))) {
        return false
      }

      if (appliedFilters.phases.length > 0 && !appliedFilters.phases.includes(item.phaseId || "")) {
        return false
      }

      return true
    })
  }, [activeItems, appliedFilters, availableTagOptions])

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
  const activeConflictIds = useMemo(
    () =>
      new Set(
        trackedConflictIds.length > 0
          ? trackedConflictIds
          : activeItems.filter((item) => item.hasConflict).map((item) => item.id),
      ),
    [activeItems, trackedConflictIds],
  )
  const ganttRowMetrics = useMemo(() => {
    const metrics = new Map<string, { startX: number; endX: number; centerY: number }>()
    let topOffset = 0

    for (const row of ganttRows) {
      if (row.type === "phase") {
        topOffset += 38
        continue
      }

      const startX = diffInDays(ganttRange.start, parseDate(row.item.startDate)) * dayWidth
      const width = (diffInDays(parseDate(row.item.startDate), parseDate(itemEndDate(row.item))) + 1) * dayWidth
      metrics.set(row.item.id, {
        startX,
        endX: startX + width,
        centerY: topOffset + 27,
      })
      topOffset += 54
    }

    return metrics
  }, [dayWidth, ganttRange.start, ganttRows])
  const ganttDependencyLines = useMemo(() => {
    return ganttItems.flatMap((item) =>
      item.predecessors
        .map((predecessor) => {
          const source = ganttRowMetrics.get(predecessor.scheduleItemId)
          const target = ganttRowMetrics.get(item.id)

          if (!source || !target) {
            return null
          }

          const startX = source.endX + 2
          const endX = Math.max(target.startX - 6, startX + 12)
          const midX = startX + Math.max((endX - startX) / 2, 16)

          return {
            key: `${predecessor.scheduleItemId}-${item.id}-${predecessor.dependencyType}`,
            path: `M ${startX} ${source.centerY} C ${midX} ${source.centerY}, ${midX} ${target.centerY}, ${endX} ${target.centerY}`,
            endX,
            endY: target.centerY,
            isConflict: activeConflictIds.has(item.id),
          }
        })
        .filter(
          (
            line,
          ): line is {
            key: string
            path: string
            endX: number
            endY: number
            isConflict: boolean
          } => line !== null,
        ),
    )
  }, [activeConflictIds, ganttItems, ganttRowMetrics])
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

  function enterDraftMode() {
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

  function handleDiscardDraft() {
    if (hasDraftChanges) {
      const confirmed = window.confirm("Discard all unpublished draft changes?")

      if (!confirmed) {
        return
      }
    }

    setScheduleOffline(false)
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
        endDate: calculateBusinessEndDate(payload.startDate, payload.workDays, workdayExceptions),
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
      resetDraftFromPersisted()
      toast.info("No draft changes to publish")
      return
    }

    setDraftPublishing(true)

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

      for (const item of createdDraftItems) {
        const payload = remapDraftPayload(schedulePayloadFromItem(item), draftIdMap, {
          dropUnresolvedPredecessors: true,
        })
        const response = await api.post<{ item: ScheduleItemRecord }>(`/jobs/${jobId}/schedule`, payload)
        draftIdMap.set(item.id, response.data.item.id)
      }

      await Promise.all([...createdDraftItems, ...changedPersistedItems].map((item) => {
        const targetId = draftIdMap.get(item.id) || item.id
        const payload = remapDraftPayload(schedulePayloadFromItem(item), draftIdMap)
        return api.put(`/schedule-items/${targetId}`, payload)
      }))

      for (const item of currentDraftItems) {
        const targetId = draftIdMap.get(item.id) || item.id
        const draftNotes = item.notesStream
          .filter((note) => isDraftScheduleNoteId(note.id))
          .map((note) => note.note.trim())
          .filter(Boolean)

        for (const note of draftNotes) {
          await api.post(`/schedule-items/${targetId}/notes`, { note })
        }
      }

      await Promise.all(deletedPersistedItems.map((item) =>
        api.delete(`/schedule-items/${item.id}`)
      ))

      setDialogOpen(false)
      setActiveItemId(null)
      setScheduleOffline(false)
      setTrackedConflictIds([])
      await refreshScheduleData()
      toast.success("Draft changes published")
    } catch (error) {
      toast.error(getApiError(error, "Failed to publish draft changes"))
    } finally {
      setDraftPublishing(false)
    }
  }

  async function handleSetBaseline() {
    if (!jobId) {
      return
    }

    try {
      const response = await api.post<{ baseline: ScheduleBaselineRecord }>(`/jobs/${jobId}/schedule/baseline`)
      setBaseline(response.data.baseline)
      toast.success("Baseline captured")
    } catch (error) {
      toast.error(getApiError(error, "Failed to set baseline"))
    }
  }

  async function handleResetBaseline() {
    if (!jobId) {
      return
    }

    try {
      await api.delete(`/jobs/${jobId}/schedule/baseline`)
      setBaseline(null)
      toast.success("Baseline removed")
    } catch (error) {
      toast.error(getApiError(error, "Failed to reset baseline"))
    }
  }

  function openNewWorkdayException() {
    if (!jobId) {
      return
    }

    setWorkdayForm(defaultExceptionForm(jobId))
    setCategoryDraft("")
    setCategoryEditorOpen(false)
    setWorkdayEditorOpen(true)
  }

  function openExistingWorkdayException(exception: ScheduleWorkdayException) {
    setWorkdayForm({
      id: exception.id,
      title: exception.title,
      type: exception.type,
      startDate: exception.startDate,
      endDate: exception.endDate,
      sameEveryYear: exception.sameEveryYear,
      categoryId: exception.categoryId,
      appliesToAllJobs: exception.appliesToAllJobs,
      jobIds: exception.jobIds,
      notes: exception.notes || "",
    })
    setCategoryDraft("")
    setCategoryEditorOpen(false)
    setWorkdayEditorOpen(true)
  }

  async function handleSaveWorkdayException() {
    if (!jobId) {
      return
    }

    setWorkdaySaving(true)

    try {
      const payload = {
        title: workdayForm.title.trim(),
        type: workdayForm.type,
        startDate: workdayForm.startDate,
        endDate: workdayForm.endDate,
        sameEveryYear: workdayForm.sameEveryYear,
        categoryId: workdayForm.categoryId,
        appliesToAllJobs: workdayForm.appliesToAllJobs,
        jobIds: workdayForm.appliesToAllJobs ? [] : workdayForm.jobIds,
        notes: workdayForm.notes.trim() || null,
      }

      if (workdayForm.id) {
        await api.put(`/jobs/${jobId}/workday-exceptions/${workdayForm.id}`, payload)
      } else {
        await api.post(`/jobs/${jobId}/workday-exceptions`, payload)
      }

      await refreshScheduleData()
      setWorkdayEditorOpen(false)
      setWorkdayForm(defaultExceptionForm(jobId))
      toast.success(workdayForm.id ? "Workday exception updated" : "Workday exception saved")
    } catch (error) {
      toast.error(getApiError(error, "Failed to save workday exception"))
    } finally {
      setWorkdaySaving(false)
    }
  }

  async function handleDeleteWorkdayException() {
    if (!jobId || !workdayForm.id) {
      return
    }

    try {
      await api.delete(`/jobs/${jobId}/workday-exceptions/${workdayForm.id}`)
      await refreshScheduleData()
      setWorkdayEditorOpen(false)
      setWorkdayForm(defaultExceptionForm(jobId))
      toast.success("Workday exception deleted")
    } catch (error) {
      toast.error(getApiError(error, "Failed to delete workday exception"))
    }
  }

  async function handleCreateCategory() {
    if (!jobId || !categoryDraft.trim()) {
      return
    }

    try {
      const response = await api.post<{ category: ScheduleSettingsOption }>(`/jobs/${jobId}/workday-exceptions/categories`, {
        name: categoryDraft.trim(),
      })
      await fetchSettings()
      setWorkdayForm((current) => ({ ...current, categoryId: response.data.category.id }))
      setCategoryDraft("")
      setCategoryEditorOpen(false)
      toast.success("Category added")
    } catch (error) {
      toast.error(getApiError(error, "Failed to add category"))
    }
  }

  async function handleSaveCategory(categoryId: string) {
    if (!jobId) {
      return
    }

    const name = editingCategories[categoryId]?.trim()

    if (!name) {
      return
    }

    try {
      await api.put(`/jobs/${jobId}/workday-exceptions/categories/${categoryId}`, { name })
      await fetchSettings()
      toast.success("Category updated")
    } catch (error) {
      toast.error(getApiError(error, "Failed to update category"))
    }
  }

  async function handleSaveSettings() {
    if (!jobId) {
      return
    }

    setSettingsSaving(true)

    try {
      await api.put(`/jobs/${jobId}/schedule/settings`, {
        defaultView: settingsForm.defaultView,
        showTimesOnMonthView: settingsForm.showTimesOnMonthView,
        showJobNameOnAllListedJobs: settingsForm.showJobNameOnAllListedJobs,
        automaticallyMarkItemsComplete: settingsForm.automaticallyMarkItemsComplete,
        includeHeaderOnPdfExports: settingsForm.includeHeaderOnPdfExports,
      })

      const existingPhases = new Map(settings.phases.map((phase) => [phase.id, phase]))

      for (const phase of settingsForm.phases) {
        if (!phase.name.trim()) {
          continue
        }

        const existing = existingPhases.get(phase.id)

        if (!existing || phase.isNew) {
          await api.post(`/jobs/${jobId}/schedule/settings/phases`, {
            name: phase.name.trim(),
            color: phase.color,
          })
          continue
        }

        if (existing.name !== phase.name.trim() || (existing.color || DEFAULT_SCHEDULE_COLOR) !== phase.color) {
          await api.put(`/jobs/${jobId}/schedule/settings/phases/${phase.id}`, {
            name: phase.name.trim(),
            color: phase.color,
          })
        }
      }

      await Promise.all([fetchSettings(), refreshScheduleData()])
      applyDefaultViewChoice(settingsForm.defaultView, setViewMode, setCalendarPeriod)
      setSettingsOpen(false)
      toast.success("Schedule settings saved")
    } catch (error) {
      toast.error(getApiError(error, "Failed to save schedule settings"))
    } finally {
      setSettingsSaving(false)
    }
  }

  async function handleTrackConflicts() {
    if (scheduleOffline) {
      const conflictIds = draftItemsRef.current
        .filter((item) => item.hasConflict)
        .map((item) => item.id)
      setTrackedConflictIds(conflictIds)
      toast.info(
        conflictIds.length === 0
          ? "No schedule conflicts found"
          : `${conflictIds.length} conflict${conflictIds.length === 1 ? "" : "s"} highlighted`,
      )
      return
    }

    if (!jobId) {
      return
    }

    try {
      const response = await api.post<{ conflicts: Array<{ id: string }>; count: number }>(
        `/jobs/${jobId}/schedule/track-conflicts`,
      )
      const conflictIds = (response.data.conflicts ?? []).map((conflict) => conflict.id)
      setTrackedConflictIds(conflictIds)
      await fetchItems()
      toast.info(
        conflictIds.length === 0
          ? "No schedule conflicts found"
          : `${response.data.count} conflict${response.data.count === 1 ? "" : "s"} highlighted`,
      )
    } catch (error) {
      toast.error(getApiError(error, "Failed to track conflicts"))
    }
  }

  async function handleNotifyAssignedUsers() {
    if (scheduleOffline) {
      toast.info("Publish draft changes before notifying assigned users")
      return
    }

    if (!jobId) {
      return
    }

    try {
      const response = await api.post<{ countUsers: number; countItems: number }>(
        `/jobs/${jobId}/schedule/notify-assigned-users`,
      )
      const countUsers = response.data.countUsers ?? 0
      const countItems = response.data.countItems ?? 0

      toast.success(
        countUsers === 0
          ? "No assigned users to notify"
          : `Queued notifications for ${countUsers} assigned user${countUsers === 1 ? "" : "s"} across ${countItems} item${countItems === 1 ? "" : "s"}`,
      )
      if (historyOpen) {
        await fetchHistory()
      }
    } catch (error) {
      toast.error(getApiError(error, "Failed to notify assigned users"))
    }
  }

  async function handleDeleteAllItems() {
    if (!activeItems.length) {
      return
    }

    const confirmed = window.confirm(
      `Delete all ${activeItems.length} schedule item${activeItems.length === 1 ? "" : "s"} for this job? This cannot be undone.`,
    )

    if (!confirmed) {
      return
    }

    if (scheduleOffline) {
      applyDraftMutation(() => [])
      setTrackedConflictIds([])
      setSelectedListIds([])
      setDialogOpen(false)
      setActiveItemId(null)
      toast.success("Draft schedule items cleared")
      return
    }

    try {
      await Promise.all(activeItems.map((item) => api.delete(`/schedule-items/${item.id}`)))
      setTrackedConflictIds([])
      setSelectedListIds([])
      setDialogOpen(false)
      setActiveItemId(null)
      await refreshScheduleData()
      toast.success("All schedule items deleted")
    } catch (error) {
      toast.error(getApiError(error, "Failed to delete all schedule items"))
    }
  }

  async function handleApplyTemplate(template: ScheduleTemplate) {
    setTemplateApplyingId(template.id)

    try {
      if (scheduleOffline) {
        applyDraftMutation((currentItems) => {
          let predecessorId: string | null = null
          const now = new Date().toISOString()
          const createdItems: ScheduleItemRecord[] = []

          for (const templateItem of template.items) {
            const nextItemId = `draft-item-${crypto.randomUUID()}`
            const nextItem: ScheduleItemRecord = {
              id: nextItemId,
              jobId: jobId ?? null,
              title: templateItem.title,
              displayColor: templateItem.displayColor || DEFAULT_SCHEDULE_COLOR,
              startDate: todayStr(),
              endDate: calculateBusinessEndDate(todayStr(), templateItem.workDays, workdayExceptions),
              workDays: templateItem.workDays,
              isHourly: false,
              startTime: null,
              endTime: null,
              progress: 0,
              reminder: "none",
              showOnGantt: true,
              visibleToEstimators: true,
              visibleToInstallers: true,
              visibleToOfficeStaff: true,
              isComplete: false,
              isPersonalTodo: false,
              notes: null,
              tags: [],
              phaseId: null,
              phaseName: null,
              phaseColor: null,
              assigneeIds: [],
              assignees: [],
              predecessors: predecessorId
                ? [
                    {
                      scheduleItemId: predecessorId,
                      dependencyType: "finish_to_start",
                      lagDays: 0,
                      title:
                        currentItems.find((candidate) => candidate.id === predecessorId)?.title
                        || createdItems.find((candidate) => candidate.id === predecessorId)?.title
                        || "Unknown task",
                    },
                  ]
                : [],
              notesStream: [],
              noteCount: 0,
              attachments: [],
              relatedTodos: [],
              relatedTodoCount: 0,
              createdBy: null,
              createdByName: "Draft",
              createdByAvatarUrl: null,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              status: "upcoming",
              hasConflict: false,
              conflictReasons: [],
            }

            predecessorId = nextItemId
            createdItems.push(nextItem)
          }

          return [...currentItems, ...createdItems]
        })
        setTemplateDialogOpen(false)
        toast.success(`${template.name} added to the draft`)
        return
      }

      if (!jobId) {
        return
      }

      let predecessorId: string | null = null

      for (const templateItem of template.items) {
        const response: { data: { item: ScheduleItemRecord } } = await api.post(`/jobs/${jobId}/schedule`, {
          title: templateItem.title,
          displayColor: templateItem.displayColor || DEFAULT_SCHEDULE_COLOR,
          assigneeIds: [],
          startDate: todayStr(),
          workDays: templateItem.workDays,
          endDate: null,
          isHourly: false,
          startTime: null,
          endTime: null,
          progress: 0,
          reminder: "none",
          notes: null,
          notifyUserIds: [],
          tags: [],
          predecessors: predecessorId
            ? [
                {
                  scheduleItemId: predecessorId,
                  dependencyType: "finish_to_start",
                  lagDays: 0,
                },
              ]
            : [],
          phaseId: null,
          showOnGantt: true,
          visibleToEstimators: true,
          visibleToInstallers: true,
          visibleToOfficeStaff: true,
          isComplete: false,
        })

        predecessorId = response.data.item.id
      }

      setTemplateDialogOpen(false)
      await refreshScheduleData()
      toast.success(`${template.name} imported`)
    } catch (error) {
      toast.error(getApiError(error, "Failed to import template"))
    } finally {
      setTemplateApplyingId(null)
    }
  }

  async function handleExport(kind: "schedule" | "baseline" | "exceptions") {
    const target =
      kind === "schedule"
        ? scheduleExportRef.current
        : kind === "baseline"
          ? baselineExportRef.current
          : exceptionsExportRef.current

    if (!target) {
      toast.error("Nothing is available to export right now")
      return
    }

    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ])
      const canvas = await html2canvas(target, {
        backgroundColor: "#ffffff",
        scale: 2,
      })
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? "landscape" : "portrait",
        unit: "px",
        format: [canvas.width, canvas.height],
      })

      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height)
      pdf.save(`cadstone-${kind}-${jobId || "job"}.pdf`)
      toast.success("PDF export ready")
    } catch (error) {
      toast.error(getApiError(error, "Failed to export PDF"))
    }
  }

  function openNewItem(startDate?: string, startTime?: string, endTime?: string) {
    setActiveItemId(null)
    setDialogInitDate(startDate ?? null)
    setDialogInitStartTime(startTime ?? null)
    setDialogInitEndTime(endTime ?? null)
    setDialogOpen(true)
  }

  function openExistingItem(itemId: string) {
    setActiveItemId(itemId)
    setDialogInitDate(null)
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
  const currentJobTitle = jobs.find((job) => job.id === jobId)?.title || "Job Schedule"
  const draftPresetValue = FILTER_PRESETS.some((preset) => preset.value === draftFilters.preset)
    ? draftFilters.preset
    : "custom"

  function runSchedulePrint() {
    const cleanup = () => {
      delete document.body.dataset.printPage
      delete document.body.dataset.printScope
    }

    document.body.dataset.printPage = "schedule"
    document.body.dataset.printScope = viewMode
    window.addEventListener("afterprint", cleanup, { once: true })
    window.print()
    window.setTimeout(cleanup, 1000)
  }

  return (
    <>
      {ganttFullscreen ? <div className="fixed inset-0 z-40 bg-slate-950/45" /> : null}

      <div className="space-y-4" data-print-root="schedule">
        <div className="hidden rounded-xl border border-[#E5E7EB] bg-white px-5 py-5 shadow-sm" data-print-only="true">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{currentJobTitle}</div>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">Schedule</h1>
          <div className="mt-2 text-sm text-slate-500">
            {section === "schedule"
              ? viewMode === "calendar"
                ? currentRangeLabel
                : viewMode === "list"
                  ? `${sortedListItems.length} item${sortedListItems.length === 1 ? "" : "s"}`
                  : `${ganttItems.length} timeline item${ganttItems.length === 1 ? "" : "s"}`
              : section === "baseline"
                ? "Baseline comparison"
                : "Workday exceptions"}
          </div>
        </div>

        <div data-print-hide="true" className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Schedule</h1>
        </div>

        <Tabs
          value={section}
          onValueChange={(value) => setSection(value as ScheduleSection)}
          className="space-y-4"
        >
          <TabsList data-print-hide="true" className="h-auto rounded-xl border border-[#E5E7EB] bg-white p-1">
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

          <TabsContent ref={scheduleExportRef} value="schedule" className="mt-0 space-y-4">
            <div data-print-hide="true" className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
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
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-[#E5E7EB] bg-white"
                    onClick={() => setTodosPanelOpen(true)}
                  >
                    <ListChecks className="size-4" />
                    My To-Do&apos;s
                    {incompleteTodoCount > 0 ? (
                      <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
                        {incompleteTodoCount}
                      </Badge>
                    ) : null}
                  </Button>
                  <div className="flex h-10 items-center gap-3 rounded-lg border border-[#E5E7EB] px-3">
                    <span className="text-sm font-medium text-slate-700">Schedule Offline</span>
                    <Switch checked={scheduleOffline} onCheckedChange={(checked) => (checked ? enterDraftMode() : handleDiscardDraft())} />
                  </div>
                  {scheduleOffline ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-[#E5E7EB] bg-white"
                        disabled={draftPast.length === 0 || draftPublishing}
                        onClick={handleDraftUndo}
                      >
                        <RotateCcw className="size-4" />
                        Undo
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-[#E5E7EB] bg-white"
                        disabled={draftFuture.length === 0 || draftPublishing}
                        onClick={handleDraftRedo}
                      >
                        <RotateCw className="size-4" />
                        Redo
                      </Button>
                    </>
                  ) : null}
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
                      <DropdownMenuItem onClick={() => setTemplateDialogOpen(true)}>
                        Import From Templates
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void handleTrackConflicts()}>
                        Track Conflicts
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={activeItems.length === 0}
                        onClick={() => void handleNotifyAssignedUsers()}
                      >
                        Notify Assigned Users
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={activeItems.length === 0} onClick={() => void handleDeleteAllItems()}>
                        Delete All Items
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExport("schedule")}>
                        Export to PDF
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={runSchedulePrint}>
                        Print
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
                      <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
                        {activeFilterCount}
                      </Badge>
                    ) : null}
                  </Button>
                  <Button type="button" size="sm" onClick={() => openNewItem()}>
                    <Plus className="size-4" />
                    New Schedule Item
                  </Button>
                  {scheduleOffline ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-[#E5E7EB] bg-white"
                        disabled={draftPublishing}
                        onClick={handleDiscardDraft}
                      >
                        Discard Draft
                      </Button>
                      <Button type="button" size="sm" disabled={draftPublishing} onClick={() => void handlePublishDraft()}>
                        {draftPublishing ? <Loader2 className="size-4 animate-spin" /> : null}
                        Publish Changes
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            {viewMode === "calendar" ? (
              <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
                <div data-print-hide="true" className="flex flex-col gap-3 border-b border-[#E5E7EB] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
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
                      title={activeItems.length === 0 ? "No schedule items yet" : "No schedule items match this filter"}
                      description={
                        activeItems.length === 0
                          ? "Add the first schedule item to start coordinating fabrication, delivery, and install work."
                          : "Adjust your filters or create another schedule item to populate this calendar."
                      }
                      actionLabel={activeItems.length === 0 ? "New Schedule Item" : "Clear Filters"}
                      onAction={
                        activeItems.length === 0
                          ? () => openNewItem()
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
                              <p className="mt-1 text-[11px] text-slate-400">Default non-workday</p>
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
                                const workday = classifyWorkday(parsedDay, workdayExceptions)

                                return (
                                  <div
                                    key={day}
                                    className={cn(
                                      "border-r border-[#E5E7EB] p-2 last:border-r-0 cursor-pointer group/cell relative hover:bg-blue-50/40 transition-colors",
                                      workday.isWorkday
                                        ? isCurrentMonth
                                          ? "bg-white"
                                          : "bg-slate-50/70"
                                        : "bg-amber-50/70",
                                    )}
                                    onClick={() => openNewItem(day)}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <span
                                        className={cn(
                                          "flex size-7 items-center justify-center rounded-full text-xs font-medium",
                                          isToday
                                            ? "bg-orange-600 text-white"
                                            : isCurrentMonth
                                            ? "text-slate-700"
                                            : "text-slate-300",
                                        )}
                                      >
                                        {parsedDay.getDate()}
                                      </span>
                                      {!workday.isWorkday || workday.type === "extra_workday" ? (
                                        <span className={cn("text-[11px]", workday.isWorkday ? "text-emerald-600" : "text-amber-600")}>
                                          {workday.label}
                                        </span>
                                      ) : null}
                                    </div>
                                    <span className="absolute bottom-1 right-1.5 text-slate-300 text-lg leading-none opacity-0 group-hover/cell:opacity-100 transition-opacity">+</span>
                                  </div>
                                )
                              })}

                              <div className="pointer-events-none absolute inset-x-0 top-10 bottom-2">
                                {visibleSegments.map((segment) => (
                                  <button
                                    key={`${segment.item.id}-${segment.startIndex}-${segment.endIndex}-${segment.lane}`}
                                    type="button"
                                    className={cn(
                                      "pointer-events-auto absolute flex h-7 items-center overflow-hidden rounded-full px-3 text-left text-xs font-medium shadow-sm transition hover:opacity-95",
                                      segment.item.isPersonalTodo
                                        ? "border-2 border-dashed text-slate-700"
                                        : "text-white",
                                      activeConflictIds.has(segment.item.id) && "ring-2 ring-rose-200",
                                    )}
                                    style={{
                                      backgroundColor: segment.item.isPersonalTodo
                                        ? colorWithAlpha(segment.item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                                        : segment.item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                      borderColor: segment.item.isPersonalTodo
                                        ? (segment.item.displayColor || DEFAULT_SCHEDULE_COLOR)
                                        : undefined,
                                      left: `calc(${(segment.startIndex / 7) * 100}% + 4px)`,
                                      width: `calc(${((segment.endIndex - segment.startIndex + 1) / 7) * 100}% - 8px)`,
                                      top: `${segment.lane * 30}px`,
                                    }}
                                    onClick={() => openExistingItem(segment.item.id)}
                                  >
                                    <span className="truncate">
                                      {segment.item.isPersonalTodo ? (segment.item.isComplete ? "☑ " : "☐ ") : segment.item.isComplete ? "✓ " : ""}
                                      {segment.item.title}
                                    </span>
                                  </button>
                                ))}

                                {hiddenCount > 0 ? (
                                  <button
                                    type="button"
                                    className="pointer-events-auto absolute bottom-0 right-3 text-[11px] font-medium text-orange-600 hover:text-orange-700 cursor-pointer"
                                    onClick={() => {
                                      let bestDay = week[0]
                                      let bestCount = 0
                                      for (const day of week) {
                                        const dayItemCount = filteredItems.filter((item) => itemOverlapsDateRange(item, day, day)).length
                                        if (dayItemCount > bestCount) {
                                          bestCount = dayItemCount
                                          bestDay = day
                                        }
                                      }
                                      setCalendarPeriod("day")
                                      setCalendarAnchorDate(parseDate(bestDay))
                                    }}
                                  >
                                    +{hiddenCount} more item{hiddenCount === 1 ? "" : "s"}
                                  </button>
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
                          const workday = classifyWorkday(day, workdayExceptions)

                          return (
                            <div key={dayKey} className="border-r border-[#E5E7EB] p-3 last:border-r-0">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-semibold text-slate-900">
                                  {new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(day)}
                                </p>
                                <span
                                  className={cn(
                                    "flex size-7 items-center justify-center rounded-full text-xs font-medium",
                                    isToday ? "bg-orange-600 text-white" : "text-slate-600",
                                  )}
                                >
                                  {day.getDate()}
                                </span>
                              </div>
                              {!workday.isWorkday || workday.type === "extra_workday" ? (
                                <p className={cn("mt-1 text-[11px]", workday.isWorkday ? "text-emerald-600" : "text-amber-600")}>
                                  {workday.label}
                                </p>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>

                      {/* All-day items row */}
                      {(() => {
                        const weekStart = startOfWeek(calendarAnchorDate)
                        const weekAllDayItems = Array.from({ length: 7 }).map((_, index) => {
                          const day = addDays(weekStart, index)
                          const dk = dateKey(day)
                          return {
                            dayKey: dk,
                            items: filteredItems.filter((item) => !item.isHourly && itemOverlapsDateRange(item, dk, dk)),
                          }
                        })
                        const hasAnyAllDay = weekAllDayItems.some((d) => d.items.length > 0)
                        return hasAnyAllDay ? (
                          <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-[#E5E7EB]">
                            <div className="border-r border-[#E5E7EB] bg-[#F8FAFC] px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 flex items-start justify-end">
                              All Day
                            </div>
                            {weekAllDayItems.map(({ dayKey: dk, items: dayItems }) => (
                              <div key={dk} className="border-r border-[#E5E7EB] last:border-r-0 px-1 py-1.5 space-y-1">
                                {dayItems.map((item) => (
                                  <button
                                    key={item.id}
                                    type="button"
                                    className={cn(
                                      "flex w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm hover:opacity-90 transition-opacity truncate",
                                      item.isPersonalTodo ? "border-dashed text-slate-700" : "text-white",
                                    )}
                                    style={{
                                      backgroundColor: item.isPersonalTodo
                                        ? colorWithAlpha(item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                                        : item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                      borderColor: item.isPersonalTodo
                                        ? (item.displayColor || DEFAULT_SCHEDULE_COLOR)
                                        : colorWithAlpha(item.displayColor, 0.75),
                                    }}
                                    onClick={() => openExistingItem(item.id)}
                                  >
                                    <span className="truncate">
                                      {item.isPersonalTodo ? (item.isComplete ? "☑ " : "☐ ") : ""}
                                      {item.title}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                        ) : null
                      })()}

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
                          const dk = dateKey(day)
                          const segments = buildDayTimelineSegments(dk, filteredItems.filter((item) => item.isHourly))
                          const workday = classifyWorkday(day, workdayExceptions)

                          return (
                            <div
                              key={dk}
                              className="relative border-r border-[#E5E7EB] last:border-r-0"
                              style={{ height: `${(DAY_END_HOUR - DAY_START_HOUR + 1) * HOUR_HEIGHT}px` }}
                            >
                              {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }).map((_, hourIndex) => (
                                <div
                                  key={hourIndex}
                                  className={cn(
                                    "h-14 border-b border-[#E5E7EB] last:border-b-0 hover:bg-blue-50/50 cursor-pointer transition-colors",
                                    !workday.isWorkday && "bg-amber-50/50",
                                  )}
                                  onClick={() => {
                                    const hour = DAY_START_HOUR + hourIndex
                                    const startTime = `${String(hour).padStart(2, "0")}:00`
                                    const endTime = `${String(hour + 1).padStart(2, "0")}:00`
                                    openNewItem(dk, startTime, endTime)
                                  }}
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
                                    className={cn(
                                      "absolute overflow-hidden rounded-xl border px-2 py-1 text-left text-xs font-medium shadow-sm",
                                      segment.item.isPersonalTodo
                                        ? "border-dashed text-slate-700"
                                        : "text-white",
                                      activeConflictIds.has(segment.item.id) && "ring-2 ring-rose-200",
                                    )}
                                    style={{
                                      top,
                                      height,
                                      width,
                                      left,
                                      backgroundColor: segment.item.isPersonalTodo
                                        ? colorWithAlpha(segment.item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                                        : segment.item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                      borderColor: segment.item.isPersonalTodo
                                        ? (segment.item.displayColor || DEFAULT_SCHEDULE_COLOR)
                                        : colorWithAlpha(segment.item.displayColor, 0.75),
                                    }}
                                    onClick={() => openExistingItem(segment.item.id)}
                                  >
                                    <span className="block truncate">
                                      {segment.item.isPersonalTodo ? (segment.item.isComplete ? "☑ " : "☐ ") : ""}
                                      {segment.item.title}
                                    </span>
                                    <span className={cn("block truncate text-[10px]", segment.item.isPersonalTodo ? "text-slate-500" : "text-white/80")}>
                                      {segment.item.isHourly && segment.item.startTime
                                        ? fmtClockRange(segment.item.startTime, segment.item.endTime)
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
                            {(() => {
                              const workday = classifyWorkday(calendarAnchorDate, workdayExceptions)
                              return !workday.isWorkday || workday.type === "extra_workday" ? (
                                <p className={cn("text-[11px]", workday.isWorkday ? "text-emerald-600" : "text-amber-600")}>
                                  {workday.label}
                                </p>
                              ) : null
                            })()}
                          </div>
                          {dateKey(calendarAnchorDate) === todayIso ? (
                            <span className="flex size-8 items-center justify-center rounded-full bg-orange-600 text-xs font-semibold text-white">
                              {calendarAnchorDate.getDate()}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* All-day items bar */}
                      {(() => {
                        const dayAllDayItems = filteredItems.filter((item) => !item.isHourly && itemOverlapsDateRange(item, dateKey(calendarAnchorDate), dateKey(calendarAnchorDate)))
                        return dayAllDayItems.length > 0 ? (
                          <div className="border-b border-[#E5E7EB] bg-slate-50/50 px-4 py-2">
                            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">All Day</p>
                            <div className="flex flex-wrap gap-1.5">
                              {dayAllDayItems.map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  className={cn(
                                    "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium shadow-sm hover:opacity-90 transition-opacity",
                                    item.isPersonalTodo ? "border-dashed text-slate-700" : "text-white",
                                  )}
                                  style={{
                                    backgroundColor: item.isPersonalTodo
                                      ? colorWithAlpha(item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                                      : item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                    borderColor: item.isPersonalTodo
                                      ? (item.displayColor || DEFAULT_SCHEDULE_COLOR)
                                      : colorWithAlpha(item.displayColor, 0.75),
                                  }}
                                  onClick={() => openExistingItem(item.id)}
                                >
                                  <span className="truncate max-w-[200px]">
                                    {item.isPersonalTodo ? (item.isComplete ? "☑ " : "☐ ") : ""}
                                    {item.title}
                                  </span>
                                  <span className={cn(item.isPersonalTodo ? "text-slate-500" : "text-white/70")}>({item.workDays}d)</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null
                      })()}

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
                            !classifyWorkday(calendarAnchorDate, workdayExceptions).isWorkday && "bg-amber-50/50",
                          )}
                          style={{ height: `${(DAY_END_HOUR - DAY_START_HOUR + 1) * HOUR_HEIGHT}px` }}
                        >
                          {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }).map((_, hourIndex) => (
                            <div
                              key={hourIndex}
                              className="h-14 border-b border-[#E5E7EB] last:border-b-0 hover:bg-blue-50/50 cursor-pointer transition-colors"
                              onClick={() => {
                                const hour = DAY_START_HOUR + hourIndex
                                const startTime = `${String(hour).padStart(2, "0")}:00`
                                const endTime = `${String(hour + 1).padStart(2, "0")}:00`
                                openNewItem(dateKey(calendarAnchorDate), startTime, endTime)
                              }}
                            />
                          ))}

                          {buildDayTimelineSegments(dateKey(calendarAnchorDate), filteredItems.filter((item) => item.isHourly)).map((segment) => {
                            const top = (segment.startHour - DAY_START_HOUR) * HOUR_HEIGHT + 6
                            const height = Math.max((segment.endHour - segment.startHour) * HOUR_HEIGHT - 10, 34)
                            const width = `calc(${100 / segment.laneCount}% - 12px)`
                            const left = `calc(${segment.lane * (100 / segment.laneCount)}% + 6px)`

                            return (
                              <button
                                key={`${segment.item.id}-${segment.lane}`}
                                type="button"
                                className={cn(
                                  "absolute overflow-hidden rounded-xl border px-3 py-2 text-left text-sm font-medium shadow-sm",
                                  segment.item.isPersonalTodo
                                    ? "border-dashed text-slate-700"
                                    : "text-white",
                                  activeConflictIds.has(segment.item.id) && "ring-2 ring-rose-200",
                                )}
                                style={{
                                  top,
                                  height,
                                  width,
                                  left,
                                  backgroundColor: segment.item.isPersonalTodo
                                    ? colorWithAlpha(segment.item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                                    : segment.item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                  borderColor: segment.item.isPersonalTodo
                                    ? (segment.item.displayColor || DEFAULT_SCHEDULE_COLOR)
                                    : colorWithAlpha(segment.item.displayColor, 0.75),
                                }}
                                onClick={() => openExistingItem(segment.item.id)}
                              >
                                <span className="block truncate">
                                  {segment.item.isPersonalTodo ? (segment.item.isComplete ? "☑ " : "☐ ") : ""}
                                  {segment.item.title}
                                </span>
                                <span className={cn("mt-1 block text-xs", segment.item.isPersonalTodo ? "text-slate-500" : "text-white/80")}>
                                  {segment.item.isHourly && segment.item.startTime
                                    ? fmtClockRange(segment.item.startTime, segment.item.endTime)
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
                                    className={cn("size-2.5 rounded-full", item.isPersonalTodo && "border border-dashed")}
                                    style={{
                                      backgroundColor: item.isPersonalTodo
                                        ? colorWithAlpha(item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                                        : item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                      borderColor: item.isPersonalTodo ? (item.displayColor || DEFAULT_SCHEDULE_COLOR) : undefined,
                                    }}
                                  />
                                  <span className="truncate font-medium text-slate-900">
                                    {item.isPersonalTodo ? (item.isComplete ? "☑ " : "☐ ") : ""}
                                    {item.title}
                                  </span>
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
                <div data-print-hide="true" className="flex flex-col gap-3 border-b border-[#E5E7EB] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
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
                      title={activeItems.length === 0 ? "No schedule items yet" : "No schedule items match this filter"}
                      description={
                        activeItems.length === 0
                          ? "Create the first schedule item to populate this table."
                          : "Adjust the active filter to see matching schedule items here."
                      }
                      actionLabel={activeItems.length === 0 ? "New Schedule Item" : "Clear Filters"}
                      onAction={
                        activeItems.length === 0
                          ? () => openNewItem()
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
                              <SortableHead label="Files" sortKey="files" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {groupedListItems.map((group) => (
                              <Fragment key={group.label}>
                                {listDisplayMode === "phases" ? (
                                  <TableRow className="hover:bg-white">
                                    <TableCell colSpan={10} className="bg-slate-50 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                                      {group.label}
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                                {group.items.map((item) => (
                                  <TableRow
                                    key={item.id}
                                    className={cn(
                                      "hover:bg-slate-50",
                                      activeConflictIds.has(item.id) && "bg-rose-50/60",
                                    )}
                                  >
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
                                          className={cn("mt-1 size-2.5 shrink-0 rounded-full", item.isPersonalTodo && "border border-dashed")}
                                          style={{
                                            backgroundColor: item.isPersonalTodo
                                              ? colorWithAlpha(item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                                              : item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                            borderColor: item.isPersonalTodo ? (item.displayColor || DEFAULT_SCHEDULE_COLOR) : undefined,
                                          }}
                                        />
                                        <span className="min-w-0">
                                          <span className="block truncate font-medium text-orange-700 hover:underline">
                                            {item.isPersonalTodo ? (item.isComplete ? "☑ " : "☐ ") : ""}
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
                <div data-print-hide="true" className="flex flex-col gap-3 border-b border-[#E5E7EB] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
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
                      title={activeItems.length === 0 ? "No gantt items yet" : "No gantt items match this filter"}
                      description={
                        activeItems.length === 0
                          ? "Create a schedule item with Show on Gantt enabled to build the job timeline."
                          : "Adjust the current filters or enable Show on Gantt on more schedule items."
                      }
                      actionLabel={activeItems.length === 0 ? "New Schedule Item" : "Clear Filters"}
                      onAction={
                        activeItems.length === 0
                          ? () => openNewItem()
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
                                    className={cn(
                                      "grid w-full grid-cols-[minmax(0,1fr)_108px_88px_72px_72px] items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50",
                                      activeConflictIds.has(row.item.id) && "bg-rose-50/60",
                                    )}
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
                                          style={{ backgroundColor: (ganttShowPhases ? row.item.phaseColor : null) || row.item.displayColor || DEFAULT_SCHEDULE_COLOR }}
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
                                    <div className="size-3 rotate-45 bg-orange-600" />
                                  </div>
                                </div>
                              </div>

                              <div className="relative">
                                <div
                                  className="pointer-events-none absolute inset-y-0 z-10 w-px bg-orange-500/60"
                                  style={{ left: `${todayOffsetPx}px` }}
                                />
                                <svg className="pointer-events-none absolute inset-0 z-10 overflow-visible">
                                  {ganttDependencyLines.map((line) => (
                                    <Fragment key={line.key}>
                                      <path
                                        d={line.path}
                                        fill="none"
                                        stroke={line.isConflict ? "#dc2626" : "#64748b"}
                                        strokeWidth="2"
                                        strokeDasharray={line.isConflict ? "4 4" : undefined}
                                      />
                                      <path
                                        d={`M ${line.endX} ${line.endY} l -6 -4 l 0 8 z`}
                                        fill={line.isConflict ? "#dc2626" : "#64748b"}
                                      />
                                    </Fragment>
                                  ))}
                                </svg>

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
                                          activeConflictIds.has(row.item.id) && "border-rose-500 ring-2 ring-rose-200",
                                        )}
                                        style={{
                                          left: `${diffInDays(ganttRange.start, parseDate(row.item.startDate)) * dayWidth}px`,
                                          width: `${(diffInDays(parseDate(row.item.startDate), parseDate(itemEndDate(row.item))) + 1) * dayWidth}px`,
                                          height: "28px",
                                          backgroundColor: colorWithAlpha((ganttShowPhases ? row.item.phaseColor : null) || row.item.displayColor, 0.18),
                                        }}
                                      >
                                        <div
                                          className="h-full"
                                          style={{
                                            width: `${Math.max(0, Math.min(100, row.item.progress ?? 0))}%`,
                                            backgroundColor: (ganttShowPhases ? row.item.phaseColor : null) || row.item.displayColor || DEFAULT_SCHEDULE_COLOR,
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

                      <div data-print-hide="true" className="flex flex-col gap-3 border-t border-[#E5E7EB] bg-orange-50/70 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Try Draft mode. Make changes confidently with features like undo and redo.</p>
                        </div>
                        <Button
                          type="button"
                          className="sm:w-auto"
                          disabled={scheduleOffline}
                          onClick={enterDraftMode}
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

          <TabsContent ref={baselineExportRef} value="baseline" className="mt-0">
            <div className="space-y-4">
              <div data-print-hide="true" className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-wrap items-center gap-2" />

                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white" onClick={() => setSettingsOpen(true)}>
                      <Settings2 className="size-4" />
                    </Button>
                    <div className="flex h-10 items-center gap-3 rounded-lg border border-[#E5E7EB] px-3">
                      <span className="text-sm font-medium text-slate-700">Schedule Offline</span>
                      <Switch checked={scheduleOffline} onCheckedChange={(checked) => (checked ? enterDraftMode() : handleDiscardDraft())} />
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white">
                          <MoreHorizontal className="size-4" />
                          More Actions
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem disabled={!baseline} onClick={() => void handleResetBaseline()}>
                          Reset Baseline
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white">
                          <Download className="size-4" />
                          Export
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleExport("baseline")}>Export CSV</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExport("baseline")}>Export PDF</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white" onClick={() => setFilterOpen(true)}>
                      <Filter className="size-4" />
                      Filter
                    </Button>
                    <Button type="button" size="sm" onClick={() => void handleSetBaseline()}>
                      <Plus className="size-4" />
                      Set Baseline
                    </Button>
                  </div>
                </div>
              </div>

              {!baseline ? (
                <EmptyState
                  title="Perfect your schedule with baseline"
                  description="Take a snapshot of your ideal project schedule and compare to timeline changes to improve planning of future projects."
                  actionLabel="Set Baseline"
                  onAction={() => void handleSetBaseline()}
                />
              ) : (
                <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
                  <div className="border-b border-[#E5E7EB] px-6 py-5">
                    <p className="text-sm font-semibold text-slate-900">Baseline comparison</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Captured {fmtDateTime(baseline.capturedAt)} by {baseline.capturedByName || "System"}
                    </p>
                  </div>
                  <div className="p-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item Title</TableHead>
                          <TableHead>Baseline Start</TableHead>
                          <TableHead>Baseline End</TableHead>
                          <TableHead>Current Start</TableHead>
                          <TableHead>Current End</TableHead>
                          <TableHead>Shift</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {baseline.items.map((item) => (
                          <TableRow key={item.scheduleItemId}>
                            <TableCell className="font-medium text-slate-900">{item.title}</TableCell>
                            <TableCell>{fmtDate(item.baselineStartDate)}</TableCell>
                            <TableCell>{fmtDate(item.baselineEndDate)}</TableCell>
                            <TableCell>{fmtDate(item.currentStartDate)}</TableCell>
                            <TableCell>{fmtDate(item.currentEndDate)}</TableCell>
                            <TableCell>
                              <Badge
                                className={cn(
                                  "border-0",
                                  item.shiftDays === 0 && "bg-emerald-100 text-emerald-700",
                                  item.shiftDays > 0 && "bg-rose-100 text-rose-700",
                                  item.shiftDays < 0 && "bg-amber-100 text-amber-700",
                                )}
                              >
                                {item.shiftDays === 0
                                  ? "On track"
                                  : `${item.shiftDays > 0 ? "+" : ""}${item.shiftDays} day${Math.abs(item.shiftDays) === 1 ? "" : "s"}`}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent ref={exceptionsExportRef} value="workday-exceptions" className="mt-0">
            <div className="space-y-4">
              <div data-print-hide="true" className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-wrap items-center gap-2" />

                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white" onClick={() => setSettingsOpen(true)}>
                      <Settings2 className="size-4" />
                    </Button>
                    <div className="flex h-10 items-center gap-3 rounded-lg border border-[#E5E7EB] px-3">
                      <span className="text-sm font-medium text-slate-700">Schedule Offline</span>
                      <Switch checked={scheduleOffline} onCheckedChange={(checked) => (checked ? enterDraftMode() : handleDiscardDraft())} />
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white">
                          <Download className="size-4" />
                          Export
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleExport("exceptions")}>Export CSV</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExport("exceptions")}>Export PDF</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white" onClick={() => setFilterOpen(true)}>
                      <Filter className="size-4" />
                      Filter
                    </Button>
                    <Button type="button" size="sm" onClick={openNewWorkdayException}>
                      <Plus className="size-4" />
                      Workday Exception
                    </Button>
                  </div>
                </div>
              </div>

              {workdayEditorOpen ? (
                <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
                  <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-6 py-5">
                    <div>
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 text-sm font-medium text-orange-700 hover:underline"
                        onClick={() => {
                          setWorkdayEditorOpen(false)
                          if (jobId) {
                            setWorkdayForm(defaultExceptionForm(jobId))
                          }
                        }}
                      >
                        <ArrowLeft className="size-4" />
                        Back to Workday Exceptions
                      </button>
                      <h2 className="mt-3 text-lg font-semibold text-slate-900">
                        {workdayForm.id ? "Edit Workday Exception" : "Add Workday Exception"}
                      </h2>
                    </div>
                    <div className="flex items-center gap-2">
                      {workdayForm.id ? (
                        <Button type="button" variant="outline" className="border-rose-200 text-rose-700" onClick={() => void handleDeleteWorkdayException()}>
                          Delete
                        </Button>
                      ) : null}
                      <Button type="button" variant="ghost" onClick={() => setWorkdayEditorOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="button" disabled={workdaySaving} onClick={() => void handleSaveWorkdayException()}>
                        {workdaySaving ? <Loader2 className="size-4 animate-spin" /> : null}
                        Save
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-6 px-6 py-6">
                    <div className="grid gap-6 lg:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="workday-title">Title</Label>
                        <Input
                          id="workday-title"
                          value={workdayForm.title}
                          placeholder="Company Holiday"
                          onChange={(event) => setWorkdayForm((current) => ({ ...current, title: event.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <RadioGroup
                          value={workdayForm.type}
                          onValueChange={(value) => setWorkdayForm((current) => ({ ...current, type: value as WorkdayExceptionForm["type"] }))}
                          className="grid gap-3 md:grid-cols-2"
                        >
                          <label className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] px-3 py-3">
                            <RadioGroupItem value="non_workday" />
                            <span className="text-sm text-slate-700">Non workday</span>
                          </label>
                          <label className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] px-3 py-3">
                            <RadioGroupItem value="extra_workday" />
                            <span className="text-sm text-slate-700">Extra workday</span>
                          </label>
                        </RadioGroup>
                      </div>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="workday-start">Start date</Label>
                        <Input
                          id="workday-start"
                          type="date"
                          value={workdayForm.startDate}
                          onChange={(event) => setWorkdayForm((current) => ({ ...current, startDate: event.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="workday-end">End date</Label>
                        <Input
                          id="workday-end"
                          type="date"
                          value={workdayForm.endDate}
                          onChange={(event) => setWorkdayForm((current) => ({ ...current, endDate: event.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">Same every year</p>
                        <p className="text-xs text-slate-500">Repeat this exception annually on the same dates.</p>
                      </div>
                      <Switch
                        checked={workdayForm.sameEveryYear}
                        onCheckedChange={(checked) => setWorkdayForm((current) => ({ ...current, sameEveryYear: checked }))}
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <Label>Category</Label>
                        <div className="flex items-center gap-2">
                          <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white" onClick={() => setCategoryEditorOpen((current) => !current)}>
                            <Plus className="size-4" />
                          </Button>
                          <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white" onClick={() => setCategoryEditorOpen((current) => !current)}>
                            <Edit3 className="size-4" />
                          </Button>
                        </div>
                      </div>
                      <Select
                        value={workdayForm.categoryId || "__none__"}
                        onValueChange={(value) => setWorkdayForm((current) => ({ ...current, categoryId: value === "__none__" ? null : value }))}
                      >
                        <SelectTrigger className="border-[#E5E7EB]">
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No category</SelectItem>
                          {(settings.workdayExceptionCategories ?? []).map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {categoryEditorOpen ? (
                        <div className="space-y-3 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-4">
                          <div className="flex gap-2">
                            <Input
                              value={categoryDraft}
                              placeholder="New category"
                              onChange={(event) => setCategoryDraft(event.target.value)}
                            />
                            <Button type="button" onClick={() => void handleCreateCategory()}>
                              Save
                            </Button>
                          </div>
                          {(settings.workdayExceptionCategories ?? []).map((category) => (
                            <div key={category.id} className="flex gap-2">
                              <Input
                                value={editingCategories[category.id] ?? category.name}
                                onChange={(event) =>
                                  setEditingCategories((current) => ({
                                    ...current,
                                    [category.id]: event.target.value,
                                  }))
                                }
                              />
                              <Button type="button" variant="outline" onClick={() => void handleSaveCategory(category.id)}>
                                Save
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-3">
                      <Label>Apply exception to</Label>
                      <RadioGroup
                        value={workdayForm.appliesToAllJobs ? "all" : "specific"}
                        onValueChange={(value) =>
                          setWorkdayForm((current) => ({
                            ...current,
                            appliesToAllJobs: value === "all",
                            jobIds: value === "all" ? [] : current.jobIds.length > 0 ? current.jobIds : jobId ? [jobId] : [],
                          }))
                        }
                        className="grid gap-3 md:grid-cols-2"
                      >
                        <label className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] px-3 py-3">
                          <RadioGroupItem value="all" />
                          <span className="text-sm text-slate-700">All jobs</span>
                        </label>
                        <label className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] px-3 py-3">
                          <RadioGroupItem value="specific" />
                          <span className="text-sm text-slate-700">Specific jobs</span>
                        </label>
                      </RadioGroup>
                    </div>

                    {!workdayForm.appliesToAllJobs ? (
                      <div className="space-y-2">
                        <Label>Jobs</Label>
                        <MultiSelectPopover
                          placeholder="Select jobs"
                          options={jobs.map((job) => ({ id: job.id, name: job.title }))}
                          selected={workdayForm.jobIds}
                          onChange={(next) => setWorkdayForm((current) => ({ ...current, jobIds: next }))}
                        />
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="workday-notes">Notes</Label>
                        <span className="text-xs text-slate-400">{workdayForm.notes.length}/500</span>
                      </div>
                      <Textarea
                        id="workday-notes"
                        rows={5}
                        value={workdayForm.notes}
                        onChange={(event) => setWorkdayForm((current) => ({ ...current, notes: event.target.value.slice(0, 500) }))}
                      />
                    </div>
                  </div>
                </div>
              ) : workdayExceptions.length === 0 ? (
                <EmptyState
                  title="Plan for any circumstance with workday exceptions"
                  description="Schedule days off or plan for work outside of the usual weekdays to keep projects on time."
                  actionLabel="Add a Workday Exception"
                  onAction={openNewWorkdayException}
                />
              ) : (
                <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
                  <div className="border-b border-[#E5E7EB] px-6 py-5">
                    <p className="text-sm font-semibold text-slate-900">Workday exceptions</p>
                    <p className="mt-1 text-sm text-slate-500">Click an exception to edit its schedule impact and scope.</p>
                  </div>
                  <div className="p-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Title</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Start Date</TableHead>
                          <TableHead>End Date</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Applies To</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {workdayExceptions.map((exception) => (
                          <TableRow key={exception.id} className="cursor-pointer hover:bg-slate-50" onClick={() => openExistingWorkdayException(exception)}>
                            <TableCell className="font-medium text-orange-700">{exception.title}</TableCell>
                            <TableCell>{exception.type === "non_workday" ? "Non workday" : "Extra workday"}</TableCell>
                            <TableCell>{fmtDate(exception.startDate)}</TableCell>
                            <TableCell>{fmtDate(exception.endDate)}</TableCell>
                            <TableCell>{exception.categoryName || "—"}</TableCell>
                            <TableCell>
                              {exception.appliesToAllJobs
                                ? "All jobs"
                                : exception.jobIds
                                    .map((scopeJobId) => jobs.find((job) => job.id === scopeJobId)?.title || "Unknown job")
                                    .join(", ")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-w-3xl border-[#E5E7EB] bg-white">
          <DialogHeader>
            <DialogTitle>Import From Templates</DialogTitle>
            <DialogDescription>
              Apply a pre-built schedule template to create the first pass of this job timeline.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            {SCHEDULE_TEMPLATES.map((template) => (
              <div key={template.id} className="rounded-2xl border border-[#E5E7EB] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{template.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">{template.description}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={templateApplyingId !== null}
                    onClick={() => void handleApplyTemplate(template)}
                  >
                    {templateApplyingId === template.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                  </Button>
                </div>
                <div className="mt-4 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                  {template.items.length} schedule item{template.items.length === 1 ? "" : "s"}
                </div>
                <div className="mt-3 space-y-2">
                  {template.items.map((item) => (
                    <div key={`${template.id}-${item.title}`} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      <span>{item.title}</span>
                      <span>{item.workDays} day{item.workDays === 1 ? "" : "s"}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-4xl border-[#E5E7EB] bg-white">
          <DialogHeader>
            <DialogTitle>Schedule Settings</DialogTitle>
            <DialogDescription>
              Configure default schedule viewing and phase management for this job.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-2">
                <Label>Default view</Label>
                <Select
                  value={settingsForm.defaultView}
                  onValueChange={(value) =>
                    setSettingsForm((current) => ({
                      ...current,
                      defaultView: value as ScheduleViewModeDefault,
                    }))
                  }
                >
                  <SelectTrigger className="border-[#E5E7EB]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULE_DEFAULT_VIEW_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-[#E5E7EB] p-4">
              {[
                {
                  key: "showTimesOnMonthView",
                  label: "Show times for hourly items on Calendar - Month view",
                },
                {
                  key: "showJobNameOnAllListedJobs",
                  label: "Show job name on Calendar for All Listed Jobs",
                },
                {
                  key: "automaticallyMarkItemsComplete",
                  label: "Automatically mark items complete",
                },
                {
                  key: "includeHeaderOnPdfExports",
                  label: "Include header on schedule PDF exports",
                },
              ].map((option) => (
                <label key={option.key} className="flex items-center gap-3">
                  <Checkbox
                    checked={settingsForm[option.key as keyof ScheduleSettingsForm] as boolean}
                    onCheckedChange={(checked) =>
                      setSettingsForm((current) => ({
                        ...current,
                        [option.key]: checked === true,
                      }))
                    }
                  />
                  <span className="text-sm text-slate-700">{option.label}</span>
                </label>
              ))}
            </div>

            <div className="space-y-4 rounded-xl border border-[#E5E7EB] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Phases Management</h3>
                  <p className="mt-1 text-sm text-slate-500">Phases appear in schedule items, filters, list grouping, and Gantt coloring.</p>
                </div>
                <Button
                  type="button"
                  onClick={() =>
                    setSettingsForm((current) => ({
                      ...current,
                      phases: [
                        ...current.phases,
                        {
                          id: `new-${Date.now()}`,
                          name: "",
                          color: SCHEDULE_COLOR_OPTIONS[3]?.value || DEFAULT_SCHEDULE_COLOR,
                          isNew: true,
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="size-4" />
                  Add Phase
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Phase Name</TableHead>
                    <TableHead>Color</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settingsForm.phases.map((phase) => (
                    <TableRow key={phase.id}>
                      <TableCell>
                        <Input
                          value={phase.name}
                          onChange={(event) =>
                            setSettingsForm((current) => ({
                              ...current,
                              phases: current.phases.map((entry) =>
                                entry.id === phase.id
                                  ? { ...entry, name: event.target.value }
                                  : entry,
                              ),
                            }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={phase.color}
                          onValueChange={(value) =>
                            setSettingsForm((current) => ({
                              ...current,
                              phases: current.phases.map((entry) =>
                                entry.id === phase.id
                                  ? { ...entry, color: value }
                                  : entry,
                              ),
                            }))
                          }
                        >
                          <SelectTrigger className="w-[220px] border-[#E5E7EB]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SCHEDULE_COLOR_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                <div className="flex items-center gap-2">
                                  <span className="size-3 rounded-full" style={{ backgroundColor: option.value }} />
                                  {option.label}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end">
              <Button type="button" disabled={settingsSaving} onClick={() => void handleSaveSettings()}>
                {settingsSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
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
                    const changes = getActivityEntryChanges(entry.metadata)

                    return (
                      <div key={entry.id} className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">{description}</p>
                            <p className="mt-1 text-sm text-slate-500">
                              {entry.userName || "System"} • {fmtDateTime(entry.createdAt)}
                            </p>
                            {changes.length > 0 ? (
                              <div className="mt-3 space-y-2 rounded-lg bg-slate-50 px-3 py-3">
                                {changes.map((change) => (
                                  <div key={`${entry.id}-${change.field}`} className="text-sm text-slate-600">
                                    <span className="font-medium text-slate-900">{change.label}:</span>{" "}
                                    <span className="text-slate-500">{change.from}</span>{" "}
                                    <span aria-hidden="true">→</span>{" "}
                                    <span className="text-slate-900">{change.to}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
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
                    options={availableTagOptions}
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

      <Sheet open={todosPanelOpen} onOpenChange={setTodosPanelOpen}>
        <SheetContent side="right" className="w-full max-w-xl border-[#E5E7EB] bg-white p-0 sm:max-w-xl">
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-[#E5E7EB] px-6 py-5">
              <SheetTitle>My To-Do&apos;s</SheetTitle>
              <SheetDescription>Personal to-do items for this job. Only visible to you.</SheetDescription>
            </SheetHeader>
            <ScrollArea className="flex-1">
              <div className="space-y-5 p-6">
                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">What needs to be done?</label>
                    <Input
                      value={todoTitle}
                      onChange={(e) => setTodoTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleAddPersonalTodo() }}
                      placeholder="e.g. Pick up materials from supplier"
                      className="h-10"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600">Due date</label>
                      <Input
                        type="date"
                        value={todoDueDate}
                        onChange={(e) => setTodoDueDate(e.target.value)}
                        className="h-9 text-sm"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600">When</label>
                      <Select
                        value={todoScheduleMode === "specific" ? "_specific" : (todoTimeOfDay || "_none")}
                        onValueChange={(v) => {
                          if (v === "_specific") {
                            setTodoScheduleMode("specific")
                            setTodoTimeOfDay("")
                          } else {
                            setTodoScheduleMode("preset")
                            setTodoSpecificTime("")
                            setTodoTimeOfDay(v === "_none" ? "" : v)
                          }
                        }}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Anytime" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Anytime</SelectItem>
                          <SelectItem value="First thing in the morning">Morning (7 - 9 AM)</SelectItem>
                          <SelectItem value="Midday">Midday (11 AM - 1 PM)</SelectItem>
                          <SelectItem value="End of day">End of day (3 - 5 PM)</SelectItem>
                          <SelectItem value="_specific">Pick a specific time...</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {todoScheduleMode === "specific" && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600">Specific time</label>
                      <Input
                        type="time"
                        value={todoSpecificTime}
                        onChange={(e) => setTodoSpecificTime(e.target.value)}
                        className="h-9 w-36 text-sm"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button size="sm" variant="ghost" onClick={resetTodoForm} disabled={todoSaving}>
                      Clear
                    </Button>
                    <Button size="sm" onClick={() => void handleAddPersonalTodo()} disabled={!todoTitle.trim() || todoSaving}>
                      {todoSaving ? "Saving..." : "Add To-Do"}
                    </Button>
                  </div>
                </div>

                {myTodos.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    <ListChecks className="mx-auto mb-2 size-6 text-slate-400" />
                    No personal to-do&apos;s yet. Add one above.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {myTodos
                      .sort((a, b) => {
                        if (!!a.isComplete !== !!b.isComplete) return a.isComplete ? 1 : -1
                        return a.startDate.localeCompare(b.startDate)
                      })
                      .map((todo) => (
                        <label
                          key={todo.id}
                          className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                        >
                          <Checkbox
                            checked={!!todo.isComplete}
                            onCheckedChange={() => void handleTogglePersonalTodo(todo)}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <div className={cn("text-sm font-medium text-slate-900", todo.isComplete && "line-through text-slate-400")}>
                              {todo.title}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                              <span>{fmtDate(todo.startDate)}</span>
                              {todo.isHourly && todo.startTime ? (
                                <span>{fmtClockRange(todo.startTime, todo.endTime)}</span>
                              ) : null}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              openExistingItem(todo.id)
                              setTodosPanelOpen(false)
                            }}
                          >
                            <Edit3 className="size-3.5" />
                          </button>
                        </label>
                      ))}
                  </div>
                )}
              </div>
            </ScrollArea>
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
              setDialogInitDate(null)
              setDialogInitStartTime(null)
              setDialogInitEndTime(null)
            }
          }}
          jobId={jobId}
          itemId={activeItemId}
          initialStartDate={dialogInitDate}
          initialStartTime={dialogInitStartTime}
          initialEndTime={dialogInitEndTime}
          items={activeItems}
          users={users}
          settings={settings}
          workdayExceptions={workdayExceptions}
          refreshSettings={fetchSettings}
          onRefresh={refreshScheduleData}
          draftMode={scheduleOffline}
          onDraftSave={handleDraftSaveItem}
          onDraftAddNote={handleDraftAddNote}
          onDraftDelete={handleDraftDeleteItem}
        />
      ) : null}

    </>
  )
}
