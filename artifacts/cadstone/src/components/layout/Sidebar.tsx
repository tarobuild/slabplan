import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  ArrowUpDown,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Job = {
  id: string
  title: string
  status: "open" | "closed" | "archived"
  city: string | null
  state: string | null
}

const STATUS_DOT: Record<string, string> = {
  open: "bg-blue-500",
  closed: "bg-slate-400",
  archived: "bg-slate-300",
}

export default function Sidebar({ mobile = false }: { mobile?: boolean }) {
  const { jobId } = useParams<{ jobId?: string }>()
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<Job[]>([])
  const [search, setSearch] = useState("")
  const [sortAsc, setSortAsc] = useState(true)
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    api
      .get("/jobs?limit=200&status=open")
      .then((r) => setJobs(r.data.jobs ?? r.data ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: "nearest" })
    }
  }, [jobId, jobs.length])

  const filtered = jobs
    .filter((j) => j.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      sortAsc ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title),
    )

  const openCount = jobs.filter((j) => j.status === "open").length

  const inner = (
    <div className="flex h-full flex-col border-r border-[#E5E7EB] bg-white">
      <div className="border-b border-[#E5E7EB] p-2.5">
        <Button
          className="w-full bg-blue-600 text-white hover:bg-blue-700"
          size="sm"
          onClick={() => navigate("/jobs")}
        >
          <Plus className="size-4" />
          New Job
        </Button>
      </div>

      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <span>Jobs</span>
          <span className="text-xs text-slate-400">({openCount})</span>
        </div>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-slate-400 hover:text-slate-600"
            title="Filter"
          >
            <SlidersHorizontal className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-slate-400 hover:text-slate-600"
            title="Sort"
            onClick={() => setSortAsc((v) => !v)}
          >
            <ArrowUpDown className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="px-2.5 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs…"
            className="h-7 border-[#E5E7EB] pl-8 text-xs shadow-none"
          />
        </div>
      </div>

      {jobId && (
        <div className="border-b border-[#E5E7EB] px-2.5 pb-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start px-2 text-xs text-slate-500 hover:text-slate-900"
            asChild
          >
            <Link to="/jobs">
              <ArrowLeft className="size-3.5" />
              Back to Jobs
            </Link>
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-slate-400">
            {search ? "No jobs match your search" : "No open jobs"}
          </p>
        )}
        {filtered.map((job) => {
          const isActive = job.id === jobId
          return (
            <button
              key={job.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => navigate(`/jobs/${job.id}/summary`)}
              className={cn(
                "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-slate-50",
                isActive && "bg-blue-50 hover:bg-blue-50",
              )}
            >
              <span
                className={cn(
                  "mt-1 size-2 shrink-0 rounded-full",
                  STATUS_DOT[job.status] ?? "bg-slate-400",
                )}
              />
              <div className="min-w-0">
                <p
                  className={cn(
                    "truncate text-sm font-medium leading-snug",
                    isActive ? "text-blue-700" : "text-slate-900",
                  )}
                >
                  {job.title}
                </p>
                {(job.city || job.state) && (
                  <p className="truncate text-xs text-slate-400">
                    {[job.city, job.state].filter(Boolean).join(", ")}
                  </p>
                )}
                {isActive && (
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-500">
                    Open
                  </p>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )

  if (mobile) {
    return <div className="h-64 overflow-hidden rounded-lg border border-[#E5E7EB] shadow-sm">{inner}</div>
  }

  return inner
}
