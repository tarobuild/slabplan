import { type Dispatch, type SetStateAction, useEffect, useState } from "react"
import { useOutletContext, useParams } from "react-router-dom"
import { Loader2 } from "lucide-react"
import {
  clientsGetClients,
  customFetch,
  getUsersGetUsersUrl,
  jobsDeleteJobsIdAssigneesUserid,
  jobsGetJobsId,
  jobsGetJobsIdAssignees,
  jobsPostJobsIdAssignees,
  jobsPutJobsId,
  type JobsAssigneePayloadSchema,
  type JobsJobPayloadSchema,
} from "@workspace/api-client-react"
import { JobsPostJobsIdAssigneesBody, JobsPutJobsIdBody } from "@workspace/api-zod"
import { validatePayload } from "@/lib/validate-payload"
import { useDocumentTitle } from "@/hooks/use-document-title"
import WorkerAssignmentPicker, { type WorkerOption } from "@/components/WorkerAssignmentPicker"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes"
import { invalidateAppData } from "@/lib/data-refresh"
import { useAuthStore } from "@/store/auth"
import { toast } from "sonner"
import { toastApiError } from "@/lib/api-errors"

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
  clientId: string | null
  clientName: string | null
  projectedStart: string | null
  projectedCompletion: string | null
  actualStart: string | null
  actualCompletion: string | null
  workDays: string[] | null
  createdAt: string
  createdByName: string | null
  assignees: WorkerOption[]
  hasTracker?: boolean
  trackerTotals?: {
    contractWithChangesCents?: number
    billedCents?: number
    outstandingCents?: number
  } | null
}

type ClientOption = { id: string; companyName: string }

const JOB_TYPES = [
  "Kitchen Countertops",
  "Flooring",
  "Bathrooms",
  "Full House Projects",
  "Custom",
]
const toLabel = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())
const WORK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
const WORK_DAYS_LABELS: Record<string, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun"
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function serializeJob(job: Job | null) {
  if (!job) return ""

  return JSON.stringify({
    id: job.id,
    title: job.title,
    status: job.status,
    streetAddress: job.streetAddress,
    city: job.city,
    state: job.state,
    zipCode: job.zipCode,
    jobType: job.jobType,
    contractPrice: job.contractPrice,
    contractType: job.contractType,
    internalNotes: job.internalNotes,
    subVendorNotes: job.subVendorNotes,
    squareFeet: job.squareFeet,
    permitNumber: job.permitNumber,
    projectManagerId: job.projectManagerId,
    clientId: job.clientId,
    projectedStart: job.projectedStart,
    projectedCompletion: job.projectedCompletion,
    actualStart: job.actualStart,
    actualCompletion: job.actualCompletion,
    workDays: [...(job.workDays ?? [])].sort(),
  })
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

type JobDetailContext = {
  setJob: Dispatch<SetStateAction<{
    id: string
    title: string
    status: "open" | "closed" | "archived"
    city: string | null
    state: string | null
  } | null>>
}

export default function JobSummaryPage() {
  useDocumentTitle("Job summary")
  const { jobId } = useParams<{ jobId: string }>()
  const { setJob: setParentJob } = useOutletContext<JobDetailContext>()
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role === "admin"
  const [job, setJob] = useState<Job | null>(null)
  const [savedJob, setSavedJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [workerOptions, setWorkerOptions] = useState<WorkerOption[]>([])
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([])
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false)
  const [assigneeDraftIds, setAssigneeDraftIds] = useState<string[]>([])
  const [savingAssignees, setSavingAssignees] = useState(false)
  const hasUnsavedChanges = !!job && !!savedJob && serializeJob(job) !== serializeJob(savedJob)
  const unsavedChanges = useUnsavedChangesGuard(hasUnsavedChanges && !saving)
  const projectManagerOptions = workerOptions.filter((option) => option.role === "project_manager")

  useEffect(() => {
    // The OpenAPI spec for `/users` doesn't yet include the `roles`/`limit`
    // filters, so go through `customFetch` with a manual querystring rather
    // than calling `usersGetUsers()` (which would over-fetch).
    type UsersResponse = { users?: WorkerOption[] }
    const usersUrl = `${getUsersGetUsersUrl()}?roles=project_manager,crew_member&limit=200`
    customFetch<UsersResponse>(usersUrl, { method: "GET" })
      .then((data) => setWorkerOptions(data.users ?? []))
      .catch(() => {})
    clientsGetClients({ pageSize: 100 })
      .then((data) => setClientOptions((data.clients ?? []) as ClientOption[]))
      .catch(() => {})
  }, [])

  const loadAssignees = async (targetJobId: string) => {
    const response = (await jobsGetJobsIdAssignees(targetJobId)) as {
      assignees?: WorkerOption[]
    }
    const assignees = response.assignees ?? []
    setJob((current) => current ? { ...current, assignees } : current)
    setSavedJob((current) => current ? { ...current, assignees } : current)
    return assignees
  }

  useEffect(() => {
    if (!jobId) return
    setLoading(true)
    setJob(null)
    setSavedJob(null)
    setAssigneeDraftIds([])
    jobsGetJobsId(jobId)
      .then((r) => {
        const nextJob = r.job as unknown as Job
        setJob(nextJob)
        setSavedJob(nextJob)
        setAssigneeDraftIds((nextJob.assignees ?? []).map((assignee: WorkerOption) => assignee.id))
      })
      .then(() => loadAssignees(jobId).catch(() => {}))
      .catch((err: unknown) => toastApiError(err, "Failed to load job"))
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
      const payload: JobsJobPayloadSchema = {
        title: job.title,
        status: job.status as JobsJobPayloadSchema["status"],
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
        workDays: (job.workDays ?? null) as JobsJobPayloadSchema["workDays"],
        contractType: (job.contractType || null) as JobsJobPayloadSchema["contractType"],
        internalNotes: job.internalNotes || null,
        subVendorNotes: job.subVendorNotes || null,
        squareFeet: job.squareFeet || null,
        permitNumber: job.permitNumber || null,
        projectManagerId: job.projectManagerId || null,
        clientId: job.clientId || null,
      }
      const validated = validatePayload(JobsPutJobsIdBody, payload)
      if (!validated) return
      const res = await jobsPutJobsId(jobId, validated)
      const updatedJob = res.job as unknown as Job
      setJob(updatedJob)
      setSavedJob(updatedJob)
      setParentJob((current) =>
        current
          ? {
              ...current,
              title: updatedJob.title,
              status: updatedJob.status as "open" | "closed" | "archived",
              city: updatedJob.city,
              state: updatedJob.state,
            }
          : current,
      )
      invalidateAppData(["jobs", "navigation"])
      toast.success("Job saved")
    } catch (err: unknown) {
      toastApiError(err, "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAssignees = async () => {
    if (!jobId || !job) return

    const currentIds = new Set(job.assignees.map((assignee) => assignee.id))
    const nextIds = new Set(assigneeDraftIds)
    const toAdd = assigneeDraftIds.filter((id) => !currentIds.has(id))
    const toRemove = job.assignees
      .map((assignee) => assignee.id)
      .filter((id) => !nextIds.has(id))

    setSavingAssignees(true)
    try {
      const addPayloads = toAdd
        .map((userId) =>
          validatePayload(JobsPostJobsIdAssigneesBody, {
            userId,
          } satisfies JobsAssigneePayloadSchema),
        )
        .filter((p): p is JobsAssigneePayloadSchema => p !== null)
      // Bail out if any add payload was rejected (validatePayload already
      // surfaced a toast); we still allow removals to proceed in the
      // happy-path scenario where everything validated.
      if (addPayloads.length !== toAdd.length) return
      await Promise.all([
        ...addPayloads.map((data) => jobsPostJobsIdAssignees(jobId, data)),
        ...toRemove.map((userId) =>
          jobsDeleteJobsIdAssigneesUserid(jobId, userId),
        ),
      ])
      const assignees = await loadAssignees(jobId)
      setAssigneeDraftIds(assignees.map((assignee: WorkerOption) => assignee.id))
      setAssigneePopoverOpen(false)
      toast.success("Assigned workers updated")
    } catch (err: unknown) {
      toastApiError(err, "Failed to update assigned workers")
    } finally {
      setSavingAssignees(false)
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
    <div className="space-y-5">
      {unsavedChanges.dialog}
      {/* Two-panel layout */}
      <div className="flex gap-5 items-start">

        {/* LEFT — Job information */}
        <div className="flex-1 min-w-0 space-y-5">
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Job Information</h3>

            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={job.title} onChange={e => setField("title", e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Job Type</Label>
                <Select value={job.jobType ?? "_none"} onValueChange={v => setField("jobType", v === "_none" ? null : v)}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">
                    <SelectItem value="_none">— None —</SelectItem>
                    {JOB_TYPES.map(t => <SelectItem key={t} value={t}>{toLabel(t)}</SelectItem>)}
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
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-2">
                Contract Price ($)
                {job.hasTracker ? (
                  <span className="text-xs font-normal text-slate-500">
                    🔒 Managed by Financial Tracker
                  </span>
                ) : null}
              </Label>
              <Input
                value={
                  job.hasTracker && job.trackerTotals?.contractWithChangesCents != null
                    ? ((job.trackerTotals.contractWithChangesCents ?? 0) / 100).toFixed(2)
                    : (job.contractPrice ?? "")
                }
                onChange={e => setField("contractPrice", e.target.value || null)}
                type="number" step="0.01" min="0" placeholder="0.00"
                disabled={!!job.hasTracker}
                title={job.hasTracker ? "This job uses a Financial Tracker. Edit values on the Financials tab." : undefined}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Contract Type</Label>
              <div className="flex flex-col gap-2 pt-0.5">
                {(["fixed_price", "open_book"] as const).map(ct => (
                  <label key={ct} className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="contractType"
                      value={ct}
                      checked={job.contractType === ct}
                      onChange={() => setField("contractType", ct)}
                      className="mt-0.5 accent-orange-600"
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
          </div>

          {/* Address */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Address</h3>
            <div className="space-y-1.5">
              <Label>Street Address</Label>
              <Input value={job.streetAddress ?? ""} onChange={e => setField("streetAddress", e.target.value || null)} placeholder="123 Main St" />
            </div>
            <div className="grid grid-cols-2 gap-4">
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
                  <Label>Zip</Label>
                  <Input value={job.zipCode ?? ""} onChange={e => setField("zipCode", e.target.value || null)} placeholder="78701" />
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Notes</h3>
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
        </div>

        {/* RIGHT — Schedule + Additional */}
        <div className="w-72 shrink-0 space-y-5">

          {/* Schedule */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Schedule</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Projected Start</Label>
                <Input type="date" value={job.projectedStart ?? ""} onChange={e => setField("projectedStart", e.target.value || null)} className="text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Actual Start</Label>
                <Input type="date" value={job.actualStart ?? ""} onChange={e => setField("actualStart", e.target.value || null)} className="text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Projected Completion</Label>
                <Input type="date" value={job.projectedCompletion ?? ""} onChange={e => setField("projectedCompletion", e.target.value || null)} className="text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Actual Completion</Label>
                <Input type="date" value={job.actualCompletion ?? ""} onChange={e => setField("actualCompletion", e.target.value || null)} className="text-xs" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Work Days</Label>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {WORK_DAYS.map(d => {
                  const active = (job.workDays ?? []).includes(d)
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleWorkDay(d)}
                      className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                        active
                          ? "bg-orange-600 text-white border-orange-600"
                          : "bg-white text-slate-600 border-[#E5E7EB] hover:border-orange-300"
                      }`}
                    >
                      {WORK_DAYS_LABELS[d]}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Additional Information */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Additional Information</h3>
            <div className="space-y-1.5">
              <Label>Client</Label>
              <Select
                value={job.clientId ?? "_none"}
                onValueChange={v => setField("clientId", v === "_none" ? null : v)}
              >
                <SelectTrigger><SelectValue placeholder="Link to a client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— None —</SelectItem>
                  {clientOptions.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  {projectManagerOptions.map(u => (
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
                type="number" step="0.01" min="0" placeholder="e.g. 48.5"
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
            {job.createdByName && (
              <p className="text-xs text-slate-400 pt-1">
                Created by <span className="font-medium text-slate-600">{job.createdByName}</span> on {fmtDate(job.createdAt)}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Assigned Workers</h3>
              {isAdmin ? (
                <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAssigneeDraftIds(job.assignees.map((assignee) => assignee.id))}
                    >
                      Add / Remove
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[380px] space-y-3">
                    <div>
                      <h4 className="text-sm font-medium text-slate-900">Assigned Workers</h4>
                      <p className="text-xs text-slate-500">Project managers and crew members assigned to this job.</p>
                    </div>
                    <WorkerAssignmentPicker
                      options={workerOptions}
                      selectedIds={assigneeDraftIds}
                      onChange={setAssigneeDraftIds}
                      placeholder="Search workers"
                      className="border-0 px-0 py-0"
                    />
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setAssigneePopoverOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="button" size="sm" onClick={handleSaveAssignees} disabled={savingAssignees}>
                        {savingAssignees && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                        Save
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>

            {job.assignees.length > 0 ? (
              <div className="space-y-3">
                {job.assignees.map((assignee) => (
                  <div key={assignee.id} className="flex items-center gap-3">
                    <Avatar className="size-9">
                      <AvatarImage src={assignee.avatarUrl || undefined} alt={assignee.fullName} />
                      <AvatarFallback className="bg-slate-100 text-[10px] font-semibold text-slate-700">
                        {initials(assignee.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{assignee.fullName}</p>
                      <p className="text-xs capitalize text-slate-500">{assignee.role.replaceAll("_", " ")}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No workers assigned yet.</p>
            )}
          </div>
        </div>
      </div>

      {unsavedChanges.isDirty ? (
        <>
          {/* Spacer so page content isn't obscured by the sticky bar */}
          <div aria-hidden className="h-16" />
          <div className="sticky bottom-0 left-0 right-0 z-30 -mx-4 border-t border-[#E5E7EB] bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] sm:-mx-6 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-amber-700">Unsaved changes</p>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
            Save Changes
          </Button>
        </div>
      )}
    </div>
  )
}
