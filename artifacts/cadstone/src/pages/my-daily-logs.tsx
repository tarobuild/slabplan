import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronRight, FileText, Search, Users } from "lucide-react"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

type MyDailyLogItem = {
  id: string
  jobId: string | null
  jobTitle: string | null
  logDate: string
  title: string | null
  notes: string
  visibilityLabel: string
  attachmentCount: number
  commentsCount: number
  likesCount: number
  status: "draft" | "published"
}

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

function apiError(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null) {
    const value = error as { response?: { data?: { message?: string } }; message?: string }
    return value.response?.data?.message ?? value.message ?? fallback
  }
  return fallback
}

export default function MyDailyLogsPage() {
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [logs, setLogs] = useState<MyDailyLogItem[]>([])
  const [errorMessage, setErrorMessage] = useState("")

  useEffect(() => {
    setLoading(true)
    setErrorMessage("")

    api
      .get<{ logs: MyDailyLogItem[] }>("/daily-logs/mine", {
        params: {
          page: 1,
          pageSize: 100,
          keywords: search.trim() || undefined,
        },
      })
      .then((response) => setLogs(response.data.logs ?? []))
      .catch((error) => setErrorMessage(apiError(error, "Failed to load your daily logs")))
      .finally(() => setLoading(false))
  }, [search])

  const groupedLogs = useMemo(() => logs, [logs])

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Dashboard</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">My Daily Logs</h1>
        <p className="mt-1 text-sm text-slate-500">Recent daily logs created by your account across all jobs.</p>
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
            <Skeleton key={index} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : errorMessage ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : groupedLogs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
          <FileText className="mx-auto size-8 text-slate-400" />
          <div className="mt-4 text-lg font-semibold text-slate-900">No daily logs found</div>
          <div className="mt-2 text-sm text-slate-500">Daily logs you create will appear here across all jobs.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedLogs.map((log) => (
            <div key={log.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={log.jobId ? `/jobs/${log.jobId}/daily-logs` : "/jobs"}
                      className="text-lg font-semibold text-slate-950 hover:text-blue-700"
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
      )}
    </div>
  )
}
