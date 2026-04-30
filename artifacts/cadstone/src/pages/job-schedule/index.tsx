import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
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
import { scheduleGetJobsJobIdSchedule } from "@workspace/api-client-react"
import { api } from "@/lib/api"
import { useDocumentTitle } from "@/hooks/use-document-title"
import {
  addBusinessDays,
  calculateBusinessEndDate,
  calculateWorkDaysBetween,
  classifyWorkday,
  dateKey,
  DEFAULT_SCHEDULE_COLOR,
  deriveScheduleStatus,
  fmtClockRange,
  fmtDate,
  fmtDateTime,
  itemEndDate,
  itemOverlapsDateRange,
  type ScheduleItemPayload,
  todayStr,
  type ScheduleBaselineRecord,
  type ScheduleItemRecord,
  type ScheduleSettings,
  type ScheduleSettingsOption,
  type ScheduleWorkdayException,
} from "@/lib/schedule"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import { ScheduleItemDialog, type SchedulePreview } from "@/components/schedule/ScheduleItemDialog"
import { ScheduleQuickCreate, type QuickCreateState } from "@/components/schedule/ScheduleQuickCreate"
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
import { toastApiError } from "@/lib/api-errors"

import {
  EmptyState,
  MultiSelectPopover,
  AssigneeSelect,
  SortableHead,
} from "./components"
import {
  DAY_WIDTH_BY_SCALE,
  DEFAULT_SETTINGS,
  FILTER_PRESETS,
  GANTT_SCALES,
  LIST_PAGE_SIZE,
  STATUS_OPTIONS,
} from "./constants"
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  DRAG_SNAP_MINUTES,
  TIMED_GRID_TOTAL_MINUTES,
  TOUCH_LONG_PRESS_MOVE_TOLERANCE,
  TOUCH_LONG_PRESS_MS,
  type BlockDrag,
  type DragSelection,
  type GanttDrag,
  type GanttDragMode,
  minutesFromClientY,
  minutesToTimeString,
  timeStringToGridMinutes,
} from "./drag"
import {
  addDays,
  addMonths,
  addYears,
  buildMonthGroups,
  buildMonthWeeks,
  buildScaleUnits,
  cloneDate,
  colorWithAlpha,
  diffInDays,
  endOfMonth,
  endOfWeek,
  endOfYear,
  formatCompactDay,
  formatLongDate,
  formatMonthLabel,
  formatRangeLabel,
  formatShortMonthDay,
  getDaySegmentBounds,
  isWeekend,
  parseDate,
  parseTimeToHour,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "./calendar-utils"
import {
  applyDefaultViewChoice,
  buildFilterPreset,
  buildSettingsForm,
  compareValues,
  computeCriticalPathIds,
  countActiveFilters,
  defaultExceptionForm,
  getActivityEntryChanges,
  matchesStatus,
  mergeUniqueIds,
  titleCaseStatus,
} from "./filters"
import {
  cloneScheduleItems,
  draftConflictReasons,
  isDraftScheduleItemId,
  isDraftScheduleNoteId,
  normalizeDraftScheduleItems,
  remapDraftPayload,
  resolveDraftPredecessorStartDate,
  schedulePayloadFromItem,
  schedulePayloadSignature,
  scheduleDraftSignature,
} from "./draft"
import type {
  ActivityEntry,
  ActivityEntryChange,
  AppUser,
  CalendarPeriod,
  DayTimelineSegment,
  FilterState,
  GanttRow,
  GanttScale,
  JobOption,
  ListDisplayMode,
  MonthWeekSegment,
  ScheduleSection,
  ScheduleSettingsForm,
  ScheduleTemplate,
  SortDirection,
  SortKey,
  TimelineHeaderUnit,
  ViewMode,
  WorkdayExceptionForm,
} from "./types"
import { CalendarView } from "./views/CalendarView"
import { ListView } from "./views/ListView"
import { GanttView } from "./views/GanttView"
import { BaselineTab } from "./views/BaselineTab"
import { ExceptionsTab } from "./views/ExceptionsTab"
import { TemplateDialog } from "./dialogs/TemplateDialog"
import { SettingsDialog } from "./dialogs/SettingsDialog"
import { useDragSelection } from "./hooks/useDragSelection"
import { useGanttDrag } from "./hooks/useGanttDrag"
import { useDraftHistoryRefs } from "./hooks/useDraftHistoryRefs"
import { useBlockDrag } from "./hooks/useBlockDrag"

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
  const [itemsTotal, setItemsTotal] = useState(0)
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
  const [schedulePreview, setSchedulePreview] = useState<SchedulePreview | null>(null)
  const [dialogInitTitle, setDialogInitTitle] = useState<string | null>(null)
  const [dialogInitAssigneeIds, setDialogInitAssigneeIds] = useState<string[] | null>(null)
  const [dialogInitIsHourly, setDialogInitIsHourly] = useState<boolean | null>(null)
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  const [quickCreateDate, setQuickCreateDate] = useState<string | null>(null)
  const [quickCreateStartTime, setQuickCreateStartTime] = useState<string | null>(null)
  const [quickCreateEndTime, setQuickCreateEndTime] = useState<string | null>(null)
  const [dragSelection, setDragSelection] = useState<DragSelection | null>(null)
  const dragSelectionRef = useRef<DragSelection | null>(null)
  const [blockDrag, setBlockDrag] = useState<BlockDrag | null>(null)
  const blockDragRef = useRef<BlockDrag | null>(null)
  const blockClickSuppressRef = useRef<string | null>(null)
  const undoBlockDragToastIdRef = useRef<string | number | null>(null)
  const [ganttDrag, setGanttDrag] = useState<GanttDrag | null>(null)
  const ganttDragRef = useRef<GanttDrag | null>(null)
  const ganttClickSuppressRef = useRef<string | null>(null)
  const undoGanttDragToastIdRef = useRef<string | number | null>(null)
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
      toastApiError(err, "Failed to add to-do")
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
      toastApiError(err, "Failed to update to-do")
    }
  }

  async function fetchItems() {
    if (!jobId) {
      return
    }

    const collected: ScheduleItemRecord[] = []
    const pageSize = 500
    let page = 1
    let totalPages = 1
    let totalItems = 0
    // The backend caps each page at 500 items. Fetch pages in sequence until
    // every page has been retrieved so the calendar continues to see the full
    // job schedule. The hard cap prevents an unbounded loop if the server
    // reports a runaway page count.
    while (page <= totalPages && page <= 20) {
      // The typed client returns `ScheduleListResponse` with the same shape
      // we used to type inline. We assert the row element type because the
      // local `ScheduleItemRecord` keeps a few derived fields the spec
      // hasn't been updated to declare.
      const response = await scheduleGetJobsJobIdSchedule(jobId, {
        page,
        limit: pageSize,
      })
      collected.push(...((response.data ?? []) as unknown as ScheduleItemRecord[]))
      totalPages = response.pagination?.totalPages ?? 1
      totalItems = response.pagination?.totalItems ?? collected.length
      page += 1
    }
    const nextItems = collected
    setItems(nextItems)
    setItemsTotal(totalItems)

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
      toastApiError(err, "Failed to load schedule history")
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
      toastApiError(err, "Failed to load schedule")
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

  useDraftHistoryRefs({
    draftItems,
    draftItemsRef,
    draftPast,
    draftPastRef,
    draftFuture,
    draftFutureRef,
  })

  useDragSelection({
    dragSelection,
    dragSelectionRef,
    setDragSelection,
    commitTimedSelection,
  })

  const { handleBlockPointerDown } = useBlockDrag({
    blockDragRef,
    setBlockDrag,
    blockClickSuppressRef,
    isBlockDraggable,
    dismissUndoBlockDragToast,
    commitBlockDrag,
  })

  useGanttDrag({
    ganttDrag,
    ganttDragRef,
    setGanttDrag,
    ganttClickSuppressRef,
    workdayExceptions,
    commitGanttDrag,
  })

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
    return () => {
      if (undoBlockDragToastIdRef.current !== null) {
        toast.dismiss(undoBlockDragToastIdRef.current)
        undoBlockDragToastIdRef.current = null
      }
      if (undoGanttDragToastIdRef.current !== null) {
        toast.dismiss(undoGanttDragToastIdRef.current)
        undoGanttDragToastIdRef.current = null
      }
    }
  }, [jobId])

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

      // Create draft items concurrently. Predecessors are intentionally
      // dropped here (`dropUnresolvedPredecessors: true`) and re-applied in
      // the PUT pass below once every draft id is mapped, so concurrency is
      // safe regardless of the order responses arrive in.
      const createResults = await Promise.all(
        createdDraftItems.map(async (item) => {
          const payload = remapDraftPayload(schedulePayloadFromItem(item), draftIdMap, {
            dropUnresolvedPredecessors: true,
          })
          const response = await api.post<{ item: ScheduleItemRecord }>(`/jobs/${jobId}/schedule`, payload)
          return [item.id, response.data.item.id] as const
        }),
      )

      for (const [draftId, persistedId] of createResults) {
        draftIdMap.set(draftId, persistedId)
      }

      await Promise.all([...createdDraftItems, ...changedPersistedItems].map((item) => {
        const targetId = draftIdMap.get(item.id) || item.id
        const payload = remapDraftPayload(schedulePayloadFromItem(item), draftIdMap)
        return api.put(`/schedule-items/${targetId}`, payload)
      }))

      await Promise.all(currentDraftItems.map(async (item) => {
        const targetId = draftIdMap.get(item.id) || item.id
        const draftNotes = item.notesStream
          .filter((note) => isDraftScheduleNoteId(note.id))
          .map((note) => note.note.trim())
          .filter(Boolean)

        // Notes are posted sequentially within an item to preserve order.
        for (const note of draftNotes) {
          await api.post(`/schedule-items/${targetId}/notes`, { note })
        }
      }))

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
      toastApiError(error, "Failed to publish draft changes")
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

  function openHourBlockFromMinutes(dayKey: string, anchorMinutes: number) {
    const hour = Math.min(DAY_END_HOUR, Math.floor(anchorMinutes / 60) + DAY_START_HOUR)
    const startTime = `${String(hour).padStart(2, "0")}:00`
    const endTime = `${String(Math.min(hour + 1, DAY_END_HOUR + 1)).padStart(2, "0")}:00`
    openQuickCreate(dayKey, startTime, endTime)
  }

  function commitTimedSelection(dragState: DragSelection) {
    const dayKey = dragState.dayKey
    if (!dragState.moved) {
      openHourBlockFromMinutes(dayKey, dragState.anchorMinutes)
      return
    }
    let start = dragState.startMinutes
    let end = dragState.endMinutes
    if (end - start < DRAG_SNAP_MINUTES) {
      end = Math.min(TIMED_GRID_TOTAL_MINUTES, start + DRAG_SNAP_MINUTES)
      if (end - start < DRAG_SNAP_MINUTES) {
        start = Math.max(0, end - DRAG_SNAP_MINUTES)
      }
    }
    openQuickCreate(dayKey, minutesToTimeString(start), minutesToTimeString(end))
  }

  function isBlockDraggable(item: ScheduleItemRecord) {
    if (!item.isHourly) {
      return false
    }
    if (!item.startTime || !item.endTime) {
      return false
    }
    if (itemEndDate(item) !== item.startDate) {
      return false
    }
    const start = timeStringToGridMinutes(item.startTime)
    const end = timeStringToGridMinutes(item.endTime)
    if (start === null || end === null) {
      return false
    }
    if (start < 0 || end > TIMED_GRID_TOTAL_MINUTES || end <= start) {
      return false
    }
    return true
  }

  function dismissUndoBlockDragToast() {
    if (undoBlockDragToastIdRef.current !== null) {
      toast.dismiss(undoBlockDragToastIdRef.current)
      undoBlockDragToastIdRef.current = null
    }
  }

  async function undoBlockDrag(snapshot: {
    itemId: string
    startDate: string
    startTime: string | null
    endTime: string | null
    isHourly: boolean
  }) {
    let snapshotTarget: ScheduleItemRecord | null = null
    let previousItems: ScheduleItemRecord[] | null = null
    setItems((current) => {
      const target = current.find((entry) => entry.id === snapshot.itemId)
      if (!target) {
        return current
      }
      snapshotTarget = target
      previousItems = current
      return current.map((entry) =>
        entry.id === snapshot.itemId
          ? {
              ...entry,
              startDate: snapshot.startDate,
              startTime: snapshot.startTime,
              endTime: snapshot.endTime,
              isHourly: snapshot.isHourly,
            }
          : entry,
      )
    })
    if (!snapshotTarget || !previousItems) {
      return
    }

    try {
      const payload: ScheduleItemPayload = {
        ...schedulePayloadFromItem(snapshotTarget),
        startDate: snapshot.startDate,
        isHourly: snapshot.isHourly,
        startTime: snapshot.isHourly ? snapshot.startTime : null,
        endTime: snapshot.isHourly ? snapshot.endTime : null,
      }
      await api.put(`/schedule-items/${snapshot.itemId}`, payload)
      await refreshScheduleData()
      toast.success("Schedule change undone")
    } catch (error) {
      setItems(previousItems)
      toastApiError(error, "Failed to undo schedule change")
    }
  }

  async function commitBlockDrag(drag: BlockDrag) {
    const target = items.find((entry) => entry.id === drag.itemId)
    if (!target) {
      return
    }
    const newStartTime = minutesToTimeString(drag.startMinutes)
    const newEndTime = minutesToTimeString(drag.endMinutes)
    const newStartDate = drag.mode === "move" ? drag.dayKey : target.startDate
    if (
      newStartDate === target.startDate &&
      newStartTime === target.startTime &&
      newEndTime === target.endTime
    ) {
      return
    }

    const previousSnapshot = {
      itemId: target.id,
      startDate: target.startDate,
      startTime: target.startTime,
      endTime: target.endTime,
      isHourly: !!target.isHourly,
    }
    const itemTitle = target.title
    const previousItems = items
    // Single-day hourly block (per isBlockDraggable), so endDate must
    // track startDate; otherwise the optimistic render briefly has
    // endDate < startDate and the block disappears from every column.
    const optimistic = items.map((entry) =>
      entry.id === target.id
        ? {
            ...entry,
            startDate: newStartDate,
            endDate: newStartDate,
            startTime: newStartTime,
            endTime: newEndTime,
            isHourly: true,
          }
        : entry,
    )
    setItems(optimistic)

    try {
      const payload: ScheduleItemPayload = {
        ...schedulePayloadFromItem(target),
        startDate: newStartDate,
        isHourly: true,
        startTime: newStartTime,
        endTime: newEndTime,
      }
      await api.put(`/schedule-items/${target.id}`, payload)
      await refreshScheduleData()
      dismissUndoBlockDragToast()
      const label = itemTitle.trim() ? `Moved "${itemTitle}"` : "Schedule block updated"
      const toastId = toast.success(label, {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            undoBlockDragToastIdRef.current = null
            void undoBlockDrag(previousSnapshot)
          },
        },
        onDismiss: (current) => {
          if (undoBlockDragToastIdRef.current === current.id) {
            undoBlockDragToastIdRef.current = null
          }
        },
        onAutoClose: (current) => {
          if (undoBlockDragToastIdRef.current === current.id) {
            undoBlockDragToastIdRef.current = null
          }
        },
      })
      undoBlockDragToastIdRef.current = toastId
    } catch (error) {
      setItems(previousItems)
      toastApiError(error, "Failed to update schedule item")
    }
  }

  function dismissUndoGanttDragToast() {
    if (undoGanttDragToastIdRef.current !== null) {
      toast.dismiss(undoGanttDragToastIdRef.current)
      undoGanttDragToastIdRef.current = null
    }
  }

  function isGanttBarDraggable(item: ScheduleItemRecord) {
    if (scheduleOffline) {
      return false
    }
    if (isDraftScheduleItemId(item.id)) {
      return false
    }
    return true
  }

  function handleGanttBarPointerDown(
    event: React.PointerEvent<HTMLElement>,
    item: ScheduleItemRecord,
    mode: GanttDragMode,
  ) {
    if (event.button !== 0) {
      return
    }
    if (event.pointerType !== "mouse") {
      return
    }
    if (!isGanttBarDraggable(item)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()

    dismissUndoGanttDragToast()

    const safeWorkDays = Math.max(item.workDays, 1)
    const next: GanttDrag = {
      itemId: item.id,
      pointerId: event.pointerId,
      mode,
      origStartDate: item.startDate,
      origWorkDays: safeWorkDays,
      origEndDate: calculateBusinessEndDate(
        item.startDate,
        safeWorkDays,
        workdayExceptions,
      ),
      startDate: item.startDate,
      workDays: safeWorkDays,
      anchorClientX: event.clientX,
      dayWidth,
      moved: false,
    }
    ganttDragRef.current = next
    setGanttDrag(next)
  }

  async function undoGanttDrag(snapshot: {
    itemId: string
    startDate: string
    workDays: number
  }) {
    let snapshotTarget: ScheduleItemRecord | null = null
    let previousItems: ScheduleItemRecord[] | null = null
    setItems((current) => {
      const target = current.find((entry) => entry.id === snapshot.itemId)
      if (!target) {
        return current
      }
      snapshotTarget = target
      previousItems = current
      const restoredEndDate = calculateBusinessEndDate(
        snapshot.startDate,
        snapshot.workDays,
        workdayExceptions,
      )
      return current.map((entry) =>
        entry.id === snapshot.itemId
          ? {
              ...entry,
              startDate: snapshot.startDate,
              workDays: snapshot.workDays,
              endDate: restoredEndDate,
            }
          : entry,
      )
    })
    if (!snapshotTarget || !previousItems) {
      return
    }

    try {
      const payload: ScheduleItemPayload = {
        ...schedulePayloadFromItem(snapshotTarget),
        startDate: snapshot.startDate,
        workDays: snapshot.workDays,
      }
      await api.put(`/schedule-items/${snapshot.itemId}`, payload)
      await refreshScheduleData()
      toast.success("Schedule change undone")
    } catch (error) {
      setItems(previousItems)
      toastApiError(error, "Failed to undo schedule change")
    }
  }

  async function commitGanttDrag(drag: GanttDrag) {
    const target = items.find((entry) => entry.id === drag.itemId)
    if (!target) {
      return
    }
    const newStartDate = drag.mode === "move" ? drag.startDate : target.startDate
    const newWorkDays = drag.mode === "resize-end" ? drag.workDays : Math.max(target.workDays, 1)
    if (newStartDate === target.startDate && newWorkDays === Math.max(target.workDays, 1)) {
      return
    }

    const previousSnapshot = {
      itemId: target.id,
      startDate: target.startDate,
      workDays: Math.max(target.workDays, 1),
    }
    const itemTitle = target.title
    const previousItems = items
    const optimisticEndDate = calculateBusinessEndDate(newStartDate, newWorkDays, workdayExceptions)
    const optimistic = items.map((entry) =>
      entry.id === target.id
        ? {
            ...entry,
            startDate: newStartDate,
            workDays: newWorkDays,
            endDate: optimisticEndDate,
          }
        : entry,
    )
    setItems(optimistic)

    try {
      const payload: ScheduleItemPayload = {
        ...schedulePayloadFromItem(target),
        startDate: newStartDate,
        workDays: newWorkDays,
      }
      await api.put(`/schedule-items/${target.id}`, payload)
      await refreshScheduleData()
      dismissUndoGanttDragToast()
      const label = itemTitle.trim() ? `Updated "${itemTitle}"` : "Schedule item updated"
      const toastId = toast.success(label, {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            undoGanttDragToastIdRef.current = null
            void undoGanttDrag(previousSnapshot)
          },
        },
        onDismiss: (current) => {
          if (undoGanttDragToastIdRef.current === current.id) {
            undoGanttDragToastIdRef.current = null
          }
        },
        onAutoClose: (current) => {
          if (undoGanttDragToastIdRef.current === current.id) {
            undoGanttDragToastIdRef.current = null
          }
        },
      })
      undoGanttDragToastIdRef.current = toastId
    } catch (error) {
      setItems(previousItems)
      toastApiError(error, "Failed to update schedule item")
    }
  }

  function handleTimedColumnPointerDown(event: React.PointerEvent<HTMLDivElement>, dayKey: string) {
    if (event.button !== 0) {
      return
    }
    const targetEl = event.target as HTMLElement | null
    if (targetEl && targetEl !== event.currentTarget && targetEl.closest("button")) {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const anchorMinutes = minutesFromClientY(event.clientY, rect.top, rect.height)

    if (event.pointerType !== "mouse") {
      openHourBlockFromMinutes(dayKey, anchorMinutes)
      return
    }

    event.preventDefault()

    const next: DragSelection = {
      dayKey,
      pointerId: event.pointerId,
      rectTop: rect.top,
      rectHeight: rect.height,
      anchorMinutes,
      startMinutes: anchorMinutes,
      endMinutes: anchorMinutes,
      moved: false,
    }
    dragSelectionRef.current = next
    setDragSelection(next)
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
