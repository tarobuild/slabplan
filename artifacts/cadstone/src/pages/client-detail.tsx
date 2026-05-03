import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  Building2,
  ClipboardList,
  FileText,
  Loader2,
  Plus,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { toastApiError } from "@/lib/api-errors"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { useAuthStore } from "@/store/auth"
import { subscribeToDataRefresh } from "@/lib/data-refresh"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type ClientContact = {
  id: string
  firstName: string | null
  lastName: string | null
  title: string | null
  email: string | null
  phone: string | null
  cellPhone: string | null
  isPrimary: boolean | null
}

type ClientJob = {
  id: string
  title: string
  status: string | null
  city: string | null
  state: string | null
  jobType: string | null
  contractValueCents: number | null
  amountPaidCents: number | null
  hasTracker?: boolean
  projectedStart: string | null
  projectedCompletion: string | null
  actualStart: string | null
  actualCompletion: string | null
  projectManagerId: string | null
  projectManagerName: string | null
  updatedAt: string | null
  createdAt: string
}

type WorkerOption = { id: string; fullName: string; email?: string | null }

type ClientRollups = {
  contractValueCents: number
  amountPaidCents: number
  outstandingCents: number
  activeJobCount: number
  totalJobCount: number
  lastActivityAt: string | null
}

type ClientDetail = {
  id: string
  companyName: string
  phone: string | null
  email: string | null
  streetAddress: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  notes: string | null
  archived: boolean
  contacts: ClientContact[]
  jobs: ClientJob[]
  rollups: ClientRollups
}

const TABS = ["jobs", "contacts", "files", "daily-logs", "schedule", "notes"] as const
type Tab = (typeof TABS)[number]
const TAB_LABELS: Record<Tab, string> = {
  jobs: "Jobs",
  contacts: "Contacts",
  files: "Files",
  "daily-logs": "Daily Logs",
  schedule: "Schedule",
  notes: "Notes",
}

function fmtMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function fmtDate(d: string | null) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function InlineMoneyInput({
  valueCents,
  onSave,
  disabled,
  disabledTitle,
}: {
  valueCents: number
  onSave: (dollars: number) => void | Promise<void>
  disabled?: boolean
  disabledTitle?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => (valueCents / 100).toFixed(2))
  useEffect(() => {
    setDraft((valueCents / 100).toFixed(2))
  }, [valueCents])
  if (disabled) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-right text-slate-700"
        title={disabledTitle ?? "Tracker-managed"}
      >
        {fmtMoney(valueCents)}
        <span className="text-[10px] text-slate-400">🔒</span>
      </span>
    )
  }
  if (!editing) {
    return (
      <button
        type="button"
        className="rounded px-1.5 py-0.5 text-right hover:bg-slate-100"
        onClick={() => setEditing(true)}
      >
        {fmtMoney(valueCents)}
      </button>
    )
  }
  const commit = () => {
    const n = Number(draft)
    setEditing(false)
    if (!Number.isFinite(n) || n < 0) return
    if (Math.round(n * 100) === valueCents) return
    void onSave(n)
  }
  return (
    <input
      autoFocus
      type="number"
      min={0}
      step="0.01"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          commit()
        } else if (e.key === "Escape") {
          setDraft((valueCents / 100).toFixed(2))
          setEditing(false)
        }
      }}
      className="w-24 rounded border border-slate-200 px-1.5 py-0.5 text-right text-sm focus:border-orange-500 focus:outline-none"
    />
  )
}

const JOB_STATUS_COLORS: Record<string, string> = {
  open: "bg-green-50 text-green-700 border-green-200",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
  archived: "bg-slate-50 text-slate-400 border-slate-200",
}
const JOB_STATUSES: string[] = ["open", "closed", "archived"]

function InlineDate({
  value,
  onSave,
  placeholder,
}: {
  value: string | null
  onSave: (next: string | null) => void | Promise<void>
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ? value.slice(0, 10) : "")
  useEffect(() => {
    setDraft(value ? value.slice(0, 10) : "")
  }, [value])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded px-1 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          {value ? fmtDate(value) : placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-orange-500 focus:outline-none"
        />
        <div className="mt-2 flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft("")
              void onSave(null)
              setOpen(false)
            }}
          >
            Clear
          </Button>
          <Button
            size="sm"
            variant="orange"
            onClick={() => {
              void onSave(draft || null)
              setOpen(false)
            }}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function InlinePmPicker({
  projectManagerId,
  projectManagerName,
  options,
  onChange,
}: {
  projectManagerId: string | null
  projectManagerName: string | null
  options: WorkerOption[]
  onChange: (next: string | null) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const current = options.find((o) => o.id === projectManagerId)
  const label = current?.fullName ?? projectManagerName ?? "Unassigned"
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) =>
      [o.fullName, o.email ?? ""].join(" ").toLowerCase().includes(q),
    )
  }, [options, query])
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
          className={cn(
            "rounded px-1 py-0.5 text-[11px] hover:bg-slate-100 hover:text-slate-700",
            projectManagerId ? "text-slate-700" : "italic text-slate-400",
          )}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search project managers"
          className="mb-2 w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-orange-500 focus:outline-none"
        />
        <div className="max-h-56 overflow-y-auto" role="menu">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!projectManagerId}
            onClick={() => {
              setOpen(false)
              if (projectManagerId) void onChange(null)
            }}
            className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-slate-100"
          >
            <span className="italic text-slate-500">Unassigned</span>
          </button>
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitemradio"
              aria-checked={projectManagerId === o.id}
              onClick={() => {
                setOpen(false)
                if (projectManagerId !== o.id) void onChange(o.id)
              }}
              className={cn(
                "flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-slate-100",
                projectManagerId === o.id && "bg-slate-50 font-semibold",
              )}
            >
              <span className="truncate">{o.fullName}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-2 py-2 text-xs text-slate-400">No matching managers.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const navigate = useNavigate()
  const [client, setClient] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("jobs")
  const [workerOptions, setWorkerOptions] = useState<WorkerOption[]>([])
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === "admin"

  useEffect(() => {
    if (!isAdmin) {
      setWorkerOptions([])
      return
    }
    api
      .get("/users?roles=project_manager,crew_member&limit=200")
      .then((r) => setWorkerOptions(r.data.users ?? []))
      .catch((err: unknown) => toastApiError(err, "Failed to load workers"))
  }, [isAdmin])

  useDocumentTitle(client ? client.companyName : "Client")

  const refetch = useCallback(async () => {
    if (!clientId) return
    try {
      const r = await api.get(`/clients/${clientId}`)
      setClient(r.data.client)
    } catch (err) {
      toastApiError(err, "Failed to load client")
    }
  }, [clientId])

  useEffect(() => {
    if (!clientId) return
    let active = true
    setLoading(true)
    api
      .get(`/clients/${clientId}`)
      .then((r) => {
        if (active) setClient(r.data.client)
      })
      .catch((err) => toastApiError(err, "Failed to load client"))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [clientId])

  // Re-fetch the client header (incl. AR rollup) whenever a downstream
  // page invalidates the "clients" resource — for example, after an
  // edit on the Job Financials tab.
  useEffect(() => subscribeToDataRefresh("clients", () => void refetch()), [refetch])

  async function saveJobFields(
    jobId: string,
    overrides: Partial<{
      status: string
      contractValueCents: number | null
      amountPaidCents: number | null
      projectedStart: string | null
      projectedCompletion: string | null
      actualStart: string | null
      actualCompletion: string | null
      projectManagerId: string | null
    }>,
  ) {
    try {
      const existing = await api.get(`/jobs/${jobId}`)
      const j = existing.data.job
      const contract =
        overrides.contractValueCents !== undefined
          ? (overrides.contractValueCents ?? 0)
          : (j.contractValueCents ?? 0)
      const paid =
        overrides.amountPaidCents !== undefined
          ? (overrides.amountPaidCents ?? 0)
          : (j.amountPaidCents ?? 0)
      if (contract > 0 && paid > contract) {
        toast.error("Amount paid cannot exceed the contract value.")
        return
      }
      const payload = {
        title: j.title,
        status: overrides.status ?? j.status,
        jobType: j.jobType ?? null,
        contractType: j.contractType ?? null,
        streetAddress: j.streetAddress ?? null,
        city: j.city ?? null,
        state: j.state ?? null,
        zipCode: j.zipCode ?? null,
        contractPrice: j.contractPrice ?? null,
        projectedStart:
          overrides.projectedStart !== undefined
            ? overrides.projectedStart
            : (j.projectedStart ?? null),
        projectedCompletion:
          overrides.projectedCompletion !== undefined
            ? overrides.projectedCompletion
            : (j.projectedCompletion ?? null),
        actualStart:
          overrides.actualStart !== undefined
            ? overrides.actualStart
            : (j.actualStart ?? null),
        actualCompletion:
          overrides.actualCompletion !== undefined
            ? overrides.actualCompletion
            : (j.actualCompletion ?? null),
        workDays: j.workDays ?? null,
        squareFeet: j.squareFeet ?? null,
        permitNumber: j.permitNumber ?? null,
        internalNotes: j.internalNotes ?? null,
        subVendorNotes: j.subVendorNotes ?? null,
        clientId: j.clientId,
        projectManagerId:
          overrides.projectManagerId !== undefined
            ? overrides.projectManagerId
            : (j.projectManagerId ?? null),
        contractValueCents:
          overrides.contractValueCents !== undefined
            ? overrides.contractValueCents
            : (j.contractValueCents ?? null),
        amountPaidCents:
          overrides.amountPaidCents !== undefined
            ? overrides.amountPaidCents
            : (j.amountPaidCents ?? null),
        assigneeIds: (j.assignees ?? []).map((a: { id: string }) => a.id),
      }
      await api.put(`/jobs/${jobId}`, payload)
      await refetch()
      toast.success("Saved")
    } catch (err) {
      toastApiError(err, "Failed to update job")
    }
  }

  function saveJobMoney(
    jobId: string,
    field: "contractValueCents" | "amountPaidCents",
    nextDollars: number,
  ) {
    return saveJobFields(jobId, { [field]: Math.round(nextDollars * 100) })
  }

  const sortedJobs = useMemo(
    () =>
      (client?.jobs ?? []).slice().sort((a, b) => {
        // Active before closed/archived, then most recent updated_at
        const aActive = a.status !== "closed" && a.status !== "archived"
        const bActive = b.status !== "closed" && b.status !== "archived"
        if (aActive !== bActive) return aActive ? -1 : 1
        return (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)
      }),
    [client?.jobs],
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (!client) {
    return (
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-8 text-center text-sm text-slate-400">
        Client not found.
      </div>
    )
  }

  const r = client.rollups

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate("/clients")} aria-label="Back to clients">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600">
            <Building2 className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-slate-900">{client.companyName}</h1>
            <p className="text-xs text-slate-400">
              {[client.city, client.state].filter(Boolean).join(", ") || "—"}
              {client.archived && (
                <Badge variant="outline" className="ml-2 bg-slate-50 text-slate-500 border-slate-200 text-[10px]">
                  Archived
                </Badge>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* AR rollup cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <RollupCard label="Active jobs" value={String(r.activeJobCount)} sub={`${r.totalJobCount} total`} />
        <RollupCard label="Contract" value={fmtMoney(r.contractValueCents)} />
        <RollupCard label="Paid" value={fmtMoney(r.amountPaidCents)} />
        <RollupCard
          label="Outstanding"
          value={fmtMoney(r.outstandingCents)}
          accent={r.outstandingCents > 0 ? "text-orange-600" : "text-slate-500"}
        />
        <RollupCard label="Last activity" value={fmtDate(r.lastActivityAt)} />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-[#E5E7EB]">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t
                ? "border-orange-600 text-orange-700"
                : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {TAB_LABELS[t]}
            {t === "jobs" && (
              <span className="ml-1.5 text-xs text-slate-400">({client.jobs.length})</span>
            )}
            {t === "contacts" && (
              <span className="ml-1.5 text-xs text-slate-400">({client.contacts.length})</span>
            )}
          </button>
        ))}
      </div>

      {tab === "jobs" && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="orange"
              onClick={() =>
                navigate("/jobs", {
                  state: {
                    openCreate: true,
                    clientId: client.id,
                    lockClient: true,
                  },
                })
              }
            >
              <Plus className="mr-1 size-3.5" />
              New Job
            </Button>
          </div>
          {sortedJobs.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-400">
                No jobs for this client yet.
                <button
                  type="button"
                  className="ml-2 text-orange-600 hover:underline"
                  onClick={() =>
                    navigate("/jobs", {
                      state: {
                        openCreate: true,
                        clientId: client.id,
                        lockClient: true,
                      },
                    })
                  }
                >
                  <Plus className="inline size-3.5" /> Add a job
                </button>
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Job</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Status</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Contract</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Paid</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedJobs.map((j) => {
                    const contract = j.contractValueCents ?? 0
                    const paid = j.amountPaidCents ?? 0
                    const out = Math.max(0, contract - paid)
                    return (
                      <tr
                        key={j.id}
                        className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                        onClick={() => navigate(`/jobs/${j.id}`)}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{j.title}</div>
                          {(j.city || j.state) && (
                            <div className="text-xs text-slate-400">
                              {[j.city, j.state].filter(Boolean).join(", ")}
                            </div>
                          )}
                          <div
                            className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-[10px] uppercase tracking-wide text-slate-400">
                              Projected
                            </span>
                            <InlineDate
                              value={j.projectedStart}
                              placeholder="Start —"
                              onSave={(next) =>
                                saveJobFields(j.id, { projectedStart: next })
                              }
                            />
                            <span className="text-[11px] text-slate-300">→</span>
                            <InlineDate
                              value={j.projectedCompletion}
                              placeholder="End —"
                              onSave={(next) =>
                                saveJobFields(j.id, { projectedCompletion: next })
                              }
                            />
                          </div>
                          <div
                            className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-[10px] uppercase tracking-wide text-slate-400">
                              Actual
                            </span>
                            <InlineDate
                              value={j.actualStart}
                              placeholder="Start —"
                              onSave={(next) =>
                                saveJobFields(j.id, { actualStart: next })
                              }
                            />
                            <span className="text-[11px] text-slate-300">→</span>
                            <InlineDate
                              value={j.actualCompletion}
                              placeholder="End —"
                              onSave={(next) =>
                                saveJobFields(j.id, { actualCompletion: next })
                              }
                            />
                          </div>
                          <div
                            className="mt-1 flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-[10px] uppercase tracking-wide text-slate-400">
                              PM
                            </span>
                            {isAdmin ? (
                              <InlinePmPicker
                                projectManagerId={j.projectManagerId}
                                projectManagerName={j.projectManagerName}
                                options={workerOptions}
                                onChange={(next) =>
                                  saveJobFields(j.id, { projectManagerId: next })
                                }
                              />
                            ) : (
                              <span className="text-[11px] text-slate-500">
                                {j.projectManagerName ?? "Unassigned"}
                              </span>
                            )}
                          </div>
                        </td>
                        <td
                          className="px-3 py-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Popover>
                            <PopoverTrigger asChild>
                              <button type="button" className="inline-flex">
                                {j.status ? (
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-xs cursor-pointer",
                                      JOB_STATUS_COLORS[j.status] ?? "",
                                    )}
                                  >
                                    {j.status}
                                  </Badge>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-32 p-1">
                              {JOB_STATUSES.map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  className={cn(
                                    "block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-100",
                                    j.status === s && "bg-slate-50 font-semibold",
                                  )}
                                  onClick={() =>
                                    void saveJobFields(j.id, { status: s })
                                  }
                                >
                                  {s}
                                </button>
                              ))}
                            </PopoverContent>
                          </Popover>
                        </td>
                        <td
                          className="px-3 py-2 text-right text-slate-700"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <InlineMoneyInput
                            valueCents={contract}
                            disabled={!!j.hasTracker}
                            disabledTitle="Managed by Financial Tracker"
                            onSave={(v) => saveJobMoney(j.id, "contractValueCents", v)}
                          />
                        </td>
                        <td
                          className="px-3 py-2 text-right text-slate-700"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <InlineMoneyInput
                            valueCents={paid}
                            disabled={!!j.hasTracker}
                            disabledTitle="Managed by Financial Tracker"
                            onSave={(v) => saveJobMoney(j.id, "amountPaidCents", v)}
                          />
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right font-medium",
                            out > 0 ? "text-orange-700" : "text-slate-400",
                          )}
                        >
                          {fmtMoney(out)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "contacts" && (
        <div className="space-y-2">
          {client.contacts.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-400">
                No contacts yet.{" "}
                <Link
                  to={`/clients?client=${client.id}`}
                  className="text-orange-600 hover:underline"
                >
                  Manage contacts
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {client.contacts.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-[#E5E7EB] bg-white p-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-slate-900">
                      {[c.firstName, c.lastName].filter(Boolean).join(" ") || "(no name)"}
                    </div>
                    {c.isPrimary && (
                      <Badge variant="outline" className="text-[10px] bg-orange-50 text-orange-700 border-orange-200">
                        Primary
                      </Badge>
                    )}
                  </div>
                  {c.title && <div className="text-xs text-slate-400">{c.title}</div>}
                  <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                    {c.email && <div>{c.email}</div>}
                    {c.phone && <div>{c.phone}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(tab === "files" || tab === "daily-logs" || tab === "schedule") && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-500 space-y-2">
            <p>
              {tab === "files"
                ? "Files for this client are organized by job."
                : tab === "daily-logs"
                  ? "Daily logs for this client are recorded per job."
                  : "Schedules for this client are managed per job."}
            </p>
            <div className="flex justify-center gap-2">
              <Link
                to={
                  tab === "files"
                    ? `/files/documents?client=${client.id}`
                    : tab === "daily-logs"
                      ? `/daily-logs/mine?client=${client.id}`
                      : `/dashboard?client=${client.id}`
                }
              >
                <Button size="sm" variant="outline">
                  {tab === "files" && <FileText className="mr-1.5 size-3.5" />}
                  {tab === "daily-logs" && <ClipboardList className="mr-1.5 size-3.5" />}
                  Open {TAB_LABELS[tab]} (filtered to this client)
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "notes" && (
        <Card>
          <CardContent className="py-6 text-sm">
            {client.notes ? (
              <p className="whitespace-pre-wrap text-slate-700">{client.notes}</p>
            ) : (
              <p className="text-slate-400">No notes yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function RollupCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className={cn("text-lg font-semibold text-slate-900 truncate", accent)}>{value}</p>
        {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
      </CardContent>
    </Card>
  )
}
