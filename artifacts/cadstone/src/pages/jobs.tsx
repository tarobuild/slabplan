import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { Briefcase, Calendar, Check, ChevronDown, Search, User } from "lucide-react"
import {
  getJobsGetJobsQueryKey,
  jobsGetJobsId,
  useJobsGetJobs,
  useJobsPostJobs,
  useJobsPutJobsId,
  type JobListItem as JobListItemDto,
  type JobsGetJobsParams,
  type JobsGetJobsQueryResult,
  type JobsJobPayloadSchema,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { type WorkerOption } from "@/components/WorkerAssignmentPicker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { invalidateAppData, subscribeToDataRefresh } from "@/lib/data-refresh"
import { useDocumentTitle } from "@/hooks/use-document-title"
import CreateJobDialog from "@/components/jobs/CreateJobDialog"
import { api } from "@/lib/api"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import { toastApiError } from "@/lib/api-errors"
import { useAuthStore } from "@/store/auth"
import { EmptyState } from "@/components/EmptyState"
import { ClientPickerDialog } from "@/components/dashboard/ClientPickerDialog"

type Job = JobListItemDto

type JobStatus = "open" | "closed" | "archived"

const STATUS_LABELS: Record<string, string> = { open: "Open", closed: "Closed", archived: "Archived" }
const STATUS_COLORS: Record<string, string> = {
  open: "bg-green-50 text-green-700 border-green-200",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
  archived: "bg-slate-50 text-slate-400 border-slate-200",
}
const STATUS_OPTIONS: JobStatus[] = ["open", "closed", "archived"]

function StatusPopoverBadge({
  status,
  onChange,
}: {
  status: string
  onChange: (next: JobStatus) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((current) => !current)
          }}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={`Change status (currently ${STATUS_LABELS[status] ?? status})`}
          className="group inline-flex items-center gap-1 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-1"
        >
          <Badge
            variant="outline"
            className={`text-xs capitalize cursor-pointer ${STATUS_COLORS[status] ?? ""}`}
          >
            {STATUS_LABELS[status] ?? status}
            <ChevronDown className="ml-0.5 size-3 opacity-60 group-hover:opacity-100" />
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-40 p-1"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div role="menu" className="flex flex-col">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={status === option}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                if (status !== option) onChange(option)
              }}
              className="flex items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
            >
              <span className="capitalize">{STATUS_LABELS[option]}</span>
              {status === option ? (
                <Check className="size-3.5 text-orange-600" />
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Inline popover for assigning the project manager from the listing.
// Only admins reach this UI — when a PM saves a job edit, the API
// overwrites projectManagerId with their own id, so letting a PM
// reassign would be a lie.
function ProjectManagerPopover({
  projectManagerId,
  options,
  onChange,
}: {
  projectManagerId: string | null | undefined
  options: WorkerOption[]
  onChange: (next: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const current = options.find((option) => option.id === projectManagerId)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((option) =>
      [option.fullName, option.email].join(" ").toLowerCase().includes(q),
    )
  }, [options, query])
  const label = current?.fullName ?? "Unassigned"
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("")
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((current) => !current)
          }}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={`Change project manager (currently ${label})`}
          className="group inline-flex max-w-[160px] items-center gap-1 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        >
          <User className="size-3.5 text-slate-400 shrink-0" />
          <span className={`truncate ${current ? "" : "text-slate-400 italic"}`}>
            {label}
          </span>
          <ChevronDown className="size-3 opacity-60 group-hover:opacity-100 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-2"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search project managers"
          className="h-8 mb-2"
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div role="menu" className="max-h-56 overflow-y-auto">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!projectManagerId}
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
              if (projectManagerId) onChange(null)
            }}
            className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
          >
            <span className="italic text-slate-500">Unassigned</span>
            {!projectManagerId ? <Check className="size-3.5 text-orange-600" /> : null}
          </button>
          {filtered.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={projectManagerId === option.id}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                if (projectManagerId !== option.id) onChange(option.id)
              }}
              className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
            >
              <span className="truncate">{option.fullName}</span>
              {projectManagerId === option.id ? (
                <Check className="size-3.5 text-orange-600 shrink-0" />
              ) : null}
            </button>
          ))}
          {filtered.length === 0 ? (
            <p className="px-2 py-2 text-xs text-slate-400">No matching managers.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Inline popover for editing a YYYY-MM-DD date field. Uses a draft so the
// user can pick or clear without committing until they hit Save / Clear.
function DatePopover({
  value,
  ariaLabel,
  placeholder = "—",
  onChange,
}: {
  value: string | null | undefined
  ariaLabel: string
  placeholder?: string
  onChange: (next: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ?? "")
  useEffect(() => {
    if (!open) setDraft(value ?? "")
  }, [value, open])
  const display = value
    ? new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : placeholder
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value ?? "")
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((current) => !current)
          }}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={ariaLabel}
          className="group inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        >
          <Calendar className="size-3.5 text-slate-400 shrink-0" />
          <span className={value ? "" : "text-slate-400"}>{display}</span>
          <ChevronDown className="size-3 opacity-60 group-hover:opacity-100 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-3"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-8 mb-3"
          autoFocus
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
              if (value) onChange(null)
            }}
          >
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            style={{ backgroundColor: "#E85D04", color: "#fff" }}
            className="hover:opacity-90 transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
              const next = draft || null
              if (next !== (value ?? null)) onChange(next)
            }}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const JOB_TYPE_LABELS: Record<string, string> = {
  kitchen_countertops: "Kitchen Countertops",
  bathrooms: "Bathrooms",
  flooring: "Flooring",
  backsplash: "Backsplash",
  full_house_project: "Full House Project",
  custom: "Custom",
}

const toLabel = (s: string) =>
  JOB_TYPE_LABELS[s] ?? s.replace(/\b\w/g, (c) => c.toUpperCase())

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
function fmtCurrency(v: string | null | undefined) {
  if (!v) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v))
}

export default function JobsPage() {
  useDocumentTitle("Jobs")
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role === "admin"
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [search, setSearch] = useState("")
  // `debouncedSearch` is what actually gets sent to the API — `search`
  // updates per keystroke for responsive input, the debounced value follows
  // 300ms later so we don't issue a request for every character.
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [status, setStatus] = useState<string>("all")
  const [createOpen, setCreateOpen] = useState(false)
  const [createDefaultClientId, setCreateDefaultClientId] = useState<string | undefined>(undefined)
  const [createLockClient, setCreateLockClient] = useState(false)
  const [workerOptions, setWorkerOptions] = useState<WorkerOption[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const location = useLocation()
  const navigate = useNavigate()

  const [pickerOpen, setPickerOpen] = useState(false)

  const handleNewJobClick = () => {
    // Defense-in-depth: job creation is admin-only (post-#277). Every
    // visible trigger is already role-gated, but this internal guard
    // ensures any future caller (deeplink, command palette, etc.) cannot
    // open the picker for a non-admin even by accident.
    if (!isAdmin) return
    setPickerOpen(true)
  }

  const openCreateDialog = (
    options?: { defaultClientId?: string; lockClient?: boolean },
  ) => {
    if (!isAdmin) return
    setCreateDefaultClientId(options?.defaultClientId)
    setCreateLockClient(Boolean(options?.lockClient && options?.defaultClientId))
    setCreateOpen(true)
  }

  useEffect(() => {
    if (!isAdmin) {
      setWorkerOptions([])
      return
    }

    api.get("/users?roles=project_manager,crew_member&limit=200")
      .then((r) => setWorkerOptions(r.data.users ?? []))
      .catch((err: unknown) => toastApiError(err, "Failed to load workers"))
  }, [isAdmin])

  useEffect(() => {
    const currentState = location.state as Record<string, unknown> | null
    if (currentState && (currentState as { openCreate?: unknown }).openCreate) {
      // Job creation is admin-only (post-#277). Strip the openCreate hint
      // for non-admins so they never see the create dialog flash open and
      // hit a 403 on submit.
      if (isAdmin) {
        const stateClientId =
          typeof (currentState as { clientId?: unknown }).clientId === "string"
            ? ((currentState as { clientId?: string }).clientId as string)
            : undefined
        const stateLock = Boolean((currentState as { lockClient?: unknown }).lockClient)
        if (stateClientId) {
          openCreateDialog({ defaultClientId: stateClientId, lockClient: stateLock })
        } else {
          setPickerOpen(true)
        }
      }
      const { openCreate: _openCreate, clientId: _cid, lockClient: _lc, ...rest } =
        currentState as { openCreate?: unknown; clientId?: unknown; lockClient?: unknown } & Record<string, unknown>
      const nextState = Object.keys(rest).length > 0 ? rest : null
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: nextState },
      )
    }
  }, [location.state, location.pathname, location.search, location.hash, navigate, isAdmin])

  const listParams = useMemo<JobsGetJobsParams>(() => {
    const params: JobsGetJobsParams = { page, pageSize }
    if (debouncedSearch) params.search = debouncedSearch
    if (status !== "all") params.status = status as JobsGetJobsParams["status"]
    return params
  }, [page, pageSize, debouncedSearch, status])

  const jobsQuery = useJobsGetJobs(listParams, {
    query: {
      // Generated query options use a strict tanstack-query type that
      // requires `queryKey` once `query` is overridden. The helper returns
      // a stable, params-aware key, and `placeholderData: previous` keeps
      // the prior page on screen while the next one loads.
      queryKey: getJobsGetJobsQueryKey(listParams),
      placeholderData: (previous: JobsGetJobsQueryResult | undefined) => previous,
    },
  })

  useEffect(() => {
    if (jobsQuery.error) {
      toastApiError(jobsQuery.error, "Failed to load jobs")
    }
  }, [jobsQuery.error])

  const jobs: Job[] = jobsQuery.data?.jobs ?? []
  const total = jobsQuery.data?.pagination?.totalItems ?? 0
  const loading = jobsQuery.isPending

  const createJobMutation = useJobsPostJobs()
  const updateJobMutation = useJobsPutJobsId()

  const invalidateJobsList = () => {
    void queryClient.invalidateQueries({ queryKey: getJobsGetJobsQueryKey() })
  }

  // The legacy data-refresh bus is also bridged into the query cache by
  // `configureApiClient`, but other tabs/components may still call it
  // directly. Keep this subscription so the visible page refetches even
  // when the bridge isn't the only listener.
  useEffect(
    () => subscribeToDataRefresh("jobs", () => invalidateJobsList()),
    // queryClient is stable; invalidation reads it through closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(1)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(v), 300)
  }

  const handleStatus = (v: string) => {
    setStatus(v); setPage(1)
  }

  const hasActiveFilters = Boolean(debouncedSearch) || status !== "all"

  const clearFilters = () => {
    setSearch("")
    setDebouncedSearch("")
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setStatus("all")
    setPage(1)
  }

  const handlePage = (p: number) => {
    setPage(p)
  }

  const handleCreated = (newJobId: string | undefined) => {
    setPage(1)
    invalidateJobsList()
    if (newJobId) {
      toast("Open the new job?", {
        action: { label: "Open job", onClick: () => navigate(`/jobs/${newJobId}`) },
      })
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // Determines whether the current user can flip the status of a row from
  // the listing. Admins can edit any job; project managers only the jobs
  // they manage. Crew/clients see the badge as a static pill.
  const canEditStatus = (job: Job): boolean => {
    if (!user) return false
    if (user.role === "admin") return true
    if (user.role === "project_manager") {
      return Boolean(job.projectManagerId && job.projectManagerId === user.id)
    }
    return false
  }

  // Optimistically applies a partial patch to `jobId` across every active
  // /jobs query in the cache. Returns a snapshot map so we can roll back
  // on failure. Used by every inline editor on the row.
  const applyOptimisticPatch = (
    jobId: string,
    patch: Partial<Job>,
  ): Map<readonly unknown[], unknown> => {
    const snapshots = new Map<readonly unknown[], unknown>()
    const matches = queryClient.getQueriesData<JobsGetJobsQueryResult>({
      queryKey: getJobsGetJobsQueryKey(),
    })
    matches.forEach(([key, value]) => {
      if (!value || !Array.isArray((value as { jobs?: Job[] }).jobs)) return
      snapshots.set(key, value)
      const next = {
        ...(value as { jobs: Job[] }),
        jobs: (value as { jobs: Job[] }).jobs.map((existing) =>
          existing.id === jobId ? { ...existing, ...patch } : existing,
        ),
      }
      queryClient.setQueryData(key, next)
    })
    return snapshots
  }

  const rollbackOptimisticPatch = (
    snapshots: Map<readonly unknown[], unknown>,
  ) => {
    snapshots.forEach((value, key) => {
      queryClient.setQueryData(key, value)
    })
  }

  // Generic inline-edit helper. The PUT endpoint requires the full job
  // payload, so we GET the hydrated record, merge the field-specific
  // override, and PUT it back. Optimistic patch is rolled back on error.
  const performInlineUpdate = async (
    job: Job,
    {
      patch,
      payloadOverride,
      successMessage,
      errorMessage,
    }: {
      patch: Partial<Job>
      payloadOverride: Record<string, unknown>
      successMessage: string
      errorMessage: string
    },
  ) => {
    const snapshots = applyOptimisticPatch(job.id, patch)
    try {
      const detail = await jobsGetJobsId(job.id)
      const current = detail?.job as unknown as Record<string, unknown> | undefined
      if (!current) throw new Error("Job not found")

      const payload = {
        title: current.title,
        status: current.status,
        jobType: current.jobType ?? null,
        contractType: current.contractType ?? null,
        streetAddress: current.streetAddress ?? null,
        city: current.city ?? null,
        state: current.state ?? null,
        zipCode: current.zipCode ?? null,
        contractPrice: current.contractPrice ?? null,
        projectedStart: current.projectedStart ?? null,
        projectedCompletion: current.projectedCompletion ?? null,
        actualStart: current.actualStart ?? null,
        actualCompletion: current.actualCompletion ?? null,
        workDays: current.workDays ?? null,
        squareFeet: current.squareFeet ?? null,
        permitNumber: current.permitNumber ?? null,
        clientId: current.clientId ?? null,
        projectManagerId: current.projectManagerId ?? null,
        ...payloadOverride,
      } as JobsJobPayloadSchema
      await updateJobMutation.mutateAsync({ id: job.id, data: payload })
      toast.success(successMessage)
      invalidateJobsList()
      invalidateAppData(["jobs"])
    } catch (err: unknown) {
      rollbackOptimisticPatch(snapshots)
      toastApiError(err, errorMessage)
    }
  }

  const handleInlineStatusChange = (
    job: Job,
    nextStatus: "open" | "closed" | "archived",
  ) => {
    if (job.status === nextStatus) return
    return performInlineUpdate(job, {
      patch: { status: nextStatus },
      payloadOverride: { status: nextStatus },
      successMessage: `Status updated to ${STATUS_LABELS[nextStatus]}`,
      errorMessage: "Failed to update status",
    })
  }

  // Project managers come from the existing workerOptions list filtered
  // to the project_manager role only — only those can be set as PM.
  const projectManagerOptions = useMemo(
    () => workerOptions.filter((option) => option.role === "project_manager"),
    [workerOptions],
  )

  // The PUT /jobs/:id handler force-rewrites `projectManagerId` to the
  // caller's own id whenever a project_manager calls it. As a result a
  // PM-of-job cannot actually reassign the manager — any selection they
  // made would be silently overwritten on the server. We therefore gate
  // the inline PM picker to admins only (status + dates still mirror the
  // canEditStatus gate so PMs can edit those on jobs they own).
  const canEditProjectManager = (_job: Job): boolean => isAdmin

  const handleInlineProjectManagerChange = (job: Job, nextId: string | null) => {
    if ((job.projectManagerId ?? null) === nextId) return
    const next = projectManagerOptions.find((option) => option.id === nextId)
    return performInlineUpdate(job, {
      patch: { projectManagerId: nextId },
      payloadOverride: { projectManagerId: nextId },
      successMessage: nextId
        ? `Assigned to ${next?.fullName ?? "project manager"}`
        : "Project manager cleared",
      errorMessage: "Failed to update project manager",
    })
  }

  const handleInlineDateChange = (
    job: Job,
    field: "projectedStart" | "projectedCompletion",
    next: string | null,
  ) => {
    const currentValue = (job[field] as string | null | undefined) ?? null
    if (currentValue === next) return
    const fieldLabel =
      field === "projectedStart" ? "Start date" : "Estimated completion"
    return performInlineUpdate(job, {
      patch: { [field]: next } as Partial<Job>,
      payloadOverride: { [field]: next },
      successMessage: next ? `${fieldLabel} updated` : `${fieldLabel} cleared`,
      errorMessage: `Failed to update ${fieldLabel.toLowerCase()}`,
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Jobs</h1>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" />
          <Input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search jobs…"
            className="pl-8 h-9"
          />
        </div>
        <Select value={status} onValueChange={handleStatus}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="font-semibold text-slate-600">Title</TableHead>
              <TableHead className="font-semibold text-slate-600">Client</TableHead>
              <TableHead className="font-semibold text-slate-600">Location</TableHead>
              <TableHead className="font-semibold text-slate-600">Type</TableHead>
              <TableHead className="font-semibold text-slate-600">Project Manager</TableHead>
              <TableHead className="font-semibold text-slate-600">Status</TableHead>
              <TableHead className="font-semibold text-slate-600">Start</TableHead>
              <TableHead className="font-semibold text-slate-600">End</TableHead>
              <TableHead className="font-semibold text-slate-600 text-right">Contract Price</TableHead>
              <TableHead className="font-semibold text-slate-600">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 10 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="p-0">
                  {hasActiveFilters ? (
                    <EmptyState
                      icon={Search}
                      title="No jobs match your filters"
                      description="Try clearing the search box or switching the status filter to see more jobs."
                      action={{ label: "Clear filters", onClick: clearFilters }}
                      className="border-0 rounded-none"
                    />
                  ) : (
                    <EmptyState
                      icon={Briefcase}
                      title="No jobs yet"
                      description={
                        isAdmin
                          ? "Create your first job to start tracking work, daily logs, schedules, and files."
                          : "An admin will add jobs here."
                      }
                      action={
                        isAdmin
                          ? { label: "+ New Job", onClick: handleNewJobClick }
                          : undefined
                      }
                      className="border-0 rounded-none"
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              jobs.map(job => (
                <TableRow
                  key={job.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => navigate(`/jobs/${job.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      navigate(`/jobs/${job.id}`)
                    }
                  }}
                  tabIndex={0}
                  role="link"
                  aria-label={`Open job ${job.title}`}
                >
                  <TableCell>
                    <Link
                      to={`/jobs/${job.id}`}
                      className="font-medium text-orange-600 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {job.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600 text-sm">
                    {job.clientName || "—"}
                  </TableCell>
                  <TableCell className="text-slate-600 text-sm">
                    {[job.city, job.state].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-slate-600 text-sm">
                    {job.jobType ? toLabel(job.jobType) : "—"}
                  </TableCell>
                  <TableCell>
                    {canEditProjectManager(job) ? (
                      <ProjectManagerPopover
                        projectManagerId={job.projectManagerId ?? null}
                        options={projectManagerOptions}
                        onChange={(next) => {
                          void handleInlineProjectManagerChange(job, next)
                        }}
                      />
                    ) : (
                      <span className="text-sm text-slate-600">
                        {projectManagerOptions.find(
                          (option) => option.id === job.projectManagerId,
                        )?.fullName ?? (
                          <span className="italic text-slate-400">Unassigned</span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canEditStatus(job) ? (
                      <StatusPopoverBadge
                        status={job.status}
                        onChange={(next) => {
                          void handleInlineStatusChange(job, next)
                        }}
                      />
                    ) : (
                      <Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[job.status]}`}>
                        {STATUS_LABELS[job.status]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {canEditStatus(job) ? (
                      <DatePopover
                        value={job.projectedStart ?? null}
                        ariaLabel={`Change start date for ${job.title}`}
                        onChange={(next) => {
                          void handleInlineDateChange(job, "projectedStart", next)
                        }}
                      />
                    ) : (
                      <span className="text-sm text-slate-600">
                        {job.projectedStart
                          ? fmtDate(job.projectedStart)
                          : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canEditStatus(job) ? (
                      <DatePopover
                        value={job.projectedCompletion ?? null}
                        ariaLabel={`Change estimated completion for ${job.title}`}
                        onChange={(next) => {
                          void handleInlineDateChange(
                            job,
                            "projectedCompletion",
                            next,
                          )
                        }}
                      />
                    ) : (
                      <span className="text-sm text-slate-600">
                        {job.projectedCompletion
                          ? fmtDate(job.projectedCompletion)
                          : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-700">
                    {fmtCurrency(job.contractPrice)}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {fmtDate(job.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-[#E5E7EB] bg-white p-4 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))
        ) : jobs.length === 0 ? (
          hasActiveFilters ? (
            <EmptyState
              icon={Search}
              title="No jobs match your filters"
              description="Try clearing the search box or switching the status filter to see more jobs."
              action={{ label: "Clear filters", onClick: clearFilters }}
            />
          ) : (
            <EmptyState
              icon={Briefcase}
              title="No jobs yet"
              description={
                isAdmin
                  ? "Create your first job to start tracking work, daily logs, schedules, and files."
                  : "An admin will add jobs here."
              }
              action={
                isAdmin
                  ? { label: "+ New Job", onClick: handleNewJobClick }
                  : undefined
              }
            />
          )
        ) : (
          jobs.map(job => (
            <div
              key={job.id}
              role="link"
              tabIndex={0}
              aria-label={`Open job ${job.title}`}
              onClick={() => navigate(`/jobs/${job.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  navigate(`/jobs/${job.id}`)
                }
              }}
              className="cursor-pointer rounded-lg border border-[#E5E7EB] bg-white p-4 hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to={`/jobs/${job.id}`}
                  className="block truncate text-sm font-medium text-orange-600 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {job.title}
                </Link>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {canEditStatus(job) ? (
                    <StatusPopoverBadge
                      status={job.status}
                      onChange={(next) => {
                        void handleInlineStatusChange(job, next)
                      }}
                    />
                  ) : (
                    <Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[job.status]}`}>
                      {STATUS_LABELS[job.status]}
                    </Badge>
                  )}
                  {job.jobType && <span className="text-xs text-slate-500">{toLabel(job.jobType)}</span>}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {canEditProjectManager(job) ? (
                    <ProjectManagerPopover
                      projectManagerId={job.projectManagerId ?? null}
                      options={projectManagerOptions}
                      onChange={(next) => {
                        void handleInlineProjectManagerChange(job, next)
                      }}
                    />
                  ) : job.projectManagerId ? (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <User className="size-3" />
                      {projectManagerOptions.find(
                        (option) => option.id === job.projectManagerId,
                      )?.fullName ?? "Project manager"}
                    </span>
                  ) : null}
                  {canEditStatus(job) ? (
                    <>
                      <DatePopover
                        value={job.projectedStart ?? null}
                        ariaLabel={`Change start date for ${job.title}`}
                        placeholder="Start"
                        onChange={(next) => {
                          void handleInlineDateChange(job, "projectedStart", next)
                        }}
                      />
                      <DatePopover
                        value={job.projectedCompletion ?? null}
                        ariaLabel={`Change estimated completion for ${job.title}`}
                        placeholder="End"
                        onChange={(next) => {
                          void handleInlineDateChange(
                            job,
                            "projectedCompletion",
                            next,
                          )
                        }}
                      />
                    </>
                  ) : (job.projectedStart || job.projectedCompletion) ? (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Calendar className="size-3" />
                      {job.projectedStart ? fmtDate(job.projectedStart) : "—"}
                      {" → "}
                      {job.projectedCompletion ? fmtDate(job.projectedCompletion) : "—"}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                  {job.clientName && <p>{job.clientName}</p>}
                  {(job.city || job.state) && <p>{[job.city, job.state].filter(Boolean).join(", ")}</p>}
                  {job.contractPrice && (
                    <p className="font-medium text-slate-700">{fmtCurrency(job.contractPrice)}</p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {!loading && total > pageSize && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => handlePage(page - 1)} disabled={page <= 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => handlePage(page + 1)} disabled={page >= totalPages}>Next</Button>
          </div>
        </div>
      )}

      <CreateJobDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultClientId={createDefaultClientId}
        lockClient={createLockClient}
        onCreated={handleCreated}
      />
      <ClientPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Pick a client for this job"
        description="Every job belongs to a client. Choose one to start the new-job form."
        onSelect={(chosenClientId) => {
          openCreateDialog({ defaultClientId: chosenClientId, lockClient: true })
        }}
      />
    </div>
  )
}

