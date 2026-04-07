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
}

export type ScheduleSettingsOption = {
  id: string
  name: string
}

export type ScheduleSettings = {
  phases: ScheduleSettingsOption[]
  tags: ScheduleSettingsOption[]
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
] as const

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

function isWeekend(date: Date) {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

export function calculateBusinessEndDate(startDate: string, workDays: number) {
  const current = new Date(`${startDate}T00:00:00.000Z`)

  while (isWeekend(current)) {
    current.setUTCDate(current.getUTCDate() + 1)
  }

  let remaining = Math.max(workDays, 1)

  while (remaining > 1) {
    current.setUTCDate(current.getUTCDate() + 1)

    if (!isWeekend(current)) {
      remaining -= 1
    }
  }

  return current.toISOString().slice(0, 10)
}

export function calculateWorkDaysBetween(startDate: string, endDate: string) {
  let start = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T00:00:00.000Z`)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 1
  }

  while (isWeekend(start)) {
    start.setUTCDate(start.getUTCDate() + 1)
  }

  let workDays = 0
  const cursor = new Date(start)

  while (cursor <= end) {
    if (!isWeekend(cursor)) {
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
