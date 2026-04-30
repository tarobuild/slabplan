import type { ScheduleItemRecord } from "@/lib/schedule"

export type AppUser = {
  id: string
  fullName: string
  email: string
  role: string
  avatarUrl: string | null
}

export type ActivityEntry = {
  id: string
  entityType: string
  entityId: string
  action: string
  metadata: Record<string, unknown> | null
  createdAt: string
  userName: string | null
}

export type ActivityEntryChange = {
  field: string
  label: string
  from: string
  to: string
}

export type JobOption = {
  id: string
  title: string
}

export type ViewMode = "calendar" | "list" | "gantt"
export type ScheduleSection = "schedule" | "baseline" | "workday-exceptions"
export type CalendarPeriod = "month" | "week" | "day" | "agenda"
export type ListDisplayMode = "phases" | "notes"
export type GanttScale = "day" | "week" | "month" | "year"
export type SortDirection = "asc" | "desc"
export type SortKey =
  | "idNumber"
  | "title"
  | "complete"
  | "phase"
  | "duration"
  | "start"
  | "end"
  | "assigned"
  | "files"

export type FilterState = {
  preset: string
  title: string
  assignedTo: string
  status: string
  tags: string[]
  phases: string[]
}

export type ScheduleSettingsForm = {
  defaultView: import("@/lib/schedule").ScheduleViewModeDefault
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

export type WorkdayExceptionForm = {
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

export type TimelineHeaderUnit = {
  key: string
  label: string
  start: Date
  end: Date
  width: number
}

export type DayTimelineSegment = {
  item: ScheduleItemRecord
  lane: number
  laneCount: number
  startHour: number
  endHour: number
}

export type MonthWeekSegment = {
  item: ScheduleItemRecord
  lane: number
  startIndex: number
  endIndex: number
}

export type GanttRow =
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

export type ScheduleTemplate = {
  id: string
  name: string
  description: string
  items: Array<{
    title: string
    workDays: number
    displayColor?: string
  }>
}
