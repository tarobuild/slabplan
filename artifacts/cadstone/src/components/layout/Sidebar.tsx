import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ArrowUpDown,
  ArrowUpRight,
  ChevronDown,
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
import { APP_STORAGE_NAMESPACE } from "@/lib/brand"

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
  open: "bg-emerald-500",
  closed: "bg-stone-400",
  archived: "bg-stone-300",
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

const STATUS_FILTER_STORAGE_KEY = `${APP_STORAGE_NAMESPACE}:sidebar:statusFilter`
const SEARCH_STORAGE_KEY = `${APP_STORAGE_NAMESPACE}:sidebar:search`
const SORT_ASC_STORAGE_KEY = `${APP_STORAGE_NAMESPACE}:sidebar:sortAsc`
const COLLAPSED_CLIENTS_STORAGE_KEY = `${APP_STORAGE_NAMESPACE}:sidebar:collapsedClients`

const UNASSIGNED_KEY = "__unassigned__"
const SIDEBAR_JOBS_PAGE_SIZE = 200

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

type JobsPageResponse = {
  jobs?: Job[]
  pagination?: {
    page?: number
    totalPages?: number
    hasMore?: boolean
  }
}

async function loadAllSidebarJobs() {
  const allJobs: Job[] = []
  let page = 1

  while (true) {
    const response = await api.get<JobsPageResponse | Job[]>(
      `/jobs?pageSize=${SIDEBAR_JOBS_PAGE_SIZE}&page=${page}`,
    )
    const data = response.data
    const pageJobs = Array.isArray(data) ? data : data.jobs ?? []
    allJobs.push(...pageJobs)

    if (Array.isArray(data)) break

    const totalPages = data.pagination?.totalPages
    if (typeof totalPages === "number") {
      if (page >= totalPages) break
    } else if (!data.pagination?.hasMore) {
      break
    }

    page += 1
  }

  return allJobs
}

export default function Sidebar() {
  const { jobId, clientId: routeClientId } = useParams<{
    jobId?: string
    clientId?: string
  }>()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role === "admin"
  const canSeeClients = isAdmin
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
  const jobLoadSeqRef = useRef(0)

  const loadJobs = () => {
    const requestSeq = ++jobLoadSeqRef.current
    setErrorMessage(null)

    loadAllSidebarJobs()
      .then((r) => {
        if (requestSeq !== jobLoadSeqRef.current) return
        setJobs(r)
      })
      .catch((err: unknown) => {
        if (requestSeq !== jobLoadSeqRef.current) return
        // Nav widget intentionally swallows the raw server message
        // (e.g. "Invalid jobs query.") because non-technical users
        // don't benefit from validation jargon — only the auth/permission
        // and session cases get specialised copy.
        const classified = classifyApiError(err, "Couldn't load the jobs list.")
        let message: string
        if (classified.kind === "session-expired") {
          message = "Your session expired — please sign in again."
        } else if (classified.kind === "forbidden") {
          message = "You don't have permission to view jobs."
        } else {
          message = "Couldn't load the jobs list."
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
        // Field users can't see clients, so don't expose them via search either.
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

  const navHeader = canSeeClients ? "Clients & jobs" : "Jobs"

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-1 px-5 pb-2 pt-3">
        <p className="flex min-w-0 items-baseline gap-1.5 text-[11px] font-medium text-muted-foreground">
          <span className="truncate">{navHeader}</span>
          <span className="tabular-nums text-muted-foreground/70">{totalJobsShown}</span>
        </p>
        <div className="-mr-1.5 flex items-center">
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "relative size-7 rounded-full text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                  isFilterActive && "text-primary hover:text-primary",
                )}
                title="Filter"
                aria-label="Filter jobs by status"
              >
                <SlidersHorizontal className="size-3.5" />
                {isFilterActive && (
                  <span
                    aria-hidden
                    className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-[hsl(var(--oxide))]"
                  />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">Show jobs</p>
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
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                        selected
                          ? "font-medium text-primary"
                          : "text-foreground",
                      )}
                    >
                      <span>{option.label}</span>
                      {selected && (
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full bg-[hsl(var(--oxide))]"
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
            className="size-7 rounded-full text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            aria-label={
              sortAsc
                ? "Sort A to Z (click to switch to Z to A)"
                : "Sort Z to A (click to switch to A to Z)"
            }
            title={sortAsc ? "Sorted A to Z" : "Sorted Z to A"}
            onClick={() => setSortAsc((v) => !v)}
          >
            <ArrowUpDown aria-hidden="true" className="size-3.5" />
            <span className="sr-only">
              {sortAsc ? "Sorted A to Z" : "Sorted Z to A"}
            </span>
          </Button>
          {isAdmin ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              aria-label="New job"
              title="New job"
              onClick={() => navigate("/jobs", { state: { openCreate: true } })}
            >
              <Plus aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              canSeeClients ? "Find a client or job" : "Find a job"
            }
            aria-label={canSeeClients ? "Find a client or job" : "Find a job"}
            className="h-9 rounded-full bg-card pl-8 text-[13px] shadow-none"
          />
        </div>
      </div>

      {errorMessage ? (
        <div className="mx-3 mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
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

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {totalJobsShown === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-muted-foreground">
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
              className="mt-2 text-xs font-medium text-primary hover:text-primary/80"
              >
                Add your first client →
              </button>
            ) : null}
          </div>
        )}

        {/* Field users can't see clients — render a flat job list. */}
        {totalJobsShown > 0 && !canSeeClients && (
          <ul className="space-y-px">
            {searchFiltered
              .slice()
              .sort((a, b) =>
                sortAsc
                  ? a.title.localeCompare(b.title)
                  : b.title.localeCompare(a.title),
              )
              .map((job) => (
                <li key={job.id}>
                  <JobRow
                    job={job}
                    active={job.id === jobId}
                    activeRef={activeRef}
                    onSelect={() => navigate(`/jobs/${job.id}`)}
                    indented={false}
                  />
                </li>
              ))}
          </ul>
        )}

        {/* Admins see jobs grouped under their client. */}
        {totalJobsShown > 0 && canSeeClients && (
          <ul className="space-y-1">
            {groups.map((group) => {
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
                <li key={group.key}>
                  <div
                    className={cn(
                      "group/client relative flex items-center rounded-md transition-colors hover:bg-sidebar-accent",
                      isActiveClient && isCollapsed && "bg-sidebar-accent",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      aria-expanded={!isCollapsed}
                      aria-label={toggleLabel}
                      title={group.clientName}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1.5 pl-1.5 pr-1 text-left"
                    >
                      <ClientMonogram name={group.clientName} unassigned={group.clientId === null} />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-[13px] leading-5",
                          isActiveClient ? "font-semibold text-foreground" : "font-medium text-foreground/90",
                        )}
                      >
                        {group.clientName}
                      </span>
                      {isCollapsed ? (
                        <span className="shrink-0 text-[11px] font-medium tabular-nums leading-5 text-muted-foreground">
                          {group.jobs.length}
                        </span>
                      ) : null}
                    </button>
                    {/* Hover controls float over the row so they don't
                        permanently steal width from the client name. */}
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-md bg-sidebar-accent pl-1.5 pr-1 opacity-0 transition-opacity group-focus-within/client:opacity-100 group-hover/client:opacity-100">
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground transition-transform",
                          isCollapsed && "-rotate-90",
                        )}
                      />
                      {group.clientId ? (
                        <Link
                          to={`/clients/${group.clientId}`}
                          aria-label={`Open ${group.clientName}`}
                          title={`Open ${group.clientName}`}
                          className="pointer-events-auto flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-foreground"
                        >
                          <ArrowUpRight className="size-3.5" />
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  {!isCollapsed && (
                    <ul className="relative ml-[17px] space-y-px border-l border-border py-0.5 pl-2">
                      {group.jobs.map((job) => (
                        <li key={job.id}>
                          <JobRow
                            job={job}
                            active={job.id === jobId}
                            activeRef={activeRef}
                            onSelect={() => navigate(`/jobs/${job.id}`)}
                            indented
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// Soft, deterministic colour per client so a list of clients can be scanned
// by shape and colour instead of re-reading every name.
const MONOGRAM_TINTS = [
  "bg-orange-100 text-orange-800",
  "bg-sky-100 text-sky-800",
  "bg-emerald-100 text-emerald-800",
  "bg-violet-100 text-violet-800",
  "bg-amber-100 text-amber-900",
  "bg-rose-100 text-rose-800",
  "bg-teal-100 text-teal-800",
  "bg-indigo-100 text-indigo-800",
]

function monogramFor(name: string): string {
  // Skip a short all-caps code prefix such as "ABC - " so the letters
  // represent the client itself.
  const withoutCode = name.replace(/^[A-Z0-9]{2,6}\s+[-–]\s+/, "")
  const words = withoutCode.split(/[\s&/,-]+/).filter((w) => /[A-Za-z0-9]/.test(w))
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")
  return letters || "?"
}

function ClientMonogram({ name, unassigned }: { name: string; unassigned: boolean }) {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const tint = unassigned ? "bg-muted text-muted-foreground" : MONOGRAM_TINTS[hash % MONOGRAM_TINTS.length]
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold",
        tint,
      )}
    >
      {unassigned ? "—" : monogramFor(name)}
    </span>
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
  const location = [job.city, job.state].filter(Boolean).join(", ")
  const statusNote = job.status === "open" ? "" : ` (${job.status})`
  return (
    <button
      ref={active ? activeRef : undefined}
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      title={`${job.title}${location ? ` · ${location}` : ""}${statusNote}`}
      className={cn(
        "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors",
        indented ? "pl-2" : "pl-2.5",
        active
          ? "bg-accent text-accent-foreground"
          : "text-foreground/80 hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      {!indented || job.status !== "open" ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            STATUS_DOT[job.status] ?? "bg-slate-400",
          )}
        />
      ) : null}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] leading-5",
          active ? "font-semibold" : "font-normal",
          job.status !== "open" && !active && "text-muted-foreground",
        )}
      >
        {job.title}
      </span>
      {job.status !== "open" ? (
        <span className="shrink-0 text-[11px] capitalize text-muted-foreground">{job.status}</span>
      ) : null}
    </button>
  )
}
