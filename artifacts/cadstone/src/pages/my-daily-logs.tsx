import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronRight, FileText, Loader2, Search, Users } from "lucide-react"
import {
  dailyLogAdminGetDailyLogsMine,
  type DailyLogAdminGetDailyLogsMineParams,
  type DailyLogListItem,
} from "@workspace/api-client-react"
import { DailyLogAdminGetDailyLogsMineQueryParams } from "@workspace/api-zod"
import { apiErrorMessage } from "@/lib/api-errors"
import { validatePayload } from "@/lib/validate-payload"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

type MyDailyLogItem = DailyLogListItem

const PAGE_LIMIT = 25

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`))
}

function truncateText(value: string, maxLength = 200) {
  if (!value) return "No notes added."
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

function titleForLog(log: MyDailyLogItem) {
  return `${formatDate(log.logDate)} | ${log.title || "Daily Log"}`
}

export default function MyDailyLogsPage() {
  useDocumentTitle("My daily logs")
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [logs, setLogs] = useState<MyDailyLogItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const loadRequestIdRef = useRef(0)

  const clientFilterId = (() => {
    if (typeof window === "undefined") return null
    const sp = new URLSearchParams(window.location.search)
    const cid = sp.get("client")
    return cid && cid.length > 0 ? cid : null
  })()
  const [clientFilterName, setClientFilterName] = useState<string | null>(null)
  useEffect(() => {
    if (!clientFilterId) {
      setClientFilterName(null)
      return
    }
    let cancelled = false
    import("@/lib/api").then(({ api }) =>
      api
        .get(`/clients/${clientFilterId}`)
        .then((r) => {
          if (!cancelled) setClientFilterName(r.data?.client?.companyName ?? null)
        })
        .catch(() => {
          if (!cancelled) setClientFilterName(null)
        }),
    )
    return () => {
      cancelled = true
    }
  }, [clientFilterId])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search)
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [search])

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
      const trimmed = debouncedSearch.trim()
      const requestParams: DailyLogAdminGetDailyLogsMineParams = {
        cursor: cursor ?? "",
        limit: PAGE_LIMIT,
        ...(trimmed ? { keywords: trimmed } : {}),
        ...(clientFilterId ? { clientId: clientFilterId } : {}),
      }

      const validated = validatePayload(
        DailyLogAdminGetDailyLogsMineQueryParams,
        requestParams,
      )
      if (!validated) {
        if (isInitial) {
          setLogs([])
          setHasMore(false)
          setNextCursor(null)
        }
        return
      }

      const response = await dailyLogAdminGetDailyLogsMine(validated)

      if (requestId !== loadRequestIdRef.current) return

      const fetched: MyDailyLogItem[] = response.logs ?? []
      setLogs((previous) => (isInitial ? fetched : [...previous, ...fetched]))
      const pagination = response.pagination
      const cursorPagination =
        pagination && "hasMore" in pagination ? pagination : null
      setHasMore(cursorPagination?.hasMore ?? false)
      setNextCursor(cursorPagination?.nextCursor ?? null)
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) return
      setErrorMessage(apiErrorMessage(error, "Failed to load your daily logs"))
      if (isInitial) {
        setLogs([])
        setHasMore(false)
        setNextCursor(null)
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        if (isInitial) {
          setLoading(false)
        } else {
          setLoadingMore(false)
        }
      }
    }
  }

  async function loadMoreLogs() {
    if (!nextCursor || loadingMore) return
    await loadLogs(nextCursor)
  }

  useEffect(() => {
    setNextCursor(null)
    setHasMore(false)
    void loadLogs(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Dashboard</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">My Daily Logs</h1>
        <p className="mt-1 text-sm text-slate-500">Recent daily logs created by your account across all jobs.</p>
        {clientFilterId ? (
          <div className="mt-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
              Client: {clientFilterName ?? "Loading…"}
              <Link
                to="/daily-logs/mine"
                aria-label="Clear client filter"
                className="ml-1 text-orange-700 hover:text-orange-900"
              >
                ×
              </Link>
            </span>
          </div>
        ) : null}
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search my daily logs"
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-40 rounded-xl" />
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
          <div className="mt-2 text-sm text-slate-500">Daily logs you create will appear here across all jobs.</div>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {logs.map((log) => (
              <div key={log.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={log.jobId ? `/jobs/${log.jobId}/daily-logs` : "/jobs"}
                        className="text-lg font-semibold text-slate-950 hover:text-orange-700"
                      >
                        {titleForLog(log)}
                      </Link>
                      <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                        {log.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                      <span>{log.jobTitle || "Unknown job"}</span>
                      <Badge variant="outline" className="gap-1 border-slate-200 bg-slate-50 text-slate-700">
                        <Users className="size-3.5" />
                        {log.visibilityLabel || "Internal"}
                      </Badge>
                      <span>{log.attachmentCount} files</span>
                      <span>{log.commentsCount} comments</span>
                      <span>{log.likesCount} likes</span>
                    </div>
                    <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">
                      {truncateText(log.notes)}
                    </p>
                  </div>
                  <Button asChild variant="outline" className="shrink-0">
                    <Link to={log.jobId ? `/jobs/${log.jobId}/daily-logs` : "/jobs"}>
                      Open Job
                      <ChevronRight className="size-4" />
                    </Link>
                  </Button>
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
                onClick={() => void loadMoreLogs()}
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
