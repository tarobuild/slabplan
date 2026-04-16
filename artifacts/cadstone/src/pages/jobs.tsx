import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { Loader2, Search } from "lucide-react"
import { api } from "@/lib/api"
import WorkerAssignmentPicker, { type WorkerOption } from "@/components/WorkerAssignmentPicker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { invalidateAppData, subscribeToDataRefresh } from "@/lib/data-refresh"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import { useAuthStore } from "@/store/auth"

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
  open: "bg-green-50 text-green-700 border-green-200",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
  archived: "bg-slate-50 text-slate-400 border-slate-200",
}
const JOB_TYPES = [
  "Kitchen Countertops",
  "Flooring",
  "Bathrooms",
  "Full House Projects",
  "Custom",
]
const ADD_NEW_CLIENT_VALUE = "__add_new_client__"

const toLabel = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

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
  assigneeIds: string[]
}

const emptyForm: CreateJobForm = {
  title: "", status: "open", jobType: "", contractType: "",
  streetAddress: "", city: "", state: "", zipCode: "",
  contractPrice: "", projectedStart: "", projectedCompletion: "",
  clientId: "", assigneeIds: [],
}

export default function JobsPage() {
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role === "admin"
  const [jobs, setJobs] = useState<Job[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [form, setForm] = useState<CreateJobForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([])
  const [workerOptions, setWorkerOptions] = useState<WorkerOption[]>([])
  const [showCreateClient, setShowCreateClient] = useState(false)
  const [newClientCompanyName, setNewClientCompanyName] = useState("")
  const [newClientContactName, setNewClientContactName] = useState("")
  const [newClientEmail, setNewClientEmail] = useState("")
  const [newClientPhone, setNewClientPhone] = useState("")
  const [creatingClient, setCreatingClient] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const location = useLocation()
  const navigate = useNavigate()

  const openCreateDialog = () => {
    setForm(emptyForm)
    setShowCreateClient(false)
    setNewClientCompanyName("")
    setNewClientContactName("")
    setNewClientEmail("")
    setNewClientPhone("")
    setStep(1)
    setCreateOpen(true)
  }

  const handleDialogOpenChange = (open: boolean) => {
    setCreateOpen(open)
    if (!open) {
      setForm(emptyForm)
      setShowCreateClient(false)
      setNewClientCompanyName("")
      setNewClientContactName("")
      setNewClientEmail("")
      setNewClientPhone("")
      setStep(1)
    }
  }

  useEffect(() => {
    api.get("/clients?pageSize=100")
      .then(r => setClientOptions(r.data.clients ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!isAdmin) {
      setWorkerOptions([])
      return
    }

    api.get("/users?roles=project_manager,crew_member&limit=200")
      .then((r) => setWorkerOptions(r.data.users ?? []))
      .catch(() => {})
  }, [isAdmin])

  useEffect(() => {
    const currentState = location.state as Record<string, unknown> | null
    if (currentState && (currentState as { openCreate?: unknown }).openCreate) {
      openCreateDialog()
      const { openCreate: _openCreate, ...rest } = currentState as { openCreate?: unknown } & Record<string, unknown>
      const nextState = Object.keys(rest).length > 0 ? rest : null
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: nextState },
      )
    }
  }, [location.state, location.pathname, location.search, location.hash, navigate])

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

  // Track the currently visible search/status/page in refs so the data-refresh
  // subscription reloads the dataset the user is actually looking at, rather
  // than the values captured when the listener was first registered.
  const searchRef = useRef(search)
  const statusRef = useRef(status)
  const pageRef = useRef(page)
  useEffect(() => { searchRef.current = search }, [search])
  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => { pageRef.current = page }, [page])

  useEffect(
    () =>
      subscribeToDataRefresh("jobs", () => {
        fetchJobs(searchRef.current, statusRef.current, pageRef.current)
      }),
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
        assigneeIds: isAdmin ? form.assigneeIds : [],
      })
      toast.success("Job created")
      setCreateOpen(false)
      setForm(emptyForm)
      setShowCreateClient(false)
      setNewClientCompanyName("")
      setNewClientContactName("")
      setNewClientEmail("")
      setNewClientPhone("")
      setStep(1)
      fetchJobs(search, status, 1)
      setPage(1)
      invalidateAppData(["jobs", "navigation"])
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create job")
    } finally {
      setSaving(false)
    }
  }

  const handleCreateClient = async () => {
    if (!newClientCompanyName.trim()) {
      toast.error("Company name is required")
      return
    }

    setCreatingClient(true)
    try {
      const response = await api.post("/clients", {
        companyName: newClientCompanyName.trim(),
        email: newClientEmail.trim() || null,
        phone: newClientPhone.trim() || null,
      })
      const nextClient = response.data.client

      if (newClientContactName.trim()) {
        const nameParts = newClientContactName.trim().split(/\s+/)
        const firstName = nameParts[0] || null
        const lastName = nameParts.slice(1).join(" ") || null
        try {
          await api.post(`/clients/${nextClient.id}/contacts`, {
            firstName,
            lastName,
            email: newClientEmail.trim() || null,
            phone: newClientPhone.trim() || null,
            isPrimary: true,
          })
        } catch {
          // Contact creation is best-effort; client was already created
        }
      }

      setClientOptions((current) =>
        [...current, nextClient].sort((left, right) => left.companyName.localeCompare(right.companyName)),
      )
      setForm((current) => ({ ...current, clientId: nextClient.id }))
      setShowCreateClient(false)
      setNewClientCompanyName("")
      setNewClientContactName("")
      setNewClientEmail("")
      setNewClientPhone("")
      toast.success("Client created")
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create client")
    } finally {
      setCreatingClient(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const setField = (k: keyof CreateJobForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

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
              <TableHead className="font-semibold text-slate-600">Status</TableHead>
              <TableHead className="font-semibold text-slate-600 text-right">Contract Price</TableHead>
              <TableHead className="font-semibold text-slate-600">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-sm">
                  No jobs found.{" "}
                  <button onClick={openCreateDialog} className="text-orange-600 hover:underline">
                    Create your first job
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              jobs.map(job => (
                <TableRow key={job.id} className="hover:bg-slate-50">
                  <TableCell>
                    <Link to={`/jobs/${job.id}/summary`} className="font-medium text-orange-600 hover:underline">
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
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-8 text-center text-sm text-slate-400">
            No jobs found.{" "}
            <button onClick={openCreateDialog} className="text-orange-600 hover:underline">
              Create your first job
            </button>
          </div>
        ) : (
          jobs.map(job => (
            <div key={job.id} className="rounded-lg border border-[#E5E7EB] bg-white p-4">
              <div className="min-w-0 flex-1">
                <Link to={`/jobs/${job.id}/summary`} className="block truncate text-sm font-medium text-orange-600 hover:underline">
                  {job.title}
                </Link>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[job.status]}`}>
                    {STATUS_LABELS[job.status]}
                  </Badge>
                  {job.jobType && <span className="text-xs capitalize text-slate-500">{job.jobType}</span>}
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

      <Dialog open={createOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Job</DialogTitle>
            <p className="text-xs text-slate-400">
              {step === 1 ? "Step 1 of 2 — Job Basics" : "Step 2 of 2 — Location & Contract"}
            </p>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              if (step === 1) {
                e.preventDefault()
                if (form.title.trim()) setStep(2)
                return
              }
              handleCreate(e)
            }}
          >
            {step === 1 ? (
              <div className="grid grid-cols-2 gap-4 py-4">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="title">Title *</Label>
                  <Input id="title" value={form.title} onChange={setField("title")} required placeholder="e.g. Johnson Kitchen Countertops" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Client</Label>
                  <Select
                    value={form.clientId || "_none"}
                    onValueChange={(value) => {
                      if (value === ADD_NEW_CLIENT_VALUE) {
                        setShowCreateClient(true)
                        return
                      }

                      setShowCreateClient(false)
                      setForm((current) => ({ ...current, clientId: value === "_none" ? "" : value }))
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Link to a client (optional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">— None —</SelectItem>
                      {clientOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                      {isAdmin ? (
                        <SelectItem value={ADD_NEW_CLIENT_VALUE}>Add new client…</SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                  {isAdmin && showCreateClient ? (
                    <div className="rounded-md border border-[#E5E7EB] bg-slate-50 p-3 space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="new-client-company">Company Name *</Label>
                        <Input
                          id="new-client-company"
                          value={newClientCompanyName}
                          onChange={(event) => setNewClientCompanyName(event.target.value)}
                          placeholder="e.g. Acme Builders"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="new-client-contact">Contact Name</Label>
                        <Input
                          id="new-client-contact"
                          value={newClientContactName}
                          onChange={(event) => setNewClientContactName(event.target.value)}
                          placeholder="e.g. John Smith"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="new-client-email">Email</Label>
                          <Input
                            id="new-client-email"
                            type="email"
                            value={newClientEmail}
                            onChange={(event) => setNewClientEmail(event.target.value)}
                            placeholder="john@example.com"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="new-client-phone">Phone Number</Label>
                          <Input
                            id="new-client-phone"
                            type="tel"
                            value={newClientPhone}
                            onChange={(event) => setNewClientPhone(event.target.value)}
                            placeholder="(555) 123-4567"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button type="button" onClick={handleCreateClient} disabled={creatingClient}>
                          {creatingClient && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                          Add Client
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Job Type</Label>
                  <Select value={form.jobType} onValueChange={v => setForm(f => ({ ...f, jobType: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent className="max-h-60 overflow-y-auto">
                      {JOB_TYPES.map(t => <SelectItem key={t} value={t}>{toLabel(t)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {isAdmin ? (
                  <div className="col-span-2 space-y-1.5">
                    <Label>Assign Workers</Label>
                    <WorkerAssignmentPicker
                      options={workerOptions}
                      selectedIds={form.assigneeIds}
                      onChange={(assigneeIds) => setForm((current) => ({ ...current, assigneeIds }))}
                      placeholder="Search project managers or crew members"
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 py-4">
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
                          className="mt-0.5 accent-orange-600"
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
            )}
            <DialogFooter>
              {step === 1 ? (
                <>
                  <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!form.title.trim()}
                    style={{ backgroundColor: "#E85D04", color: "#fff" }}
                    className="hover:opacity-90 transition-opacity"
                  >
                    Next: Location & Contract →
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => setStep(1)}>
                    ← Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving}
                    style={{ backgroundColor: "#E85D04", color: "#fff" }}
                    className="hover:opacity-90 transition-opacity"
                  >
                    {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                    Create Job
                  </Button>
                </>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
