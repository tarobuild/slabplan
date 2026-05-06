import { useEffect, useMemo, useRef, useState } from "react"
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
import type { DailyLogListItem } from "@workspace/api-client-react"
import { api } from "@/lib/api"
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

type CursorPagination = { limit: number; hasMore: boolean; nextCursor: string | null }

type FeedResponse = {
  logs: DailyLogListItem[]
  pagination: CursorPagination | { page: number; pageSize: number; totalItems: number; totalPages: number }
}

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

export default function CompanyDailyLogsPage() {
  useDocumentTitle("Daily Logs")
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [logs, setLogs] = useState<DailyLogListItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [searchInput, setSearchInput] = useState(searchParams.get("keywords") ?? "")
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get("keywords") ?? "")
  const [clientOptions, setClientOptions] = useState<OptionRow[]>([])
  const [jobOptions, setJobOptions] = useState<OptionRow[]>([])
  const [authorOptions, setAuthorOptions] = useState<OptionRow[]>([])
  const loadRequestIdRef = useRef(0)

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

  useEffect(() => {
    let cancelled = false
    api
      .get<{ clients?: Array<{ id: string; companyName?: string | null; name?: string | null }> }>(
        "/clients?pageSize=200",
      )
      .then((r) => {
        if (cancelled) return
        setClientOptions((r.data.clients ?? []).map((c) => ({ id: c.id, label: c.companyName ?? c.name ?? c.id })))
      })
      .catch(() => {})
    api
      .get<{ jobs?: Array<{ id: string; title?: string | null; clientName?: string | null }> }>(
        "/jobs?pageSize=200",
      )
      .then((r) => {
        if (cancelled) return
        setJobOptions(
          (r.data.jobs ?? []).map((j) => ({
            id: j.id,
            label: j.clientName ? `${j.clientName} · ${j.title ?? j.id}` : (j.title ?? j.id),
          })),
        )
      })
      .catch(() => {})
    api
      .get<{ users?: Array<{ id: string; fullName?: string | null; email: string }> }>(
        "/users?roles=admin,project_manager,crew_member&limit=200",
      )
      .then((r) => {
        if (cancelled) return
        setAuthorOptions((r.data.users ?? []).map((u) => ({ id: u.id, label: u.fullName ?? u.email })))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

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

  async function loadLogs(cursor: string | null) {
    const isInitial = cursor === null
    const requestId = ++loadRequestIdRef.current
    if (isInitial) {
      setLoading(true)
      setErrorMessage("")
    } else {
      setLoadingMore(true)
    }
    try {
      const params: Record<string, string | number | boolean> = {
        cursor: cursor ?? "",
        limit: PAGE_LIMIT,
      }
      if (debouncedSearch.trim()) params.keywords = debouncedSearch.trim()
      for (const key of FILTER_KEYS) {
        const v = filters[key]
        if (v) params[key] = v
      }
      const response = await api.get<FeedResponse>("/daily-logs/feed", { params })
      if (requestId !== loadRequestIdRef.current) return
      const fetched = response.data.logs ?? []
      setLogs((prev) => (isInitial ? fetched : [...prev, ...fetched]))
      const pag = response.data.pagination as CursorPagination | undefined
      setHasMore(pag && "hasMore" in pag ? pag.hasMore : false)
      setNextCursor(pag && "nextCursor" in pag ? pag.nextCursor : null)
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) return
      setErrorMessage(apiErrorMessage(error, "Failed to load daily logs"))
      if (isInitial) {
        setLogs([])
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
    void loadLogs(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, JSON.stringify(filters)])

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
                onClick={() => void loadLogs(nextCursor)}
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
