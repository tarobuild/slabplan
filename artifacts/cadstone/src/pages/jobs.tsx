import { useEffect, useRef, useState } from "react"
import { Link, useLocation } from "react-router-dom"
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

type Job = {
  id: string
  title: string
  status: "open" | "closed" | "archived"
  city: string | null
  state: string | null
  jobType: string | null
  contractPrice: string | null
  clientId: string | null
  clientName: string | null
  createdAt: string
  createdByName: string | null
}

const STATUS_LABELS: Record<string, string> = { open: "Open", closed: "Closed", archived: "Archived" }
const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-50 text-blue-700 border-blue-200",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
  archived: "bg-slate-50 text-slate-400 border-slate-200",
}
const JOB_TYPES = ["countertops", "backsplash", "flooring", "custom"]

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
function fmtCurrency(v: string | null) {
  if (!v) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v))
}

type ClientOption = { id: string; companyName: string }

type CreateJobForm = {
  title: string
  status: string
  jobType: string
  contractType: string
  streetAddress: string
  city: string
  state: string
  zipCode: string
  contractPrice: string
  projectedStart: string
  projectedCompletion: string
  clientId: string
}

const emptyForm: CreateJobForm = {
  title: "", status: "open", jobType: "", contractType: "",
  streetAddress: "", city: "", state: "", zipCode: "",
  contractPrice: "", projectedStart: "", projectedCompletion: "",
  clientId: "",
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CreateJobForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const location = useLocation()

  useEffect(() => {
    api.get("/clients?pageSize=200")
      .then(r => setClientOptions(r.data.clients ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if ((location.state as any)?.openCreate) {
      setForm(emptyForm)
      setCreateOpen(true)
      window.history.replaceState({}, "")
    }
  }, [location.state])

  const fetchJobs = (s = search, st = status, p = page) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) })
    if (s) params.set("search", s)
    if (st !== "all") params.set("status", st)
    api.get(`/jobs?${params}`)
      .then(r => { setJobs(r.data.jobs); setTotal(r.data.pagination?.totalItems ?? 0) })
      .catch(() => toast.error("Failed to load jobs"))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchJobs() }, [])

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(1)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchJobs(v, status, 1), 300)
  }

  const handleStatus = (v: string) => {
    setStatus(v); setPage(1); fetchJobs(search, v, 1)
  }

  const handlePage = (p: number) => {
    setPage(p); fetchJobs(search, status, p)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post("/jobs", {
        title: form.title,
        status: form.status,
        jobType: form.jobType || null,
        contractType: form.contractType || null,
        streetAddress: form.streetAddress || null,
        city: form.city || null,
        state: form.state || null,
        zipCode: form.zipCode || null,
        contractPrice: form.contractPrice || null,
        projectedStart: form.projectedStart || null,
        projectedCompletion: form.projectedCompletion || null,
        clientId: form.clientId || null,
      })
      toast.success("Job created")
      setCreateOpen(false)
      setForm(emptyForm)
      fetchJobs(search, status, 1)
      setPage(1)
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create job")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      await api.delete(`/jobs/${deleteId}`)
      toast.success("Job deleted")
      setDeleteId(null)
      fetchJobs()
    } catch {
      toast.error("Failed to delete job")
    } finally {
      setDeleting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const setField = (k: keyof CreateJobForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Jobs</h1>
        <Button size="sm" onClick={() => { setForm(emptyForm); setCreateOpen(true) }}>
          <Plus className="mr-1.5 size-3.5" />Create Job
        </Button>
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

      <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="font-semibold text-slate-600">Title</TableHead>
              <TableHead className="font-semibold text-slate-600">Client</TableHead>
              <TableHead className="font-semibold text-slate-600">Location</TableHead>
              <TableHead className="font-semibold text-slate-600">Type</TableHead>
              <TableHead className="font-semibold text-slate-600">Status</TableHead>
              <TableHead className="font-semibold text-slate-600 text-right">Contract Price</TableHead>
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
            ) : jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-slate-400 text-sm">
                  No jobs found.{" "}
                  <button onClick={() => { setForm(emptyForm); setCreateOpen(true) }} className="text-blue-600 hover:underline">
                    Create your first job
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              jobs.map(job => (
                <TableRow key={job.id} className="hover:bg-slate-50">
                  <TableCell>
                    <Link to={`/jobs/${job.id}/summary`} className="font-medium text-blue-600 hover:underline">
                      {job.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600 text-sm">
                    {job.clientName || "—"}
                  </TableCell>
                  <TableCell className="text-slate-600 text-sm">
                    {[job.city, job.state].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-slate-600 text-sm capitalize">
                    {job.jobType || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[job.status]}`}>
                      {STATUS_LABELS[job.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-700">
                    {fmtCurrency(job.contractPrice)}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {fmtDate(job.createdAt)}
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => setDeleteId(job.id)}
                      className="text-slate-400 hover:text-red-500 transition-colors p-1"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Job</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="title">Title *</Label>
                <Input id="title" value={form.title} onChange={setField("title")} required placeholder="e.g. Johnson Kitchen Countertops" />
              </div>
              {clientOptions.length > 0 && (
                <div className="col-span-2 space-y-1.5">
                  <Label>Client</Label>
                  <Select value={form.clientId} onValueChange={v => setForm(f => ({ ...f, clientId: v === "_none" ? "" : v }))}>
                    <SelectTrigger><SelectValue placeholder="Link to a client (optional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">— None —</SelectItem>
                      {clientOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Job Type</Label>
                <Select value={form.jobType} onValueChange={v => setForm(f => ({ ...f, jobType: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {JOB_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="streetAddress">Street Address</Label>
                <Input id="streetAddress" value={form.streetAddress} onChange={setField("streetAddress")} placeholder="123 Main St" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input id="city" value={form.city} onChange={setField("city")} placeholder="Austin" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="state">State</Label>
                  <Input id="state" value={form.state} onChange={setField("state")} placeholder="TX" maxLength={2} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="zipCode">Zip</Label>
                  <Input id="zipCode" value={form.zipCode} onChange={setField("zipCode")} placeholder="78701" />
                </div>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Contract Type</Label>
                <div className="flex gap-6 pt-0.5">
                  {(["fixed_price", "open_book"] as const).map(ct => (
                    <label key={ct} className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="createContractType"
                        value={ct}
                        checked={form.contractType === ct}
                        onChange={() => setForm(f => ({ ...f, contractType: ct }))}
                        className="mt-0.5 accent-blue-600"
                      />
                      <div>
                        <div className="text-sm font-medium text-slate-800">
                          {ct === "fixed_price" ? "Fixed price" : "Open book"}
                        </div>
                        <div className="text-xs text-slate-500">
                          {ct === "fixed_price" ? "Set contract price for the client" : "Projected costs + markup"}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contractPrice">Contract Price ($)</Label>
                <Input id="contractPrice" value={form.contractPrice} onChange={setField("contractPrice")} placeholder="0.00" type="number" min="0" step="0.01" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="projectedStart">Start Date</Label>
                  <Input id="projectedStart" type="date" value={form.projectedStart} onChange={setField("projectedStart")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="projectedCompletion">Est. Completion</Label>
                  <Input id="projectedCompletion" type="date" value={form.projectedCompletion} onChange={setField("projectedCompletion")} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                Create Job
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Job?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the job and all related files and folders. This action cannot be undone.</AlertDialogDescription>
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
