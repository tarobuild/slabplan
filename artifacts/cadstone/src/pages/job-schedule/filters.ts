import {
  DEFAULT_SCHEDULE_COLOR,
  todayStr,
  type ScheduleItemRecord,
  type ScheduleSettings,
  type ScheduleViewModeDefault,
} from "@/lib/schedule"
import type {
  ActivityEntryChange,
  CalendarPeriod,
  FilterState,
  ScheduleSettingsForm,
  SortDirection,
  ViewMode,
  WorkdayExceptionForm,
} from "./types"

export function titleCaseStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

export function getActivityEntryChanges(metadata: Record<string, unknown> | null) {
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

export function buildFilterPreset(preset: string): FilterState {
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

export function countActiveFilters(filters: FilterState) {
  return [
    filters.title.trim().length > 0,
    filters.assignedTo !== "",
    filters.status !== "all",
    filters.tags.length > 0,
    filters.phases.length > 0,
  ].filter(Boolean).length
}

export function applyDefaultViewChoice(
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

export function buildSettingsForm(settings: ScheduleSettings): ScheduleSettingsForm {
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

export function defaultExceptionForm(jobId: string, startDate = todayStr()): WorkdayExceptionForm {
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

export function mergeUniqueIds(current: string[], nextIds: string[]) {
  return Array.from(new Set([...current, ...nextIds]))
}

export function matchesStatus(item: ScheduleItemRecord, status: string) {
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

export function compareValues(left: string | number, right: string | number, direction: SortDirection) {
  if (left < right) {
    return direction === "asc" ? -1 : 1
  }

  if (left > right) {
    return direction === "asc" ? 1 : -1
  }

  return 0
}

export function computeCriticalPathIds(items: ScheduleItemRecord[]) {
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
