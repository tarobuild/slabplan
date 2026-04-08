import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
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
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

type Job = {
  id: string
  title: string
  status: string
  streetAddress: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  jobType: string | null
  contractPrice: string | null
  contractType: "fixed_price" | "open_book" | null
  internalNotes: string | null
  subVendorNotes: string | null
  squareFeet: string | null
  permitNumber: string | null
  projectManagerId: string | null
  projectManagerName: string | null
  projectedStart: string | null
  projectedCompletion: string | null
  actualStart: string | null
  actualCompletion: string | null
  workDays: string[] | null
  createdAt: string
  createdByName: string | null
}

type UserOption = { id: string; fullName: string }

const JOB_TYPES = ["countertops", "backsplash", "flooring", "custom"]
const WORK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
const WORK_DAYS_LABELS: Record<string, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun"
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export default function JobSummaryPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [userOptions, setUserOptions] = useState<UserOption[]>([])

  useEffect(() => {
    api.get("/users").then(r => setUserOptions(r.data.users ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!jobId) return
    setLoading(true)
    api.get(`/jobs/${jobId}`)
      .then(r => setJob(r.data.job ?? r.data))
      .finally(() => setLoading(false))
  }, [jobId])

  const setField = (key: keyof Job, value: any) =>
    setJob(j => j ? { ...j, [key]: value } : j)

  const toggleWorkDay = (day: string) => {
    if (!job) return
    const current = job.workDays ?? []
    const updated = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day]
    setField("workDays", updated)
  }

  const handleSave = async () => {
    if (!job || !jobId) return
    setSaving(true)
    try {
      const res = await api.put(`/jobs/${jobId}`, {
        title: job.title,
        status: job.status,
        jobType: job.jobType || null,
        streetAddress: job.streetAddress || null,
        city: job.city || null,
        state: job.state || null,
        zipCode: job.zipCode || null,
        contractPrice: job.contractPrice || null,
        projectedStart: job.projectedStart || null,
        projectedCompletion: job.projectedCompletion || null,
        actualStart: job.actualStart || null,
        actualCompletion: job.actualCompletion || null,
        workDays: job.workDays,
        contractType: job.contractType || null,
        internalNotes: job.internalNotes || null,
        subVendorNotes: job.subVendorNotes || null,
        squareFeet: job.squareFeet || null,
        permitNumber: job.permitNumber || null,
        projectManagerId: job.projectManagerId || null,
      })
      setJob(res.data.job ?? res.data)
      toast.success("Job saved")
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 max-w-2xl">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (!job) return <div className="text-sm text-slate-500">Job not found.</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="grid grid-cols-2 gap-4">

        <div className="col-span-2 space-y-1.5">
          <Label>Title *</Label>
          <Input value={job.title} onChange={e => setField("title", e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label>Job Type</Label>
          <Select value={job.jobType ?? "_none"} onValueChange={v => setField("jobType", v === "_none" ? null : v)}>
            <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">— None —</SelectItem>
              {JOB_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={job.status} onValueChange={v => setField("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label>Street Address</Label>
          <Input value={job.streetAddress ?? ""} onChange={e => setField("streetAddress", e.target.value || null)} placeholder="123 Main St" />
        </div>

        <div className="space-y-1.5">
          <Label>City</Label>
          <Input value={job.city ?? ""} onChange={e => setField("city", e.target.value || null)} placeholder="Austin" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>State</Label>
            <Input value={job.state ?? ""} onChange={e => setField("state", e.target.value || null)} placeholder="TX" maxLength={2} className="uppercase" />
          </div>
          <div className="space-y-1.5">
            <Label>Zip Code</Label>
            <Input value={job.zipCode ?? ""} onChange={e => setField("zipCode", e.target.value || null)} placeholder="78701" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Contract Price ($)</Label>
          <Input
            value={job.contractPrice ?? ""}
            onChange={e => setField("contractPrice", e.target.value || null)}
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Contract Type</Label>
          <div className="flex gap-4 pt-1">
            {(["fixed_price", "open_book"] as const).map(ct => (
              <label key={ct} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="contractType"
                  value={ct}
                  checked={job.contractType === ct}
                  onChange={() => setField("contractType", ct)}
                  className="mt-0.5 accent-blue-600"
                />
                <div>
                  <div className="text-sm font-medium text-slate-800">
                    {ct === "fixed_price" ? "Fixed price" : "Open book"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {ct === "fixed_price"
                      ? "You will set the contract price for the client"
                      : 'Price = projected costs + markup. "Cost plus" and "time and materials" contracts.'}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Project Manager</Label>
          <Select
            value={job.projectManagerId ?? "_none"}
            onValueChange={v => setField("projectManagerId", v === "_none" ? null : v)}
          >
            <SelectTrigger><SelectValue placeholder="Assign a project manager" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">— None —</SelectItem>
              {userOptions.map(u => (
                <SelectItem key={u.id} value={u.id}>{u.fullName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Square Feet</Label>
          <Input
            value={job.squareFeet ?? ""}
            onChange={e => setField("squareFeet", e.target.value || null)}
            type="number"
            step="0.01"
            min="0"
            placeholder="e.g. 48.5"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Permit Number</Label>
          <Input
            value={job.permitNumber ?? ""}
            onChange={e => setField("permitNumber", e.target.value || null)}
            placeholder="e.g. BP-2024-00123"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Work Days</Label>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {WORK_DAYS.map(d => {
              const active = (job.workDays ?? []).includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleWorkDay(d)}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                    active
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-600 border-[#E5E7EB] hover:border-blue-300"
                  }`}
                >
                  {WORK_DAYS_LABELS[d]}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Projected Start</Label>
          <Input type="date" value={job.projectedStart ?? ""} onChange={e => setField("projectedStart", e.target.value || null)} />
        </div>
        <div className="space-y-1.5">
          <Label>Projected Completion</Label>
          <Input type="date" value={job.projectedCompletion ?? ""} onChange={e => setField("projectedCompletion", e.target.value || null)} />
        </div>
        <div className="space-y-1.5">
          <Label>Actual Start</Label>
          <Input type="date" value={job.actualStart ?? ""} onChange={e => setField("actualStart", e.target.value || null)} />
        </div>
        <div className="space-y-1.5">
          <Label>Actual Completion</Label>
          <Input type="date" value={job.actualCompletion ?? ""} onChange={e => setField("actualCompletion", e.target.value || null)} />
        </div>

        {job.createdByName && (
          <div className="col-span-2 pt-1 text-xs text-slate-400">
            Created by <span className="font-medium text-slate-600">{job.createdByName}</span> on {fmtDate(job.createdAt)}
          </div>
        )}
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
        <h3 className="text-sm font-semibold text-slate-700">Notes</h3>
        <div className="space-y-1.5">
          <Label>Notes for internal users</Label>
          <Textarea
            value={job.internalNotes ?? ""}
            onChange={e => setField("internalNotes", e.target.value || null)}
            placeholder="Internal notes visible only to your team…"
            maxLength={2500}
            rows={4}
          />
          <p className="text-xs text-slate-400">Maximum 2500 characters</p>
        </div>
        <div className="space-y-1.5">
          <Label>Notes for subs/vendors</Label>
          <Textarea
            value={job.subVendorNotes ?? ""}
            onChange={e => setField("subVendorNotes", e.target.value || null)}
            placeholder="Notes visible to subcontractors and vendors…"
            maxLength={2500}
            rows={4}
          />
          <p className="text-xs text-slate-400">Maximum 2500 characters</p>
        </div>
      </div>

      <div>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}
