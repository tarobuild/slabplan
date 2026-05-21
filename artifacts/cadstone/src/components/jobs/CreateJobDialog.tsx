import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useJobsPostJobs,
  type JobsJobCreatePayloadSchema,
  type JobsJobPayloadSchema,
} from "@workspace/api-client-react";
import { ClientsPostClientsBody, JobsPostJobsBody } from "@workspace/api-zod";
import { api } from "@/lib/api";
import { toastApiError } from "@/lib/api-errors";
import { validatePayload } from "@/lib/validate-payload";
import { invalidateAppData } from "@/lib/data-refresh";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import WorkerAssignmentPicker, {
  type WorkerOption,
} from "@/components/WorkerAssignmentPicker";
import { useAuthStore } from "@/store/auth";

type ClientOption = { id: string; companyName: string };

type CreateJobForm = {
  title: string;
  status: string;
  jobType: string;
  contractType: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  contractPrice: string;
  projectedStart: string;
  projectedCompletion: string;
  clientId: string;
  assigneeIds: string[];
};

const emptyForm: CreateJobForm = {
  title: "",
  status: "open",
  jobType: "",
  contractType: "",
  streetAddress: "",
  city: "",
  state: "",
  zipCode: "",
  contractPrice: "",
  projectedStart: "",
  projectedCompletion: "",
  clientId: "",
  assigneeIds: [],
};

const JOB_TYPES = [
  "kitchen_countertops",
  "bathrooms",
  "flooring",
  "backsplash",
  "full_house_project",
  "custom",
] as const;
const JOB_TYPE_LABELS: Record<string, string> = {
  kitchen_countertops: "Kitchen Countertops",
  bathrooms: "Bathrooms",
  flooring: "Flooring",
  backsplash: "Backsplash",
  full_house_project: "Full House Project",
  custom: "Custom",
};
const ADD_NEW_CLIENT_VALUE = "__add_new_client__";
const toLabel = (s: string) =>
  JOB_TYPE_LABELS[s] ?? s.replace(/\b\w/g, (c) => c.toUpperCase());

export type CreateJobDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultClientId?: string;
  lockClient?: boolean;
  onCreated?: (newJobId: string | undefined) => void;
};

/**
 * Self-contained "Create Job" dialog. Used by /jobs and by the client
 * detail page so an admin can spin up a job without leaving the
 * client. The picker is intentionally NOT hosted here — callers that
 * need to pick a client first own that flow and pass `defaultClientId`
 * + `lockClient` once the user has chosen.
 */
export default function CreateJobDialog({
  open,
  onOpenChange,
  defaultClientId,
  lockClient,
  onCreated,
}: CreateJobDialogProps) {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === "admin";

  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<CreateJobForm>(emptyForm);
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([]);
  const [workerOptions, setWorkerOptions] = useState<WorkerOption[]>([]);
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [newClientCompanyName, setNewClientCompanyName] = useState("");
  const [newClientContactName, setNewClientContactName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [creatingClient, setCreatingClient] = useState(false);
  const [saving, setSaving] = useState(false);

  const createJobMutation = useJobsPostJobs();

  // Reset form ONLY on the open transition (false → true). Re-running
  // the reset whenever `defaultClientId` changes mid-flow could wipe
  // user-entered fields and the chosen clientId between steps.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setForm({ ...emptyForm, clientId: defaultClientId ?? "" });
      setStep(1);
      setShowCreateClient(false);
      setNewClientCompanyName("");
      setNewClientContactName("");
      setNewClientEmail("");
      setNewClientPhone("");
    }
    wasOpenRef.current = open;
  }, [open, defaultClientId]);

  useEffect(() => {
    if (!open || !lockClient) return;
    setForm((current) => ({ ...current, clientId: defaultClientId ?? "" }));
  }, [open, lockClient, defaultClientId]);

  useEffect(() => {
    if (!open || !isAdmin) return;
    api
      .get("/clients?pageSize=100")
      .then((r) => setClientOptions(r.data.clients ?? []))
      .catch((err: unknown) => toastApiError(err, "Failed to load clients"));
  }, [open, isAdmin]);

  useEffect(() => {
    if (!open || !isAdmin) return;
    api
      .get("/users?roles=project_manager,crew_member&limit=200")
      .then((r) => setWorkerOptions(r.data.users ?? []))
      .catch((err: unknown) => toastApiError(err, "Failed to load workers"));
  }, [open, isAdmin]);

  const setField =
    (k: keyof CreateJobForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleDialogOpenChange = (next: boolean) => {
    onOpenChange(next);
  };

  const handleCreateClient = async () => {
    if (!newClientCompanyName.trim()) {
      toast.error("Company name is required");
      return;
    }
    const clientPayload = validatePayload(ClientsPostClientsBody, {
      companyName: newClientCompanyName.trim(),
      email: newClientEmail.trim() || null,
      phone: newClientPhone.trim() || null,
    });
    if (!clientPayload) return;
    setCreatingClient(true);
    try {
      const response = await api.post("/clients", clientPayload);
      const nextClient = response.data.client;

      setClientOptions((current) =>
        [...current, nextClient].sort((left, right) =>
          left.companyName.localeCompare(right.companyName),
        ),
      );
      setForm((current) => ({ ...current, clientId: nextClient.id }));

      if (newClientContactName.trim()) {
        const nameParts = newClientContactName.trim().split(/\s+/);
        const firstName = nameParts[0] || null;
        const lastName = nameParts.slice(1).join(" ") || null;
        try {
          await api.post(`/clients/${nextClient.id}/contacts`, {
            firstName,
            lastName,
            email: newClientEmail.trim() || null,
            phone: newClientPhone.trim() || null,
            isPrimary: true,
          });
        } catch (err: unknown) {
          toastApiError(
            err,
            "Client was created, but the primary contact could not be saved. The contact fields are still here for reference.",
          );
          return;
        }
      }

      setShowCreateClient(false);
      setNewClientCompanyName("");
      setNewClientContactName("");
      setNewClientEmail("");
      setNewClientPhone("");
      toast.success("Client created");
    } catch (err: unknown) {
      toastApiError(err, "Failed to create client");
    } finally {
      setCreatingClient(false);
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    // Belt-and-suspenders: when the parent locked the client (picker
    // flow), defaultClientId is authoritative. Fall back to it if the
    // local form state ever loses the value mid-flow.
    const effectiveClientId = lockClient
      ? defaultClientId || ""
      : form.clientId || "";
    if (!effectiveClientId) {
      toast.error("Pick a client before creating the job.");
      setStep(1);
      return;
    }
    const payload: JobsJobCreatePayloadSchema = {
      title: form.title,
      status: form.status as JobsJobPayloadSchema["status"],
      jobType: (form.jobType || null) as JobsJobPayloadSchema["jobType"],
      contractType: (form.contractType ||
        null) as JobsJobPayloadSchema["contractType"],
      streetAddress: form.streetAddress || null,
      city: form.city || null,
      state: form.state || null,
      zipCode: form.zipCode || null,
      contractPrice: form.contractPrice || null,
      projectedStart: form.projectedStart || null,
      projectedCompletion: form.projectedCompletion || null,
      clientId: effectiveClientId,
      assigneeIds: isAdmin ? form.assigneeIds : [],
    };
    const validated = validatePayload(JobsPostJobsBody, payload);
    if (!validated) return;
    setSaving(true);
    const hadStartDate = Boolean(form.projectedStart);
    try {
      const res = await createJobMutation.mutateAsync({ data: validated });
      const newJobId = res?.job?.id;
      toast.success("Job created");
      if (!hadStartDate) {
        toast("Add a start date later", {
          description:
            "This job won't appear on the calendar until you set a start date.",
        });
      }
      onOpenChange(false);
      invalidateAppData(["jobs", "navigation"]);
      onCreated?.(newJobId);
    } catch (err: unknown) {
      toastApiError(err, "Failed to create job");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-2xl flex flex-col max-h-[90dvh] p-0 gap-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
          <DialogTitle>Create Job</DialogTitle>
          <p className="text-xs text-slate-400">
            {step === 1
              ? "Step 1 of 2 — Job Basics"
              : "Step 2 of 2 — Location & Contract"}
          </p>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            if (step === 1) {
              e.preventDefault();
              const effectiveClientId = lockClient
                ? defaultClientId || ""
                : form.clientId || "";
              if (!form.title.trim()) return;
              if (!effectiveClientId) {
                toast.error("Pick a client before continuing.");
                return;
              }
              setStep(2);
              return;
            }
            void handleCreate(e);
          }}
        >
          {step === 1 ? (
            <div className="grid grid-cols-2 gap-4 px-6 py-4 flex-1 overflow-y-auto">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={setField("title")}
                  required
                  placeholder="e.g. Johnson Kitchen Countertops"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>
                  Client *{" "}
                  {lockClient ? (
                    <span className="text-[10px] text-slate-400">(locked)</span>
                  ) : null}
                </Label>
                <Select
                  value={
                    (lockClient ? defaultClientId : form.clientId) || "_none"
                  }
                  disabled={lockClient}
                  onValueChange={(value) => {
                    if (value === ADD_NEW_CLIENT_VALUE) {
                      setShowCreateClient(true);
                      return;
                    }
                    setShowCreateClient(false);
                    setForm((current) => ({
                      ...current,
                      clientId: value === "_none" ? "" : value,
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none" disabled>
                      Select a client
                    </SelectItem>
                    {clientOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.companyName}
                      </SelectItem>
                    ))}
                    {isAdmin ? (
                      <SelectItem value={ADD_NEW_CLIENT_VALUE}>
                        Add new client…
                      </SelectItem>
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
                        onChange={(event) =>
                          setNewClientCompanyName(event.target.value)
                        }
                        placeholder="e.g. Acme Builders"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-client-contact">Contact Name</Label>
                      <Input
                        id="new-client-contact"
                        value={newClientContactName}
                        onChange={(event) =>
                          setNewClientContactName(event.target.value)
                        }
                        placeholder="e.g. John Smith"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="new-client-email">Email</Label>
                        <Input
                          id="new-client-email"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          value={newClientEmail}
                          onChange={(event) =>
                            setNewClientEmail(event.target.value)
                          }
                          placeholder="john@example.com"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="new-client-phone">Phone Number</Label>
                        <Input
                          id="new-client-phone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          value={newClientPhone}
                          onChange={(event) =>
                            setNewClientPhone(event.target.value)
                          }
                          placeholder="(555) 123-4567"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={handleCreateClient}
                        disabled={creatingClient}
                      >
                        {creatingClient && (
                          <Loader2 className="mr-2 size-3.5 animate-spin" />
                        )}
                        Add Client
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Job Type</Label>
                <Select
                  value={form.jobType}
                  onValueChange={(v) => setForm((f) => ({ ...f, jobType: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">
                    {JOB_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {toLabel(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isAdmin ? (
                <div className="col-span-2 space-y-1.5">
                  <Label>Assign Workers</Label>
                  <WorkerAssignmentPicker
                    options={workerOptions}
                    selectedIds={form.assigneeIds}
                    onChange={(assigneeIds) =>
                      setForm((current) => ({ ...current, assigneeIds }))
                    }
                    placeholder="Search project managers or crew members"
                  />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="projectedStart">Start Date</Label>
                <Input
                  id="projectedStart"
                  type="date"
                  value={form.projectedStart}
                  onChange={setField("projectedStart")}
                />
                <p className="text-xs text-slate-400">
                  Required for the job to appear on the schedule.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="projectedCompletion">Est. Completion</Label>
                <Input
                  id="projectedCompletion"
                  type="date"
                  value={form.projectedCompletion}
                  onChange={setField("projectedCompletion")}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 px-6 py-4 flex-1 overflow-y-auto">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="streetAddress">Street Address</Label>
                <Input
                  id="streetAddress"
                  value={form.streetAddress}
                  onChange={setField("streetAddress")}
                  placeholder="123 Main St"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={form.city}
                  onChange={setField("city")}
                  placeholder="Austin"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    value={form.state}
                    onChange={setField("state")}
                    placeholder="TX"
                    maxLength={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="zipCode">Zip</Label>
                  <Input
                    id="zipCode"
                    value={form.zipCode}
                    onChange={setField("zipCode")}
                    placeholder="78701"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={10}
                  />
                </div>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Contract Type</Label>
                <div className="flex gap-6 pt-0.5">
                  {(["fixed_price", "open_book"] as const).map((ct) => (
                    <label
                      key={ct}
                      className="flex items-start gap-2 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="createContractType"
                        value={ct}
                        checked={form.contractType === ct}
                        onChange={() =>
                          setForm((f) => ({ ...f, contractType: ct }))
                        }
                        className="mt-0.5 accent-primary"
                      />
                      <div>
                        <div className="text-sm font-medium text-slate-800">
                          {ct === "fixed_price" ? "Fixed price" : "Open book"}
                        </div>
                        <div className="text-xs text-slate-500">
                          {ct === "fixed_price"
                            ? "Set contract price for the client"
                            : "Projected costs + markup"}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="contractPrice">Contract Price ($)</Label>
                <Input
                  id="contractPrice"
                  value={form.contractPrice}
                  onChange={setField("contractPrice")}
                  placeholder="0.00"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t bg-white px-6 py-3">
            {step === 1 ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDialogOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!form.title.trim()}
                  className="hover:opacity-90 transition-opacity"
                >
                  Next: Location & Contract →
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                >
                  ← Back
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
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
  );
}
