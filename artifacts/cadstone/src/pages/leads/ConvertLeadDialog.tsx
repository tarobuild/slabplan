import { useEffect, useMemo, useState } from "react"
import { Loader2, Search } from "lucide-react"
import {
  useClientsGetClients,
  getClientsGetClientsQueryKey,
  useUsersGetUsers,
  getUsersGetUsersQueryKey,
  useLeadsPostLeadsIdConvertToJob,
  type LeadConvertToJobBody,
  type ClientsClientPayloadSchema,
} from "@workspace/api-client-react"
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
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { toastApiError } from "@/lib/api-errors"

const JOB_TYPE_OPTIONS = [
  { value: "kitchen_countertops", label: "Kitchen Countertops" },
  { value: "bathrooms", label: "Bathrooms" },
  { value: "flooring", label: "Flooring" },
  { value: "backsplash", label: "Backsplash" },
  { value: "full_house_project", label: "Full House Project" },
  { value: "custom", label: "Custom" },
] as const

type JobType = (typeof JOB_TYPE_OPTIONS)[number]["value"]

// Pull the existing-job ref out of a 409 response thrown by the
// convert-to-job endpoint. Returns null if the error isn't a 409 or
// doesn't carry a `convertedJob` payload (problem+json `errors`).
function extractAlreadyConvertedJob(
  err: unknown,
): { id: string; title?: string } | null {
  const e = err as {
    status?: number
    response?: { status?: number; data?: unknown }
  }
  const status = e?.status ?? e?.response?.status
  if (status !== 409) return null
  const data = e?.response?.data ?? (e as { data?: unknown })?.data
  const errors = (data as { errors?: unknown } | null)?.errors
  const ref = (errors as { convertedJob?: unknown } | null)?.convertedJob
  if (ref && typeof ref === "object" && typeof (ref as { id?: unknown }).id === "string") {
    return ref as { id: string; title?: string }
  }
  return null
}

// Mirror the backend's midpointMoney() so the dialog's "Contract
// Price" pre-fill matches what the server would default to. Returns
// "" (rather than null) so it slots straight into the controlled
// input value.
function midpointMoney(
  min: string | null | undefined,
  max: string | null | undefined,
): string {
  const minN = min != null && min !== "" ? Number(min) : null
  const maxN = max != null && max !== "" ? Number(max) : null
  if (
    minN != null &&
    maxN != null &&
    Number.isFinite(minN) &&
    Number.isFinite(maxN)
  ) {
    return ((minN + maxN) / 2).toFixed(2)
  }
  if (minN != null && Number.isFinite(minN)) return minN.toFixed(2)
  if (maxN != null && Number.isFinite(maxN)) return maxN.toFixed(2)
  return ""
}

type LeadPrefill = {
  id: string
  title: string
  streetAddress: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  estimatedRevenueMin: string | null
  estimatedRevenueMax: string | null
  projectType: string | null
  projectedSalesDate: string | null
  clientContact?: {
    displayName: string | null
    email: string | null
    phone: string | null
  } | null
}

type ClientForm = {
  companyName: string
  email: string
  phone: string
  streetAddress: string
  city: string
  state: string
  zipCode: string
  notes: string
}

const emptyClientForm: ClientForm = {
  companyName: "",
  email: "",
  phone: "",
  streetAddress: "",
  city: "",
  state: "",
  zipCode: "",
  notes: "",
}

export type ConvertLeadDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  lead: LeadPrefill | null
  onConverted: (jobId: string) => void
}

export function ConvertLeadDialog({
  open,
  onOpenChange,
  lead,
  onConverted,
}: ConvertLeadDialogProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [clientMode, setClientMode] = useState<"existing" | "new">("existing")
  const [clientId, setClientId] = useState<string>("")
  const [clientSearch, setClientSearch] = useState("")
  const [newClient, setNewClient] = useState<ClientForm>(emptyClientForm)

  const [jobTitle, setJobTitle] = useState("")
  const [streetAddress, setStreetAddress] = useState("")
  const [city, setCity] = useState("")
  const [state, setState] = useState("")
  const [zipCode, setZipCode] = useState("")
  const [contractPrice, setContractPrice] = useState("")
  const [projectedStart, setProjectedStart] = useState("")
  const [projectedCompletion, setProjectedCompletion] = useState("")
  const [jobType, setJobType] = useState<JobType | "">("")
  const [projectManagerId, setProjectManagerId] = useState<string>("")
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])

  // Reset everything every time the dialog opens for a fresh lead
  useEffect(() => {
    if (!open || !lead) return
    setStep(1)
    setClientMode("existing")
    setClientId("")
    setClientSearch("")
    // Prefill the new-client form from lead contact + address so the
    // common case (lead → new client → job) is one click. Users can
    // still edit any field before submitting.
    setNewClient({
      ...emptyClientForm,
      companyName: lead.clientContact?.displayName ?? lead.title ?? "",
      email: lead.clientContact?.email ?? "",
      phone: lead.clientContact?.phone ?? "",
      streetAddress: lead.streetAddress ?? "",
      city: lead.city ?? "",
      state: lead.state ?? "",
      zipCode: lead.zipCode ?? "",
    })
    // Pre-seed the existing-client search with the lead's contact name
    // so duplicates surface to the top of the list right away.
    if (lead.clientContact?.displayName) {
      setClientSearch(lead.clientContact.displayName)
    }
    setJobTitle(lead.title ?? "")
    setStreetAddress(lead.streetAddress ?? "")
    setCity(lead.city ?? "")
    setState(lead.state ?? "")
    setZipCode(lead.zipCode ?? "")
    // Mirror the backend default: midpoint of (min, max) when both are
    // present, otherwise fall back to whichever bound is set.
    setContractPrice(midpointMoney(lead.estimatedRevenueMin, lead.estimatedRevenueMax))
    setProjectedStart(lead.projectedSalesDate ?? "")
    setProjectedCompletion("")
    const validJobType = JOB_TYPE_OPTIONS.find((o) => o.value === lead.projectType)
    setJobType(validJobType ? validJobType.value : "")
    setProjectManagerId("")
    setAssigneeIds([])
  }, [open, lead])

  const clientsParams = { search: clientSearch || undefined, pageSize: 50 }
  const clientsQuery = useClientsGetClients(clientsParams, {
    query: {
      queryKey: getClientsGetClientsQueryKey(clientsParams),
      enabled: open && clientMode === "existing",
    },
  })
  const usersParams = { limit: 200 }
  type AssignableUser = { id: string; fullName: string; role: string }
  const usersQuery = useUsersGetUsers<{ users: AssignableUser[] }>(usersParams, {
    query: {
      queryKey: getUsersGetUsersQueryKey(usersParams),
      enabled: open && step === 2,
    },
  })

  const assignableUsers = useMemo<AssignableUser[]>(() => {
    const users = usersQuery.data?.users ?? []
    return users.filter((u: AssignableUser) =>
      ["admin", "project_manager", "crew_member"].includes(u.role ?? ""),
    )
  }, [usersQuery.data])

  const convertMutation = useLeadsPostLeadsIdConvertToJob()

  const canAdvance =
    clientMode === "new"
      ? newClient.companyName.trim().length > 0
      : !!clientId

  function toggleAssignee(id: string) {
    setAssigneeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function handleConvert() {
    if (!lead) return

    const body: LeadConvertToJobBody = { job: {} }
    if (clientMode === "existing" && clientId) {
      body.clientId = clientId
    } else if (clientMode === "new") {
      const nc: ClientsClientPayloadSchema = {
        companyName: newClient.companyName.trim(),
        email: newClient.email.trim() || null,
        phone: newClient.phone.trim() || null,
        streetAddress: newClient.streetAddress.trim() || null,
        city: newClient.city.trim() || null,
        state: newClient.state.trim() || null,
        zipCode: newClient.zipCode.trim() || null,
        notes: newClient.notes.trim() || null,
      }
      body.newClient = nc
    }

    body.job = {
      title: jobTitle.trim() || lead.title,
      streetAddress: streetAddress.trim() || null,
      city: city.trim() || null,
      state: state.trim() || null,
      zipCode: zipCode.trim() || null,
      contractPrice: contractPrice.trim() || null,
      projectedStart: projectedStart || null,
      projectedCompletion: projectedCompletion || null,
      jobType: jobType ? (jobType as JobType) : null,
      projectManagerId: projectManagerId || null,
      assigneeIds,
    }

    try {
      const res = await convertMutation.mutateAsync({ id: lead.id, data: body })
      toast.success("Lead converted to job.")
      onConverted(res.job.id)
      onOpenChange(false)
    } catch (error) {
      // Specialized 409 handling: the server returns the existing
      // converted job ref under errors.convertedJob. Surface a direct
      // "View job" recovery action so the user can navigate to the
      // job that already exists instead of getting a generic error.
      const existing = extractAlreadyConvertedJob(error)
      if (existing) {
        toast.error("This lead has already been converted to a job.", {
          action: {
            label: "View job",
            onClick: () => {
              onConverted(existing.id)
              onOpenChange(false)
            },
          },
        })
        return
      }
      toastApiError(error, "Unable to convert this lead.")
    }
  }

  const submitting = convertMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Convert lead to job — Step {step} of 2
          </DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={clientMode === "existing" ? "default" : "outline"}
                onClick={() => setClientMode("existing")}
              >
                Pick existing client
              </Button>
              <Button
                type="button"
                size="sm"
                variant={clientMode === "new" ? "default" : "outline"}
                onClick={() => setClientMode("new")}
              >
                Create new client
              </Button>
            </div>

            {clientMode === "existing" ? (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" />
                  <Input
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Search clients…"
                    className="pl-8 h-9"
                  />
                </div>
                <div
                  className="max-h-64 overflow-y-auto rounded-md border border-slate-200"
                  data-testid="convert-client-list"
                >
                  {clientsQuery.isLoading ? (
                    <div className="p-4 text-sm text-slate-500 flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" /> Loading clients…
                    </div>
                  ) : (clientsQuery.data?.clients ?? []).length === 0 ? (
                    <div className="p-4 text-sm text-slate-500">
                      No clients match. Try “Create new client” instead.
                    </div>
                  ) : (
                    (clientsQuery.data?.clients ?? []).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setClientId(c.id)}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                          clientId === c.id ? "bg-orange-50" : ""
                        }`}
                      >
                        <span className="font-medium text-slate-900">
                          {c.companyName}
                        </span>
                        {clientId === c.id && (
                          <span className="text-xs font-semibold text-orange-600">
                            Selected
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label>Company name *</Label>
                  <Input
                    value={newClient.companyName}
                    onChange={(e) =>
                      setNewClient((f) => ({ ...f, companyName: e.target.value }))
                    }
                    data-testid="convert-new-client-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    value={newClient.email}
                    onChange={(e) =>
                      setNewClient((f) => ({ ...f, email: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input
                    value={newClient.phone}
                    onChange={(e) =>
                      setNewClient((f) => ({ ...f, phone: e.target.value }))
                    }
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Street address</Label>
                  <Input
                    value={newClient.streetAddress}
                    onChange={(e) =>
                      setNewClient((f) => ({
                        ...f,
                        streetAddress: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>City</Label>
                  <Input
                    value={newClient.city}
                    onChange={(e) =>
                      setNewClient((f) => ({ ...f, city: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>State</Label>
                  <Input
                    maxLength={2}
                    value={newClient.state}
                    onChange={(e) =>
                      setNewClient((f) => ({
                        ...f,
                        state: e.target.value.toUpperCase(),
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Zip code</Label>
                  <Input
                    value={newClient.zipCode}
                    onChange={(e) =>
                      setNewClient((f) => ({ ...f, zipCode: e.target.value }))
                    }
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Notes</Label>
                  <Textarea
                    rows={2}
                    value={newClient.notes}
                    onChange={(e) =>
                      setNewClient((f) => ({ ...f, notes: e.target.value }))
                    }
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>Job title *</Label>
              <Input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                data-testid="convert-job-title"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Street address</Label>
              <Input
                value={streetAddress}
                onChange={(e) => setStreetAddress(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>State</Label>
              <Input
                maxLength={2}
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Zip code</Label>
              <Input
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contract price</Label>
              <Input
                value={contractPrice}
                onChange={(e) => setContractPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Projected start</Label>
              <Input
                type="date"
                value={projectedStart}
                onChange={(e) => setProjectedStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Projected completion</Label>
              <Input
                type="date"
                value={projectedCompletion}
                onChange={(e) => setProjectedCompletion(e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Job type</Label>
              <Select
                value={jobType || "__none__"}
                onValueChange={(v) =>
                  setJobType(v === "__none__" ? "" : (v as JobType))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {JOB_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Project manager</Label>
              <Select
                value={projectManagerId || "__none__"}
                onValueChange={(v) =>
                  setProjectManagerId(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {assignableUsers
                    .filter((u: AssignableUser) => u.role === "admin" || u.role === "project_manager")
                    .map((u: AssignableUser) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.fullName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Assignees</Label>
              <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200">
                {assignableUsers.length === 0 ? (
                  <div className="p-3 text-sm text-slate-500">
                    No users available.
                  </div>
                ) : (
                  assignableUsers.map((u: AssignableUser) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={assigneeIds.includes(u.id)}
                        onChange={() => toggleAssignee(u.id)}
                      />
                      <span>{u.fullName}</span>
                      <span className="ml-auto text-xs text-slate-400">
                        {u.role}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => setStep(2)}
                disabled={!canAdvance}
                data-testid="convert-next"
              >
                Next
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                onClick={handleConvert}
                disabled={submitting || !jobTitle.trim()}
                data-testid="convert-submit"
              >
                {submitting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                Convert to job
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
