import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  ChevronRight,
  Cloud,
  Clock,
  FileText,
  Loader2,
  Search,
  Users,
  X,
} from "lucide-react"
import {
  useDailyLogsGetDailyLogsFeed,
  useClientsGetClients,
  useJobsGetJobs,
  useUsersGetUsers,
  type CursorPagination as GeneratedCursorPagination,
  type DailyLogListItem,
  type DailyLogListResponse,
  type DailyLogsGetDailyLogsFeedParams,
  type ClientListItem,
  type JobListItem,
} from "@workspace/api-client-react"
import { apiErrorMessage } from "@/lib/api-errors"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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

const PAGE_LIMIT = 25

type CursorPagination = GeneratedCursorPagination

const FILTER_KEYS = [
  "clientId",
  "jobId",
  "createdBy",
  "from",
  "to",
  "hasAttachments",
  "hasComments",
] as const
type FilterKey = (typeof FILTER_KEYS)[number]

type OptionRow = { id: string; label: string }

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`))
}

function formatTimeShort(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d)
}

function summarizeWeather(log: DailyLogListItem): string | null {
  if (!log.includeWeather) return null
  const w = log.weatherData
  if (!w || typeof w !== "object") return null
  const obj = w as unknown as Record<string, unknown>
  const temp = obj.temperature ?? obj.temp ?? obj.tempF
  const cond = obj.condition ?? obj.summary ?? obj.description
  const parts: string[] = []
  if (typeof cond === "string" && cond.trim()) parts.push(cond.trim())
  if (typeof temp === "number") parts.push(`${Math.round(temp)}°`)
  else if (typeof temp === "string" && temp.trim()) parts.push(temp.trim())
  return parts.length > 0 ? parts.join(" · ") : null
}

function getCursorMeta(page: DailyLogListResponse | undefined): {
  hasMore: boolean
  nextCursor: string | null
} {
  const pag = page?.pagination as CursorPagination | undefined
  if (!pag) return { hasMore: false, nextCursor: null }
  const hasMore = "hasMore" in pag ? pag.hasMore : false
  const nextCursor = "nextCursor" in pag ? (pag.nextCursor ?? null) : null
  return { hasMore, nextCursor }
}

export default function CompanyDailyLogsPage() {
  useDocumentTitle("Daily Logs")
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchInput, setSearchInput] = useState(searchParams.get("keywords") ?? "")
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get("keywords") ?? "")

  const filters = useMemo<Partial<Record<FilterKey, string>>>(() => {
    const out: Partial<Record<FilterKey, string>> = {}
    for (const key of FILTER_KEYS) {
      const v = searchParams.get(key)
      if (v) out[key] = v
    }
    return out
  }, [searchParams])

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchInput), 300)
    return () => window.clearTimeout(id)
  }, [searchInput])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (debouncedSearch) next.set("keywords", debouncedSearch)
    else next.delete("keywords")
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
  }, [debouncedSearch, searchParams, setSearchParams])

  // Filter-option dropdowns are populated from the typed list endpoints. We
  // ask for the maximum page size each contract allows so the dropdowns
  // match what the underlying lists can deliver in one request.
  const clientsOptionsQuery = useClientsGetClients({ pageSize: 100 })
  const jobsOptionsQuery = useJobsGetJobs({ pageSize: 100 })
  const usersOptionsQuery = useUsersGetUsers({
    roles: "admin,project_manager,crew_member",
    limit: 200,
  })

  const clientOptions = useMemo<OptionRow[]>(() => {
    const list = clientsOptionsQuery.data?.clients ?? []
    return list.map((c: ClientListItem) => ({
      id: c.id,
      label: c.companyName ?? c.id,
    }))
  }, [clientsOptionsQuery.data])

  const jobOptions = useMemo<OptionRow[]>(() => {
    const list = jobsOptionsQuery.data?.jobs ?? []
    return list.map((j: JobListItem) => ({
      id: j.id,
      label: j.clientName ? `${j.clientName} · ${j.title ?? j.id}` : (j.title ?? j.id),
    }))
  }, [jobsOptionsQuery.data])

  const authorOptions = useMemo<OptionRow[]>(() => {
    // `usersGetUsers` is currently typed as `AnyValue`, so we narrow the
    // shape inline rather than across the whole file.
    const data = usersOptionsQuery.data as
      | { users?: Array<{ id: string; fullName?: string | null; email: string }> }
      | undefined
    return (data?.users ?? []).map((u) => ({
      id: u.id,
      label: u.fullName ?? u.email,
    }))
  }, [usersOptionsQuery.data])

  // Cursor pagination is modelled as an array of "page cursors". Index 0 is
  // always the initial fetch (`null` cursor); each Load-more click appends
  // the next cursor returned by the previous page. We only run a query for
  // the latest cursor; previously-loaded pages stay cached by their own
  // queryKey so users don't re-pay the network cost when revisiting.
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null])
  const [pages, setPages] = useState<DailyLogListResponse[]>([])

  // Reset pagination whenever a filter or the search term changes.
  useEffect(() => {
    setPageCursors([null])
    setPages([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, JSON.stringify(filters)])

  const currentCursor = pageCursors[pageCursors.length - 1]

  const feedParams = useMemo<DailyLogsGetDailyLogsFeedParams>(() => {
    const params: DailyLogsGetDailyLogsFeedParams = { limit: PAGE_LIMIT }
    if (currentCursor) params.cursor = currentCursor
    if (debouncedSearch.trim()) params.keywords = debouncedSearch.trim()
    // URL state stores filters as strings; coerce the boolean ones since
    // the typed query params expect actual booleans.
    if (filters.clientId) params.clientId = filters.clientId
    if (filters.jobId) params.jobId = filters.jobId
    if (filters.createdBy) params.createdBy = filters.createdBy
    if (filters.from) params.from = filters.from
    if (filters.to) params.to = filters.to
    if (filters.hasAttachments) params.hasAttachments = filters.hasAttachments === "true"
    if (filters.hasComments) params.hasComments = filters.hasComments === "true"
    return params
  }, [currentCursor, debouncedSearch, filters])

  const feedQuery = useDailyLogsGetDailyLogsFeed(feedParams)

  // Append the freshly-loaded page when its data resolves. We gate on
  // `isFetching` so a stale `data` reference (e.g. during the brief
  // transition between query keys) doesn't get appended twice.
  useEffect(() => {
    if (feedQuery.isFetching) return
    const data = feedQuery.data
    if (!data) return
    setPages((prev) => {
      const expectedIndex = pageCursors.length - 1
      // Refetch of the current page (e.g. after invalidation): replace it
      // in place rather than appending.
      if (prev.length > expectedIndex) {
        if (prev[expectedIndex] === data) return prev
        const next = prev.slice(0, expectedIndex)
        next.push(data)
        return next
      }
      // New page just loaded.
      if (prev.length === expectedIndex) {
        return [...prev, data]
      }
      // Should not happen, but reset defensively.
      return [data]
    })
  }, [feedQuery.data, feedQuery.isFetching, pageCursors.length])

  const errorMessage = feedQuery.error
    ? apiErrorMessage(feedQuery.error, "Failed to load daily logs")
    : ""

  const logs: DailyLogListItem[] = useMemo(
    () => pages.flatMap((p) => p.logs ?? []),
    [pages],
  )

  const lastPage = pages[pages.length - 1]
  const { hasMore, nextCursor } = getCursorMeta(lastPage)

  const isInitialLoad = pages.length === 0
  const loading = isInitialLoad && feedQuery.isFetching && !errorMessage
  const loadingMore = !isInitialLoad && feedQuery.isFetching

  function setFilter(key: FilterKey, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value && value !== "__all__") next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  function toggleBoolFilter(key: "hasAttachments" | "hasComments", checked: boolean) {
    const next = new URLSearchParams(searchParams)
    if (checked) next.set(key, "true")
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  function clearFilter(key: FilterKey) {
    const next = new URLSearchParams(searchParams)
    next.delete(key)
    setSearchParams(next, { replace: true })
  }

  function clearAllFilters() {
    setSearchInput("")
    setSearchParams(new URLSearchParams(), { replace: true })
  }

  function loadMore() {
    if (!hasMore || !nextCursor) return
    if (feedQuery.isFetching) return
    setPageCursors((prev) => [...prev, nextCursor])
  }

  const activeChips = FILTER_KEYS.filter((k) => filters[k])

  function chipLabel(key: FilterKey, value: string) {
    if (key === "clientId") return clientOptions.find((c) => c.id === value)?.label ?? value
    if (key === "jobId") return jobOptions.find((j) => j.id === value)?.label ?? value
    if (key === "createdBy") return authorOptions.find((a) => a.id === value)?.label ?? value
    if (key === "hasAttachments") return "Has attachments"
    if (key === "hasComments") return "Has comments"
    return value
  }

  // Group logs by their logDate so the feed reads as a calendar of work
  // (newest-day first); within a day we keep the server's order.
  const groupedByDate = useMemo(() => {
    const map = new Map<string, DailyLogListItem[]>()
    for (const log of logs) {
      const key = log.logDate
      const arr = map.get(key) ?? []
      arr.push(log)
      map.set(key, arr)
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [logs])

  return (
    <div className="space-y-5" data-testid="company-daily-logs-page">
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Company</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Daily Logs</h1>
        <p className="mt-1 text-sm text-slate-500">All daily logs across every job and client.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search daily logs"
            className="pl-9"
            data-testid="daily-logs-search-input"
          />
        </div>
        {activeChips.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            Clear all
          </Button>
        ) : null}
      </div>

      <div
        className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
        data-testid="daily-logs-filters"
      >
        <div className="space-y-1">
          <Label className="text-xs">Client</Label>
          <Select value={filters.clientId ?? "__all__"} onValueChange={(v) => setFilter("clientId", v)}>
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
          <Select value={filters.jobId ?? "__all__"} onValueChange={(v) => setFilter("jobId", v)}>
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
          <Label className="text-xs">Author</Label>
          <Select value={filters.createdBy ?? "__all__"} onValueChange={(v) => setFilter("createdBy", v)}>
            <SelectTrigger data-testid="filter-select-createdBy"><SelectValue placeholder="Anyone" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Anyone</SelectItem>
              {authorOptions.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
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
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={filters.hasAttachments === "true"}
            onCheckedChange={(v) => toggleBoolFilter("hasAttachments", Boolean(v))}
            data-testid="filter-check-hasAttachments"
          />
          Has attachments
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={filters.hasComments === "true"}
            onCheckedChange={(v) => toggleBoolFilter("hasComments", Boolean(v))}
            data-testid="filter-check-hasComments"
          />
          Has comments
        </label>
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
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : errorMessage ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : logs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
          <FileText className="mx-auto size-8 text-slate-400" />
          <div className="mt-4 text-lg font-semibold text-slate-900">No daily logs found</div>
          <div className="mt-2 text-sm text-slate-500">Try adjusting your filters.</div>
        </div>
      ) : (
        <>
          <div className="space-y-6" data-testid="daily-logs-feed">
            {groupedByDate.map(([date, dayLogs]) => (
              <div key={date} data-testid={`daily-logs-day-${date}`}>
                <div className="sticky top-0 z-[1] bg-slate-50/90 px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur">
                  {formatDateLabel(date)}
                </div>
                <div className="space-y-3">
                  {dayLogs.map((log) => {
                    const weather = summarizeWeather(log)
                    return (
                      <div
                        key={log.id}
                        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                        data-testid="daily-log-card"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                to={log.jobId ? `/jobs/${log.jobId}/daily-logs?focus=${log.id}` : "/jobs"}
                                className="text-lg font-semibold text-slate-950 hover:text-orange-700"
                              >
                                {log.title || "Daily Log"}
                              </Link>
                              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                                {log.status}
                              </Badge>
                              <Badge
                                variant="outline"
                                className="gap-1 border-slate-200 bg-slate-50 text-slate-700"
                                data-testid="daily-log-time-chip"
                              >
                                <Clock className="size-3.5" />
                                {formatTimeShort(log.createdAt)}
                              </Badge>
                              {weather ? (
                                <Badge
                                  variant="outline"
                                  className="gap-1 border-sky-200 bg-sky-50 text-sky-700"
                                  data-testid="daily-log-weather-chip"
                                >
                                  <Cloud className="size-3.5" />
                                  {weather}
                                </Badge>
                              ) : null}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                              {log.clientName ? (
                                <Link
                                  to={`/clients/${log.clientId}`}
                                  className="font-medium text-slate-700 hover:text-orange-700"
                                >
                                  {log.clientName}
                                </Link>
                              ) : null}
                              <span>{log.jobTitle || "Unknown job"}</span>
                              <span data-testid="daily-log-author">
                                by {log.createdByName ?? "Unknown"}
                              </span>
                              <Badge variant="outline" className="gap-1 border-slate-200 bg-slate-50 text-slate-700">
                                <Users className="size-3.5" />
                                {log.visibilityLabel || "Internal"}
                              </Badge>
                              <span>{log.attachmentCount ?? 0} files</span>
                              <span>{log.commentsCount ?? 0} comments</span>
                              <span>{log.likesCount ?? 0} likes</span>
                            </div>
                            <p
                              className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-6 text-slate-600 [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box] [overflow:hidden]"
                              data-testid="daily-log-preview"
                            >
                              {log.notes?.trim() ? log.notes : "No notes added."}
                            </p>
                          </div>
                          <Button asChild variant="outline" className="shrink-0">
                            <Link to={log.jobId ? `/jobs/${log.jobId}/daily-logs?focus=${log.id}` : "/jobs"}>
                              Open
                              <ChevronRight className="size-4" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col items-center gap-2 pt-1 sm:flex-row sm:justify-between">
            <div className="text-sm text-slate-500">
              {`${logs.length} ${logs.length === 1 ? "item" : "items"} loaded`}
            </div>
            {hasMore ? (
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
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
        </>
      )}
    </div>
  )
}
