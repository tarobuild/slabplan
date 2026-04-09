import { useEffect, useState } from "react"
import { Link, Outlet, useLocation, useParams } from "react-router-dom"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { subscribeToDataRefresh } from "@/lib/data-refresh"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

type Job = {
  id: string
  title: string
  status: "open" | "closed" | "archived"
  city: string | null
  state: string | null
}

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-50 text-blue-700 border-blue-200",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
  archived: "bg-slate-50 text-slate-400 border-slate-200",
}

const TABS = [
  { label: "Schedule", path: "schedule" },
  { label: "Summary", path: "summary" },
  { label: "Files", path: "files/documents", matchPrefix: "files/" },
  { label: "Daily Logs", path: "daily-logs" },
]

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const location = useLocation()
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadJob = (showLoading = false) => {
    if (!jobId) return
    if (showLoading) {
      setLoading(true)
      setJob(null)
    }
    setError(null)

    api
      .get(`/jobs/${jobId}`)
      .then((r) => {
        setJob(r.data.job ?? r.data)
      })
      .catch(() => {
        setError("Unable to load this job.")
        toast.error("Failed to load job")
      })
      .finally(() => {
        if (showLoading) {
          setLoading(false)
        }
      })
  }

  useEffect(() => {
    loadJob(true)
  }, [jobId])

  useEffect(() => subscribeToDataRefresh("jobs", () => loadJob()), [jobId])

  if ((error && !job) || (!loading && !job)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 text-center">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-900">Job not found</h1>
          <p className="text-sm text-slate-500">{error ?? "This job could not be found."}</p>
        </div>
        <Link
          to="/jobs"
          className="text-sm font-medium text-orange-600 hover:text-orange-700"
        >
          Back to jobs
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-0">
      <div className="mb-3">
        {loading ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <Link
            to="/jobs"
            className="text-xs font-medium text-orange-600 hover:text-orange-700"
          >
            {job?.title}
          </Link>
        )}
      </div>

      <div className="flex items-center gap-3 pb-3">
        {loading ? (
          <Skeleton className="h-8 w-64" />
        ) : (
          <>
            {job?.status && (
              <Badge
                variant="outline"
                className={cn(
                  "capitalize text-xs shrink-0",
                  STATUS_COLORS[job.status],
                )}
              >
                {job.status}
              </Badge>
            )}
            {(job?.city || job?.state) && (
              <span className="text-sm text-slate-500">
                {[job.city, job.state].filter(Boolean).join(", ")}
              </span>
            )}
          </>
        )}
      </div>

      <div className="border-b border-[#E5E7EB]">
        <nav className="-mb-px flex gap-0 overflow-x-auto scrollbar-none">
          {TABS.map((tab) => {
            const isActive = tab.matchPrefix
              ? location.pathname.includes(`/${tab.matchPrefix}`)
              : location.pathname.endsWith(`/${tab.path}`)
            return (
              <Link
                key={tab.path}
                to={`/jobs/${jobId}/${tab.path}`}
                className={cn(
                  "shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-orange-500 text-orange-600"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900",
                )}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="pt-4">
        <Outlet context={{ job, setJob, jobId }} />
      </div>
    </div>
  )
}
