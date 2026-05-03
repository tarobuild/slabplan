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
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { subscribeToDataRefresh } from "@/lib/data-refresh"
import { cn } from "@/lib/utils"
import { classifyApiError } from "@/lib/api-errors"

type Job = {
  id: string
  title: string
  status: "open" | "closed" | "archived"
  city: string | null
  state: string | null
}

type StatusFilter = "open" | "closed" | "archived" | "all"

const STATUS_DOT: Record<string, string> = {
  open: "bg-green-500",
  closed: "bg-slate-400",
  archived: "bg-slate-300",
}

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
]

const EMPTY_COPY: Record<StatusFilter, string> = {
  open: "No open jobs",
  closed: "No closed jobs",
  archived: "No archived jobs",
  all: "No jobs",
}

const STATUS_FILTER_STORAGE_KEY = "cadstone:sidebar:statusFilter"
const SEARCH_STORAGE_KEY = "cadstone:sidebar:search"
const SORT_ASC_STORAGE_KEY = "cadstone:sidebar:sortAsc"

function isStatusFilter(value: unknown): value is StatusFilter {
  return (
    value === "open" ||
    value === "closed" ||
    value === "archived" ||
    value === "all"
  )
}

function readStoredStatusFilter(): StatusFilter {
  if (typeof window === "undefined") return "open"
  try {
    const stored = window.localStorage.getItem(STATUS_FILTER_STORAGE_KEY)
    return isStatusFilter(stored) ? stored : "open"
  } catch {
    return "open"
  }
}

function readStoredSearch(): string {
  if (typeof window === "undefined") return ""
  try {
    return window.localStorage.getItem(SEARCH_STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

function readStoredSortAsc(): boolean {
  if (typeof window === "undefined") return true
  try {
    const stored = window.localStorage.getItem(SORT_ASC_STORAGE_KEY)
    if (stored === "true") return true
    if (stored === "false") return false
    return true
  } catch {
    return true
  }
}

export default function Sidebar() {
  const { jobId } = useParams<{ jobId?: string }>()
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.user?.role === "admin")
  const [jobs, setJobs] = useState<Job[]>([])
  const [search, setSearch] = useState(readStoredSearch)
  const [sortAsc, setSortAsc] = useState(readStoredSortAsc)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    readStoredStatusFilter,
  )
  const [filterOpen, setFilterOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const activeRef = useRef<HTMLButtonElement | null>(null)

  const loadJobs = () => {
    setErrorMessage(null)

    api
      .get("/jobs?pageSize=100")
      .then((r) => setJobs(r.data.jobs ?? r.data ?? []))
      .catch((err: unknown) => {
        const classified = classifyApiError(err, "Couldn't refresh jobs right now.")
        // The global axios interceptor already toasts (and, for 403, redirects)
        // for forbidden / session-expired responses. Mirror that here with an
        // inline note that matches what the toast just said.
        let message: string
        if (classified.kind === "toast") {
          message = classified.message
        } else if (classified.kind === "session-expired") {
          message = "Your session expired — please sign in again."
        } else {
          message = "You don't have permission to view jobs."
        }
        setErrorMessage(message)
      })
  }

  useEffect(() => {
    loadJobs()
  }, [])

  useEffect(() => subscribeToDataRefresh("navigation", () => loadJobs()), [])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(STATUS_FILTER_STORAGE_KEY, statusFilter)
    } catch {
      // Ignore storage failures (e.g. private mode quota errors).
    }
  }, [statusFilter])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(SEARCH_STORAGE_KEY, search)
    } catch {
      // Ignore storage failures (e.g. private mode quota errors).
    }
  }, [search])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(SORT_ASC_STORAGE_KEY, sortAsc ? "true" : "false")
    } catch {
      // Ignore storage failures (e.g. private mode quota errors).
    }
  }, [sortAsc])

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: "nearest" })
    }
  }, [jobId, jobs.length])

  const statusFiltered = jobs.filter(
    (j) => statusFilter === "all" || j.status === statusFilter,
  )

  const filtered = statusFiltered
    .filter((j) => j.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      sortAsc ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title),
    )

  const filteredCount = statusFiltered.length
  const isFilterActive = statusFilter !== "open"

  // Resolve the active job for the "Current Job" banner. The sidebar list may
  // be filtered (or the active job may not be in the loaded slice), so fall
  // back to a direct fetch by id when we can't find it locally.
  useEffect(() => {
    if (!jobId) {
      setActiveJob(null)
      return
    }

    const fromList = jobs.find((j) => j.id === jobId)
    if (fromList) {
      setActiveJob(fromList)
      return
    }

    // Clear any stale active job from a previous route before the fetch
    // resolves, but keep the current one if it already matches `jobId` —
    // otherwise a background `jobs` reload would flicker the banner to
    // "Loading…" and back to the same title.
    setActiveJob((current) => (current?.id === jobId ? current : null))

    let cancelled = false

    api
      .get(`/jobs/${jobId}`)
      .then((r) => {
        if (cancelled) return

        const job = r.data?.job
        if (!job) {
          setActiveJob((current) => (current?.id === jobId ? null : current))
          return
        }

        setActiveJob({
          id: job.id,
          title: job.title,
          status: job.status,
          city: job.city ?? null,
          state: job.state ?? null,
        })
      })
      .catch(() => {
        if (cancelled) return
        setActiveJob((current) => (current?.id === jobId ? null : current))
      })

    return () => {
      cancelled = true
    }
  }, [jobId, jobs])

  return (
    <div className="flex h-full flex-col border-r border-[#E5E7EB] bg-white">
      {jobId && (
        <div className="sticky top-0 z-10 border-b border-orange-100 bg-orange-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-orange-700/70">
            Current Job
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">
            {activeJob?.title ?? "Loading…"}
          </p>
          <Link
            to="/jobs"
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-orange-700 hover:text-orange-800"
          >
            <ArrowLeft className="size-3.5" />
            All Jobs
          </Link>
        </div>
      )}
      {isAdmin ? (
        <div className="border-b border-[#E5E7EB] p-2.5">
          <Button
            variant="orange"
            className="w-full"
            size="sm"
            onClick={() => navigate("/jobs", { state: { openCreate: true } })}
          >
            <Plus className="size-4" />
            New Job
          </Button>
        </div>
      ) : null}

      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <span>Jobs</span>
          <span className="text-xs text-slate-400">({filteredCount})</span>
        </div>
        <div className="flex items-center">
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "relative size-6 text-slate-400 hover:text-slate-600",
                  isFilterActive && "text-orange-600 hover:text-orange-700",
                )}
                title="Filter"
                aria-label="Filter jobs by status"
              >
                <SlidersHorizontal className="size-3.5" />
                {isFilterActive && (
                  <span
                    aria-hidden
                    className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-orange-500"
                  />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-40 p-1">
              <div role="radiogroup" aria-label="Filter jobs by status">
                {STATUS_FILTER_OPTIONS.map((option) => {
                  const selected = statusFilter === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setStatusFilter(option.value)
                        setFilterOpen(false)
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs hover:bg-slate-100",
                        selected
                          ? "font-medium text-orange-700"
                          : "text-slate-700",
                      )}
                    >
                      <span>{option.label}</span>
                      {selected && (
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full bg-orange-500"
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-slate-400 hover:text-slate-600"
            aria-label={
              sortAsc
                ? "Sort jobs A to Z (click to switch to Z to A)"
                : "Sort jobs Z to A (click to switch to A to Z)"
            }
            onClick={() => setSortAsc((v) => !v)}
          >
            <ArrowUpDown aria-hidden="true" className="size-3.5" />
            <span className="sr-only">
              {sortAsc ? "Sorted A to Z" : "Sorted Z to A"}
            </span>
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

      {errorMessage ? (
        <div className="mx-2.5 mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-amber-800">{errorMessage}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-amber-900 hover:text-amber-950"
              onClick={loadJobs}
            >
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-slate-400">
            {search ? "No jobs match your search" : EMPTY_COPY[statusFilter]}
          </p>
        )}
        {filtered.map((job) => {
          const isActive = job.id === jobId
          return (
            <button
              key={job.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => navigate(`/jobs/${job.id}`)}
              className={cn(
                "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-slate-50",
                isActive && "bg-orange-50 hover:bg-orange-50",
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
                    isActive ? "text-orange-700" : "text-slate-900",
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
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-orange-500">
                    Current
                  </p>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
