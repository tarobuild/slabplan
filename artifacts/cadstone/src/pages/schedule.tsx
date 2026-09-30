import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Calendar, ChevronRight, Loader2, X } from "lucide-react"
import { api } from "@/lib/api"
import { apiErrorMessage } from "@/lib/api-errors"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { Badge } from "@/components/ui/badge"
import PageHeader from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuthStore } from "@/store/auth"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  deriveStatus,
  getViewWindow,
  intersectRange,
  localDateKey,
  parseAnchor,
  parseGanttScale,
  shiftAnchor,
  type CalendarViewMode,
  type ScheduleRow,
} from "./company-schedule/layout"
import {
  CompanyGanttView,
  CompanyMonthView,
  CompanyWeekView,
  PeriodNavigator,
} from "./company-schedule/views"
import { GANTT_SCALES } from "./job-schedule/constants"
import type { GanttScale } from "./job-schedule/types"

export { deriveStatus, localDateKey }

const PAGE_LIMIT = 50

type CursorPagination = { limit: number; hasMore: boolean; nextCursor: string | null }

type ScheduleResponse = {
  data: ScheduleRow[]
  pagination: CursorPagination | { page: number; limit: number; totalItems: number; totalPages: number }
}

const FILTER_KEYS = ["clientId", "jobId", "assigneeId", "phaseId", "status", "from", "to"] as const
type FilterKey = (typeof FILTER_KEYS)[number]

const VIEW_MODES = ["gantt", "week", "month", "list"] as const
type ViewMode = (typeof VIEW_MODES)[number]

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "upcoming", label: "Upcoming" },
  { value: "in_progress", label: "In progress" },
  { value: "overdue", label: "Overdue" },
  { value: "complete", label: "Complete" },
]

type OptionRow = { id: string; label: string }
type OptionCollection = "clients" | "jobs" | "users"

async function loadFilterRows<T>(endpoint: string, collection: OptionCollection, params: Record<string, string | number>, signal: AbortSignal) {
  const rows: T[] = []
  let page = 1
  while (true) {
    const response = await api.get<Partial<Record<OptionCollection, T[]>> & {
      pagination?: { totalPages?: number; hasMore?: boolean }
    }>(endpoint, { params: { ...params, page }, signal })
    rows.push(...(response.data[collection] ?? []))
    const pagination = response.data.pagination
    if (typeof pagination?.totalPages === "number") {
      if (page >= pagination.totalPages) break
    } else if (!pagination?.hasMore) break
    page += 1
  }
  return rows
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`))
}

export default function CompanySchedulePage() {
  useDocumentTitle("Schedule")
  const isDrafter = useAuthStore((s) => s.user?.role === "drafter")
  const [searchParams, setSearchParams] = useSearchParams()
  const [items, setItems] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [filterError, setFilterError] = useState("")
  const [clientOptions, setClientOptions] = useState<OptionRow[]>([])
  const [jobOptions, setJobOptions] = useState<OptionRow[]>([])
  const [assigneeOptions, setAssigneeOptions] = useState<OptionRow[]>([])
  const loadRequestIdRef = useRef(0)

  const view = (searchParams.get("view") as ViewMode | null) ?? "gantt"
  const viewMode: ViewMode = (VIEW_MODES as readonly string[]).includes(view) ? (view as ViewMode) : "gantt"

  const filters = useMemo<Partial<Record<FilterKey, string>>>(() => {
    const out: Partial<Record<FilterKey, string>> = {}
    for (const key of FILTER_KEYS) {
      const v = searchParams.get(key)
      if (v) out[key] = v
    }
    return out
  }, [searchParams])

  // Gantt, Week and Month show one period at a time (anchored by ?date=) and
  // request only that period, narrowed by any From/To filter. List keeps the
  // plain filtered feed.
  const today = localDateKey()
  const calendarMode: CalendarViewMode | null = viewMode === "list" ? null : viewMode
  const anchor = parseAnchor(searchParams.get("date"), today)
  const ganttScale = parseGanttScale(searchParams.get("scale"))
  const viewWindow = useMemo(
    () => (calendarMode ? getViewWindow(calendarMode, anchor, ganttScale) : null),
    [calendarMode, anchor, ganttScale],
  )
  const requestRange = viewWindow ? intersectRange(viewWindow, filters.from, filters.to) : null

  function setView(next: ViewMode) {
    const sp = new URLSearchParams(searchParams)
    sp.set("view", next)
    setSearchParams(sp, { replace: true })
  }

  function setAnchor(next: string | null) {
    const sp = new URLSearchParams(searchParams)
    if (next && next !== today) sp.set("date", next)
    else sp.delete("date")
    setSearchParams(sp, { replace: true })
  }

  function setGanttScale(next: GanttScale) {
    const sp = new URLSearchParams(searchParams)
    sp.set("scale", next)
    setSearchParams(sp, { replace: true })
  }

  function openWeekOf(day: string) {
    const sp = new URLSearchParams(searchParams)
    sp.set("view", "week")
    sp.set("date", day)
    setSearchParams(sp, { replace: true })
  }

  function setFilter(key: FilterKey, value: string) {
    const sp = new URLSearchParams(searchParams)
    if (value && value !== "__all__") sp.set(key, value)
    else sp.delete(key)
    setSearchParams(sp, { replace: true })
  }

  function clearFilter(key: FilterKey) {
    const sp = new URLSearchParams(searchParams)
    sp.delete(key)
    setSearchParams(sp, { replace: true })
  }

  function clearAllFilters() {
    const sp = new URLSearchParams()
    if (viewMode !== "gantt") sp.set("view", viewMode)
    const date = searchParams.get("date")
    if (date) sp.set("date", date)
    if (ganttScale !== "day") sp.set("scale", ganttScale)
    setSearchParams(sp, { replace: true })
  }

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setFilterError("")
    setClientOptions([])
    setJobOptions([])
    setAssigneeOptions([])
    function reportFailure(message: string) {
      if (!cancelled) setFilterError((current) => current ? `${current} ${message}` : message)
    }
    if (!isDrafter) {
      void loadFilterRows<{ id: string; companyName?: string | null; name?: string | null }>(
        "/clients", "clients", { pageSize: 100 }, controller.signal,
      ).then((rows) => {
        if (cancelled) return
        setClientOptions(rows.map((c) => ({
          id: c.id,
          label: c.companyName ?? c.name ?? c.id,
        })))
      }).catch(() => reportFailure("Client filters could not be loaded."))
      void loadFilterRows<{ id: string; fullName?: string | null; email: string }>(
        "/users", "users", { roles: "admin,project_manager,crew_member,drafter", limit: 200 }, controller.signal,
      ).then((rows) => {
        if (cancelled) return
        setAssigneeOptions(rows.map((u) => ({ id: u.id, label: u.fullName ?? u.email })))
      }).catch(() => reportFailure("Assignee filters could not be loaded."))
    }
    void loadFilterRows<{ id: string; title?: string | null; clientId?: string | null; clientName?: string | null }>(
      "/jobs", "jobs", { pageSize: 100 }, controller.signal,
    ).then((rows) => {
        if (cancelled) return
        setJobOptions(rows.map((j) => ({
          id: j.id,
          label: j.clientName ? `${j.clientName} · ${j.title ?? j.id}` : (j.title ?? j.id),
        })))
        if (isDrafter) {
          const clients = new Map<string, OptionRow>()
          for (const job of rows) {
            if (job.clientId && job.clientName) clients.set(job.clientId, { id: job.clientId, label: job.clientName })
          }
          setClientOptions(Array.from(clients.values()).sort((a, b) => a.label.localeCompare(b.label)))
        }
      }).catch(() => reportFailure("Job filters could not be loaded."))
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [isDrafter])

  async function loadItems(cursor: string | null) {
    const isInitial = cursor === null
    const requestId = ++loadRequestIdRef.current
    if (isInitial) {
      setLoading(true)
      setLoadingMore(false)
      setErrorMessage("")
    } else {
      setLoadingMore(true)
    }
    try {
      const params: Record<string, string | number> = {
        cursor: cursor ?? "",
        limit: PAGE_LIMIT,
      }
      for (const key of FILTER_KEYS) {
        const v = filters[key]
        if (v) params[key] = v
      }
      if (viewWindow) {
        // The From/To filters exclude this whole period: nothing to show.
        if (!requestRange) {
          setItems([])
          setHasMore(false)
          setNextCursor(null)
          return
        }
        params.from = requestRange.from
        params.to = requestRange.to
      }
      const response = await api.get<ScheduleResponse>("/schedule", { params })
      if (requestId !== loadRequestIdRef.current) return
      const fetched = response.data.data ?? []
      setItems((prev) => (isInitial ? fetched : [...prev, ...fetched]))
      const pag = response.data.pagination as CursorPagination | undefined
      setHasMore(pag && "hasMore" in pag ? pag.hasMore : false)
      setNextCursor(pag && "nextCursor" in pag ? pag.nextCursor : null)
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) return
      setErrorMessage(apiErrorMessage(error, "Failed to load schedule"))
      if (isInitial) {
        setItems([])
        setHasMore(false)
        setNextCursor(null)
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        if (isInitial) setLoading(false)
        else setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    setNextCursor(null)
    setHasMore(false)
    void loadItems(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters), viewWindow?.start, viewWindow?.end])

  const activeChips = FILTER_KEYS.filter((k) => filters[k])

  function chipLabel(key: FilterKey, value: string) {
    if (key === "clientId") return clientOptions.find((c) => c.id === value)?.label ?? value
    if (key === "jobId") return jobOptions.find((j) => j.id === value)?.label ?? value
    if (key === "assigneeId") return assigneeOptions.find((a) => a.id === value)?.label ?? value
    if (key === "status") return STATUS_OPTIONS.find((s) => s.value === value)?.label ?? value
    return value
  }

  // List remains grouped by job; the calendar modes use their own geometry.
  const groupedByJob = useMemo(() => {
    const map = new Map<string, { jobId: string; jobTitle: string; clientName: string | null; rows: ScheduleRow[] }>()
    for (const it of items) {
      const key = it.jobId ?? "__none__"
      const entry = map.get(key) ?? {
        jobId: it.jobId ?? "",
        jobTitle: it.jobTitle ?? "Unknown job",
        clientName: it.clientName ?? null,
        rows: [],
      }
      entry.rows.push(it)
      map.set(key, entry)
    }
    return Array.from(map.values())
  }, [items])


  return (
    <div className="space-y-5" data-testid="company-schedule-page">
      <PageHeader
        className="mb-0"
        title="Schedule"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={viewMode} onValueChange={(v) => setView(v as ViewMode)}>
          <TabsList data-testid="schedule-view-switcher">
            <TabsTrigger value="gantt">Gantt</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
          </TabsList>
        </Tabs>
        {activeChips.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            Clear all
          </Button>
        ) : null}
      </div>

      <div
        className={`grid grid-cols-2 gap-3 lg:grid-cols-3 ${isDrafter ? "xl:grid-cols-5" : "xl:grid-cols-6"}`}
        data-testid="schedule-filters"
      >
        <div className="space-y-1">
          <Label htmlFor="schedule-filter-client" className="text-xs">Client</Label>
          <Select
            value={filters.clientId ?? "__all__"}
            onValueChange={(v) => setFilter("clientId", v)}
          >
            <SelectTrigger id="schedule-filter-client" data-testid="filter-select-clientId"><SelectValue placeholder="All clients" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All clients</SelectItem>
              {clientOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="schedule-filter-job" className="text-xs">Job</Label>
          <Select
            value={filters.jobId ?? "__all__"}
            onValueChange={(v) => setFilter("jobId", v)}
          >
            <SelectTrigger id="schedule-filter-job" data-testid="filter-select-jobId"><SelectValue placeholder="All jobs" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All jobs</SelectItem>
              {jobOptions.map((j) => (
                <SelectItem key={j.id} value={j.id}>{j.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!isDrafter ? <div className="space-y-1">
          <Label htmlFor="schedule-filter-assignee" className="text-xs">Assignee</Label>
          <Select
            value={filters.assigneeId ?? "__all__"}
            onValueChange={(v) => setFilter("assigneeId", v)}
          >
            <SelectTrigger id="schedule-filter-assignee" data-testid="filter-select-assigneeId"><SelectValue placeholder="Anyone" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Anyone</SelectItem>
              {assigneeOptions.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div> : null}
        <div className="space-y-1">
          <Label htmlFor="schedule-filter-status" className="text-xs">Status</Label>
          <Select
            value={filters.status ?? "__all__"}
            onValueChange={(v) => setFilter("status", v)}
          >
            <SelectTrigger id="schedule-filter-status" data-testid="filter-select-status"><SelectValue placeholder="Any status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Any status</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 space-y-1 min-[360px]:col-span-1">
          <Label htmlFor="schedule-filter-from" className="text-xs">From</Label>
          <Input
            id="schedule-filter-from"
            type="date"
            value={filters.from ?? ""}
            onChange={(e) => setFilter("from", e.target.value)}
            data-testid="filter-input-from"
          />
        </div>
        <div className="col-span-2 space-y-1 min-[360px]:col-span-1">
          <Label htmlFor="schedule-filter-to" className="text-xs">To</Label>
          <Input
            id="schedule-filter-to"
            type="date"
            value={filters.to ?? ""}
            onChange={(e) => setFilter("to", e.target.value)}
            data-testid="filter-input-to"
          />
        </div>
      </div>

      {filterError ? <p role="status" className="text-sm text-destructive">{filterError}</p> : null}

      {activeChips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {activeChips.map((key) => (
            <Badge
              key={key}
              variant="outline"
              className="max-w-full gap-1 border-primary/20 bg-primary/10 text-primary"
              data-testid={`filter-chip-${key}`}
            >
              <span className="min-w-0 truncate">{key}: {chipLabel(key, filters[key]!)}</span>
              <button
                type="button"
                onClick={() => clearFilter(key)}
                aria-label={`Clear ${key} filter`}
                className="ml-1 shrink-0 hover:text-primary"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      {calendarMode && viewWindow ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodNavigator
            mode={calendarMode}
            label={viewWindow.label}
            onPrevious={() => setAnchor(shiftAnchor(calendarMode, anchor, -1, ganttScale))}
            onNext={() => setAnchor(shiftAnchor(calendarMode, anchor, 1, ganttScale))}
            onToday={() => setAnchor(null)}
          />
          {calendarMode === "gantt" ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="gantt-scale-control">
              <span className="text-xs font-medium text-muted-foreground">Timeline</span>
              <Tabs value={ganttScale} onValueChange={(value) => setGanttScale(value as GanttScale)}>
                <TabsList aria-label="Gantt timeline scale">
                  {GANTT_SCALES.map((scale) => (
                    <TabsTrigger key={scale.value} value={scale.value}>{scale.label}</TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : errorMessage ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : calendarMode === "gantt" && viewWindow ? (
        <CompanyGanttView rows={items} window={viewWindow} scale={ganttScale} today={today} canOpenJobs={!isDrafter} />
      ) : calendarMode === "week" && viewWindow ? (
        <CompanyWeekView rows={items} window={viewWindow} today={today} canOpenJobs={!isDrafter} />
      ) : calendarMode === "month" && viewWindow ? (
        <CompanyMonthView
          rows={items}
          window={viewWindow}
          anchor={anchor}
          today={today}
          canOpenJobs={!isDrafter}
          onOpenWeek={openWeekOf}
        />
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
          <Calendar className="mx-auto size-8 text-slate-400" />
          <div className="mt-4 text-lg font-semibold text-slate-900">No schedule items</div>
          <div className="mt-2 text-sm text-slate-500">Try adjusting your filters.</div>
        </div>
      ) : viewMode === "list" ? (
        <div className="space-y-8" data-testid="schedule-list">
          {groupedByJob.map((group) => (
            <section key={group.jobId}>
              <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">{group.clientName ?? ""}</div>
                  {isDrafter ? (
                    <div className="text-base font-semibold text-slate-900">
                      {group.jobTitle}
                    </div>
                  ) : (
                    <Link
                      to={group.jobId ? `/jobs/${group.jobId}/schedule` : "/jobs"}
                      className="text-base font-semibold text-slate-900 hover:text-primary"
                    >
                      {group.jobTitle}
                    </Link>
                  )}
                </div>
                {!isDrafter ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to={group.jobId ? `/jobs/${group.jobId}/schedule` : "/jobs"}>
                      Open job
                      <ChevronRight className="size-4" />
                    </Link>
                  </Button>
                ) : null}
              </div>
              <div className="divide-y divide-border">
                {group.rows.map((it) => {
                  const status = deriveStatus(it)
                  const content = (
                    <>
                      <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: it.displayColor || it.phaseColor || "#94a3b8" }} />
                        <span className="font-medium text-slate-900">{it.title}</span>
                        <Badge variant="outline" className={status.tone}>{status.label}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-slate-500">
                        <span>{formatDate(it.startDate)} → {formatDate(it.endDate)}</span>
                      </div>
                    </>
                  )
                  return isDrafter ? (
                    <div
                      key={it.id}
                      className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      {content}
                    </div>
                  ) : (
                    <Link
                      key={it.id}
                      to={it.jobId ? `/jobs/${it.jobId}/schedule?focus=${it.id}` : "/jobs"}
                      className="flex flex-col gap-1 rounded-sm py-3 outline-offset-2 transition-colors hover:text-primary sm:flex-row sm:items-center sm:justify-between [&:hover_.font-medium]:text-primary"
                    >
                      {content}
                    </Link>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col items-center gap-2 pt-1 sm:flex-row sm:justify-between">
        <div className="text-sm text-slate-500">
          {`${items.length} ${items.length === 1 ? "item" : "items"} loaded`}
        </div>
        {hasMore ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadItems(nextCursor)}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Loading…
              </>
            ) : (
              "Load more"
            )}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
