import { useEffect, useRef, useState } from "react"
import { Loader2, Plus, Search, Trash2 } from "lucide-react"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"

type Lead = {
  id: string
  title: string
  status: string
  city: string | null
  state: string | null
  projectType: string | null
  confidence: number | null
  estimatedRevenueMin: string | null
  estimatedRevenueMax: string | null
  projectedSalesDate: string | null
  createdAt: string
  createdByName: string | null
  clientContact: {
    displayName: string | null
    email: string | null
    phone: string | null
  } | null
}

type Pagination = { page: number; pageSize: number; totalItems: number; totalPages: number }

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-50 text-blue-700 border-blue-200",
  in_negotiation: "bg-yellow-50 text-yellow-700 border-yellow-200",
  won: "bg-green-50 text-green-700 border-green-200",
  lost: "bg-red-50 text-red-700 border-red-200",
  archived: "bg-slate-50 text-slate-500 border-slate-200",
}

const STATUS_LABELS: Record<string, string> = {
  open: "Open", in_negotiation: "In Negotiation", won: "Won", lost: "Lost", archived: "Archived"
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
function fmtCurrency(v: string | null) {
  if (!v) return null
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v))
}

type CreateForm = {
  title: string
  status: string
  projectType: string
  city: string
  state: string
  estimatedRevenueMin: string
  estimatedRevenueMax: string
  confidence: string
  projectedSalesDate: string
  notes: string
  leadSource: string
}

const emptyForm: CreateForm = {
  title: "", status: "open", projectType: "", city: "", state: "",
  estimatedRevenueMin: "", estimatedRevenueMax: "", confidence: "",
  projectedSalesDate: "", notes: "", leadSource: "",
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CreateForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchLeads = (s = search, st = status, p = pagination.page) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), pageSize: "10" })
    if (s) params.set("search", s)
    if (st !== "all") params.set("status", st)
    api.get(`/leads?${params}`)
      .then(r => {
        setLeads(r.data.leads)
        setPagination(r.data.pagination)
      })
      .catch(() => toast.error("Failed to load leads"))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchLeads() }, [])

  const handleSearch = (v: string) => {
    setSearch(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchLeads(v, status, 1), 300)
  }

  const handleStatus = (v: string) => {
    setStatus(v); fetchLeads(search, v, 1)
  }

  const handlePage = (p: number) => fetchLeads(search, status, p)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post("/leads", {
        title: form.title,
        status: form.status,
        projectType: form.projectType || null,
        city: form.city || null,
        state: form.state || null,
        estimatedRevenueMin: form.estimatedRevenueMin || null,
        estimatedRevenueMax: form.estimatedRevenueMax || null,
        confidence: form.confidence ? Number(form.confidence) : null,
        projectedSalesDate: form.projectedSalesDate || null,
        notes: form.notes || null,
        leadSource: form.leadSource || null,
      })
      toast.success("Lead created")
      setCreateOpen(false)
      setForm(emptyForm)
      fetchLeads()
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create lead")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      await api.delete(`/leads/${deleteId}`)
      toast.success("Lead deleted")
      setDeleteId(null)
      fetchLeads()
    } catch {
      toast.error("Failed to delete lead")
    } finally {
      setDeleting(false)
    }
  }

  const setField = (k: keyof CreateForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Sales Leads</h1>
        <Button size="sm" onClick={() => { setForm(emptyForm); setCreateOpen(true) }}>
          <Plus className="mr-1.5 size-3.5" />New Lead
        </Button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" />
          <Input value={search} onChange={e => handleSearch(e.target.value)} placeholder="Search leads…" className="pl-8 h-9" />
        </div>
        <Select value={status} onValueChange={handleStatus}>
          <SelectTrigger className="w-40 h-9">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_negotiation">In Negotiation</SelectItem>
            <SelectItem value="won">Won</SelectItem>
            <SelectItem value="lost">Lost</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="font-semibold text-slate-600">Title</TableHead>
              <TableHead className="font-semibold text-slate-600">Status</TableHead>
              <TableHead className="font-semibold text-slate-600">Location</TableHead>
              <TableHead className="font-semibold text-slate-600">Type</TableHead>
              <TableHead className="font-semibold text-slate-600">Contact</TableHead>
              <TableHead className="font-semibold text-slate-600 text-right">Revenue Est.</TableHead>
              <TableHead className="font-semibold text-slate-600">Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-sm text-slate-400">
                  No leads found.{" "}
                  <button onClick={() => { setForm(emptyForm); setCreateOpen(true) }} className="text-blue-600 hover:underline">
                    Create your first lead
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              leads.map(lead => (
                <TableRow key={lead.id} className="hover:bg-slate-50">
                  <TableCell className="font-medium text-slate-900">{lead.title}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${STATUS_COLORS[lead.status] ?? ""}`}>
                      {STATUS_LABELS[lead.status] ?? lead.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {[lead.city, lead.state].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500 capitalize">
                    {lead.projectType || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {lead.clientContact?.displayName || "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-700">
                    {(() => {
                      const min = fmtCurrency(lead.estimatedRevenueMin)
                      const max = fmtCurrency(lead.estimatedRevenueMax)
                      if (min && max && min !== max) return `${min} – ${max}`
                      return min || max || "—"
                    })()}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">{fmtDate(lead.createdAt)}</TableCell>
                  <TableCell>
                    <button onClick={() => setDeleteId(lead.id)} className="text-slate-400 hover:text-red-500 transition-colors p-1">
                      <Trash2 className="size-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && pagination.totalItems > pagination.pageSize && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            Showing {(pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.totalItems)} of {pagination.totalItems}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => handlePage(pagination.page - 1)} disabled={pagination.page <= 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => handlePage(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Lead Opportunity</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="lead-title">Title *</Label>
                <Input id="lead-title" value={form.title} onChange={setField("title")} required placeholder="e.g. Smith Residence Countertops" />
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_negotiation">In Negotiation</SelectItem>
                    <SelectItem value="won">Won</SelectItem>
                    <SelectItem value="lost">Lost</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-projectType">Project Type</Label>
                <Input id="lead-projectType" value={form.projectType} onChange={setField("projectType")} placeholder="e.g. countertops" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-city">City</Label>
                <Input id="lead-city" value={form.city} onChange={setField("city")} placeholder="Austin" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-state">State</Label>
                <Input id="lead-state" value={form.state} onChange={setField("state")} placeholder="TX" maxLength={2} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-revMin">Revenue Min ($)</Label>
                <Input id="lead-revMin" type="number" min="0" step="0.01" value={form.estimatedRevenueMin} onChange={setField("estimatedRevenueMin")} placeholder="0" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-revMax">Revenue Max ($)</Label>
                <Input id="lead-revMax" type="number" min="0" step="0.01" value={form.estimatedRevenueMax} onChange={setField("estimatedRevenueMax")} placeholder="0" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-confidence">Confidence (0–100)</Label>
                <Input id="lead-confidence" type="number" min="0" max="100" value={form.confidence} onChange={setField("confidence")} placeholder="50" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-salesDate">Projected Sales Date</Label>
                <Input id="lead-salesDate" type="date" value={form.projectedSalesDate} onChange={setField("projectedSalesDate")} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-source">Lead Source</Label>
                <Input id="lead-source" value={form.leadSource} onChange={setField("leadSource")} placeholder="Referral, Web, etc." />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                Create Lead
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lead?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this lead. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700">
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
