export type ScheduleAssignee = {
  id: string
  fullName: string | null
  email: string
  role?: string
  avatarUrl?: string | null
}

export type SchedulePredecessor = {
  scheduleItemId: string
  title: string
  dependencyType: "finish_to_start" | "start_to_start" | "finish_to_finish" | "start_to_finish"
  lagDays: number
  isConflict?: boolean
}

export type ScheduleNote = {
  id: string
  note: string
  createdAt: string
  authorId: string | null
  authorName: string | null
  authorAvatarUrl: string | null
  isLegacy?: boolean
}

export type ScheduleAttachment = {
  id: string
  fileId: string
  filename: string
  originalName: string
  fileUrl: string | null
  fileSize: number | null
  mimeType: string | null
  createdAt: string
  icon: string
}

export type ScheduleTodo = {
  id: string
  title: string
  isComplete: boolean | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}

export type ScheduleItemRecord = {
  id: string
  jobId: string | null
  title: string
  displayColor: string | null
  startDate: string
  endDate: string
  workDays: number
  isHourly: boolean | null
  startTime: string | null
  endTime: string | null
  progress: number | null
  reminder: string | null
  showOnGantt: boolean | null
  visibleToEstimators: boolean | null
  visibleToInstallers: boolean | null
  visibleToOfficeStaff: boolean | null
  isComplete: boolean | null
  notes: string | null
  tags: string[]
  phaseId: string | null
  phaseName: string | null
  phaseColor?: string | null
  assigneeIds: string[]
  assignees: ScheduleAssignee[]
  predecessors: SchedulePredecessor[]
  notesStream: ScheduleNote[]
  noteCount: number
  attachments: ScheduleAttachment[]
  relatedTodos: ScheduleTodo[]
  relatedTodoCount: number
  createdBy: string | null
  createdByName: string | null
  createdByAvatarUrl: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  status: string
  hasConflict?: boolean
  conflictReasons?: string[]
}

export type ScheduleItemPayload = {
  title: string
  displayColor: string | null
  assigneeIds: string[]
  startDate: string
  workDays: number
  endDate: string | null
  isHourly: boolean
  startTime: string | null
  endTime: string | null
  progress: number
  reminder: string
  notes: string | null
  notifyUserIds: string[]
  tags: string[]
  predecessors: Array<{
    scheduleItemId: string
    dependencyType: SchedulePredecessor["dependencyType"]
    lagDays: number
  }>
  phaseId: string | null
  showOnGantt: boolean
  visibleToEstimators: boolean
  visibleToInstallers: boolean
  visibleToOfficeStaff: boolean
  isComplete: boolean
}

export type ScheduleSettingsOption = {
  id: string
  name: string
  color?: string | null
}

export type ScheduleViewModeDefault =
  | "calendar_month"
  | "calendar_week"
  | "calendar_day"
  | "calendar_agenda"
  | "list"
  | "gantt"

export type ScheduleWorkdayExceptionCategory = {
  id: string
  name: string
}

export type ScheduleWorkdayException = {
  id: string
  title: string
  type: "non_workday" | "extra_workday"
  startDate: string
  endDate: string
  sameEveryYear: boolean
  categoryId: string | null
  categoryName: string | null
  appliesToAllJobs: boolean
  jobIds: string[]
  notes: string | null
}

export type ScheduleBaselineItem = {
  scheduleItemId: string
  title: string
  baselineStartDate: string
  baselineEndDate: string
  currentStartDate: string | null
  currentEndDate: string | null
  shiftDays: number
}

export type ScheduleBaselineRecord = {
  id: string
  jobId: string
  capturedAt: string
  capturedBy: string | null
  capturedByName: string | null
  items: ScheduleBaselineItem[]
}

export type ScheduleSettings = {
  phases: ScheduleSettingsOption[]
  tags: ScheduleSettingsOption[]
  defaultView: ScheduleViewModeDefault
  showTimesOnMonthView: boolean
  showJobNameOnAllListedJobs: boolean
  automaticallyMarkItemsComplete: boolean
  includeHeaderOnPdfExports: boolean
  workdayExceptionCategories?: ScheduleWorkdayExceptionCategory[]
}

export const SCHEDULE_COLOR_OPTIONS = [
  { label: "Maroon", value: "#7b2d26" },
  { label: "Merlot", value: "#7a1f3d" },
  { label: "Tuscan Red", value: "#9b2c2c" },
  { label: "Rose", value: "#e76f8a" },
  { label: "Victoria", value: "#7c6aa6" },
  { label: "Brown", value: "#7b5b3a" },
  { label: "Coffee", value: "#6f4e37" },
  { label: "Amber", value: "#d99a1c" },
  { label: "Cucumber", value: "#4f8a10" },
  { label: "Plum", value: "#6e3c5d" },
  { label: "Purple", value: "#7e3ace" },
  { label: "Lavender", value: "#b695e0" },
  { label: "Iris", value: "#5f6edc" },
  { label: "Violet", value: "#8b5cf6" },
  { label: "Navy", value: "#1f3c88" },
  { label: "Levi", value: "#2563eb" },
] as const

export const SCHEDULE_REMINDER_OPTIONS = [
  { label: "None", value: "none" },
  { label: "1 Hour Before", value: "1_hour_before" },
  { label: "2 Hours Before", value: "2_hours_before" },
  { label: "4 Hours Before", value: "4_hours_before" },
  { label: "8 Hours Before", value: "8_hours_before" },
  { label: "12 Hours Before", value: "12_hours_before" },
  { label: "1 Day Before", value: "1_day_before" },
  { label: "2 Days Before", value: "2_days_before" },
] as const

export const SCHEDULE_PREDECESSOR_TYPES = [
  { label: "Finish-to-Start (FS)", value: "finish_to_start" },
  { label: "Start-to-Start (SS)", value: "start_to_start" },
  { label: "Finish-to-Finish (FF)", value: "finish_to_finish" },
  { label: "Start-to-Finish (SF)", value: "start_to_finish" },
] as const

export const SCHEDULE_DEFAULT_VIEW_OPTIONS: Array<{
  label: string
  value: ScheduleViewModeDefault
}> = [
  { label: "Calendar - Month", value: "calendar_month" },
  { label: "Calendar - Week", value: "calendar_week" },
  { label: "Calendar - Day", value: "calendar_day" },
  { label: "Calendar - Agenda", value: "calendar_agenda" },
  { label: "List", value: "list" },
  { label: "Gantt", value: "gantt" },
]

export const DEFAULT_SCHEDULE_COLOR = "#2563eb"

export function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function todayStr() {
  return dateKey(new Date())
}

export function isoDate(date: Date) {
  return dateKey(date)
}

export function fmtDate(value: string | null | undefined) {
  if (!value) {
    return "—"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`))
}

export function fmtDateTime(value: string | null | undefined) {
  if (!value) {
    return "—"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export function fmtClockTime(value: string | null | undefined) {
  if (!value) {
    return "—"
  }

  const parts = value.split(":")

  if (parts.length < 2) {
    return value
  }

  const hours = Number(parts[0])
  const minutes = Number(parts[1])

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return value
  }

  const date = new Date()
  date.setHours(hours, minutes, 0, 0)

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

export function fmtClockRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start) {
    return "—"
  }

  if (!end) {
    return fmtClockTime(start)
  }

  return `${fmtClockTime(start)} - ${fmtClockTime(end)}`
}

function isWeekend(date: Date) {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function normalizeExceptionMatchDate(date: Date, sameEveryYear: boolean) {
  if (!sameEveryYear) {
    return date.toISOString().slice(5, 10)
  }

  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

function dateMatchesException(date: Date, exception: ScheduleWorkdayException) {
  const value = sameYearComparableValue(date, exception.sameEveryYear)
  const start = exception.sameEveryYear ? exception.startDate.slice(5, 10) : exception.startDate
  const end = exception.sameEveryYear ? exception.endDate.slice(5, 10) : exception.endDate
  return value >= start && value <= end
}

function sameYearComparableValue(date: Date, sameEveryYear: boolean) {
  return sameEveryYear ? normalizeExceptionMatchDate(date, true) : date.toISOString().slice(0, 10)
}

export function classifyWorkday(
  date: Date,
  exceptions: ScheduleWorkdayException[] = [],
) {
  const matching = exceptions.filter((exception) => dateMatchesException(date, exception))
  const hasExtra = matching.some((exception) => exception.type === "extra_workday")
  const hasNonWorkday = matching.some((exception) => exception.type === "non_workday")

  if (hasExtra) {
    return {
      isWorkday: true,
      label: matching.find((exception) => exception.type === "extra_workday")?.title || "Extra workday",
      type: "extra_workday" as const,
    }
  }

  if (hasNonWorkday) {
    return {
      isWorkday: false,
      label: matching.find((exception) => exception.type === "non_workday")?.title || "Non-workday",
      type: "non_workday" as const,
    }
  }

  return {
    isWorkday: !isWeekend(date),
    label: isWeekend(date) ? "Non-workday" : null,
    type: isWeekend(date) ? ("non_workday" as const) : null,
  }
}

export function calculateBusinessEndDate(
  startDate: string,
  workDays: number,
  exceptions: ScheduleWorkdayException[] = [],
) {
  const current = new Date(`${startDate}T00:00:00.000Z`)

  while (!classifyWorkday(current, exceptions).isWorkday) {
    current.setUTCDate(current.getUTCDate() + 1)
  }

  let remaining = Math.max(workDays, 1)

  while (remaining > 1) {
    current.setUTCDate(current.getUTCDate() + 1)

    if (classifyWorkday(current, exceptions).isWorkday) {
      remaining -= 1
    }
  }

  return current.toISOString().slice(0, 10)
}

export function addBusinessDays(
  startDate: string,
  amount: number,
  exceptions: ScheduleWorkdayException[] = [],
) {
  if (amount <= 0) {
    return startDate
  }

  return calculateBusinessEndDate(startDate, amount + 1, exceptions)
}

export function calculateWorkDaysBetween(
  startDate: string,
  endDate: string,
  exceptions: ScheduleWorkdayException[] = [],
) {
  let start = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T00:00:00.000Z`)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 1
  }

  while (!classifyWorkday(start, exceptions).isWorkday) {
    start.setUTCDate(start.getUTCDate() + 1)
  }

  let workDays = 0
  const cursor = new Date(start)

  while (cursor <= end) {
    if (classifyWorkday(cursor, exceptions).isWorkday) {
      workDays += 1
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return Math.max(workDays, 1)
}

export function cleanTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  )
}

export function itemEndDate(item: Pick<ScheduleItemRecord, "endDate" | "startDate">) {
  return item.endDate || item.startDate
}

export function deriveScheduleStatus(item: {
  startDate: string
  endDate: string
  progress: number | null
  isComplete: boolean | null
}) {
  const today = todayStr()

  if (item.isComplete || (item.progress ?? 0) >= 100) {
    return "completed"
  }

  if (item.endDate < today) {
    return "overdue"
  }

  if (item.startDate > today) {
    return "upcoming"
  }

  return "in_progress"
}

export function itemOverlapsDateRange(
  item: Pick<ScheduleItemRecord, "startDate" | "endDate">,
  rangeStart: string,
  rangeEnd: string,
) {
  return item.startDate <= rangeEnd && itemEndDate(item) >= rangeStart
}

export function getInitials(name: string | null | undefined) {
  const safeName = (name || "").trim()

  if (!safeName) {
    return "?"
  }

  return safeName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("")
}
