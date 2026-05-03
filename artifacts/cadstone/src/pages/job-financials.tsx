import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
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
import { toastApiError } from "@/lib/api-errors"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

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
    estimateFileId: string | null
  }
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
  }
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100)
}

function statusForPct(pct: number): { label: string; cls: string } {
  if (pct >= 100) return { label: "Complete", cls: "bg-green-100 text-green-800 border-green-200" }
  if (pct > 0) return { label: "In progress", cls: "bg-blue-100 text-blue-800 border-blue-200" }
  return { label: "Not started", cls: "bg-slate-100 text-slate-700 border-slate-200" }
}

function csvEscape(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
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

export default function JobFinancialsPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const user = useAuthStore((s) => s.user)
  const canManage = user?.role === "admin" || user?.role === "project_manager"
  const [data, setData] = useState<TrackerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [estimateUploading, setEstimateUploading] = useState(false)
  const [invoiceUploading, setInvoiceUploading] = useState(false)
  const [pendingEstimateFile, setPendingEstimateFile] = useState<File | null>(null)
  const [editingProject, setEditingProject] = useState(false)
  const [projectDraft, setProjectDraft] = useState({ projectName: "", contractDate: "" })
  const [matchesInvoice, setMatchesInvoice] = useState<Invoice | null>(null)
  const [matchDraft, setMatchDraft] = useState<Record<string, string>>({})
  const [savingMatches, setSavingMatches] = useState(false)
  const [collapsedAreas, setCollapsedAreas] = useState<Record<string, boolean>>({})
  const toggleArea = (areaId: string) =>
    setCollapsedAreas((m) => ({ ...m, [areaId]: !m[areaId] }))
  const estimateInputRef = useRef<HTMLInputElement>(null)
  const invoiceInputRef = useRef<HTMLInputElement>(null)

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

  const performEstimateUpload = async (file: File) => {
    if (!jobId) return
    setEstimateUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await api.post<TrackerData>(`/jobs/${jobId}/financials/estimate`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      setData(res.data)
      toast.success("Estimate parsed")
    } catch (err) {
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

  const onInvoicePicked = async (file: File) => {
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
      toast.success("Invoice matched and applied")
    } catch (err) {
      toastApiError(err, "Failed to ingest invoice")
    } finally {
      setInvoiceUploading(false)
      if (invoiceInputRef.current) invoiceInputRef.current.value = ""
    }
  }

  const updateLineItem = async (
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
      await api.patch(`/jobs/${jobId}/financials/line-items/${lineItemId}`, patch)
      await load()
    } catch (err) {
      toastApiError(err, "Failed to update line item")
    }
  }

  const deleteLineItem = async (lineItemId: string) => {
    if (!jobId) return
    if (!window.confirm("Delete this line item?")) return
    try {
      await api.delete(`/jobs/${jobId}/financials/line-items/${lineItemId}`)
      await load()
    } catch (err) {
      toastApiError(err, "Failed to delete line item")
    }
  }

  const addArea = async () => {
    if (!jobId) return
    const name = window.prompt("Area name")?.trim()
    if (!name) return
    try {
      await api.post(`/jobs/${jobId}/financials/areas`, { name })
      await load()
    } catch (err) {
      toastApiError(err, "Failed to add area")
    }
  }

  const renameArea = async (areaId: string, currentName: string) => {
    if (!jobId) return
    const next = window.prompt("Rename area", currentName)?.trim()
    if (!next || next === currentName) return
    try {
      await api.patch(`/jobs/${jobId}/financials/areas/${areaId}`, { name: next })
      await load()
    } catch (err) {
      toastApiError(err, "Failed to rename area")
    }
  }

  const deleteArea = async (areaId: string, name: string) => {
    if (!jobId) return
    if (
      !window.confirm(
        `Delete area "${name}" and all of its line items? Invoice payments tied to this area will also be reversed.`,
      )
    ) {
      return
    }
    try {
      await api.delete(`/jobs/${jobId}/financials/areas/${areaId}`)
      await load()
    } catch (err) {
      toastApiError(err, "Failed to delete area")
    }
  }

  const openInvoiceFile = async (fileId: string) => {
    try {
      const res = await api.post<{ url: string }>(`/files/${fileId}/signed-view`)
      window.open(res.data.url, "_blank", "noopener,noreferrer")
    } catch (err) {
      toastApiError(err, "Failed to open invoice file")
    }
  }

  const addLineItem = async (areaId: string) => {
    if (!jobId) return
    const description = window.prompt("Line item description")?.trim()
    if (!description) return
    try {
      await api.post(`/jobs/${jobId}/financials/line-items`, {
        areaId,
        description,
      })
      await load()
    } catch (err) {
      toastApiError(err, "Failed to add line item")
    }
  }

  const addChangeOrder = async () => {
    if (!jobId) return
    const number = window.prompt("Change order number")?.trim()
    if (!number) return
    const description = window.prompt("Description (optional)")?.trim() || null
    const amountStr = window.prompt("Amount (USD)")?.trim()
    const amountCents = Math.round((Number(amountStr ?? "0") || 0) * 100)
    // Optional area assignment: list area names so the user can pick one.
    const areas = data?.areas ?? []
    let areaId: string | null = null
    if (areas.length > 0) {
      const list = areas.map((a, i) => `${i + 1}. ${a.name}`).join("\n")
      const pick = window
        .prompt(`Assign to area? Enter number, or leave blank for none.\n${list}`)
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
      await api.patch(`/jobs/${jobId}/financials/change-orders/${coId}`, { status })
      await load()
    } catch (err) {
      toastApiError(err, "Failed to update change order")
    }
  }

  const deleteInvoice = async (invoiceId: string) => {
    if (!jobId) return
    if (!window.confirm("Delete this invoice and reverse its payments?")) return
    try {
      await api.delete(`/jobs/${jobId}/financials/invoices/${invoiceId}`)
      await load()
    } catch (err) {
      toastApiError(err, "Failed to delete invoice")
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
    } catch (err) {
      toastApiError(err, "Failed to update tracker")
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
      .filter((x): x is { sovLineItemId: string; amountCents: number } => x !== null)
    setSavingMatches(true)
    try {
      const res = await api.patch<TrackerData>(
        `/jobs/${jobId}/financials/invoices/${matchesInvoice.id}/matches`,
        { matches },
      )
      setData(res.data)
      setMatchesInvoice(null)
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
        const paid = new Map(li.payments.map((p) => [p.invoiceId, p.amountCents]))
        const out = Math.max(0, Number(li.scheduledValueCents) - Number(li.billedCents))
        rows.push([
          area.name,
          li.description,
          Number(li.qty),
          (li.rateCents / 100).toFixed(2),
          (li.scheduledValueCents / 100).toFixed(2),
          (li.billedCents / 100).toFixed(2),
          (out / 100).toFixed(2),
          Number(li.percentComplete).toFixed(2),
          ...invoices.map((i) => (((paid.get(i.id) ?? 0) as number) / 100).toFixed(2)),
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
  const totalsStrip = useMemo(() => {
    if (!totals) return null
    const balance = Math.max(
      0,
      Number(totals.contractWithChangesCents) - Number(totals.billedCents),
    )
    const applications = data?.invoices.length ?? 0
    return [
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
      { label: "Contract w/ COs", value: formatCurrency(totals.contractWithChangesCents) },
      { label: "Billed", value: formatCurrency(totals.billedCents) },
      { label: "Balance", value: formatCurrency(balance) },
      { label: "Applications", value: String(applications) },
      { label: "% Billed", value: `${totals.percentBilled}%` },
    ]
  }, [totals, data?.invoices.length, data?.tracker.contractDate])


  if (!canManage) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        You do not have permission to view financials.
      </div>
    )
  }

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
      {/* Header strip — contract date, main contract, change orders,
          contract w/ COs, billed, balance, applications, % billed */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {totalsStrip?.map((t) => (
          <Card key={t.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {t.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-semibold tabular-nums xl:text-xl">
                {t.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Overall % billed bar */}
      {totals ? (
        <Card>
          <CardContent className="space-y-2 py-4">
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
                className="h-full bg-orange-500 transition-all"
                style={{
                  width: `${Math.min(100, Number(totals.percentBilled) || 0)}%`,
                }}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Estimate / project metadata */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" /> Estimate
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={estimateUploading}
            >
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
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
              {data.tracker.estimateFileId ? "Re-parse PDF" : "Parse Estimate PDF"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {editingProject ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="text-xs text-muted-foreground">Project</label>
                <Input
                  value={projectDraft.projectName}
                  onChange={(e) =>
                    setProjectDraft((p) => ({ ...p, projectName: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Contract date</label>
                <Input
                  type="date"
                  value={projectDraft.contractDate}
                  onChange={(e) =>
                    setProjectDraft((p) => ({ ...p, contractDate: e.target.value }))
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
                <div className="text-xs text-muted-foreground">Contract date</div>
                <div className="text-sm font-medium">
                  {data.tracker.contractDate ?? "—"}
                </div>
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Currency</div>
                  <div className="text-sm font-medium">{data.tracker.currency}</div>
                </div>
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
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SOV section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <DollarSign className="h-5 w-5" /> Schedule of Values
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download className="mr-1 h-4 w-4" /> Export CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => void addArea()}>
              <Plus className="mr-1 h-4 w-4" /> Add Area
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {data.areas.length === 0 ? (
            <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
              No areas yet. Parse an estimate PDF or add an area manually.
            </div>
          ) : (
            data.areas.map((area) => {
              const sched = area.lineItems.reduce(
                (s, li) => s + Number(li.scheduledValueCents),
                0,
              )
              const billed = area.lineItems.reduce(
                (s, li) => s + Number(li.billedCents),
                0,
              )
              const pct = sched > 0 ? Math.round((billed / sched) * 100) : 0
              const status = statusForPct(pct)
              const isCO = area.isChangeOrderGroup
              return (
                <div
                  key={area.id}
                  className={`rounded-lg border ${isCO ? "border-violet-300 bg-violet-50/30" : ""}`}
                >
                  <div
                    className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2 ${isCO ? "bg-violet-100/60" : "bg-muted/40"}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleArea(area.id)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={
                            collapsedAreas[area.id] ? "Expand area" : "Collapse area"
                          }
                        >
                          {collapsedAreas[area.id] ? (
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
                          className="h-full bg-orange-500 transition-all"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void addLineItem(area.id)}
                      >
                        <Plus className="mr-1 h-4 w-4" /> Line item
                      </Button>
                      {isCO ? null : (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Rename area"
                            onClick={() => void renameArea(area.id, area.name)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Delete area"
                            onClick={() => void deleteArea(area.id, area.name)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {collapsedAreas[area.id] ? null : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left">Status</th>
                          <th className="px-3 py-2 text-left">Description</th>
                          <th className="px-3 py-2 text-right">Qty</th>
                          <th className="px-3 py-2 text-right">Rate</th>
                          <th className="px-3 py-2 text-right">Scheduled</th>
                          <th className="px-3 py-2 text-right">Billed</th>
                          <th className="px-3 py-2 text-right">Balance</th>
                          <th className="px-3 py-2 text-right">% Done</th>
                          {data.invoices.map((inv) => (
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
                        {area.lineItems.map((li) => {
                          const paymentByInv = new Map(
                            li.payments.map((p) => [p.invoiceId, p.amountCents]),
                          )
                          const liPct = Math.round(Number(li.percentComplete) || 0)
                          const liStatus = statusForPct(liPct)
                          return (
                            <tr key={li.id} className="border-t">
                              <td className="px-3 py-2">
                                <Badge variant="outline" className={liStatus.cls}>
                                  {liStatus.label}
                                </Badge>
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  defaultValue={li.description}
                                  onBlur={(e) => {
                                    if (e.target.value !== li.description) {
                                      void updateLineItem(li.id, {
                                        description: e.target.value,
                                      })
                                    }
                                  }}
                                  className="h-8"
                                />
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Input
                                  type="number"
                                  defaultValue={String(Number(li.qty))}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value)
                                    if (!Number.isNaN(v) && v !== Number(li.qty)) {
                                      void updateLineItem(li.id, { qty: v })
                                    }
                                  }}
                                  className="h-8 w-20 text-right"
                                />
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                <Input
                                  type="number"
                                  step="0.01"
                                  defaultValue={(li.rateCents / 100).toFixed(2)}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value)
                                    const cents = Math.round(v * 100)
                                    if (
                                      !Number.isNaN(v) &&
                                      cents !== Number(li.rateCents)
                                    ) {
                                      void updateLineItem(li.id, { rateCents: cents })
                                    }
                                  }}
                                  className="h-8 w-24 text-right"
                                />
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                <Input
                                  type="number"
                                  step="0.01"
                                  defaultValue={(li.scheduledValueCents / 100).toFixed(2)}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value)
                                    const cents = Math.round(v * 100)
                                    if (
                                      Number.isNaN(v) ||
                                      cents === Number(li.scheduledValueCents)
                                    ) {
                                      return
                                    }
                                    // Lowering scheduled below the current
                                    // billed will cap billed down to the new
                                    // scheduled → confirm.
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
                                    void updateLineItem(li.id, {
                                      scheduledValueCents: cents,
                                    })
                                  }}
                                  className="h-8 w-28 text-right"
                                />
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatCurrency(li.billedCents)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatCurrency(
                                  Math.max(
                                    0,
                                    Number(li.scheduledValueCents) -
                                      Number(li.billedCents),
                                  ),
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="1"
                                  defaultValue={Number(li.percentComplete).toFixed(0)}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value)
                                    if (
                                      !Number.isNaN(v) &&
                                      v.toFixed(2) !== Number(li.percentComplete).toFixed(2)
                                    ) {
                                      void updateLineItem(li.id, { percentComplete: v })
                                    }
                                  }}
                                  className="h-8 w-16 text-right"
                                />
                              </td>
                              {data.invoices.map((inv) => {
                                const amt = paymentByInv.get(inv.id) ?? 0
                                return (
                                  <td
                                    key={inv.id}
                                    className="px-3 py-2 text-right tabular-nums"
                                  >
                                    {amt > 0 ? (
                                      formatCurrency(amt)
                                    ) : (
                                      <span className="text-slate-300">—</span>
                                    )}
                                  </td>
                                )
                              })}
                              <td className="px-3 py-2 text-right">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => void deleteLineItem(li.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          )
                        })}
                        {area.lineItems.length === 0 ? (
                          <tr>
                            <td
                              colSpan={9 + data.invoices.length}
                              className="px-3 py-4 text-center text-xs text-muted-foreground"
                            >
                              No line items
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                  )}
                </div>
              )
            })
          )}

          {/* Change-order group rendered inline within the SOV */}
          {data.changeOrders.length > 0 ? (
            <div className="rounded-lg border border-violet-300 bg-violet-50/30">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-200 bg-violet-100/60 px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">Change Orders</div>
                  <Badge className="border-violet-300 bg-violet-100 text-violet-800 hover:bg-violet-100">
                    {data.changeOrders.filter((co) => co.status === "approved").length} approved
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatCurrency(totals?.changeOrderApprovedCents ?? 0)}
                  </span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => void addChangeOrder()}>
                  <Plus className="mr-1 h-4 w-4" /> Add CO
                </Button>
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
          <Button size="sm" variant="outline" onClick={() => void addChangeOrder()}>
            <Plus className="mr-1 h-4 w-4" /> Add CO
          </Button>
        </CardHeader>
        <CardContent>
          {data.changeOrders.length === 0 ? (
            <div className="text-sm text-muted-foreground">No change orders.</div>
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
                      <div className="flex justify-end gap-1">
                        {co.status !== "approved" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void setChangeOrderStatus(co.id, "approved")}
                          >
                            Approve
                          </Button>
                        ) : null}
                        {co.status !== "rejected" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void setChangeOrderStatus(co.id, "rejected")}
                          >
                            Reject
                          </Button>
                        ) : null}
                      </div>
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
        </CardHeader>
        <CardContent>
          {data.invoices.length === 0 ? (
            <div className="text-sm text-muted-foreground">No invoices yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Invoice #</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-right">Total</th>
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
                      <td className="px-3 py-2">{inv.invoiceDate ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(inv.totalCents)}
                      </td>
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
                              onClick={() => void openInvoiceFile(inv.fileId!)}
                              title="Open uploaded invoice file"
                            >
                              <FileText className="mr-1 h-4 w-4" /> File
                            </Button>
                          ) : null}
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
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
              <AlertTriangle className="h-5 w-5 text-orange-500" /> Replace existing estimate?
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            Re-parsing will replace the current Schedule of Values with the new
            estimate. Existing invoices stay attached: matching line items
            (same area + description) keep their billed amounts. Unmatched
            invoices remain — you can re-link them via "Edit matches".
            Approved change orders are never touched.
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingEstimateFile(null)}>
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
                {matchesInvoice ? formatCurrency(matchesInvoice.totalCents) : ""}
              </span>
            </div>
            {data.areas.map((area) => (
              <div key={area.id}>
                <div className="text-xs font-semibold text-slate-500">{area.name}</div>
                <div className="space-y-1">
                  {area.lineItems.map((li) => (
                    <div
                      key={li.id}
                      className="flex items-center gap-2 rounded border p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{li.description}</div>
                        <div className="text-xs text-muted-foreground">
                          Sched {formatCurrency(li.scheduledValueCents)} · Billed{" "}
                          {formatCurrency(li.billedCents)}
                        </div>
                      </div>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        placeholder="0.00"
                        value={matchDraft[li.id] ?? ""}
                        onChange={(e) =>
                          setMatchDraft((d) => ({ ...d, [li.id]: e.target.value }))
                        }
                        className="h-8 w-28 text-right"
                      />
                      {matchDraft[li.id] ? (
                        <Button
                          size="icon"
                          variant="ghost"
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
    </div>
  )
}
