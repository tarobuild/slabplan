import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  DollarSign,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { api } from "@/lib/api"
import { ApiError } from "@workspace/api-client-react"
import { isAxiosError } from "axios"
import { apiErrorDetailCode, toastApiError } from "@/lib/api-errors"
import { useAuthStore } from "@/store/auth"
import { invalidateFinancialsRollups } from "@/lib/query-client"
import { formatCurrencyCents } from "@/lib/format"
import { parseUsdAmountCents } from "@/lib/money-input"
import { describePercentLowering } from "@/lib/percent-confirm"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type LinePayment = { id: string; invoiceId: string; amountCents: number }

type LineItem = {
  id: string
  areaId: string
  description: string
  qty: string
  rateCents: number
  scheduledValueCents: number
  billedCents: number
  percentComplete: string
  isRemoved: boolean
  isChangeOrder: boolean
  sortOrder: number
  payments: LinePayment[]
}

type Area = {
  id: string
  trackerId: string
  name: string
  floor: string | null
  sortOrder: number
  isChangeOrderGroup: boolean
  lineItems: LineItem[]
}

type ChangeOrder = {
  id: string
  number: string
  description: string | null
  amountCents: number
  status: "pending" | "approved" | "rejected"
}

type InvoicePayment = { id: string; lineItemId: string; amountCents: number }

type Invoice = {
  id: string
  invoiceNumber: string | null
  invoiceDate: string | null
  totalCents: number
  retentionHeldCents: number
  netPaidCents: number
  appliedAt: string | null
  createdAt: string
  fileId: string | null
  payments: InvoicePayment[]
}

type TrackerData = {
  tracker: {
    id: string
    jobId: string
    projectName: string | null
    contractDate: string | null
    currency: string
    retentionEnabled: boolean
    retentionRateBps: number
    retentionReleasedAt: string | null
    retentionReleasedBy: string | null
    estimateFileId: string | null
  }
  // Parent client of this job; surfaced by the API so cache
  // invalidation can refresh the Client Detail AR card without
  // an extra round-trip (#275 follow-up).
  clientId: string | null
  areas: Area[]
  changeOrders: ChangeOrder[]
  invoices: Invoice[]
  totals: {
    scheduledValueCents: number
    billedCents: number
    outstandingCents: number
    changeOrderApprovedCents: number
    contractWithChangesCents: number
    percentBilled: number
    retention: {
      enabled: boolean
      rateBps: number
      releasedAt: string | null
      releasedBy: string | null
      released: boolean
      maxRetentionCents: number
      retentionHeldCents: number
      retentionOutstandingCents: number
      netReceivedCents: number
      invoiceNetPaidCents: number
    }
  }
}

// Use the shared cents-aware formatter so SOV totals match the way
// money is displayed elsewhere (Clients / Jobs / Client Detail). Cents
// are always shown — invoice + SOV math is too sensitive to round to
// whole dollars (#275).
const formatCurrency = formatCurrencyCents
const DEFAULT_RETENTION_RATE_BPS = 1000
const RETENTION_RATE_OPTIONS = [500, 1000, 1500]

function formatRetentionRate(rateBps: number) {
  const pct = rateBps / 100
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`
}

export type AiParseError = {
  file: File
  code: string
  message: string
}

function statusForPct(pct: number): { label: string; cls: string } {
  if (pct >= 100)
    return {
      label: "Complete",
      cls: "bg-green-100 text-green-800 border-green-200",
    }
  if (pct > 0)
    return {
      label: "In progress",
      cls: "bg-primary/10 text-primary border-primary/20",
    }
  return {
    label: "Not started",
    cls: "bg-slate-100 text-slate-700 border-slate-200",
  }
}

function csvEscape(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadCsv(
  filename: string,
  rows: (string | number | null | undefined)[][],
) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Memoized SOV row components (#275 follow-up) ─────────────────
//
// The SOV table is the most expensive surface on this page: every
// PATCH triggers a full reload(), which re-builds the whole tree.
// Hoisting line-item and area rows to module scope and wrapping in
// React.memo means rows whose props are reference-equal (the same
// `li`, the same handler identities) skip re-rendering. The parent
// owns the data and passes stable useCallback handlers down.
//
// Inputs use `defaultValue` (uncontrolled) so typing inside one row
// never re-renders siblings. Each input key includes the persisted value so
// a tracker reload remounts stale fields even when the line item id is stable.

type LineItemPatch = Partial<{
  description: string
  qty: number
  rateCents: number
  scheduledValueCents: number
  percentComplete: number
}>

type SovLineItemRowProps = {
  li: LineItem
  invoices: Invoice[]
  canManage: boolean
  onUpdate: (id: string, patch: LineItemPatch) => void
  onDelete: (id: string) => void
}

const SovLineItemRow = memo(function SovLineItemRow({
  li,
  invoices,
  canManage,
  onUpdate,
  onDelete,
}: SovLineItemRowProps) {
  const paymentByInv = useMemo(
    () => new Map(li.payments.map((p) => [p.invoiceId, p.amountCents])),
    [li.payments],
  )
  const liPct = Math.round(Number(li.percentComplete) || 0)
  const liStatus = statusForPct(liPct)
  return (
    <tr className="border-t">
      <td className="px-3 py-2">
        <Badge variant="outline" className={liStatus.cls}>
          {liStatus.label}
        </Badge>
      </td>
      <td className="sticky left-0 z-10 bg-white px-3 py-2 shadow-[1px_0_0_0_rgb(226,232,240)] md:shadow-none md:static">
        {canManage ? (
          <Input
            key={`desc-${li.description}`}
            defaultValue={li.description}
            onBlur={(e) => {
              if (e.target.value !== li.description) {
                onUpdate(li.id, { description: e.target.value })
              }
            }}
            className="h-8"
          />
        ) : (
          <span className="text-sm">{li.description}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {canManage ? (
          <Input
            key={`qty-${li.qty}`}
            type="number"
            inputMode="decimal"
            defaultValue={String(Number(li.qty))}
            onBlur={(e) => {
              const v = Number(e.target.value)
              if (!Number.isNaN(v) && v !== Number(li.qty)) {
                onUpdate(li.id, { qty: v })
              }
            }}
            className="h-8 w-20 text-right"
          />
        ) : (
          <span className="tabular-nums">{Number(li.qty)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {canManage ? (
          <Input
            key={`rate-${li.rateCents}`}
            type="number"
            inputMode="decimal"
            step="0.01"
            defaultValue={(li.rateCents / 100).toFixed(2)}
            onBlur={(e) => {
              const v = Number(e.target.value)
              const cents = Math.round(v * 100)
              if (!Number.isNaN(v) && cents !== Number(li.rateCents)) {
                onUpdate(li.id, { rateCents: cents })
              }
            }}
            className="h-8 w-24 text-right"
          />
        ) : (
          formatCurrency(li.rateCents)
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {canManage ? (
          <Input
            key={`sched-${li.scheduledValueCents}`}
            type="number"
            inputMode="decimal"
            step="0.01"
            defaultValue={(li.scheduledValueCents / 100).toFixed(2)}
            onBlur={(e) => {
              const v = Number(e.target.value)
              const cents = Math.round(v * 100)
              if (Number.isNaN(v) || cents === Number(li.scheduledValueCents)) {
                return
              }
              // Lowering scheduled below the current billed will cap
              // billed down to the new scheduled → confirm.
              const currentBilled = Number(li.billedCents)
              const projectedBilled = Math.min(currentBilled, cents)
              if (projectedBilled < currentBilled) {
                const ok = window.confirm(
                  `Lowering scheduled value will reduce billed from ${formatCurrency(currentBilled)} to ${formatCurrency(projectedBilled)}. Continue?`,
                )
                if (!ok) {
                  e.target.value = (li.scheduledValueCents / 100).toFixed(2)
                  return
                }
              }
              onUpdate(li.id, { scheduledValueCents: cents })
            }}
            className="h-8 w-28 text-right"
          />
        ) : (
          formatCurrency(li.scheduledValueCents)
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatCurrency(li.billedCents)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatCurrency(
          Math.max(0, Number(li.scheduledValueCents) - Number(li.billedCents)),
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {canManage ? (
          <Input
            key={`pct-${li.percentComplete}`}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step="1"
            defaultValue={Number(li.percentComplete).toFixed(0)}
            aria-label={`Percent complete for ${li.description}`}
            onBlur={(e) => {
              const v = Number(e.target.value)
              if (
                Number.isNaN(v) ||
                v.toFixed(2) === Number(li.percentComplete).toFixed(2)
              ) {
                return
              }
              // Safety check: dropping % below already-applied invoice
              // payments would silently shrink billed under the matched
              // amount. Predicate lives in lib/percent-confirm.ts so it
              // can be unit-tested apart from React.
              const conflict = describePercentLowering({
                scheduledValueCents: Number(li.scheduledValueCents) || 0,
                newPercent: v,
                payments: li.payments,
              })
              if (conflict.needsConfirm) {
                const invNos = li.payments
                  .map((p) => {
                    const inv = invoices.find((x) => x.id === p.invoiceId)
                    return inv?.invoiceNumber ?? inv?.id.slice(0, 6) ?? "?"
                  })
                  .join(", ")
                const ok = window.confirm(
                  `This line already has ${formatCurrency(conflict.appliedCents)} applied from invoice(s) ${invNos}. ` +
                    `Setting % complete to ${v}% would lower billed to ${formatCurrency(conflict.proposedBilledCents)}, which is below the matched amount.\n\n` +
                    `Continue anyway?`,
                )
                if (!ok) {
                  e.target.value = Number(li.percentComplete).toFixed(0)
                  return
                }
              }
              onUpdate(li.id, { percentComplete: v })
            }}
            className="h-8 w-16 text-right"
          />
        ) : (
          <span className="tabular-nums">{Number(li.percentComplete).toFixed(0)}%</span>
        )}
      </td>
      {invoices.map((inv) => {
        const amt = paymentByInv.get(inv.id) ?? 0
        return (
          <td key={inv.id} className="px-3 py-2 text-right tabular-nums">
            {amt > 0 ? (
              formatCurrency(amt)
            ) : (
              <span className="text-slate-300">—</span>
            )}
          </td>
        )
      })}
      <td className="px-3 py-2 text-right">
        {canManage ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Delete line item: ${li.description}`}
            onClick={() => onDelete(li.id)}
            className="min-h-10 min-w-10 md:min-h-9 md:min-w-9"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </td>
    </tr>
  )
})

type SovAreaRowProps = {
  area: Area
  invoices: Invoice[]
  collapsed: boolean
  canManage: boolean
  onToggle: (id: string) => void
  onAddLineItem: (id: string) => void
  onRenameArea: (id: string, name: string) => void
  onDeleteArea: (id: string, name: string) => void
  onUpdateLineItem: (id: string, patch: LineItemPatch) => void
  onDeleteLineItem: (id: string) => void
}

const SovAreaRow = memo(function SovAreaRow({
  area,
  invoices,
  collapsed,
  canManage,
  onToggle,
  onAddLineItem,
  onRenameArea,
  onDeleteArea,
  onUpdateLineItem,
  onDeleteLineItem,
}: SovAreaRowProps) {
  const sched = area.lineItems.reduce(
    (s, li) => s + Number(li.scheduledValueCents),
    0,
  )
  const billed = area.lineItems.reduce((s, li) => s + Number(li.billedCents), 0)
  const pct = sched > 0 ? Math.round((billed / sched) * 100) : 0
  const status = statusForPct(pct)
  const isCO = area.isChangeOrderGroup
  return (
    <div
      className={`rounded-lg border ${isCO ? "border-violet-300 bg-violet-50/30" : ""}`}
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2 ${isCO ? "bg-violet-100/60" : "bg-muted/40"}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onToggle(area.id)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={collapsed ? "Expand area" : "Collapse area"}
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            <div className="text-sm font-semibold">{area.name}</div>
            {isCO ? (
              <Badge className="border-violet-300 bg-violet-100 text-violet-800 hover:bg-violet-100">
                Change Order
              </Badge>
            ) : null}
            <Badge variant="outline" className={status.cls}>
              {status.label}
            </Badge>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatCurrency(billed)} / {formatCurrency(sched)} ({pct}%)
            </span>
          </div>
          {area.floor ? (
            <div className="text-xs text-muted-foreground">{area.floor}</div>
          ) : null}
          <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>
        {canManage ? (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAddLineItem(area.id)}
            >
              <Plus className="mr-1 h-4 w-4" /> Line item
            </Button>
            {isCO ? null : (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Rename area"
                  onClick={() => onRenameArea(area.id, area.name)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Delete area"
                  onClick={() => onDeleteArea(area.id, area.name)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>
      {collapsed ? null : (
        <>
          <div className="px-3 pt-1 text-[10px] uppercase tracking-wide text-slate-400 md:hidden">
            ← swipe to see more →
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left shadow-[1px_0_0_0_rgb(226,232,240)] md:shadow-none md:static">
                    Description
                  </th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Scheduled</th>
                  <th className="px-3 py-2 text-right">Billed</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2 text-right">% Done</th>
                  {invoices.map((inv) => (
                    <th
                      key={inv.id}
                      className="px-3 py-2 text-right whitespace-nowrap"
                      title={inv.invoiceDate ?? ""}
                    >
                      Inv {inv.invoiceNumber ?? inv.id.slice(0, 6)}
                    </th>
                  ))}
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {area.lineItems.map((li) => (
                  <SovLineItemRow
                    key={li.id}
                    li={li}
                    invoices={invoices}
                    canManage={canManage}
                    onUpdate={onUpdateLineItem}
                    onDelete={onDeleteLineItem}
                  />
                ))}
                {area.lineItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9 + invoices.length}
                      className="px-3 py-4 text-center text-xs text-muted-foreground"
                    >
                      No line items
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
})

export default function JobFinancialsPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const user = useAuthStore((s) => s.user)
  // Non-admin assignees can be granted read-only financials access per job,
  // but every financial write remains admin-only.
  const canManage = user?.role === "admin"
  const queryClient = useQueryClient()
  const [data, setData] = useState<TrackerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [estimateUploading, setEstimateUploading] = useState(false)
  const [invoiceUploading, setInvoiceUploading] = useState(false)
  const [pendingEstimateFile, setPendingEstimateFile] = useState<File | null>(
    null,
  )
  const [editingProject, setEditingProject] = useState(false)
  const [projectDraft, setProjectDraft] = useState({
    projectName: "",
    contractDate: "",
  })
  const [retentionDraft, setRetentionDraft] = useState({
    enabled: false,
    rateBps: DEFAULT_RETENTION_RATE_BPS,
    customPct: "10",
  })
  const [savingRetention, setSavingRetention] = useState(false)
  const [releasingRetention, setReleasingRetention] = useState(false)
  const [matchesInvoice, setMatchesInvoice] = useState<Invoice | null>(null)
  const [matchDraft, setMatchDraft] = useState<Record<string, string>>({})
  const [savingMatches, setSavingMatches] = useState(false)
  const [collapsedAreas, setCollapsedAreas] = useState<Record<string, boolean>>(
    {},
  )
  // Holds the last-failed AI parse so the user can hit "Try again"
  // without re-picking the file. Cleared on success or explicit
  // dismiss. Drift item from #269 / #275.
  const [estimateError, setEstimateError] = useState<AiParseError | null>(null)
  const [invoiceError, setInvoiceError] = useState<AiParseError | null>(null)
  const toggleArea = useCallback(
    (areaId: string) =>
      setCollapsedAreas((m) => ({ ...m, [areaId]: !m[areaId] })),
    [],
  )
  const estimateInputRef = useRef<HTMLInputElement>(null)
  const invoiceInputRef = useRef<HTMLInputElement>(null)

  // We re-read clientId from the latest data on each call rather
  // than capturing it in the dep array — invalidate() is passed to
  // many useCallback'd handlers and we don't want to invalidate
  // their identity every time the tracker reloads.
  const dataRef = useRef<TrackerData | null>(null)
  dataRef.current = data
  const invalidate = useCallback(() => {
    invalidateFinancialsRollups(queryClient, {
      jobId: jobId ?? null,
      clientId: dataRef.current?.clientId ?? null,
    })
  }, [queryClient, jobId])

  // Pull a stable error code + human message out of an axios/ApiError
  // response so the AI retry block can surface what actually went wrong.
  // Estimate/invoice uploads go through the Axios `api` instance, not
  // the ApiError-throwing fetch client, so we try Axios first and fall
  // back to ApiError + generic Error.
  const toAiError = useCallback(
    (err: unknown, file: File, fallback: string): AiParseError => {
      if (isAxiosError(err)) {
        // Prefer the structured `errors.code` the API surfaces inside
        // problem+json bodies (e.g. AI_PARSE_FAILED, LIMIT_FILE_SIZE).
        // Fall back to HTTP_<status> so the retry block always shows
        // something machine-readable.
        const detailCode = apiErrorDetailCode(err)
        const status = err.response?.status
        const data = err.response?.data as
          | { message?: string; error?: string }
          | undefined
        return {
          file,
          code:
            detailCode ?? (status ? `HTTP_${status}` : (err.code ?? "UNKNOWN")),
          message: data?.message ?? data?.error ?? err.message ?? fallback,
        }
      }
      if (err instanceof ApiError) {
        const data = err.data as
          | { message?: string; error?: string }
          | undefined
        return {
          file,
          code: `HTTP_${err.status}`,
          message: data?.message ?? data?.error ?? err.message ?? fallback,
        }
      }
      return {
        file,
        code: "UNKNOWN",
        message: err instanceof Error ? err.message : fallback,
      }
    },
    [],
  )

  const load = useCallback(async () => {
    if (!jobId) return
    try {
      const res = await api.get<TrackerData>(`/jobs/${jobId}/financials`)
      setData(res.data)
    } catch (err) {
      toastApiError(err, "Failed to load financial tracker")
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!data) return
    const rateBps = data.tracker.retentionRateBps ?? DEFAULT_RETENTION_RATE_BPS
    setRetentionDraft({
      enabled: Boolean(data.tracker.retentionEnabled),
      rateBps,
      customPct: String(rateBps / 100),
    })
  }, [
    data?.tracker.id,
    data?.tracker.retentionEnabled,
    data?.tracker.retentionRateBps,
  ])

  const performEstimateUpload = async (file: File) => {
    if (!jobId) return
    setEstimateUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("retentionEnabled", String(retentionDraft.enabled))
      fd.append("retentionRateBps", String(retentionDraft.rateBps))
      const res = await api.post<TrackerData>(
        `/jobs/${jobId}/financials/estimate`,
        fd,
        {
          headers: { "Content-Type": "multipart/form-data" },
        },
      )
      setData(res.data)
      setEstimateError(null)
      invalidate()
      toast.success("Estimate parsed")
    } catch (err) {
      // Hold the file in state so "Try again" can re-run the parse
      // without forcing the user to re-pick the document.
      setEstimateError(toAiError(err, file, "Failed to parse estimate"))
      toastApiError(err, "Failed to parse estimate")
    } finally {
      setEstimateUploading(false)
      if (estimateInputRef.current) estimateInputRef.current.value = ""
    }
  }

  const onEstimatePicked = (file: File) => {
    if (data?.tracker.estimateFileId || (data?.areas.length ?? 0) > 0) {
      setPendingEstimateFile(file)
      return
    }
    void performEstimateUpload(file)
  }

  const confirmReupload = async () => {
    const f = pendingEstimateFile
    setPendingEstimateFile(null)
    if (f) await performEstimateUpload(f)
  }

  const performInvoiceUpload = async (file: File) => {
    if (!jobId) return
    setInvoiceUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await api.post<TrackerData & { invoiceId: string }>(
        `/jobs/${jobId}/financials/invoices`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      )
      setData(res.data)
      setInvoiceError(null)
      invalidate()
      toast.success("Invoice matched and applied")
    } catch (err) {
      setInvoiceError(toAiError(err, file, "Failed to ingest invoice"))
      toastApiError(err, "Failed to ingest invoice")
    } finally {
      setInvoiceUploading(false)
      if (invoiceInputRef.current) invoiceInputRef.current.value = ""
    }
  }

  const onInvoicePicked = (file: File) => {
    void performInvoiceUpload(file)
  }

  // -------------------- Upload CO (AI parse) --------------------
  // Mirrors the estimate / invoice upload UX. The parse endpoint
  // saves the file to the FINANCIALS folder and returns extracted
  // {number, description, amountCents}; the user confirms in a
  // dialog and the existing change-orders POST creates the row. The
  // uploaded document remains in the Financials folder rather than being
  // linked from the change-order row.
  const coInputRef = useRef<HTMLInputElement>(null)
  const [coUploading, setCoUploading] = useState(false)
  const [coParseError, setCoParseError] = useState<AiParseError | null>(null)
  const [coDraft, setCoDraft] = useState<{
    number: string
    description: string
    amountDollars: string
    areaId: string
  } | null>(null)
  const [coSaving, setCoSaving] = useState(false)

  // Pending delete dialogs — converted from window.confirm so the
  // experience matches the AlertDialog pattern used elsewhere.
  const [pendingDeleteLineItemId, setPendingDeleteLineItemId] = useState<
    string | null
  >(null)
  const [pendingDeleteArea, setPendingDeleteArea] = useState<{
    id: string
    name: string
  } | null>(null)
  const [pendingDeleteInvoiceId, setPendingDeleteInvoiceId] = useState<
    string | null
  >(null)
  const [deletingFinancial, setDeletingFinancial] = useState(false)

  const performCoParse = async (file: File) => {
    if (!jobId) return
    setCoUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await api.post<{
        number: string
        description: string | null
        amountCents: number
        fileId: string | null
      }>(`/jobs/${jobId}/financials/change-orders/parse`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      setCoParseError(null)
      setCoDraft({
        number: res.data.number,
        description: res.data.description ?? "",
        amountDollars: (res.data.amountCents / 100).toFixed(2),
        areaId: "",
      })
    } catch (err) {
      setCoParseError(toAiError(err, file, "Failed to parse change order"))
      toastApiError(err, "Failed to parse change order")
    } finally {
      setCoUploading(false)
      if (coInputRef.current) coInputRef.current.value = ""
    }
  }

  const onCoPicked = (file: File) => {
    void performCoParse(file)
  }

  const saveParsedChangeOrder = async () => {
    if (!jobId || !coDraft) return
    const number = coDraft.number.trim()
    if (!number) {
      toast.error("CO number is required")
      return
    }
    const amountCents = parseUsdAmountCents(coDraft.amountDollars)
    if (amountCents === null) {
      toast.error("Amount must be a non-negative number")
      return
    }
    setCoSaving(true)
    try {
      await api.post(`/jobs/${jobId}/financials/change-orders`, {
        number,
        description: coDraft.description.trim() || null,
        amountCents,
        areaId: coDraft.areaId || null,
      })
      setCoDraft(null)
      await load()
      invalidate()
      toast.success("Change order added")
    } catch (err) {
      toastApiError(err, "Failed to add change order")
    } finally {
      setCoSaving(false)
    }
  }

  const updateLineItem = useCallback(
    async (
      lineItemId: string,
      patch: Partial<{
        description: string
        qty: number
        rateCents: number
        scheduledValueCents: number
        percentComplete: number
      }>,
    ) => {
      if (!jobId) return
      try {
        await api.patch(
          `/jobs/${jobId}/financials/line-items/${lineItemId}`,
          patch,
        )
        await load()
        invalidate()
      } catch (err) {
        toastApiError(err, "Failed to update line item")
      }
    },
    [jobId, load, invalidate],
  )

  const deleteLineItem = useCallback((lineItemId: string) => {
    setPendingDeleteLineItemId(lineItemId)
  }, [])

  const confirmDeleteLineItem = useCallback(async () => {
    const lineItemId = pendingDeleteLineItemId
    if (!jobId || !lineItemId) return
    setDeletingFinancial(true)
    try {
      await api.delete(`/jobs/${jobId}/financials/line-items/${lineItemId}`)
      await load()
      invalidate()
      setPendingDeleteLineItemId(null)
    } catch (err) {
      toastApiError(err, "Failed to delete line item")
    } finally {
      setDeletingFinancial(false)
    }
  }, [jobId, load, invalidate, pendingDeleteLineItemId])

  const addArea = async () => {
    if (!jobId) return
    const name = window.prompt("Area name")?.trim()
    if (!name) return
    try {
      await api.post(`/jobs/${jobId}/financials/areas`, { name })
      await load()
      invalidate()
    } catch (err) {
      toastApiError(err, "Failed to add area")
    }
  }

  const renameArea = useCallback(
    async (areaId: string, currentName: string) => {
      if (!jobId) return
      const next = window.prompt("Rename area", currentName)?.trim()
      if (!next || next === currentName) return
      try {
        await api.patch(`/jobs/${jobId}/financials/areas/${areaId}`, {
          name: next,
        })
        await load()
        invalidate()
      } catch (err) {
        toastApiError(err, "Failed to rename area")
      }
    },
    [jobId, load, invalidate],
  )

  const deleteArea = useCallback((areaId: string, name: string) => {
    setPendingDeleteArea({ id: areaId, name })
  }, [])

  const confirmDeleteArea = useCallback(async () => {
    const target = pendingDeleteArea
    if (!jobId || !target) return
    setDeletingFinancial(true)
    try {
      await api.delete(`/jobs/${jobId}/financials/areas/${target.id}`)
      await load()
      invalidate()
      setPendingDeleteArea(null)
    } catch (err) {
      toastApiError(err, "Failed to delete area")
    } finally {
      setDeletingFinancial(false)
    }
  }, [jobId, load, invalidate, pendingDeleteArea])

  const openInvoiceFile = async (fileId: string) => {
    try {
      const res = await api.post<{ url: string }>(
        `/files/${fileId}/signed-view`,
      )
      window.open(res.data.url, "_blank", "noopener,noreferrer")
    } catch (err) {
      toastApiError(err, "Failed to open invoice file")
    }
  }

  const addLineItem = useCallback(
    async (areaId: string) => {
      if (!jobId) return
      const description = window.prompt("Line item description")?.trim()
      if (!description) return
      try {
        await api.post(`/jobs/${jobId}/financials/line-items`, {
          areaId,
          description,
        })
        await load()
        invalidate()
      } catch (err) {
        toastApiError(err, "Failed to add line item")
      }
    },
    [jobId, load, invalidate],
  )

  const addChangeOrder = async () => {
    if (!jobId) return
    const number = window.prompt("Change order number")?.trim()
    if (!number) return
    const description = window.prompt("Description (optional)")?.trim() || null
    const amountStr = window.prompt("Amount (USD)")
    if (amountStr === null) return
    const amountCents = parseUsdAmountCents(amountStr)
    if (amountCents === null) {
      toast.error("Amount must be a non-negative number")
      return
    }
    // Optional area assignment: list area names so the user can pick one.
    const areas = data?.areas ?? []
    let areaId: string | null = null
    if (areas.length > 0) {
      const list = areas.map((a, i) => `${i + 1}. ${a.name}`).join("\n")
      const pick = window
        .prompt(
          `Assign to area? Enter number, or leave blank for none.\n${list}`,
        )
        ?.trim()
      const idx = pick ? Number(pick) - 1 : NaN
      if (!Number.isNaN(idx) && idx >= 0 && idx < areas.length) {
        areaId = areas[idx].id
      }
    }
    try {
      await api.post(`/jobs/${jobId}/financials/change-orders`, {
        number,
        description,
        amountCents,
        areaId,
      })
      await load()
      invalidate()
    } catch (err) {
      toastApiError(err, "Failed to add change order")
    }
  }

  const setChangeOrderStatus = async (
    coId: string,
    status: ChangeOrder["status"],
  ) => {
    if (!jobId) return
    try {
      await api.patch(`/jobs/${jobId}/financials/change-orders/${coId}`, {
        status,
      })
      await load()
      invalidate()
    } catch (err) {
      toastApiError(err, "Failed to update change order")
    }
  }

  const deleteInvoice = (invoiceId: string) => {
    setPendingDeleteInvoiceId(invoiceId)
  }

  const confirmDeleteInvoice = async () => {
    const invoiceId = pendingDeleteInvoiceId
    if (!jobId || !invoiceId) return
    setDeletingFinancial(true)
    try {
      await api.delete(`/jobs/${jobId}/financials/invoices/${invoiceId}`)
      await load()
      invalidate()
      setPendingDeleteInvoiceId(null)
    } catch (err) {
      toastApiError(err, "Failed to delete invoice")
    } finally {
      setDeletingFinancial(false)
    }
  }

  const saveProject = async () => {
    if (!jobId) return
    try {
      await api.patch(`/jobs/${jobId}/financials`, {
        projectName: projectDraft.projectName || null,
        contractDate: projectDraft.contractDate || null,
      })
      setEditingProject(false)
      await load()
      invalidate()
    } catch (err) {
      toastApiError(err, "Failed to update tracker")
    }
  }

  const setRetentionRate = (rateBps: number) => {
    setRetentionDraft((draft) => ({
      ...draft,
      rateBps,
      customPct: String(rateBps / 100),
    }))
  }

  const saveRetention = async () => {
    if (!jobId) return
    setSavingRetention(true)
    try {
      await api.patch(`/jobs/${jobId}/financials`, {
        retentionEnabled: retentionDraft.enabled,
        retentionRateBps: retentionDraft.enabled
          ? retentionDraft.rateBps
          : DEFAULT_RETENTION_RATE_BPS,
      })
      await load()
      invalidate()
      toast.success("Retention settings saved")
    } catch (err) {
      toastApiError(err, "Failed to update retention")
    } finally {
      setSavingRetention(false)
    }
  }

  const releaseRetention = async () => {
    if (!jobId) return
    setReleasingRetention(true)
    try {
      const res = await api.post<TrackerData>(
        `/jobs/${jobId}/financials/retention/release`,
      )
      setData(res.data)
      invalidate()
      toast.success("Retention marked as released")
    } catch (err) {
      toastApiError(err, "Failed to release retention")
    } finally {
      setReleasingRetention(false)
    }
  }

  const openMatchesEditor = (inv: Invoice) => {
    setMatchesInvoice(inv)
    const draft: Record<string, string> = {}
    for (const p of inv.payments) {
      draft[p.lineItemId] = (p.amountCents / 100).toFixed(2)
    }
    setMatchDraft(draft)
  }

  const saveMatches = async () => {
    if (!jobId || !matchesInvoice) return
    const matches = Object.entries(matchDraft)
      .map(([sovLineItemId, dollarStr]) => {
        const n = Number(dollarStr)
        if (!Number.isFinite(n) || n <= 0) return null
        return { sovLineItemId, amountCents: Math.round(n * 100) }
      })
      .filter(
        (x): x is { sovLineItemId: string; amountCents: number } => x !== null,
      )
    setSavingMatches(true)
    try {
      const res = await api.patch<TrackerData>(
        `/jobs/${jobId}/financials/invoices/${matchesInvoice.id}/matches`,
        { matches },
      )
      setData(res.data)
      setMatchesInvoice(null)
      invalidate()
      toast.success("Matches saved")
    } catch (err) {
      toastApiError(err, "Failed to save matches")
    } finally {
      setSavingMatches(false)
    }
  }

  const exportCsv = () => {
    if (!data) return
    const invoices = data.invoices
    const header = [
      "Area",
      "Description",
      "Qty",
      "Rate",
      "Scheduled",
      "Billed",
      "Balance",
      "% Complete",
      ...invoices.map((i) => `Inv ${i.invoiceNumber ?? i.id.slice(0, 6)}`),
    ]
    const rows: (string | number | null | undefined)[][] = [header]
    for (const area of data.areas) {
      for (const li of area.lineItems) {
        const paid = new Map(
          li.payments.map((p) => [p.invoiceId, p.amountCents]),
        )
        const out = Math.max(
          0,
          Number(li.scheduledValueCents) - Number(li.billedCents),
        )
        rows.push([
          area.name,
          li.description,
          Number(li.qty),
          (li.rateCents / 100).toFixed(2),
          (li.scheduledValueCents / 100).toFixed(2),
          (li.billedCents / 100).toFixed(2),
          (out / 100).toFixed(2),
          Number(li.percentComplete).toFixed(2),
          ...invoices.map((i) =>
            (((paid.get(i.id) ?? 0) as number) / 100).toFixed(2),
          ),
        ])
      }
    }
    rows.push([])
    rows.push([
      "TOTALS",
      "",
      "",
      "",
      (data.totals.scheduledValueCents / 100).toFixed(2),
      (data.totals.billedCents / 100).toFixed(2),
      (data.totals.outstandingCents / 100).toFixed(2),
      `${data.totals.percentBilled}%`,
    ])
    downloadCsv(`sov-${jobId}.csv`, rows)
  }

  const totals = data?.totals
  const retentionTotals = totals?.retention
  const totalsStrip = useMemo(() => {
    if (!totals) return null
    const balance = Math.max(
      0,
      Number(totals.contractWithChangesCents) - Number(totals.billedCents),
    )
    const applications = data?.invoices.length ?? 0
    const base = [
      {
        label: "Contract Date",
        value: data?.tracker.contractDate ?? "—",
      },
      {
        label: "Main Contract",
        value: formatCurrency(totals.scheduledValueCents),
      },
      {
        label: "Change Orders",
        value: formatCurrency(totals.changeOrderApprovedCents),
      },
      {
        label: "Contract w/ COs",
        value: formatCurrency(totals.contractWithChangesCents),
      },
      { label: "Billed", value: formatCurrency(totals.billedCents) },
      { label: "Balance", value: formatCurrency(balance) },
      { label: "Applications", value: String(applications) },
      { label: "% Billed", value: `${totals.percentBilled}%` },
    ]
    const retention = totals.retention
    if (!retention?.enabled) return base
    return [
      {
        label: "Contract",
        value: formatCurrency(totals.contractWithChangesCents),
      },
      { label: "Billed", value: formatCurrency(totals.billedCents) },
      { label: "Balance", value: formatCurrency(balance) },
      {
        label: "Max Retention",
        value: formatCurrency(retention.maxRetentionCents),
      },
      {
        label: "Retention Held",
        value: formatCurrency(retention.retentionHeldCents),
      },
      {
        label: "Net Received",
        value: formatCurrency(retention.netReceivedCents),
      },
    ]
  }, [totals, data?.invoices.length, data?.tracker.contractDate])

  const retentionLedger = useMemo(() => {
    if (!data?.totals.retention?.enabled) return []
    let gross = 0
    let held = 0
    let net = 0
    return [...data.invoices]
      .sort((a, b) => {
        const aKey = a.invoiceDate ?? a.createdAt
        const bKey = b.invoiceDate ?? b.createdAt
        return aKey.localeCompare(bKey)
      })
      .map((inv) => {
        gross += Number(inv.totalCents)
        held += Number(inv.retentionHeldCents ?? 0)
        net += Number(
          inv.netPaidCents ??
            Math.max(0, inv.totalCents - (inv.retentionHeldCents ?? 0)),
        )
        return { invoice: inv, gross, held, net }
      })
  }, [data?.invoices, data?.totals.retention.enabled])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">No data.</div>
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      {!canManage ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You have read-only access to this financial dashboard.
        </div>
      ) : null}
      {/* Header strip — contract date, main contract, change orders,
          contract w/ COs, billed, balance, applications, % billed */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
        {totalsStrip?.map((t) => (
          <Card key={t.label} className="min-w-0">
            <CardHeader className="px-4 pb-1 pt-4">
              <CardTitle className="text-xs font-medium leading-snug text-muted-foreground">
                {t.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="break-words text-2xl font-semibold leading-tight tabular-nums text-slate-950">
                {t.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Overall % billed bar */}
      {totals ? (
        <Card>
          <CardContent className="space-y-4 py-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Overall progress</span>
              <span className="tabular-nums">
                {formatCurrency(totals.billedCents)} of{" "}
                {formatCurrency(totals.contractWithChangesCents)} ·{" "}
                {totals.percentBilled}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: `${Math.min(100, Number(totals.percentBilled) || 0)}%`,
                }}
              />
            </div>
            {retentionTotals?.enabled ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-amber-800">
                  <span>
                    Retention held (
                    {formatRetentionRate(retentionTotals.rateBps)})
                  </span>
                  <span className="tabular-nums">
                    {formatCurrency(retentionTotals.retentionHeldCents)} of{" "}
                    {formatCurrency(retentionTotals.maxRetentionCents)}
                    {retentionTotals.released ? " · Released" : ""}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-amber-100">
                  <div
                    className={`h-full transition-all ${
                      retentionTotals.released ? "bg-green-500" : "bg-amber-500"
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        retentionTotals.maxRetentionCents > 0
                          ? (retentionTotals.retentionHeldCents /
                              retentionTotals.maxRetentionCents) *
                              100
                          : 0,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Estimate / project metadata */}
      <Card>
        <CardHeader className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" /> Estimate
          </CardTitle>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={estimateUploading}
            >
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            {canManage ? (
              <>
                <input
                  ref={estimateInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.txt,.rtf,.md,.json,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,.bmp,application/pdf,image/*,text/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) onEstimatePicked(f)
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => estimateInputRef.current?.click()}
                  disabled={estimateUploading}
                >
                  {estimateUploading ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-4 w-4" />
                  )}
                  {data.tracker.estimateFileId
                    ? "Re-parse PDF"
                    : "Parse Estimate PDF"}
                </Button>
              </>
            ) : null}
          </div>
        </CardHeader>
        {estimateError ? (
          <div
            role="alert"
            className="mx-6 mb-3 flex items-start justify-between gap-3 rounded-md border border-primary/35 bg-primary/10 px-3 py-2 text-sm text-primary"
          >
            <div className="min-w-0">
              <div className="font-medium">
                Couldn’t parse {estimateError.file.name}
              </div>
              <div className="truncate text-xs text-primary">
                <span className="font-mono">{estimateError.code}</span>
                {": "}
                {estimateError.message}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={estimateUploading}
                onClick={() => {
                  const f = estimateError.file
                  void performEstimateUpload(f)
                }}
              >
                {estimateUploading ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-4 w-4" />
                )}
                Try again
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Dismiss estimate parse error"
                onClick={() => setEstimateError(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
        <CardContent className="space-y-5">
          {canManage ? (
          <div className="rounded-md border border-amber-200 bg-amber-50/60 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-amber-950">
                  Will this project have retention on invoices?
                </div>
                <p className="max-w-2xl text-xs text-amber-900">
                  Turn this on for projects that hold back a percentage of each
                  invoice until completion. It defaults to 10% and is tracked
                  separately from gross billed work.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-amber-900">
                  {retentionDraft.enabled ? "Retention on" : "Retention off"}
                </span>
                <Switch
                  checked={retentionDraft.enabled}
                  onCheckedChange={(checked) =>
                    setRetentionDraft((draft) => ({
                      ...draft,
                      enabled: checked,
                    }))
                  }
                  aria-label="Toggle retention"
                />
              </div>
            </div>
            {retentionDraft.enabled ? (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="flex gap-2">
                  {RETENTION_RATE_OPTIONS.map((rate) => (
                    <Button
                      key={rate}
                      type="button"
                      size="sm"
                      variant={
                        retentionDraft.rateBps === rate ? "default" : "outline"
                      }
                      className={
                        retentionDraft.rateBps === rate
                          ? "bg-amber-600 hover:bg-amber-700"
                          : ""
                      }
                      onClick={() => setRetentionRate(rate)}
                    >
                      {formatRetentionRate(rate)}
                    </Button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-amber-950">
                  Custom
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={retentionDraft.customPct}
                    onChange={(e) => {
                      const raw = e.target.value
                      const pct = Number(raw)
                      setRetentionDraft((draft) => ({
                        ...draft,
                        customPct: raw,
                        rateBps: Number.isFinite(pct)
                          ? Math.max(0, Math.min(10000, Math.round(pct * 100)))
                          : draft.rateBps,
                      }))
                    }}
                    className="h-8 w-24 bg-white text-right"
                  />
                  %
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={savingRetention}
                  onClick={() => void saveRetention()}
                >
                  {savingRetention ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : null}
                  Save retention
                </Button>
              </div>
            ) : (
              <div className="mt-4">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={savingRetention}
                  onClick={() => void saveRetention()}
                >
                  {savingRetention ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : null}
                  Save retention off
                </Button>
              </div>
            )}
          </div>
          ) : null}
          {editingProject ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="text-xs text-muted-foreground">Project</label>
                <Input
                  value={projectDraft.projectName}
                  onChange={(e) =>
                    setProjectDraft((p) => ({
                      ...p,
                      projectName: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  Contract date
                </label>
                <Input
                  type="date"
                  value={projectDraft.contractDate}
                  onChange={(e) =>
                    setProjectDraft((p) => ({
                      ...p,
                      contractDate: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex items-end gap-2">
                <Button size="sm" onClick={() => void saveProject()}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingProject(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">Project</div>
                <div className="text-sm font-medium">
                  {data.tracker.projectName ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Contract date
                </div>
                <div className="text-sm font-medium">
                  {data.tracker.contractDate ?? "—"}
                </div>
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Currency</div>
                  <div className="text-sm font-medium">
                    {data.tracker.currency}
                  </div>
                </div>
                {canManage ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setProjectDraft({
                        projectName: data.tracker.projectName ?? "",
                        contractDate: data.tracker.contractDate ?? "",
                      })
                      setEditingProject(true)
                    }}
                  >
                    <Pencil className="mr-1 h-4 w-4" /> Edit
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SOV section */}
      <Card>
        <CardHeader className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <CardTitle className="flex items-center gap-2 text-lg">
            <DollarSign className="h-5 w-5" /> Schedule of Values
          </CardTitle>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download className="mr-1 h-4 w-4" /> Export CSV
            </Button>
            {canManage ? (
              <Button size="sm" variant="outline" onClick={() => void addArea()}>
                <Plus className="mr-1 h-4 w-4" /> Add Area
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {data.areas.length === 0 ? (
            <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
              No areas yet. Parse an estimate PDF or add an area manually.
            </div>
          ) : (
            data.areas.map((area) => (
              <SovAreaRow
                key={area.id}
                area={area}
                invoices={data.invoices}
                collapsed={!!collapsedAreas[area.id]}
                canManage={canManage}
                onToggle={toggleArea}
                onAddLineItem={addLineItem}
                onRenameArea={renameArea}
                onDeleteArea={deleteArea}
                onUpdateLineItem={updateLineItem}
                onDeleteLineItem={deleteLineItem}
              />
            ))
          )}

          {/* Change-order group rendered inline within the SOV */}
          {data.changeOrders.length > 0 ? (
            <div className="rounded-lg border border-violet-300 bg-violet-50/30">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-200 bg-violet-100/60 px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">Change Orders</div>
                  <Badge className="border-violet-300 bg-violet-100 text-violet-800 hover:bg-violet-100">
                    {
                      data.changeOrders.filter((co) => co.status === "approved")
                        .length
                    }{" "}
                    approved
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatCurrency(totals?.changeOrderApprovedCents ?? 0)}
                  </span>
                </div>
                {canManage ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={coUploading}
                      onClick={() => coInputRef.current?.click()}
                    >
                      {coUploading ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="mr-1 h-4 w-4" />
                      )}
                      Upload CO
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void addChangeOrder()}
                    >
                      <Plus className="mr-1 h-4 w-4" /> Add CO
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.changeOrders.map((co) => (
                      <tr key={co.id} className="border-t border-violet-100">
                        <td className="px-3 py-2">{co.number ?? "—"}</td>
                        <td className="px-3 py-2">{co.description ?? "—"}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="capitalize">
                            {co.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCurrency(co.amountCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Change orders */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Change Orders</CardTitle>
          {canManage ? (
            <div className="flex gap-2">
              <input
                ref={coInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.txt,.rtf,.md,.json,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,.bmp,application/pdf,image/*,text/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onCoPicked(f)
                }}
              />
              <Button
                size="sm"
                onClick={() => coInputRef.current?.click()}
                disabled={coUploading}
              >
                {coUploading ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-4 w-4" />
                )}
                Upload CO
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void addChangeOrder()}
              >
                <Plus className="mr-1 h-4 w-4" /> Add CO
              </Button>
            </div>
          ) : null}
        </CardHeader>
        {coParseError ? (
          <div
            role="alert"
            className="mx-6 mb-3 flex items-start justify-between gap-3 rounded-md border border-primary/35 bg-primary/10 px-3 py-2 text-sm text-primary"
          >
            <div className="min-w-0">
              <div className="font-medium">
                Couldn’t parse {coParseError.file.name}
              </div>
              <div className="truncate text-xs text-primary">
                <span className="font-mono">{coParseError.code}</span>
                {": "}
                {coParseError.message}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={coUploading}
                onClick={() => {
                  const f = coParseError.file
                  void performCoParse(f)
                }}
              >
                {coUploading ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-4 w-4" />
                )}
                Try again
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Dismiss change order parse error"
                onClick={() => setCoParseError(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
        <CardContent>
          {data.changeOrders.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No change orders.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.changeOrders.map((co) => (
                  <tr key={co.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{co.number}</td>
                    <td className="px-3 py-2">{co.description ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(co.amountCents)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          co.status === "approved"
                            ? "default"
                            : co.status === "rejected"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {co.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canManage ? (
                        <div className="flex justify-end gap-1">
                          {co.status !== "approved" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void setChangeOrderStatus(co.id, "approved")
                              }
                            >
                              Approve
                            </Button>
                          ) : null}
                          {co.status !== "rejected" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void setChangeOrderStatus(co.id, "rejected")
                              }
                            >
                              Reject
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Receipt className="h-5 w-5" /> Invoices
          </CardTitle>
          {canManage ? (
            <div>
              <input
                ref={invoiceInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.txt,.rtf,.md,.json,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,.bmp,application/pdf,image/*,text/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onInvoicePicked(f)
                }}
              />
              <Button
                size="sm"
                onClick={() => invoiceInputRef.current?.click()}
                disabled={invoiceUploading}
              >
                {invoiceUploading ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-1 h-4 w-4" />
                )}
                Upload Invoice PDF
              </Button>
            </div>
          ) : null}
        </CardHeader>
        {invoiceError ? (
          <div
            role="alert"
            className="mx-6 mb-3 flex items-start justify-between gap-3 rounded-md border border-primary/35 bg-primary/10 px-3 py-2 text-sm text-primary"
          >
            <div className="min-w-0">
              <div className="font-medium">
                Couldn’t parse {invoiceError.file.name}
              </div>
              <div className="truncate text-xs text-primary">
                <span className="font-mono">{invoiceError.code}</span>
                {": "}
                {invoiceError.message}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={invoiceUploading}
                onClick={() => {
                  const f = invoiceError.file
                  void performInvoiceUpload(f)
                }}
              >
                {invoiceUploading ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-4 w-4" />
                )}
                Try again
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Dismiss invoice parse error"
                onClick={() => setInvoiceError(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
        <CardContent className="space-y-4">
          {retentionTotals?.enabled ? (
            <div
              className={`rounded-md border p-4 ${
                retentionTotals.released
                  ? "border-green-300 bg-green-50"
                  : "border-amber-300 bg-amber-50"
              }`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div
                    className={`text-sm font-semibold ${
                      retentionTotals.released
                        ? "text-green-900"
                        : "text-amber-950"
                    }`}
                  >
                    Retention summary
                  </div>
                  <div
                    className={`mt-1 text-xs ${
                      retentionTotals.released
                        ? "text-green-800"
                        : "text-amber-900"
                    }`}
                  >
                    {formatRetentionRate(retentionTotals.rateBps)} holdback on
                    invoice gross amounts.
                  </div>
                </div>
                {canManage ? (
                  <Button
                    size="sm"
                    variant={retentionTotals.released ? "outline" : "default"}
                    className={
                      retentionTotals.released
                        ? ""
                        : "bg-amber-600 hover:bg-amber-700"
                    }
                    disabled={retentionTotals.released || releasingRetention}
                    onClick={() => void releaseRetention()}
                  >
                    {releasingRetention ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : null}
                    {retentionTotals.released ? "Released" : "Mark as released"}
                  </Button>
                ) : null}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">
                    Max retention
                  </div>
                  <div className="font-semibold tabular-nums">
                    {formatCurrency(retentionTotals.maxRetentionCents)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Held to date
                  </div>
                  <div className="font-semibold tabular-nums">
                    {formatCurrency(retentionTotals.retentionHeldCents)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Still outstanding
                  </div>
                  <div
                    className={`font-semibold tabular-nums ${
                      retentionTotals.released
                        ? "text-green-700 line-through"
                        : ""
                    }`}
                  >
                    {formatCurrency(retentionTotals.retentionOutstandingCents)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Net received
                  </div>
                  <div className="font-semibold tabular-nums">
                    {formatCurrency(retentionTotals.netReceivedCents)}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {data.invoices.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No invoices yet.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Invoice #</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-right">Gross</th>
                      {retentionTotals?.enabled ? (
                        <>
                          <th className="px-3 py-2 text-right">Retention</th>
                          <th className="px-3 py-2 text-right">Net Paid</th>
                        </>
                      ) : null}
                      <th className="px-3 py-2 text-right">Applied</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invoices.map((inv) => {
                      const applied = inv.payments.reduce(
                        (s, p) => s + Number(p.amountCents),
                        0,
                      )
                      return (
                        <tr key={inv.id} className="border-t">
                          <td className="px-3 py-2 font-medium">
                            {inv.invoiceNumber ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            {inv.invoiceDate ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCurrency(inv.totalCents)}
                          </td>
                          {retentionTotals?.enabled ? (
                            <>
                              <td className="px-3 py-2 text-right text-amber-700 tabular-nums">
                                {formatCurrency(inv.retentionHeldCents ?? 0)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatCurrency(
                                  inv.netPaidCents ??
                                    Math.max(
                                      0,
                                      inv.totalCents -
                                        (inv.retentionHeldCents ?? 0),
                                    ),
                                )}
                              </td>
                            </>
                          ) : null}
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCurrency(applied)}
                          </td>
                          <td className="px-3 py-2">
                            {inv.appliedAt ? (
                              <Badge>Applied</Badge>
                            ) : (
                              <Badge variant="secondary">Pending</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              {inv.fileId ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    void openInvoiceFile(inv.fileId!)
                                  }
                                  title="Open uploaded invoice file"
                                >
                                  <FileText className="mr-1 h-4 w-4" /> File
                                </Button>
                              ) : null}
                              {canManage ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => openMatchesEditor(inv)}
                                  >
                                    <Pencil className="mr-1 h-4 w-4" /> Edit matches
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => void deleteInvoice(inv.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {retentionLedger.length >= 2 ? (
                <div className="rounded-md border border-amber-200">
                  <div className="border-b bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
                    Retention running totals
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left">Application</th>
                          <th className="px-3 py-2 text-right">Gross</th>
                          <th className="px-3 py-2 text-right">Retention</th>
                          <th className="px-3 py-2 text-right">Net</th>
                          <th className="px-3 py-2 text-right">
                            Running Gross
                          </th>
                          <th className="px-3 py-2 text-right">
                            Running Retention
                          </th>
                          <th className="px-3 py-2 text-right">Running Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {retentionLedger.map(
                          ({ invoice, gross, held, net }) => (
                            <tr key={invoice.id} className="border-t">
                              <td className="px-3 py-2">
                                {invoice.invoiceNumber ??
                                  invoice.id.slice(0, 6)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatCurrency(invoice.totalCents)}
                              </td>
                              <td className="px-3 py-2 text-right text-amber-700 tabular-nums">
                                {formatCurrency(
                                  invoice.retentionHeldCents ?? 0,
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatCurrency(invoice.netPaidCents ?? 0)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatCurrency(gross)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatCurrency(held)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatCurrency(net)}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm re-upload of estimate */}
      <Dialog
        open={!!pendingEstimateFile}
        onOpenChange={(o) => {
          if (!o) setPendingEstimateFile(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-primary" /> Replace
              existing estimate?
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            Re-parsing will replace the current Schedule of Values with the new
            estimate. Existing invoices stay attached: matching line items (same
            area + description) keep their billed amounts. Unmatched invoices
            remain — you can re-link them via "Edit matches". Approved change
            orders are never touched.
          </div>
          <DialogFooter>
            {/* Default focus on Cancel so an accidental Enter does not
                wipe the SOV — replacing the estimate is destructive. */}
            <Button
              variant="ghost"
              autoFocus
              onClick={() => setPendingEstimateFile(null)}
            >
              Cancel
            </Button>
            <Button onClick={() => void confirmReupload()}>Re-parse</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit invoice matches dialog */}
      <Dialog
        open={!!matchesInvoice}
        onOpenChange={(o) => {
          if (!o) setMatchesInvoice(null)
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Edit matches — Invoice {matchesInvoice?.invoiceNumber ?? ""}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-2">
            <div className="text-xs text-muted-foreground">
              Allocate this invoice across SOV line items. Total invoice:{" "}
              <span className="font-semibold tabular-nums">
                {matchesInvoice
                  ? formatCurrency(matchesInvoice.totalCents)
                  : ""}
              </span>
            </div>
            {data.areas.map((area) => (
              <div key={area.id}>
                <div className="text-xs font-semibold text-slate-500">
                  {area.name}
                </div>
                <div className="space-y-1">
                  {area.lineItems.map((li) => (
                    <div
                      key={li.id}
                      className="flex items-center gap-2 rounded border p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{li.description}</div>
                        <div className="text-xs text-muted-foreground">
                          Sched {formatCurrency(li.scheduledValueCents)} ·
                          Billed {formatCurrency(li.billedCents)}
                        </div>
                      </div>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        placeholder="0.00"
                        value={matchDraft[li.id] ?? ""}
                        onChange={(e) =>
                          setMatchDraft((d) => ({
                            ...d,
                            [li.id]: e.target.value,
                          }))
                        }
                        className="h-8 w-28 text-right"
                      />
                      {matchDraft[li.id] ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Clear match for ${li.description}`}
                          onClick={() =>
                            setMatchDraft((d) => {
                              const n = { ...d }
                              delete n[li.id]
                              return n
                            })
                          }
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMatchesInvoice(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveMatches()} disabled={savingMatches}>
              {savingMatches ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Save matches
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm parsed change order */}
      <Dialog
        open={!!coDraft}
        onOpenChange={(o) => {
          if (!o) setCoDraft(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> Confirm change
              order
            </DialogTitle>
          </DialogHeader>
          {coDraft ? (
            <div className="grid gap-3">
              <div className="text-xs text-muted-foreground">
                We extracted the following from your document. Review and edit
                before saving — the change order is created with status{" "}
                <span className="font-medium">pending</span>.
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs text-muted-foreground">CO #</span>
                  <Input
                    aria-label="CO #"
                    value={coDraft.number}
                    onChange={(e) =>
                      setCoDraft((d) =>
                        d ? { ...d, number: e.target.value } : d,
                      )
                    }
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">
                    Amount (USD)
                  </span>
                  <Input
                    aria-label="Amount (USD)"
                    type="number"
                    step="0.01"
                    min={0}
                    value={coDraft.amountDollars}
                    onChange={(e) =>
                      setCoDraft((d) =>
                        d ? { ...d, amountDollars: e.target.value } : d,
                      )
                    }
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs text-muted-foreground">
                  Description
                </span>
                <Input
                  aria-label="Description"
                  value={coDraft.description}
                  onChange={(e) =>
                    setCoDraft((d) =>
                      d ? { ...d, description: e.target.value } : d,
                    )
                  }
                />
              </label>
              <div>
                <label className="text-xs text-muted-foreground">
                  Assign to area (optional)
                </label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={coDraft.areaId}
                  onChange={(e) =>
                    setCoDraft((d) =>
                      d ? { ...d, areaId: e.target.value } : d,
                    )
                  }
                >
                  <option value="">— None —</option>
                  {data.areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCoDraft(null)}
              disabled={coSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void saveParsedChangeOrder()}
              disabled={coSaving}
            >
              {coSaving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Save change order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={pendingDeleteLineItemId !== null}
        onOpenChange={(next) => {
          if (!next && !deletingFinancial) setPendingDeleteLineItemId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete line item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this line item?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingFinancial}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingFinancial}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault()
                void confirmDeleteLineItem()
              }}
            >
              {deletingFinancial ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingDeleteArea !== null}
        onOpenChange={(next) => {
          if (!next && !deletingFinancial) setPendingDeleteArea(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete area</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteArea
                ? `Delete area "${pendingDeleteArea.name}" and all of its line items? Invoice payments tied to this area will also be reversed.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingFinancial}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingFinancial}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault()
                void confirmDeleteArea()
              }}
            >
              {deletingFinancial ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingDeleteInvoiceId !== null}
        onOpenChange={(next) => {
          if (!next && !deletingFinancial) setPendingDeleteInvoiceId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete invoice</AlertDialogTitle>
            <AlertDialogDescription>
              Delete this invoice and reverse its payments?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingFinancial}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingFinancial}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault()
                void confirmDeleteInvoice()
              }}
            >
              {deletingFinancial ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
