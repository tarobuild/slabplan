import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
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
  clientId: string | null
  clientName: string | null
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
  open: "No open jobs yet",
  closed: "No closed jobs",
  archived: "No archived jobs",
  all: "No jobs yet",
}

const STATUS_FILTER_STORAGE_KEY = "cadstone:sidebar:statusFilter"
const SEARCH_STORAGE_KEY = "cadstone:sidebar:search"
const SORT_ASC_STORAGE_KEY = "cadstone:sidebar:sortAsc"
const COLLAPSED_CLIENTS_STORAGE_KEY = "cadstone:sidebar:collapsedClients"

const UNASSIGNED_KEY = "__unassigned__"

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

function readStoredCollapsedClients(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const stored = window.localStorage.getItem(COLLAPSED_CLIENTS_STORAGE_KEY)
    if (!stored) return new Set()
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? new Set(parsed.filter((v) => typeof v === "string")) : new Set()
  } catch {
    return new Set()
  }
}

type ClientGroup = {
  key: string
  clientId: string | null
  clientName: string
  jobs: Job[]
}

export default function Sidebar() {
  const { jobId, clientId: routeClientId } = useParams<{
    jobId?: string
    clientId?: string
  }>()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role === "admin"
  const canSeeClients = user?.role !== "crew_member"
  const [jobs, setJobs] = useState<Job[]>([])
  const [search, setSearch] = useState(readStoredSearch)
  const [sortAsc, setSortAsc] = useState(readStoredSortAsc)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    readStoredStatusFilter,
  )
  const [filterOpen, setFilterOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const [collapsedClients, setCollapsedClients] = useState<Set<string>>(
    readStoredCollapsedClients,
  )
  const activeRef = useRef<HTMLButtonElement | null>(null)

  const loadJobs = () => {
    setErrorMessage(null)

    api
      .get("/jobs?pageSize=200")
      .then((r) => setJobs(r.data.jobs ?? r.data ?? []))
      .catch((err: unknown) => {
        const classified = classifyApiError(err, "Couldn't refresh jobs right now.")
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
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(
        COLLAPSED_CLIENTS_STORAGE_KEY,
        JSON.stringify(Array.from(collapsedClients)),
      )
    } catch {
      // Ignore storage failures (e.g. private mode quota errors).
    }
  }, [collapsedClients])

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: "nearest" })
    }
  }, [jobId, jobs.length])

  const statusFiltered = useMemo(
    () =>
      jobs.filter(
        (j) => statusFilter === "all" || j.status === statusFilter,
      ),
    [jobs, statusFilter],
  )

  const searchQuery = search.trim().toLowerCase()
  const isSearching = searchQuery.length > 0

  const searchFiltered = useMemo(
    () =>
      statusFiltered.filter((j) => {
        if (!isSearching) return true
        const inTitle = j.title.toLowerCase().includes(searchQuery)
        // Crew members can't see clients, so don't expose them via search either.
        const inClient =
          canSeeClients &&
          (j.clientName ?? "").toLowerCase().includes(searchQuery)
        const inLocation = [j.city, j.state]
          .filter(Boolean)
          .join(", ")
          .toLowerCase()
          .includes(searchQuery)
        return inTitle || inClient || inLocation
      }),
    [statusFiltered, isSearching, searchQuery, canSeeClients],
  )

  const groups: ClientGroup[] = useMemo(() => {
    const map = new Map<string, ClientGroup>()
    for (const job of searchFiltered) {
      const key = job.clientId ?? UNASSIGNED_KEY
      const name = job.clientId
        ? job.clientName ?? "(Unnamed client)"
        : "Unassigned"
      if (!map.has(key)) {
        map.set(key, {
          key,
          clientId: job.clientId,
          clientName: name,
          jobs: [],
        })
      }
      map.get(key)!.jobs.push(job)
    }
    const arr = Array.from(map.values())
    // Sort jobs within each group
    for (const g of arr) {
      g.jobs.sort((a, b) =>
        sortAsc
          ? a.title.localeCompare(b.title)
          : b.title.localeCompare(a.title),
      )
    }
    // Sort groups: real clients alphabetically, then "Unassigned" last
    arr.sort((a, b) => {
      if (a.clientId === null && b.clientId !== null) return 1
      if (b.clientId === null && a.clientId !== null) return -1
      const cmp = a.clientName.localeCompare(b.clientName)
      return sortAsc ? cmp : -cmp
    })
    return arr
  }, [searchFiltered, sortAsc])

  const totalJobsShown = searchFiltered.length
  const isFilterActive = statusFilter !== "open"

  // Resolve the active job for the "Current Job" banner.
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
          clientId: job.clientId ?? null,
          clientName: job.clientName ?? null,
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

  // Auto-expand the client group that contains the active job or matches the
  // current /clients/:clientId route, so users always see context. When the
  // active job has no client, expand the synthetic "Unassigned" group.
  useEffect(() => {
    let focusKey: string | null = null
    if (activeJob) {
      focusKey = activeJob.clientId ?? UNASSIGNED_KEY
    } else if (routeClientId) {
      focusKey = routeClientId
    }
    if (!focusKey) return
    setCollapsedClients((prev) => {
      if (!prev.has(focusKey!)) return prev
      const next = new Set(prev)
      next.delete(focusKey!)
      return next
    })
  }, [activeJob, routeClientId])

  const toggleGroup = (key: string) => {
    setCollapsedClients((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const navHeader = canSeeClients ? "Clients & Jobs" : "Jobs"

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
          <div className="mt-1 flex flex-col gap-0.5">
            {canSeeClients && activeJob?.clientId ? (
              <Link
                to={`/clients/${activeJob.clientId}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 hover:text-orange-800"
              >
                <ArrowLeft className="size-3.5" />
                Back to {activeJob.clientName ?? "client"}
              </Link>
            ) : null}
            <Link
              to={canSeeClients ? "/clients" : "/jobs"}
              className="inline-flex items-center gap-1 text-xs font-medium text-orange-700/80 hover:text-orange-800"
            >
              <ArrowLeft className="size-3.5" />
              {canSeeClients ? "All Clients" : "All Jobs"}
            </Link>
          </div>
        </div>
      )}
      {isAdmin ? (
        <div className="flex flex-col gap-1.5 border-b border-[#E5E7EB] p-2.5">
          {canSeeClients ? (
            <Button
              variant="orange"
              className="w-full"
              size="sm"
              onClick={() => navigate("/clients", { state: { openCreate: true } })}
            >
              <Plus className="size-4" />
              New Client
            </Button>
          ) : null}
          <Button
            variant="outline"
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
          <span>{navHeader}</span>
          <span className="text-xs text-slate-400">({totalJobsShown})</span>
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
                ? "Sort A to Z (click to switch to Z to A)"
                : "Sort Z to A (click to switch to A to Z)"
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
            placeholder={
              canSeeClients ? "Search clients or jobs…" : "Search jobs…"
            }
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
        {totalJobsShown === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-slate-400">
              {isSearching
                ? "Nothing matches your search"
                : EMPTY_COPY[statusFilter]}
            </p>
            {isAdmin && !isSearching && canSeeClients ? (
              <button
                type="button"
                onClick={() =>
                  navigate("/clients", { state: { openCreate: true } })
                }
                className="mt-2 text-xs font-medium text-orange-700 hover:text-orange-800"
              >
                Add your first client →
              </button>
            ) : null}
          </div>
        )}

        {/* Crew members can't see clients — render a flat job list. */}
        {totalJobsShown > 0 && !canSeeClients && (
          <div>
            {searchFiltered
              .slice()
              .sort((a, b) =>
                sortAsc
                  ? a.title.localeCompare(b.title)
                  : b.title.localeCompare(a.title),
              )
              .map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  active={job.id === jobId}
                  activeRef={activeRef}
                  onSelect={() => navigate(`/jobs/${job.id}`)}
                  indented={false}
                />
              ))}
          </div>
        )}

        {/* Admin/PM see jobs grouped under their client. */}
        {totalJobsShown > 0 && canSeeClients &&
          groups.map((group) => {
            // When searching, always show jobs expanded so results are visible.
            const isCollapsed =
              !isSearching && collapsedClients.has(group.key)
            const isActiveClient =
              (activeJob?.clientId ?? routeClientId ?? null) === group.clientId &&
              group.clientId !== null
            const toggleLabel = isCollapsed
              ? `Expand ${group.clientName}`
              : `Collapse ${group.clientName}`

            return (
              <div key={group.key} className="border-b border-slate-100 last:border-b-0">
                <div
                  className={cn(
                    "flex items-center gap-1 px-2 py-1.5",
                    isActiveClient && "bg-orange-50/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={!isCollapsed}
                    aria-label={toggleLabel}
                    className="flex size-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </button>
                  {group.clientId ? (
                    <Link
                      to={`/clients/${group.clientId}`}
                      className={cn(
                        "min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide hover:text-orange-700",
                        isActiveClient ? "text-orange-700" : "text-slate-600",
                      )}
                      title={group.clientName}
                    >
                      {group.clientName}
                    </Link>
                  ) : (
                    <span
                      className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-slate-500"
                      title={group.clientName}
                    >
                      {group.clientName}
                    </span>
                  )}
                  <span className="shrink-0 text-[10px] text-slate-400">
                    {group.jobs.length}
                  </span>
                </div>

                {!isCollapsed && (
                  <div className="pb-1">
                    {group.jobs.map((job) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        active={job.id === jobId}
                        activeRef={activeRef}
                        onSelect={() => navigate(`/jobs/${job.id}`)}
                        indented
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

function JobRow({
  job,
  active,
  activeRef,
  onSelect,
  indented,
}: {
  job: Job
  active: boolean
  activeRef: React.Ref<HTMLButtonElement>
  onSelect: () => void
  indented: boolean
}) {
  return (
    <button
      ref={active ? activeRef : undefined}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 pr-3 py-2 text-left transition-colors hover:bg-slate-50",
        indented ? "pl-7" : "pl-3",
        active && "bg-orange-50 hover:bg-orange-50",
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
            active ? "text-orange-700" : "text-slate-900",
          )}
        >
          {job.title}
        </p>
        {(job.city || job.state) && (
          <p className="truncate text-xs text-slate-400">
            {[job.city, job.state].filter(Boolean).join(", ")}
          </p>
        )}
        {active && (
          <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-orange-500">
            Current
          </p>
        )}
      </div>
    </button>
  )
}
