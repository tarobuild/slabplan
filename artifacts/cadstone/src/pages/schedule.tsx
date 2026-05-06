import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Calendar, ChevronRight, Loader2, X } from "lucide-react"
import type { ScheduleItem } from "@workspace/api-client-react"
import { api } from "@/lib/api"
import { apiErrorMessage } from "@/lib/api-errors"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const PAGE_LIMIT = 50

type ScheduleRow = ScheduleItem & {
  jobTitle?: string | null
  clientId?: string | null
  clientName?: string | null
}

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

function formatDate(value: string | null | undefined) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`))
}

function deriveStatus(item: ScheduleRow): { label: string; tone: string } {
  if (item.isComplete) return { label: "Complete", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" }
  const today = new Date().toISOString().slice(0, 10)
  if (item.endDate && item.endDate < today) return { label: "Overdue", tone: "border-rose-200 bg-rose-50 text-rose-700" }
  if (item.startDate && item.startDate <= today && item.endDate && item.endDate >= today) {
    return { label: "In progress", tone: "border-blue-200 bg-blue-50 text-blue-700" }
  }
  return { label: "Upcoming", tone: "border-slate-200 bg-slate-50 text-slate-600" }
}

export default function CompanySchedulePage() {
  useDocumentTitle("Schedule")
  const [searchParams, setSearchParams] = useSearchParams()
  const [items, setItems] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
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

  function setView(next: ViewMode) {
    const sp = new URLSearchParams(searchParams)
    sp.set("view", next)
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
    setSearchParams(sp, { replace: true })
  }

  // Lightweight option lists for filter selects. These tolerate failures
  // (selects fall back to "All ...") so the page always renders.
  useEffect(() => {
    let cancelled = false
    api
      .get<{ clients?: Array<{ id: string; companyName?: string | null; name?: string | null }> }>(
        "/clients?pageSize=200",
      )
      .then((r) => {
        if (cancelled) return
        const rows = (r.data.clients ?? []).map((c) => ({
          id: c.id,
          label: c.companyName ?? c.name ?? c.id,
        }))
        setClientOptions(rows)
      })
      .catch(() => {})
    api
      .get<{ jobs?: Array<{ id: string; title?: string | null; clientName?: string | null }> }>(
        "/jobs?pageSize=200",
      )
      .then((r) => {
        if (cancelled) return
        const rows = (r.data.jobs ?? []).map((j) => ({
          id: j.id,
          label: j.clientName ? `${j.clientName} · ${j.title ?? j.id}` : (j.title ?? j.id),
        }))
        setJobOptions(rows)
      })
      .catch(() => {})
    api
      .get<{ users?: Array<{ id: string; fullName?: string | null; email: string }> }>(
        "/users?roles=admin,project_manager,crew_member&limit=200",
      )
      .then((r) => {
        if (cancelled) return
        const rows = (r.data.users ?? []).map((u) => ({
          id: u.id,
          label: u.fullName ?? u.email,
        }))
        setAssigneeOptions(rows)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function loadItems(cursor: string | null) {
    const isInitial = cursor === null
    const requestId = ++loadRequestIdRef.current
    if (isInitial) {
      setLoading(true)
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
  }, [JSON.stringify(filters)])

  const activeChips = FILTER_KEYS.filter((k) => filters[k])

  function chipLabel(key: FilterKey, value: string) {
    if (key === "clientId") return clientOptions.find((c) => c.id === value)?.label ?? value
    if (key === "jobId") return jobOptions.find((j) => j.id === value)?.label ?? value
    if (key === "assigneeId") return assigneeOptions.find((a) => a.id === value)?.label ?? value
    if (key === "status") return STATUS_OPTIONS.find((s) => s.value === value)?.label ?? value
    return value
  }

  // Group rows by start-date bucket for gantt/week/month and by job for list.
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

  const groupedByDate = useMemo(() => {
    const map = new Map<string, ScheduleRow[]>()
    for (const it of items) {
      const key = it.startDate ?? "—"
      const arr = map.get(key) ?? []
      arr.push(it)
      map.set(key, arr)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [items])

  return (
    <div className="space-y-5" data-testid="company-schedule-page">
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Company</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Schedule</h1>
        <p className="mt-1 text-sm text-slate-500">All schedule items across every job and client.</p>
      </div>

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
        className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-6"
        data-testid="schedule-filters"
      >
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select
            value={filters.clientId ?? "__all__"}
            onValueChange={(v) => setFilter("clientId", v)}
          >
            <SelectTrigger data-testid="filter-select-clientId"><SelectValue placeholder="All clients" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All clients</SelectItem>
              {clientOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Job</Label>
          <Select
            value={filters.jobId ?? "__all__"}
            onValueChange={(v) => setFilter("jobId", v)}
          >
            <SelectTrigger data-testid="filter-select-jobId"><SelectValue placeholder="All jobs" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All jobs</SelectItem>
              {jobOptions.map((j) => (
                <SelectItem key={j.id} value={j.id}>{j.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Assignee</Label>
          <Select
            value={filters.assigneeId ?? "__all__"}
            onValueChange={(v) => setFilter("assigneeId", v)}
          >
            <SelectTrigger data-testid="filter-select-assigneeId"><SelectValue placeholder="Anyone" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Anyone</SelectItem>
              {assigneeOptions.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select
            value={filters.status ?? "__all__"}
            onValueChange={(v) => setFilter("status", v)}
          >
            <SelectTrigger data-testid="filter-select-status"><SelectValue placeholder="Any status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Any status</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            value={filters.from ?? ""}
            onChange={(e) => setFilter("from", e.target.value)}
            data-testid="filter-input-from"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            value={filters.to ?? ""}
            onChange={(e) => setFilter("to", e.target.value)}
            data-testid="filter-input-to"
          />
        </div>
      </div>

      {activeChips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {activeChips.map((key) => (
            <Badge
              key={key}
              variant="outline"
              className="gap-1 border-orange-200 bg-orange-50 text-orange-700"
              data-testid={`filter-chip-${key}`}
            >
              {key}: {chipLabel(key, filters[key]!)}
              <button
                type="button"
                onClick={() => clearFilter(key)}
                aria-label={`Clear ${key} filter`}
                className="ml-1 hover:text-orange-900"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : errorMessage ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
          <Calendar className="mx-auto size-8 text-slate-400" />
          <div className="mt-4 text-lg font-semibold text-slate-900">No schedule items</div>
          <div className="mt-2 text-sm text-slate-500">Try adjusting your filters.</div>
        </div>
      ) : viewMode === "list" ? (
        <div className="space-y-6" data-testid="schedule-list">
          {groupedByJob.map((group) => (
            <div key={group.jobId} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wide text-slate-400">{group.clientName ?? ""}</div>
                  <Link
                    to={group.jobId ? `/jobs/${group.jobId}/schedule` : "/jobs"}
                    className="text-base font-semibold text-slate-900 hover:text-orange-700"
                  >
                    {group.jobTitle}
                  </Link>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to={group.jobId ? `/jobs/${group.jobId}/schedule` : "/jobs"}>
                    Open job
                    <ChevronRight className="size-4" />
                  </Link>
                </Button>
              </div>
              <div className="divide-y divide-slate-100">
                {group.rows.map((it) => {
                  const status = deriveStatus(it)
                  return (
                    <Link
                      key={it.id}
                      to={it.jobId ? `/jobs/${it.jobId}/schedule?focus=${it.id}` : "/jobs"}
                      className="flex flex-col gap-1 px-5 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: it.displayColor || it.phaseColor || "#94a3b8" }} />
                        <span className="font-medium text-slate-900">{it.title}</span>
                        <Badge variant="outline" className={status.tone}>{status.label}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-slate-500">
                        <span>{formatDate(it.startDate)} → {formatDate(it.endDate)}</span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4" data-testid={`schedule-${viewMode}`}>
          {groupedByDate.map(([date, rows]) => (
            <div key={date} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-2 text-sm font-semibold text-slate-700">
                {formatDate(date)}
              </div>
              <div className="divide-y divide-slate-100">
                {rows.map((it) => {
                  const status = deriveStatus(it)
                  return (
                    <Link
                      key={it.id}
                      to={it.jobId ? `/jobs/${it.jobId}/schedule?focus=${it.id}` : "/jobs"}
                      className="flex items-center justify-between px-5 py-3 hover:bg-slate-50"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: it.displayColor || it.phaseColor || "#94a3b8" }} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900">{it.title}</div>
                          <div className="truncate text-xs text-slate-500">
                            {it.clientName ? `${it.clientName} · ` : ""}{it.jobTitle ?? ""}
                          </div>
                        </div>
                      </div>
                      <Badge variant="outline" className={status.tone}>{status.label}</Badge>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

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
