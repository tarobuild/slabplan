import { type ScheduleSettings } from "@/lib/schedule"
import type { CalendarPeriod, GanttScale, ScheduleTemplate } from "./types"

export const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export const CALENDAR_PERIODS: Array<{ value: CalendarPeriod; label: string }> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "agenda", label: "Agenda" },
]

export const GANTT_SCALES: Array<{ value: GanttScale; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
]

export const FILTER_PRESETS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All Schedule Items" },
  { value: "upcoming", label: "Upcoming Work" },
  { value: "completed", label: "Completed Items" },
  { value: "unassigned", label: "Unassigned Work" },
]

export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  {
    id: "standard-countertop-install",
    name: "Standard Countertop Install",
    description: "Template, fabrication, install, and final inspection milestones for a typical countertop project.",
    items: [
      { title: "Template", workDays: 1, displayColor: "#2E765D" },
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
      { title: "Design", workDays: 2, displayColor: "#0ea5e9" },
      { title: "Template", workDays: 1, displayColor: "#2E765D" },
      { title: "Fabrication", workDays: 3, displayColor: "#6b7280" },
      { title: "Dry Fit", workDays: 1, displayColor: "#7c3aed" },
      { title: "Final Install", workDays: 1, displayColor: "#16a34a" },
      { title: "Punch List", workDays: 1, displayColor: "#f59e0b" },
    ],
  },
]

export const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "none", label: "None" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
  { value: "in_progress", label: "In Progress" },
  { value: "incomplete", label: "Incomplete" },
  { value: "past_due", label: "Past Due" },
] as const

export const LIST_PAGE_SIZE = 10

export const DAY_WIDTH_BY_SCALE: Record<GanttScale, number> = {
  day: 48,
  week: 18,
  month: 8,
  year: 3,
}

export const DEFAULT_SETTINGS: ScheduleSettings = {
  phases: [],
  tags: [],
  defaultView: "calendar_month",
  showTimesOnMonthView: false,
  showJobNameOnAllListedJobs: true,
  automaticallyMarkItemsComplete: false,
  includeHeaderOnPdfExports: true,
  workdayExceptionCategories: [],
}
