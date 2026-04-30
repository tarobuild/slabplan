import { useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { api } from "@/lib/api"
import { useDocumentTitle } from "@/hooks/use-document-title"
import {
  calculateBusinessEndDate,
  dateKey,
  DEFAULT_SCHEDULE_COLOR,
  itemEndDate,
  type ScheduleItemPayload,
  todayStr,
  type ScheduleBaselineRecord,
  type ScheduleItemRecord,
  type ScheduleSettingsOption,
  type ScheduleWorkdayException,
} from "@/lib/schedule"
import { useAuthStore } from "@/store/auth"
import { ScheduleItemDialog, type SchedulePreview } from "@/components/schedule/ScheduleItemDialog"
import { ScheduleQuickCreate, type QuickCreateState } from "@/components/schedule/ScheduleQuickCreate"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { toastApiError } from "@/lib/api-errors"

import { ScheduleToolbar } from "./components"
import {
  DAY_WIDTH_BY_SCALE,
  FILTER_PRESETS,
  LIST_PAGE_SIZE,
} from "./constants"
import {
  addDays,
  addMonths,
  buildMonthGroups,
  buildMonthWeeks,
  buildScaleUnits,
  diffInDays,
  endOfWeek,
  formatLongDate,
  formatMonthLabel,
  formatRangeLabel,
  parseDate,
  startOfWeek,
} from "./calendar-utils"
import {
  applyDefaultViewChoice,
  buildFilterPreset,
  compareValues,
  computeCriticalPathIds,
  countActiveFilters,
  defaultExceptionForm,
  matchesStatus,
} from "./filters"
import type {
  CalendarPeriod,
  FilterState,
  GanttRow,
  GanttScale,
  ListDisplayMode,
  ScheduleSection,
  ScheduleTemplate,
  SortDirection,
  SortKey,
  ViewMode,
  WorkdayExceptionForm,
} from "./types"
import { CalendarView } from "./views/CalendarView"
import { ListView } from "./views/ListView"
import { GanttView } from "./views/GanttView"
import { BaselineTab } from "./views/BaselineTab"
import { ExceptionsTab } from "./views/ExceptionsTab"
import { FilterSheet } from "./dialogs/FilterSheet"
import { HistorySheet } from "./dialogs/HistorySheet"
import { SettingsDialog } from "./dialogs/SettingsDialog"
import { TemplateDialog } from "./dialogs/TemplateDialog"
import { TodosSheet } from "./dialogs/TodosSheet"
import { useScheduleData } from "./hooks/useScheduleData"
import { useScheduleDraft } from "./hooks/useScheduleDraft"
import { useScheduleDragHandlers } from "./hooks/useScheduleDragHandlers"

export default function JobSchedulePage() {
  useDocumentTitle("Schedule")
  const { jobId } = useParams<{ jobId: string }>()
  const currentUser = useAuthStore((s) => s.user)
  const monthPickerRef = useRef<HTMLInputElement | null>(null)
  const ganttTimelineRef = useRef<HTMLDivElement | null>(null)
  const scheduleExportRef = useRef<HTMLDivElement | null>(null)
  const baselineExportRef = useRef<HTMLDivElement | null>(null)
  const exceptionsExportRef = useRef<HTMLDivElement | null>(null)

  const [settingsSaving, setSettingsSaving] = useState(false)
  const [workdayForm, setWorkdayForm] = useState<WorkdayExceptionForm>(() => defaultExceptionForm(jobId || ""))
  const [workdayEditorOpen, setWorkdayEditorOpen] = useState(false)
  const [workdaySaving, setWorkdaySaving] = useState(false)
  const [categoryDraft, setCategoryDraft] = useState("")
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false)
  const [trackedConflictIds, setTrackedConflictIds] = useState<string[]>([])
  const [section, setSection] = useState<ScheduleSection>("schedule")
  const [viewMode, setViewMode] = useState<ViewMode>("calendar")
  const [calendarPeriod, setCalendarPeriod] = useState<CalendarPeriod>("month")
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(() => new Date())
  const [calendarExpanded, setCalendarExpanded] = useState(false)
  const [calendarHintDismissed, setCalendarHintDismissed] = useState(false)
  const [listDisplayMode, setListDisplayMode] = useState<ListDisplayMode>("phases")
  const [sortKey, setSortKey] = useState<SortKey>("start")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [listPage, setListPage] = useState(1)
  const [selectedListIds, setSelectedListIds] = useState<string[]>([])
  const [ganttScale, setGanttScale] = useState<GanttScale>("day")
  const [ganttShowPhases, setGanttShowPhases] = useState(true)
  const [ganttCriticalPath, setGanttCriticalPath] = useState(false)
  const [ganttFullscreen, setGanttFullscreen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [templateApplyingId, setTemplateApplyingId] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [todosPanelOpen, setTodosPanelOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [dialogInitDate, setDialogInitDate] = useState<string | null>(null)
  const [dialogInitStartTime, setDialogInitStartTime] = useState<string | null>(null)
  const [dialogInitEndTime, setDialogInitEndTime] = useState<string | null>(null)
  const [schedulePreview, setSchedulePreview] = useState<SchedulePreview | null>(null)
  const [dialogInitTitle, setDialogInitTitle] = useState<string | null>(null)
  const [dialogInitAssigneeIds, setDialogInitAssigneeIds] = useState<string[] | null>(null)
  const [dialogInitIsHourly, setDialogInitIsHourly] = useState<boolean | null>(null)
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  const [quickCreateDate, setQuickCreateDate] = useState<string | null>(null)
  const [quickCreateStartTime, setQuickCreateStartTime] = useState<string | null>(null)
  const [quickCreateEndTime, setQuickCreateEndTime] = useState<string | null>(null)
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(() => buildFilterPreset("all"))
  const [draftFilters, setDraftFilters] = useState<FilterState>(() => buildFilterPreset("all"))

  const draftHandlersRef = useRef<{
    syncWithFetchedItems: (nextItems: ScheduleItemRecord[]) => void
  } | null>(null)

  const {
    items,
    setItems,
    itemsTotal,
    users,
    jobs,
    settings,
    settingsForm,
    setSettingsForm,
    baseline,
    setBaseline,
    workdayExceptions,
    editingCategories,
    setEditingCategories,
    loading,
    historyLoading,
    historyEntries,
    fetchItems,
    fetchSettings,
    fetchHistory,
    refreshScheduleData,
  } = useScheduleData({
    jobId,
    setViewMode,
    setCalendarPeriod,
    historyOpen,
    onItemsFetched: (nextItems) => {
      draftHandlersRef.current?.syncWithFetchedItems(nextItems)
    },
  })

  const {
    scheduleOffline,
    draftItems,
    draftPast,
    draftFuture,
    draftPublishing,
    draftItemsRef,
    hasDraftChanges,
    syncWithFetchedItems,
    enterDraftMode,
    handleDiscardDraft,
    handleDraftUndo,
    handleDraftRedo,
    applyDraftMutation,
    handleDraftSaveItem,
    handleDraftAddNote,
    handleDraftDeleteItem,
    handlePublishDraft,
  } = useScheduleDraft({
    jobId,
    items,
    users,
    settings,
    workdayExceptions,
    refreshScheduleData,
    activeItemId,
    setDialogOpen,
    setActiveItemId,
    setTrackedConflictIds,
  })

  draftHandlersRef.current = { syncWithFetchedItems }

  const myTodos = useMemo(
    () => items.filter((item) => item.isPersonalTodo && item.createdBy === currentUser?.id),
    [items, currentUser?.id],
  )

  const incompleteTodoCount = useMemo(
    () => myTodos.filter((t) => !t.isComplete).length,
    [myTodos],
  )

  useEffect(() => {
    if (!jobId) {
      return
    }

    setWorkdayForm(defaultExceptionForm(jobId))
    setWorkdayEditorOpen(false)
    setTrackedConflictIds([])

    if (typeof window !== "undefined") {
      try {
        const dismissed = window.sessionStorage.getItem(`cadstone:job-schedule:hint-dismissed:${jobId}`) === "1"
        setCalendarHintDismissed(dismissed)
      } catch {
        setCalendarHintDismissed(false)
      }
    } else {
      setCalendarHintDismissed(false)
    }
  }, [jobId])

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
    let start: Date
    let end: Date

    if (ganttItems.length === 0) {
      const today = new Date()
      start = addDays(startOfWeek(today), -7)
      end = addDays(endOfWeek(today), 14)
    } else {
      const starts = ganttItems.map((item) => parseDate(item.startDate))
      const ends = ganttItems.map((item) => parseDate(itemEndDate(item)))
      const minStart = starts.reduce((left, right) => (left < right ? left : right))
      const maxEnd = ends.reduce((left, right) => (left > right ? left : right))
      start = addDays(startOfWeek(minStart), -7)
      end = addDays(endOfWeek(maxEnd), 7)
    }

    if (schedulePreview) {
      const previewStart = parseDate(schedulePreview.startDate)
      const previewEnd = parseDate(schedulePreview.endDate)
      if (previewStart < start) {
        start = addDays(startOfWeek(previewStart), -7)
      }
      if (previewEnd > end) {
        end = addDays(endOfWeek(previewEnd), 7)
      }
    }

    return { start, end }
  }, [ganttItems, schedulePreview])

  const dayWidth = DAY_WIDTH_BY_SCALE[ganttScale]

  const {
    dragSelection,
    blockDrag,
    blockClickSuppressRef,
    ganttDrag,
    ganttClickSuppressRef,
    handleBlockPointerDown,
    handleGanttBarPointerDown,
    handleTimedColumnPointerDown,
    isBlockDraggable,
    isGanttBarDraggable,
  } = useScheduleDragHandlers({
    jobId,
    items,
    setItems,
    workdayExceptions,
    dayWidth,
    scheduleOffline,
    refreshScheduleData,
    openQuickCreate,
  })

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

  const ganttPreviewBounds = useMemo(() => {
    if (!schedulePreview) {
      return null
    }

    const rangeStartKey = dateKey(ganttRange.start)
    const rangeEndKey = dateKey(ganttRange.end)

    if (schedulePreview.endDate < rangeStartKey || schedulePreview.startDate > rangeEndKey) {
      return null
    }

    const startKey = schedulePreview.startDate < rangeStartKey ? rangeStartKey : schedulePreview.startDate
    const endKey = schedulePreview.endDate > rangeEndKey ? rangeEndKey : schedulePreview.endDate
    const left = diffInDays(ganttRange.start, parseDate(startKey)) * dayWidth
    const width = (diffInDays(parseDate(startKey), parseDate(endKey)) + 1) * dayWidth

    return { left, width }
  }, [schedulePreview, ganttRange.start, ganttRange.end, dayWidth])

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

  async function handleSetBaseline() {
    if (!jobId) {
      return
    }

    try {
      const response = await api.post<{ baseline: ScheduleBaselineRecord }>(`/jobs/${jobId}/schedule/baseline`)
      setBaseline(response.data.baseline)
      toast.success("Baseline captured")
    } catch (error) {
      toastApiError(error, "Failed to set baseline")
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
      toastApiError(error, "Failed to reset baseline")
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
      toastApiError(error, "Failed to save workday exception")
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
      toastApiError(error, "Failed to delete workday exception")
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
      toastApiError(error, "Failed to add category")
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
      toastApiError(error, "Failed to update category")
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
      toastApiError(error, "Failed to save schedule settings")
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
      toastApiError(error, "Failed to track conflicts")
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
      toastApiError(error, "Failed to notify assigned users")
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
      toastApiError(error, "Failed to delete all schedule items")
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
      toastApiError(error, "Failed to import template")
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
      toastApiError(error, "Failed to export PDF")
    }
  }

  function openNewItem(startDate?: string, startTime?: string, endTime?: string) {
    setActiveItemId(null)
    setDialogInitDate(startDate ?? null)
    setDialogInitStartTime(startTime ?? null)
    setDialogInitEndTime(endTime ?? null)
    setDialogInitTitle(null)
    setDialogInitAssigneeIds(null)
    setDialogInitIsHourly(null)
    setDialogOpen(true)
  }


  function openExistingItem(itemId: string) {
    setActiveItemId(itemId)
    setDialogInitDate(null)
    setDialogInitTitle(null)
    setDialogInitAssigneeIds(null)
    setDialogInitIsHourly(null)
    setDialogOpen(true)
  }

  function openQuickCreate(startDate: string, startTime?: string, endTime?: string) {
    setQuickCreateDate(startDate)
    setQuickCreateStartTime(startTime ?? null)
    setQuickCreateEndTime(endTime ?? null)
    setQuickCreateOpen(true)
  }

  async function handleQuickSave() {
    await refreshScheduleData()
  }

  function handleQuickMoreOptions(state: QuickCreateState) {
    setActiveItemId(null)
    setDialogInitDate(state.date)
    setDialogInitStartTime(state.isHourly ? state.startTime : null)
    setDialogInitEndTime(state.isHourly ? state.endTime : null)
    setDialogInitTitle(state.title || null)
    setDialogInitAssigneeIds(state.assigneeIds.length > 0 ? state.assigneeIds : null)
    setDialogInitIsHourly(state.isHourly)
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

  const previewLeft = ganttPreviewBounds?.left ?? null
  const previewWidth = ganttPreviewBounds?.width ?? null

  useEffect(() => {
    if (previewLeft === null || previewWidth === null) {
      return
    }

    const container = ganttTimelineRef.current

    if (!container) {
      return
    }

    const padding = 24
    const previewRight = previewLeft + previewWidth
    const visibleStart = container.scrollLeft
    const visibleEnd = visibleStart + container.clientWidth

    if (previewLeft >= visibleStart + padding && previewRight <= visibleEnd - padding) {
      return
    }

    const maxScrollLeft = Math.max(container.scrollWidth - container.clientWidth, 0)
    let target: number

    if (previewWidth >= container.clientWidth - padding * 2) {
      target = previewLeft - padding
    } else {
      target = previewLeft - (container.clientWidth - previewWidth) / 2
    }

    target = Math.max(0, Math.min(target, maxScrollLeft))

    container.scrollTo({ left: target, behavior: "smooth" })
  }, [previewLeft, previewWidth, viewMode])

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
            <ScheduleToolbar
              viewMode={viewMode}
              setViewMode={setViewMode}
              setSettingsOpen={setSettingsOpen}
              setHistoryOpen={setHistoryOpen}
              setTodosPanelOpen={setTodosPanelOpen}
              setTemplateDialogOpen={setTemplateDialogOpen}
              setFilterOpen={setFilterOpen}
              incompleteTodoCount={incompleteTodoCount}
              scheduleOffline={scheduleOffline}
              draftPublishing={draftPublishing}
              draftPastLength={draftPast.length}
              draftFutureLength={draftFuture.length}
              activeFilterCount={activeFilterCount}
              hasActiveItems={activeItems.length > 0}
              enterDraftMode={enterDraftMode}
              handleDiscardDraft={handleDiscardDraft}
              handleDraftUndo={handleDraftUndo}
              handleDraftRedo={handleDraftRedo}
              handleTrackConflicts={handleTrackConflicts}
              handleNotifyAssignedUsers={handleNotifyAssignedUsers}
              handleDeleteAllItems={handleDeleteAllItems}
              handleExport={handleExport}
              runSchedulePrint={runSchedulePrint}
              openNewItem={() => openNewItem()}
              handlePublishDraft={handlePublishDraft}
            />

            {viewMode === "calendar" ? (
              <CalendarView
                loading={loading}
                jobId={jobId}
                calendarPeriod={calendarPeriod}
                setCalendarPeriod={setCalendarPeriod}
                calendarExpanded={calendarExpanded}
                setCalendarExpanded={setCalendarExpanded}
                calendarHintDismissed={calendarHintDismissed}
                setCalendarHintDismissed={setCalendarHintDismissed}
                calendarAnchorDate={calendarAnchorDate}
                setCalendarAnchorDate={setCalendarAnchorDate}
                monthPickerRef={monthPickerRef}
                currentRangeLabel={currentRangeLabel}
                jumpToToday={jumpToToday}
                navigateCalendar={navigateCalendar}
                openDatePicker={openDatePicker}
                monthWeeks={monthWeeks}
                items={items}
                filteredItems={filteredItems}
                activeItems={activeItems}
                activeConflictIds={activeConflictIds}
                todayIso={todayIso}
                workdayExceptions={workdayExceptions}
                schedulePreview={schedulePreview}
                blockDrag={blockDrag}
                dragSelection={dragSelection}
                blockClickSuppressRef={blockClickSuppressRef}
                isBlockDraggable={isBlockDraggable}
                handleBlockPointerDown={handleBlockPointerDown}
                handleTimedColumnPointerDown={handleTimedColumnPointerDown}
                openExistingItem={openExistingItem}
                openQuickCreate={openQuickCreate}
                setAppliedFilters={setAppliedFilters}
                setDraftFilters={setDraftFilters}
              />
            ) : null}

            {viewMode === "list" ? (
              <ListView
                itemsTotal={itemsTotal}
                loading={loading}
                isEmpty={isEmpty}
                activeItems={activeItems}
                groupedListItems={groupedListItems}
                listDisplayMode={listDisplayMode}
                selectedListIds={selectedListIds}
                currentPageIds={currentPageIds}
                allCurrentPageSelected={allCurrentPageSelected}
                itemNumberById={itemNumberById}
                activeConflictIds={activeConflictIds}
                sortKey={sortKey}
                sortDirection={sortDirection}
                listPage={listPage}
                totalListPages={totalListPages}
                listStart={listStart}
                listEnd={listEnd}
                sortedListItemsLength={sortedListItems.length}
                setListDisplayMode={setListDisplayMode}
                setSelectedListIds={setSelectedListIds}
                setAppliedFilters={setAppliedFilters}
                setDraftFilters={setDraftFilters}
                setListPage={setListPage}
                handleSort={handleSort}
                openNewItem={openNewItem}
                openExistingItem={openExistingItem}
              />
            ) : null}

            {viewMode === "gantt" ? (
              <GanttView
                ganttFullscreen={ganttFullscreen}
                ganttScale={ganttScale}
                ganttShowPhases={ganttShowPhases}
                ganttCriticalPath={ganttCriticalPath}
                loading={loading}
                ganttItems={ganttItems}
                activeItems={activeItems}
                ganttRows={ganttRows}
                activeConflictIds={activeConflictIds}
                ganttTimelineRef={ganttTimelineRef}
                timelineWidth={timelineWidth}
                monthGroups={monthGroups}
                scaleUnits={scaleUnits}
                todayOffsetPx={todayOffsetPx}
                schedulePreview={schedulePreview}
                ganttPreviewBounds={ganttPreviewBounds}
                ganttDependencyLines={ganttDependencyLines}
                ganttDrag={ganttDrag}
                ganttClickSuppressRef={ganttClickSuppressRef}
                criticalPathIds={criticalPathIds}
                ganttRange={ganttRange}
                dayWidth={dayWidth}
                workdayExceptions={workdayExceptions}
                scheduleOffline={scheduleOffline}
                setGanttScale={setGanttScale}
                setGanttShowPhases={setGanttShowPhases}
                setGanttCriticalPath={setGanttCriticalPath}
                setGanttFullscreen={setGanttFullscreen}
                setAppliedFilters={setAppliedFilters}
                setDraftFilters={setDraftFilters}
                scrollGanttToToday={scrollGanttToToday}
                openNewItem={openNewItem}
                openExistingItem={openExistingItem}
                enterDraftMode={enterDraftMode}
                handleGanttBarPointerDown={handleGanttBarPointerDown}
                isGanttBarDraggable={isGanttBarDraggable}
              />
            ) : null}
          </TabsContent>

          <TabsContent ref={baselineExportRef} value="baseline" className="mt-0">
            <BaselineTab
              baseline={baseline}
              scheduleOffline={scheduleOffline}
              setSettingsOpen={setSettingsOpen}
              setFilterOpen={setFilterOpen}
              enterDraftMode={enterDraftMode}
              handleDiscardDraft={handleDiscardDraft}
              handleResetBaseline={handleResetBaseline}
              handleSetBaseline={handleSetBaseline}
              handleExport={handleExport}
            />
          </TabsContent>

          <TabsContent ref={exceptionsExportRef} value="workday-exceptions" className="mt-0">
            <ExceptionsTab
              jobId={jobId}
              jobs={jobs}
              scheduleOffline={scheduleOffline}
              workdayExceptions={workdayExceptions}
              workdayEditorOpen={workdayEditorOpen}
              workdayForm={workdayForm}
              workdaySaving={workdaySaving}
              categoryEditorOpen={categoryEditorOpen}
              categoryDraft={categoryDraft}
              editingCategories={editingCategories}
              settings={settings}
              setSettingsOpen={setSettingsOpen}
              setFilterOpen={setFilterOpen}
              setWorkdayEditorOpen={setWorkdayEditorOpen}
              setWorkdayForm={setWorkdayForm}
              setCategoryEditorOpen={setCategoryEditorOpen}
              setCategoryDraft={setCategoryDraft}
              setEditingCategories={setEditingCategories}
              enterDraftMode={enterDraftMode}
              handleDiscardDraft={handleDiscardDraft}
              handleExport={handleExport}
              openNewWorkdayException={openNewWorkdayException}
              openExistingWorkdayException={openExistingWorkdayException}
              handleSaveWorkdayException={handleSaveWorkdayException}
              handleDeleteWorkdayException={handleDeleteWorkdayException}
              handleCreateCategory={handleCreateCategory}
              handleSaveCategory={handleSaveCategory}
            />
          </TabsContent>
        </Tabs>
      </div>

      <TemplateDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        templateApplyingId={templateApplyingId}
        onApplyTemplate={handleApplyTemplate}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settingsForm={settingsForm}
        setSettingsForm={setSettingsForm}
        settingsSaving={settingsSaving}
        onSave={handleSaveSettings}
      />

      <HistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        loading={historyLoading}
        entries={historyEntries}
      />

      <FilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        draftFilters={draftFilters}
        setDraftFilters={setDraftFilters}
        setAppliedFilters={setAppliedFilters}
        setListPage={setListPage}
        draftPresetValue={draftPresetValue}
        users={users}
        availableTagOptions={availableTagOptions}
        phaseOptions={settings.phases}
      />

      <TodosSheet
        open={todosPanelOpen}
        onOpenChange={setTodosPanelOpen}
        jobId={jobId}
        myTodos={myTodos}
        currentUserId={currentUser?.id}
        onRefresh={refreshScheduleData}
        onOpenItem={openExistingItem}
      />

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
              setDialogInitTitle(null)
              setDialogInitAssigneeIds(null)
              setDialogInitIsHourly(null)
            }
          }}
          jobId={jobId}
          itemId={activeItemId}
          initialStartDate={dialogInitDate}
          initialStartTime={dialogInitStartTime}
          initialEndTime={dialogInitEndTime}
          initialTitle={dialogInitTitle}
          initialAssigneeIds={dialogInitAssigneeIds}
          initialIsHourly={dialogInitIsHourly}
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
          onPreviewChange={setSchedulePreview}
        />
      ) : null}

      {jobId && quickCreateDate ? (
        <ScheduleQuickCreate
          open={quickCreateOpen}
          onOpenChange={(nextOpen) => {
            setQuickCreateOpen(nextOpen)
            if (!nextOpen) {
              setQuickCreateDate(null)
              setQuickCreateStartTime(null)
              setQuickCreateEndTime(null)
            }
          }}
          jobId={jobId}
          users={users}
          initialDate={quickCreateDate}
          initialStartTime={quickCreateStartTime}
          initialEndTime={quickCreateEndTime}
          onSaved={handleQuickSave}
          onMoreOptions={handleQuickMoreOptions}
        />
      ) : null}

    </>
  )
}
