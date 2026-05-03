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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
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
  projectedStart: string | null
  projectedCompletion: string | null
  updatedAt: string | null
  createdAt: string
}

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
}: {
  valueCents: number
  onSave: (dollars: number) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => (valueCents / 100).toFixed(2))
  useEffect(() => {
    setDraft((valueCents / 100).toFixed(2))
  }, [valueCents])
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

export default function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const navigate = useNavigate()
  const [client, setClient] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("jobs")

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

  async function saveJobMoney(
    jobId: string,
    field: "contractValueCents" | "amountPaidCents",
    nextDollars: number,
  ) {
    const nextCents = Math.round(nextDollars * 100)
    try {
      const existing = await api.get(`/jobs/${jobId}`)
      const j = existing.data.job
      const contract =
        field === "contractValueCents" ? nextCents : (j.contractValueCents ?? 0)
      const paid =
        field === "amountPaidCents" ? nextCents : (j.amountPaidCents ?? 0)
      if (contract > 0 && paid > contract) {
        toast.error("Amount paid cannot exceed the contract value.")
        return
      }
      const payload = {
        title: j.title,
        status: j.status,
        jobType: j.jobType ?? null,
        contractType: j.contractType ?? null,
        streetAddress: j.streetAddress ?? null,
        city: j.city ?? null,
        state: j.state ?? null,
        zipCode: j.zipCode ?? null,
        contractPrice: j.contractPrice ?? null,
        projectedStart: j.projectedStart ?? null,
        projectedCompletion: j.projectedCompletion ?? null,
        actualStart: j.actualStart ?? null,
        actualCompletion: j.actualCompletion ?? null,
        workDays: j.workDays ?? null,
        squareFeet: j.squareFeet ?? null,
        permitNumber: j.permitNumber ?? null,
        internalNotes: j.internalNotes ?? null,
        subVendorNotes: j.subVendorNotes ?? null,
        clientId: j.clientId,
        projectManagerId: j.projectManagerId ?? null,
        contractValueCents:
          field === "contractValueCents" ? nextCents : (j.contractValueCents ?? null),
        amountPaidCents:
          field === "amountPaidCents" ? nextCents : (j.amountPaidCents ?? null),
        assigneeIds: (j.assignees ?? []).map((a: { id: string }) => a.id),
      }
      await api.put(`/jobs/${jobId}`, payload)
      await refetch()
      toast.success("Saved")
    } catch (err) {
      toastApiError(err, "Failed to update job")
    }
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
          {sortedJobs.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-400">
                No jobs for this client yet.
                <Link to={`/jobs?client=${client.id}`} className="ml-2 text-orange-600 hover:underline">
                  <Plus className="inline size-3.5" /> Add a job
                </Link>
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
                        </td>
                        <td className="px-3 py-2">
                          {j.status ? (
                            <Badge
                              variant="outline"
                              className={cn("text-xs", JOB_STATUS_COLORS[j.status] ?? "")}
                            >
                              {j.status}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td
                          className="px-3 py-2 text-right text-slate-700"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <InlineMoneyInput
                            valueCents={contract}
                            onSave={(v) => saveJobMoney(j.id, "contractValueCents", v)}
                          />
                        </td>
                        <td
                          className="px-3 py-2 text-right text-slate-700"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <InlineMoneyInput
                            valueCents={paid}
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
