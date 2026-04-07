import { useEffect, useState } from "react"
import { Link, NavLink, Outlet, useParams } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

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

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!jobId) return
    api.get(`/jobs/${jobId}`)
      .then(r => setJob(r.data.job ?? r.data))
      .finally(() => setLoading(false))
  }, [jobId])

  const tabs = [
    { label: "Summary", to: `/jobs/${jobId}/summary` },
    { label: "Documents", to: `/jobs/${jobId}/files/documents` },
    { label: "Photos", to: `/jobs/${jobId}/files/photos` },
    { label: "Videos", to: `/jobs/${jobId}/files/videos` },
    { label: "Schedule", to: `/jobs/${jobId}/schedule` },
    { label: "Daily Logs", to: `/jobs/${jobId}/daily-logs` },
  ]

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1.5 text-sm text-slate-500">
        <Link to="/jobs" className="hover:text-slate-900">Jobs</Link>
        <ChevronRight className="size-3.5" />
        {loading ? (
          <Skeleton className="h-4 w-32" />
        ) : (
          <span className="text-slate-900 font-medium">{job?.title}</span>
        )}
      </nav>

      <div className="flex items-center gap-3">
        {loading ? (
          <Skeleton className="h-7 w-48" />
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-900">{job?.title}</h1>
            {job?.status && (
              <Badge variant="outline" className={`capitalize text-xs ${STATUS_COLORS[job.status]}`}>
                {job.status}
              </Badge>
            )}
          </>
        )}
      </div>

      <div className="border-b border-[#E5E7EB]">
        <nav className="flex gap-0 -mb-px">
          {tabs.map(tab => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                  isActive
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300"
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <Outlet context={{ job, setJob, jobId }} />
    </div>
  )
}
