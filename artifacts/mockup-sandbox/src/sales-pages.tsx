import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Underline from "@tiptap/extension-underline"
import {
  Bold,
  FilePlus2,
  Filter,
  HelpCircle,
  Italic,
  List,
  ListOrdered,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Underline as UnderlineIcon,
  Upload,
} from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  ageInDays,
  apiErrorMessage,
  buildLocation,
  cleanTags,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  leadStatusClass,
  type PaginationMeta,
  titleCaseStatus,
  type UserOption,
} from "@/feature-utils"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

type LeadStatus = "open" | "in_negotiation" | "won" | "lost" | "archived"

type LeadListItem = {
  id: string
  title: string
  streetAddress: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  confidence: number | null
  projectedSalesDate: string | null
  estimatedRevenueMin: string | null
  estimatedRevenueMax: string | null
  status: LeadStatus
  projectType: string | null
  leadSource: string | null
  createdAt: string
  updatedAt: string
  createdByName: string | null
  clientContact: {
    id: string
    displayName: string | null
    email: string | null
    phone: string | null
    label: string | null
  } | null
}

type LeadContact = {
  id: string
  leadId: string
  firstName: string | null
  lastName: string | null
  displayName: string | null
  streetAddress: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  phone: string | null
  cellPhone: string | null
  email: string | null
  label: string | null
  createdAt: string
  updatedAt: string
}

type LeadAttachment = {
  id: string
  fileId: string
  originalName: string
  fileUrl: string | null
  fileSize: number | null
  mimeType: string | null
  createdAt: string
  uploadedByName: string | null
}

type LeadDetail = {
  id: string
  title: string
  streetAddress: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  confidence: number | null
  projectedSalesDate: string | null
  estimatedRevenueMin: string | null
  estimatedRevenueMax: string | null
  status: LeadStatus
  projectType: string | null
  notes: string | null
  leadSource: string | null
  createdBy: string
  createdByName: string | null
  createdAt: string
  updatedAt: string
  clientContact: LeadContact | null
  contacts: LeadContact[]
  salespeople: UserOption[]
  tags: string[]
  sources: string[]
  attachments: LeadAttachment[]
  availableContacts: Array<{
    id: string
    leadId: string
    leadTitle: string | null
    displayName: string | null
    email: string | null
    phone: string | null
    cellPhone: string | null
    label: string | null
  }>
}

type LeadActivityEntry = {
  id: string
  entityType: string
  entityId: string
  action: string
  metadata: Record<string, unknown> | null
  createdAt: string
  userName: string | null
}

type LeadFormState = {
  title: string
  streetAddress: string
  city: string
  state: string
  zipCode: string
  confidence: number
  projectedSalesDate: string
  estimatedRevenueMin: string
  estimatedRevenueMax: string
  status: LeadStatus
  projectType: string
  notes: string
  leadSource: string
  tagsInput: string
  salespeople: string[]
}

type ContactFormState = {
  firstName: string
  lastName: string
  displayName: string
  streetAddress: string
  city: string
  state: string
  zipCode: string
  phone: string
  cellPhone: string
  email: string
  label: string
}

const defaultPagination: PaginationMeta = {
  page: 1,
  pageSize: 10,
  totalItems: 0,
  totalPages: 1,
}

function EmptyPanel({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div className="rounded-full border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-slate-500">
          <FilePlus2 className="size-5" />
        </div>
        <div className="space-y-1">
          <h3 className="font-semibold text-slate-950">{title}</h3>
          <p className="max-w-md text-sm text-slate-500">{description}</p>
        </div>
        {action}
      </CardContent>
    </Card>
  )
}

function PageFrame({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm">
      <CardHeader className="flex flex-col gap-3 border-b border-[#E5E7EB] pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-xl font-semibold text-slate-950">{title}</CardTitle>
          <CardDescription className="text-sm text-slate-500">{description}</CardDescription>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent className="p-6">{children}</CardContent>
    </Card>
  )
}

function MiniToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof HelpCircle
  label: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-9 border-[#E5E7EB] bg-white text-slate-600"
      onClick={onClick}
    >
      <Icon className="size-4" />
      {label}
    </Button>
  )
}

function defaultLeadForm(): LeadFormState {
  return {
    title: "",
    streetAddress: "",
    city: "",
    state: "",
    zipCode: "",
    confidence: 50,
    projectedSalesDate: "",
    estimatedRevenueMin: "",
    estimatedRevenueMax: "",
    status: "open",
    projectType: "",
    notes: "",
    leadSource: "",
    tagsInput: "",
    salespeople: [],
  }
}

function defaultContactForm(): ContactFormState {
  return {
    firstName: "",
    lastName: "",
    displayName: "",
    streetAddress: "",
    city: "",
    state: "",
    zipCode: "",
    phone: "",
    cellPhone: "",
    email: "",
    label: "",
  }
}

function leadPayloadFromForm(values: LeadFormState) {
  const tags = cleanTags(values.tagsInput)

  return {
    title: values.title.trim(),
    streetAddress: values.streetAddress || null,
    city: values.city || null,
    state: values.state || null,
    zipCode: values.zipCode || null,
    confidence: values.confidence,
    projectedSalesDate: values.projectedSalesDate || null,
    estimatedRevenueMin: values.estimatedRevenueMin || null,
    estimatedRevenueMax: values.estimatedRevenueMax || null,
    status: values.status,
    projectType: values.projectType || null,
    notes: values.notes || null,
    leadSource: values.leadSource || null,
    salespeople: values.salespeople,
    tags,
    sources: values.leadSource ? [values.leadSource] : [],
  }
}

function contactPayloadFromForm(values: ContactFormState) {
  return {
    firstName: values.firstName || null,
    lastName: values.lastName || null,
    displayName: values.displayName || null,
    streetAddress: values.streetAddress || null,
    city: values.city || null,
    state: values.state || null,
    zipCode: values.zipCode || null,
    phone: values.phone || null,
    cellPhone: values.cellPhone || null,
    email: values.email || null,
    label: values.label || null,
  }
}

function RichTextEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const editor = useEditor({
    extensions: [StarterKit, Underline],
    content: value,
    immediatelyRender: false,
    onUpdate({ editor: currentEditor }) {
      onChange(currentEditor.getHTML())
    },
  })

  useEffect(() => {
    if (!editor) {
      return
    }

    if (editor.getHTML() !== value) {
      editor.commands.setContent(value)
    }
  }, [editor, value])

  if (!editor) {
    return (
      <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4 text-sm text-slate-500">
        Loading editor…
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
      <div className="flex flex-wrap items-center gap-1 border-b border-[#E5E7EB] bg-[#F9FAFB] p-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-8", editor.isActive("bold") && "bg-blue-50 text-blue-700")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-8", editor.isActive("italic") && "bg-blue-50 text-blue-700")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-8", editor.isActive("underline") && "bg-blue-50 text-blue-700")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-8", editor.isActive("bulletList") && "bg-blue-50 text-blue-700")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-8", editor.isActive("orderedList") && "bg-blue-50 text-blue-700")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="size-4" />
        </Button>
      </div>
      <EditorContent
        editor={editor}
        className="cadstone-richtext min-h-[180px] px-4 py-3 text-sm"
      />
    </div>
  )
}

function LeadContactDialog({
  open,
  onOpenChange,
  availableContacts,
  onCreate,
  onSelectExisting,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableContacts: LeadDetail["availableContacts"]
  onCreate: (values: ContactFormState) => Promise<void>
  onSelectExisting: (contactId: string) => Promise<void>
}) {
  const [mode, setMode] = useState<"new" | "existing">("new")
  const [selectedContactId, setSelectedContactId] = useState("")
  const [values, setValues] = useState<ContactFormState>(defaultContactForm())
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setMode("new")
      setSelectedContactId("")
      setValues(defaultContactForm())
      setSubmitting(false)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-[#E5E7EB] bg-white">
        <DialogHeader>
          <DialogTitle>Add Client Contact</DialogTitle>
          <DialogDescription>
            Create a brand-new client contact or attach an existing contact record from another lead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              variant={mode === "new" ? "default" : "outline"}
              className={mode === "new" ? "" : "border-[#E5E7EB]"}
              onClick={() => setMode("new")}
            >
              New Contact
            </Button>
            <Button
              type="button"
              variant={mode === "existing" ? "default" : "outline"}
              className={mode === "existing" ? "" : "border-[#E5E7EB]"}
              onClick={() => setMode("existing")}
            >
              Choose Existing
            </Button>
          </div>

          {mode === "existing" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Existing contact</label>
              <Select value={selectedContactId} onValueChange={setSelectedContactId}>
                <SelectTrigger className="border-[#E5E7EB]">
                  <SelectValue placeholder="Choose a contact" />
                </SelectTrigger>
                <SelectContent>
                  {availableContacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.displayName || "Unnamed contact"} • {contact.leadTitle || "Lead"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["First name", "firstName"],
                ["Last name", "lastName"],
                ["Display name", "displayName"],
                ["Label", "label"],
                ["Email", "email"],
                ["Phone", "phone"],
                ["Cell phone", "cellPhone"],
                ["Street address", "streetAddress"],
                ["City", "city"],
                ["State", "state"],
                ["Zip code", "zipCode"],
              ].map(([label, key]) => (
                <div key={key} className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">{label}</label>
                  <Input
                    value={values[key as keyof ContactFormState]}
                    className="border-[#E5E7EB]"
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-[#E5E7EB]"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true)

              try {
                if (mode === "existing") {
                  if (!selectedContactId) {
                    toast.error("Select a contact first.")
                    return
                  }

                  await onSelectExisting(selectedContactId)
                } else {
                  await onCreate(values)
                }

                onOpenChange(false)
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {submitting ? <Spinner className="size-4" /> : null}
            Save Contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateLeadDialog({
  open,
  onOpenChange,
  users,
  contacts,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  users: UserOption[]
  contacts: LeadDetail["availableContacts"]
  onCreated: () => Promise<void>
}) {
  const [values, setValues] = useState<LeadFormState>(defaultLeadForm())
  const [contactMode, setContactMode] = useState<"none" | "existing" | "new">("none")
  const [selectedContactId, setSelectedContactId] = useState("")
  const [contactValues, setContactValues] = useState<ContactFormState>(defaultContactForm())
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setValues(defaultLeadForm())
      setContactMode("none")
      setSelectedContactId("")
      setContactValues(defaultContactForm())
      setSubmitting(false)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[720px] overflow-y-auto border-[#E5E7EB] bg-white">
        <DialogHeader>
          <DialogTitle>New Lead Opportunity</DialogTitle>
          <DialogDescription>
            Capture the opportunity, confidence, expected value, client contact, and the sales team assigned to it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Title</label>
              <Input
                value={values.title}
                className="border-[#E5E7EB]"
                onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Street address</label>
              <Input
                value={values.streetAddress}
                className="border-[#E5E7EB]"
                onChange={(event) =>
                  setValues((current) => ({ ...current, streetAddress: event.target.value }))
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium text-slate-900">City</label>
                <Input
                  value={values.city}
                  className="border-[#E5E7EB]"
                  onChange={(event) => setValues((current) => ({ ...current, city: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">State</label>
                <Input
                  value={values.state}
                  maxLength={2}
                  className="border-[#E5E7EB] uppercase"
                  onChange={(event) =>
                    setValues((current) => ({ ...current, state: event.target.value.toUpperCase() }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">Projected sales date</label>
                <Input
                  type="date"
                  value={values.projectedSalesDate}
                  className="border-[#E5E7EB]"
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      projectedSalesDate: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">Status</label>
                <Select
                  value={values.status}
                  onValueChange={(value: LeadStatus) =>
                    setValues((current) => ({ ...current, status: value }))
                  }
                >
                  <SelectTrigger className="border-[#E5E7EB]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_negotiation">In Negotiation</SelectItem>
                    <SelectItem value="won">Won</SelectItem>
                    <SelectItem value="lost">Lost</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">Est. revenue min</label>
                <Input
                  value={values.estimatedRevenueMin}
                  className="border-[#E5E7EB]"
                  placeholder="25000"
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      estimatedRevenueMin: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">Est. revenue max</label>
                <Input
                  value={values.estimatedRevenueMax}
                  className="border-[#E5E7EB]"
                  placeholder="45000"
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      estimatedRevenueMax: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-900">Confidence</label>
                <span className="text-sm text-slate-500">{values.confidence}%</span>
              </div>
              <Slider
                value={[values.confidence]}
                max={100}
                step={1}
                onValueChange={([value]) =>
                  setValues((current) => ({ ...current, confidence: value ?? 0 }))
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Project type</label>
              <Input
                value={values.projectType}
                className="border-[#E5E7EB]"
                onChange={(event) =>
                  setValues((current) => ({ ...current, projectType: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Lead source</label>
              <Input
                value={values.leadSource}
                className="border-[#E5E7EB]"
                onChange={(event) =>
                  setValues((current) => ({ ...current, leadSource: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Tags</label>
              <Input
                value={values.tagsInput}
                className="border-[#E5E7EB]"
                placeholder="kitchen, remodel, premium"
                onChange={(event) =>
                  setValues((current) => ({ ...current, tagsInput: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Client contact</label>
              <Select
                value={contactMode}
                onValueChange={(value: "none" | "existing" | "new") => setContactMode(value)}
              >
                <SelectTrigger className="border-[#E5E7EB]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Add later</SelectItem>
                  <SelectItem value="existing">Choose existing contact</SelectItem>
                  <SelectItem value="new">Create new contact</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {contactMode === "existing" ? (
              <Select value={selectedContactId} onValueChange={setSelectedContactId}>
                <SelectTrigger className="border-[#E5E7EB]">
                  <SelectValue placeholder="Choose a contact" />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.displayName || "Unnamed contact"} • {contact.leadTitle || "Lead"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {contactMode === "new" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={contactValues.firstName}
                  className="border-[#E5E7EB]"
                  placeholder="First name"
                  onChange={(event) =>
                    setContactValues((current) => ({ ...current, firstName: event.target.value }))
                  }
                />
                <Input
                  value={contactValues.lastName}
                  className="border-[#E5E7EB]"
                  placeholder="Last name"
                  onChange={(event) =>
                    setContactValues((current) => ({ ...current, lastName: event.target.value }))
                  }
                />
                <Input
                  value={contactValues.displayName}
                  className="border-[#E5E7EB] sm:col-span-2"
                  placeholder="Display name"
                  onChange={(event) =>
                    setContactValues((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                />
                <Input
                  value={contactValues.email}
                  className="border-[#E5E7EB] sm:col-span-2"
                  placeholder="Email"
                  onChange={(event) =>
                    setContactValues((current) => ({ ...current, email: event.target.value }))
                  }
                />
                <Input
                  value={contactValues.phone}
                  className="border-[#E5E7EB]"
                  placeholder="Phone"
                  onChange={(event) =>
                    setContactValues((current) => ({ ...current, phone: event.target.value }))
                  }
                />
                <Input
                  value={contactValues.label}
                  className="border-[#E5E7EB]"
                  placeholder="Label"
                  onChange={(event) =>
                    setContactValues((current) => ({ ...current, label: event.target.value }))
                  }
                />
              </div>
            ) : null}

            <div className="space-y-3">
              <label className="text-sm font-medium text-slate-900">Salespeople</label>
              <ScrollArea className="max-h-44 rounded-lg border border-[#E5E7EB]">
                <div className="space-y-2 p-3">
                  {users.map((user) => {
                    const checked = values.salespeople.includes(user.id)

                    return (
                      <label
                        key={user.id}
                        className="flex items-start gap-3 rounded-md border border-transparent px-2 py-1 hover:bg-[#F9FAFB]"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(nextChecked) =>
                            setValues((current) => ({
                              ...current,
                              salespeople: nextChecked
                                ? [...current.salespeople, user.id]
                                : current.salespeople.filter((item) => item !== user.id),
                            }))
                          }
                        />
                        <div>
                          <p className="text-sm font-medium text-slate-900">{user.fullName}</p>
                          <p className="text-xs text-slate-500">{user.role.replaceAll("_", " ")}</p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </ScrollArea>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Notes</label>
              <Textarea
                value={values.notes}
                rows={4}
                className="border-[#E5E7EB]"
                onChange={(event) =>
                  setValues((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-[#E5E7EB]"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting || !values.title.trim()}
            onClick={async () => {
              setSubmitting(true)

              try {
                const { data } = await api.post<{ lead: LeadDetail }>("/leads", leadPayloadFromForm(values))

                if (contactMode === "existing" && selectedContactId) {
                  await api.post(`/leads/${data.lead.id}/contacts`, {
                    sourceContactId: selectedContactId,
                  })
                }

                if (contactMode === "new" && contactValues.displayName && contactValues.email) {
                  await api.post(`/leads/${data.lead.id}/contacts`, contactPayloadFromForm(contactValues))
                }

                toast.success("Lead opportunity created.")
                await onCreated()
                onOpenChange(false)
              } catch (error) {
                toast.error(apiErrorMessage(error, "Unable to create lead opportunity."))
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {submitting ? <Spinner className="size-4" /> : null}
            Create Lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LeadPanel({
  leadId,
  open,
  onOpenChange,
  users,
  onChanged,
}: {
  leadId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  users: UserOption[]
  onChanged: () => Promise<void>
}) {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [lead, setLead] = useState<LeadDetail | null>(null)
  const [form, setForm] = useState<LeadFormState>(defaultLeadForm())
  const [activeTab, setActiveTab] = useState("general")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activities, setActivities] = useState<LeadActivityEntry[]>([])
  const [loadingActivities, setLoadingActivities] = useState(false)
  const [newActivityTitle, setNewActivityTitle] = useState("")
  const [newActivityNotes, setNewActivityNotes] = useState("")
  const [contactDialogOpen, setContactDialogOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{
    kind: "contact" | "attachment"
    id: string
    label: string
  } | null>(null)

  useEffect(() => {
    if (!open || !leadId) {
      setLead(null)
      setForm(defaultLeadForm())
      setActiveTab("general")
      setActivities([])
      return
    }

    let active = true
    setLoading(true)

    void api
      .get<{ lead: LeadDetail }>(`/leads/${leadId}`)
      .then((response) => {
        if (!active) {
          return
        }

        setLead(response.data.lead)
        setForm({
          title: response.data.lead.title,
          streetAddress: response.data.lead.streetAddress || "",
          city: response.data.lead.city || "",
          state: response.data.lead.state || "",
          zipCode: response.data.lead.zipCode || "",
          confidence: response.data.lead.confidence ?? 0,
          projectedSalesDate: response.data.lead.projectedSalesDate || "",
          estimatedRevenueMin: response.data.lead.estimatedRevenueMin || "",
          estimatedRevenueMax: response.data.lead.estimatedRevenueMax || "",
          status: response.data.lead.status,
          projectType: response.data.lead.projectType || "",
          notes: response.data.lead.notes || "",
          leadSource: response.data.lead.leadSource || "",
          tagsInput: response.data.lead.tags.join(", "),
          salespeople: response.data.lead.salespeople.map((person) => person.id),
        })
      })
      .catch((error) => {
        if (active) {
          toast.error(apiErrorMessage(error, "Unable to load lead details."))
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [leadId, open])

  useEffect(() => {
    if (!open || activeTab !== "activities" || !leadId) {
      return
    }

    let active = true
    setLoadingActivities(true)

    void api
      .get<{ entries: LeadActivityEntry[] }>(`/activity?entityType=lead&entityId=${leadId}&page=1&limit=50`)
      .then((response) => {
        if (active) {
          setActivities(response.data.entries)
        }
      })
      .catch((error) => {
        if (active) {
          toast.error(apiErrorMessage(error, "Unable to load lead activities."))
        }
      })
      .finally(() => {
        if (active) {
          setLoadingActivities(false)
        }
      })

    return () => {
      active = false
    }
  }, [activeTab, leadId, open])

  const selectedSalespeople = useMemo(
    () => new Set(form.salespeople),
    [form.salespeople],
  )

  async function reloadLead() {
    if (!leadId) {
      return
    }

    const { data } = await api.get<{ lead: LeadDetail }>(`/leads/${leadId}`)
    setLead(data.lead)
    return data.lead
  }

  if (!leadId) {
    return null
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-[560px] border-[#E5E7EB] bg-white p-0 sm:max-w-[560px]">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-[#E5E7EB] px-6 py-5">
            <SheetTitle>{lead?.title || "Lead Opportunity"}</SheetTitle>
            <SheetDescription>
              Review, update, and convert sales opportunities without leaving the table view.
            </SheetDescription>
          </SheetHeader>

          {loading || !lead ? (
            <div className="space-y-6 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : (
            <>
              <div className="border-b border-[#E5E7EB] px-6 py-4">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="grid w-full grid-cols-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-1">
                    <TabsTrigger value="general">General</TabsTrigger>
                    <TabsTrigger value="activities">Activities</TabsTrigger>
                    <TabsTrigger value="proposals">Proposals</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <ScrollArea className="flex-1">
                <div className="space-y-6 px-6 py-5">
                  {activeTab === "general" ? (
                    <>
                      <section className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-slate-950">Client Contact</h3>
                            <p className="text-sm text-slate-500">Choose an existing client record or add a new one.</p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="border-[#E5E7EB]"
                              onClick={() => setContactDialogOpen(true)}
                            >
                              New Contact
                            </Button>
                          </div>
                        </div>

                        {lead.contacts.length === 0 ? (
                          <EmptyPanel
                            title="No client contact yet"
                            description="Attach a contact to this opportunity so the estimator has a clear client record."
                          />
                        ) : (
                          <div className="space-y-3">
                            {lead.contacts.map((contact) => (
                              <div
                                key={contact.id}
                                className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="font-medium text-slate-950">{contact.displayName || "Unnamed contact"}</p>
                                    <p className="text-sm text-slate-500">{contact.label || "Client contact"}</p>
                                  </div>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button type="button" variant="ghost" size="icon" className="size-8">
                                        <MoreHorizontal className="size-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={() =>
                                          setConfirmAction({
                                            kind: "contact",
                                            id: contact.id,
                                            label: contact.displayName || "this contact",
                                          })
                                        }
                                      >
                                        Delete Contact
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                                <div className="mt-3 grid gap-2 text-sm text-slate-600">
                                  <p>{contact.email || "No email saved"}</p>
                                  <p>{contact.phone || contact.cellPhone || "No phone saved"}</p>
                                  <p>{buildLocation([contact.streetAddress, contact.city, contact.state, contact.zipCode])}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>

                      <section className="grid gap-4 sm:grid-cols-2">
                        {[
                          ["Title", "title"],
                          ["Street address", "streetAddress"],
                          ["City", "city"],
                          ["State", "state"],
                          ["Zip code", "zipCode"],
                          ["Projected sales date", "projectedSalesDate"],
                          ["Project type", "projectType"],
                          ["Lead source", "leadSource"],
                          ["Est. revenue min", "estimatedRevenueMin"],
                          ["Est. revenue max", "estimatedRevenueMax"],
                        ].map(([label, key]) => (
                          <div key={key} className="space-y-2">
                            <label className="text-sm font-medium text-slate-900">{label}</label>
                            <Input
                              type={key === "projectedSalesDate" ? "date" : "text"}
                              value={form[key as keyof LeadFormState] as string}
                              className="border-[#E5E7EB]"
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  [key]: event.target.value,
                                }))
                              }
                            />
                          </div>
                        ))}

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-900">Status</label>
                          <Select
                            value={form.status}
                            onValueChange={(value: LeadStatus) =>
                              setForm((current) => ({ ...current, status: value }))
                            }
                          >
                            <SelectTrigger className="border-[#E5E7EB]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="in_negotiation">In Negotiation</SelectItem>
                              <SelectItem value="won">Won</SelectItem>
                              <SelectItem value="lost">Lost</SelectItem>
                              <SelectItem value="archived">Archived</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-slate-900">Confidence</label>
                            <span className="text-sm text-slate-500">{form.confidence}%</span>
                          </div>
                          <Slider
                            value={[form.confidence]}
                            max={100}
                            step={1}
                            onValueChange={([value]) =>
                              setForm((current) => ({ ...current, confidence: value ?? 0 }))
                            }
                          />
                        </div>
                      </section>

                      <section className="space-y-3">
                        <div>
                          <h3 className="font-semibold text-slate-950">Salespeople</h3>
                          <p className="text-sm text-slate-500">Assign the team covering this opportunity.</p>
                        </div>
                        <div className="grid gap-2">
                          {users.map((user) => (
                            <label
                              key={user.id}
                              className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] px-3 py-2"
                            >
                              <Checkbox
                                checked={selectedSalespeople.has(user.id)}
                                onCheckedChange={(nextChecked) =>
                                  setForm((current) => ({
                                    ...current,
                                    salespeople: nextChecked
                                      ? [...current.salespeople, user.id]
                                      : current.salespeople.filter((item) => item !== user.id),
                                  }))
                                }
                              />
                              <div>
                                <p className="text-sm font-medium text-slate-900">{user.fullName}</p>
                                <p className="text-xs text-slate-500">{user.role.replaceAll("_", " ")}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </section>

                      <section className="space-y-3">
                        <div>
                          <h3 className="font-semibold text-slate-950">Notes</h3>
                          <p className="text-sm text-slate-500">Use lightweight formatting for qualification notes and proposal context.</p>
                        </div>
                        <RichTextEditor value={form.notes} onChange={(value) => setForm((current) => ({ ...current, notes: value }))} />
                      </section>

                      <section className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-slate-950">Attachments</h3>
                            <p className="text-sm text-slate-500">Upload reference files, sketches, and proposal inputs.</p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            className="border-[#E5E7EB]"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <Upload className="size-4" />
                            Upload
                          </Button>
                        </div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={async (event) => {
                            const files = Array.from(event.target.files || [])

                            if (files.length === 0) {
                              return
                            }

                            const formData = new FormData()
                            files.forEach((file) => formData.append("files", file))

                            try {
                              await api.post(`/leads/${lead.id}/attachments`, formData)
                              toast.success("Attachments uploaded.")
                              const nextLead = await reloadLead()
                              if (nextLead) {
                                setLead(nextLead)
                              }
                              await onChanged()
                            } catch (error) {
                              toast.error(apiErrorMessage(error, "Unable to upload attachments."))
                            } finally {
                              event.target.value = ""
                            }
                          }}
                        />
                        {lead.attachments.length === 0 ? (
                          <EmptyPanel
                            title="No attachments yet"
                            description="Upload source files, reference documents, or sketches for the estimator."
                          />
                        ) : (
                          <div className="space-y-2">
                            {lead.attachments.map((attachment) => (
                              <div
                                key={attachment.id}
                                className="flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] px-4 py-3"
                              >
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-slate-950">{attachment.originalName}</p>
                                  <p className="text-xs text-slate-500">
                                    {attachment.uploadedByName || "Unknown"} • {formatDateTime(attachment.createdAt)}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="border-[#E5E7EB]"
                                    onClick={() => window.open(`/api/files/${attachment.fileId}/download`, "_blank")}
                                  >
                                    Download
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    className="text-red-600 hover:text-red-700"
                                    onClick={() =>
                                      setConfirmAction({
                                        kind: "attachment",
                                        id: attachment.id,
                                        label: attachment.originalName,
                                      })
                                    }
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    </>
                  ) : null}

                  {activeTab === "activities" ? (
                    <section className="space-y-4">
                      <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                        <div className="grid gap-3">
                          <Input
                            value={newActivityTitle}
                            className="border-[#E5E7EB] bg-white"
                            placeholder="Lead Activity title"
                            onChange={(event) => setNewActivityTitle(event.target.value)}
                          />
                          <Textarea
                            value={newActivityNotes}
                            rows={3}
                            className="border-[#E5E7EB] bg-white"
                            placeholder="Notes"
                            onChange={(event) => setNewActivityNotes(event.target.value)}
                          />
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              disabled={!newActivityTitle.trim()}
                              onClick={async () => {
                                try {
                                  await api.post(`/leads/${lead.id}/activities`, {
                                    title: newActivityTitle,
                                    notes: newActivityNotes || null,
                                  })
                                  toast.success("Lead activity saved.")
                                  setNewActivityTitle("")
                                  setNewActivityNotes("")
                                  const { data } = await api.get<{ entries: LeadActivityEntry[] }>(
                                    `/activity?entityType=lead&entityId=${lead.id}&page=1&limit=50`,
                                  )
                                  setActivities(data.entries)
                                } catch (error) {
                                  toast.error(apiErrorMessage(error, "Unable to save lead activity."))
                                }
                              }}
                            >
                              + Lead Activity
                            </Button>
                          </div>
                        </div>
                      </div>

                      {loadingActivities ? (
                        <div className="flex items-center justify-center py-12">
                          <Spinner className="size-5 text-blue-600" />
                        </div>
                      ) : activities.length === 0 ? (
                        <EmptyPanel
                          title="No lead activities yet"
                          description="Log the latest outreach, pricing discussion, or next-step commitment."
                        />
                      ) : (
                        <div className="space-y-3">
                          {activities.map((activity) => (
                            <div
                              key={activity.id}
                              className="rounded-lg border border-[#E5E7EB] px-4 py-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium text-slate-950">
                                    {String(activity.metadata?.title || activity.metadata?.description || titleCaseStatus(activity.action))}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {activity.userName || "System"} • {formatDateTime(activity.createdAt)}
                                  </p>
                                </div>
                                <Badge variant="outline" className="border-[#E5E7EB] bg-[#F9FAFB] text-slate-600">
                                  {titleCaseStatus(activity.action)}
                                </Badge>
                              </div>
                              {activity.metadata?.notes ? (
                                <p className="mt-2 text-sm text-slate-600">{String(activity.metadata.notes)}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  ) : null}

                  {activeTab === "proposals" ? (
                    <EmptyPanel
                      title="Proposal tools stay on the job record"
                      description="Convert the opportunity to a job when you are ready for full proposal and operations workflows."
                      action={
                        <Button
                          type="button"
                          onClick={async () => {
                            try {
                              const { data } = await api.post<{ job: { id: string } }>(`/leads/${lead.id}/convert-to-job`)
                              toast.success("Lead converted to a job.")
                              await onChanged()
                              onOpenChange(false)
                              navigate(`/jobs/${data.job.id}`)
                            } catch (error) {
                              toast.error(apiErrorMessage(error, "Unable to convert this lead to a job."))
                            }
                          }}
                        >
                          +Job
                        </Button>
                      }
                    />
                  ) : null}
                </div>
              </ScrollArea>

              <div className="border-t border-[#E5E7EB] bg-white px-6 py-4">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
                    <span>
                      Created by {lead.createdByName || "Unknown"} on {formatDate(lead.createdAt)}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" className="size-8">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={async () => {
                            try {
                              await api.post("/leads", {
                                ...leadPayloadFromForm(form),
                                title: `${form.title} Copy`,
                              })
                              toast.success("Lead duplicated.")
                              await onChanged()
                            } catch (error) {
                              toast.error(apiErrorMessage(error, "Unable to duplicate this lead."))
                            }
                          }}
                        >
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={async () => {
                            try {
                              const { data } = await api.post<{ job: { id: string } }>(`/leads/${lead.id}/convert-to-job`)
                              toast.success("Lead converted to a job.")
                              await onChanged()
                              onOpenChange(false)
                              navigate(`/jobs/${data.job.id}`)
                            } catch (error) {
                              toast.error(apiErrorMessage(error, "Unable to convert this lead to a job."))
                            }
                          }}
                        >
                          Convert to job
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-red-600" onClick={() => setDeleteOpen(true)}>
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="border-[#E5E7EB]"
                      onClick={() => onOpenChange(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-[#E5E7EB]"
                      onClick={async () => {
                        try {
                          const { data } = await api.post<{ job: { id: string } }>(`/leads/${lead.id}/convert-to-job`)
                          toast.success("Lead converted to a job.")
                          await onChanged()
                          onOpenChange(false)
                          navigate(`/jobs/${data.job.id}`)
                        } catch (error) {
                          toast.error(apiErrorMessage(error, "Unable to convert this lead to a job."))
                        }
                      }}
                    >
                      +Job
                    </Button>
                    <Button
                      type="button"
                      disabled={saving}
                      onClick={async () => {
                        setSaving(true)

                        try {
                          const { data } = await api.put<{ lead: LeadDetail }>(`/leads/${lead.id}`, leadPayloadFromForm(form))
                          setLead(data.lead)
                          toast.success("Lead saved.")
                          await onChanged()
                        } catch (error) {
                          toast.error(apiErrorMessage(error, "Unable to save lead changes."))
                        } finally {
                          setSaving(false)
                        }
                      }}
                    >
                      {saving ? <Spinner className="size-4" /> : null}
                      Save
                    </Button>
                  </div>
                </div>
              </div>

              <LeadContactDialog
                open={contactDialogOpen}
                onOpenChange={setContactDialogOpen}
                availableContacts={lead.availableContacts}
                onCreate={async (values) => {
                  await api.post(`/leads/${lead.id}/contacts`, contactPayloadFromForm(values))
                  toast.success("Contact saved.")
                  const nextLead = await reloadLead()
                  if (nextLead) {
                    setLead(nextLead)
                  }
                }}
                onSelectExisting={async (contactId) => {
                  await api.post(`/leads/${lead.id}/contacts`, {
                    sourceContactId: contactId,
                  })
                  toast.success("Contact attached.")
                  const nextLead = await reloadLead()
                  if (nextLead) {
                    setLead(nextLead)
                  }
                }}
              />

              <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogContent className="border-[#E5E7EB] bg-white">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete lead opportunity?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the opportunity from the active sales pipeline. The action cannot be undone from the UI.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-[#E5E7EB]">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700"
                      onClick={async () => {
                        try {
                          await api.delete(`/leads/${lead.id}`)
                          toast.success("Lead deleted.")
                          setDeleteOpen(false)
                          onOpenChange(false)
                          await onChanged()
                        } catch (error) {
                          toast.error(apiErrorMessage(error, "Unable to delete this lead."))
                        }
                      }}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog
                open={Boolean(confirmAction)}
                onOpenChange={(nextOpen) => {
                  if (!nextOpen) {
                    setConfirmAction(null)
                  }
                }}
              >
                <AlertDialogContent className="border-[#E5E7EB] bg-white">
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {confirmAction?.kind === "contact" ? "Remove contact?" : "Remove attachment?"}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {confirmAction?.kind === "contact"
                        ? `${confirmAction.label} will be removed from this lead.`
                        : `${confirmAction?.label || "This file"} will be removed from this lead.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-[#E5E7EB]">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700"
                      onClick={async () => {
                        if (!confirmAction) {
                          return
                        }

                        try {
                          if (confirmAction.kind === "contact") {
                            await api.delete(`/leads/${lead.id}/contacts/${confirmAction.id}`)
                            toast.success("Contact removed.")
                            await onChanged()
                          } else {
                            await api.delete(`/leads/${lead.id}/attachments/${confirmAction.id}`)
                            toast.success("Attachment removed.")
                          }

                          const nextLead = await reloadLead()
                          if (nextLead) {
                            setLead(nextLead)
                          }
                          setConfirmAction(null)
                        } catch (error) {
                          toast.error(
                            apiErrorMessage(
                              error,
                              confirmAction.kind === "contact"
                                ? "Unable to remove contact."
                                : "Unable to remove attachment.",
                            ),
                          )
                        }
                      }}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function SalesLeadsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [leads, setLeads] = useState<LeadListItem[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [contacts, setContacts] = useState<LeadDetail["availableContacts"]>([])
  const [pagination, setPagination] = useState<PaginationMeta>(defaultPagination)
  const [summary, setSummary] = useState({
    estimatedRevenueMinTotal: "0",
    estimatedRevenueMaxTotal: "0",
  })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | LeadStatus>("all")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [panelLeadId, setPanelLeadId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false)

  async function loadUsersAndContacts() {
    const [usersResponse, contactsResponse] = await Promise.all([
      api.get<{ users: UserOption[] }>("/users"),
      api.get<{ contacts: LeadDetail["availableContacts"] }>("/leads/contacts"),
    ])

    setUsers(usersResponse.data.users)
    setContacts(contactsResponse.data.contacts)
  }

  async function loadLeads(page = pagination.page) {
    setLoading(true)

    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pagination.pageSize),
      })

      if (search.trim()) {
        params.set("search", search.trim())
      }

      if (statusFilter !== "all") {
        params.set("status", statusFilter)
      }

      const { data } = await api.get<{
        leads: LeadListItem[]
        pagination: PaginationMeta
        summary: {
          estimatedRevenueMinTotal: string
          estimatedRevenueMaxTotal: string
        }
      }>(`/leads?${params.toString()}`)

      setLeads(data.leads)
      setPagination(data.pagination)
      setSummary(data.summary)
      setSelectedIds((current) => current.filter((id) => data.leads.some((lead) => lead.id === id)))
    } catch (error) {
      toast.error(apiErrorMessage(error, "Unable to load lead opportunities."))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadUsersAndContacts()
  }, [])

  useEffect(() => {
    void loadLeads(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter])

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setCreateOpen(true)
    }

    const leadId = searchParams.get("lead")
    if (leadId) {
      setPanelLeadId(leadId)
      setPanelOpen(true)
    }
  }, [searchParams])

  const allSelected = leads.length > 0 && selectedIds.length === leads.length

  return (
    <>
      <PageFrame
        title="Lead Opportunities"
        description="Track open opportunities, expected revenue, contacts, and conversion to live jobs."
        actions={
          <>
            <MiniToolbarButton icon={HelpCircle} label="Help" onClick={() => toast.info("Lead help content is not published yet.")} />
            <MiniToolbarButton icon={Settings2} label="Settings" onClick={() => toast.info("Lead settings are not configured yet.")} />
            <MiniToolbarButton icon={Upload} label="Export" onClick={() => toast.info("CSV export is available from the bottom menu.")} />
            <Button
              type="button"
              variant="outline"
              className="h-9 border-[#E5E7EB] bg-white text-slate-600"
              onClick={() => toast.info(statusFilter === "all" ? "No active lead filters." : `1 filter active: ${titleCaseStatus(statusFilter)}.`)}
            >
              <Filter className="size-4" />
              Filter
              {statusFilter !== "all" ? (
                <Badge variant="outline" className="ml-1 border-blue-200 bg-blue-50 text-blue-700">
                  1
                </Badge>
              ) : null}
            </Button>
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Lead Opportunity
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                className="border-[#E5E7EB] pl-9"
                placeholder="Search leads, location, or project type"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="text-sm text-slate-500">
              Total Estimated Revenue: {formatCurrency(summary.estimatedRevenueMinTotal)} to {formatCurrency(summary.estimatedRevenueMaxTotal)}
            </div>
          </div>

          {loading ? (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
                <div className="space-y-3 p-4">
                  <Skeleton className="h-10 w-full" />
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-12 w-full" />
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-9 w-64" />
                <Skeleton className="h-9 w-44" />
              </div>
            </div>
          ) : leads.length === 0 ? (
            <EmptyPanel
              title="No lead opportunities yet"
              description="Create the first opportunity so the sales and operations teams can move it through qualification."
              action={<Button onClick={() => setCreateOpen(true)}>Create Lead</Button>}
            />
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-12">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={(checked) =>
                            setSelectedIds(checked ? leads.map((lead) => lead.id) : [])
                          }
                        />
                      </TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Client Contact</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Age</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead className="text-right">Est. Revenue Min</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads.map((lead) => {
                      const checked = selectedIds.includes(lead.id)

                      return (
                        <TableRow key={lead.id} className="cursor-pointer hover:bg-[#F9FAFB]">
                          <TableCell onClick={(event) => event.stopPropagation()}>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(nextChecked) =>
                                setSelectedIds((current) =>
                                  nextChecked
                                    ? [...current, lead.id]
                                    : current.filter((item) => item !== lead.id),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              className="text-left font-medium text-blue-700 hover:underline"
                              onClick={() => {
                                setPanelLeadId(lead.id)
                                setPanelOpen(true)
                              }}
                            >
                              {lead.title}
                            </button>
                            <p className="mt-1 text-xs text-slate-500">
                              {buildLocation([lead.streetAddress, lead.city, lead.state])}
                            </p>
                          </TableCell>
                          <TableCell>{formatDate(lead.createdAt)}</TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium text-slate-900">{lead.clientContact?.displayName || "No contact"}</p>
                              <p className="text-xs text-slate-500">{lead.clientContact?.label || "Add a client contact"}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={leadStatusClass(lead.status)}>
                              {titleCaseStatus(lead.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>{ageInDays(lead.createdAt)} days</TableCell>
                          <TableCell>
                            <div className="w-36 space-y-1">
                              <div className="flex items-center justify-between text-xs text-slate-500">
                                <span>{lead.confidence ?? 0}%</span>
                              </div>
                              <Progress value={lead.confidence ?? 0} className="h-2 bg-slate-100" />
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(lead.estimatedRevenueMin)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col gap-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={statusFilter}
                    onValueChange={(value: "all" | LeadStatus) => setStatusFilter(value)}
                  >
                    <SelectTrigger className="h-9 w-[180px] border-[#E5E7EB] bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Opportunities</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_negotiation">In Negotiation</SelectItem>
                      <SelectItem value="won">Won</SelectItem>
                      <SelectItem value="lost">Lost</SelectItem>
                    </SelectContent>
                  </Select>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" className="h-9 border-[#E5E7EB] bg-white">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => toast.info("CSV export is not wired yet.")}>
                        Export CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toast.info("Import flow is not wired yet.")}>
                        Import
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-red-600"
                        disabled={selectedIds.length === 0}
                        onClick={() => setDeleteSelectedOpen(true)}
                      >
                        Delete selected
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-center gap-3 text-sm text-slate-500">
                  <span>
                    Page {pagination.page} of {pagination.totalPages} • {formatNumber(pagination.totalItems)} opportunities
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 border-[#E5E7EB] bg-white"
                      disabled={pagination.page <= 1}
                      onClick={() => void loadLeads(pagination.page - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 border-[#E5E7EB] bg-white"
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => void loadLeads(pagination.page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </PageFrame>

      <CreateLeadDialog
        open={createOpen}
        onOpenChange={(nextOpen) => {
          setCreateOpen(nextOpen)

          if (!nextOpen && searchParams.get("create") === "1") {
            const next = new URLSearchParams(searchParams)
            next.delete("create")
            setSearchParams(next, { replace: true })
          }
        }}
        users={users}
        contacts={contacts}
        onCreated={async () => {
          await Promise.all([loadLeads(1), loadUsersAndContacts()])
        }}
      />

      <LeadPanel
        leadId={panelLeadId}
        open={panelOpen}
        onOpenChange={(nextOpen) => {
          setPanelOpen(nextOpen)
          if (!nextOpen) {
            setPanelLeadId(null)
            if (searchParams.get("lead")) {
              const next = new URLSearchParams(searchParams)
              next.delete("lead")
              setSearchParams(next, { replace: true })
            }
          }
        }}
        users={users}
        onChanged={async () => {
          await Promise.all([loadLeads(pagination.page), loadUsersAndContacts()])
        }}
      />

      <AlertDialog open={deleteSelectedOpen} onOpenChange={setDeleteSelectedOpen}>
        <AlertDialogContent className="border-[#E5E7EB] bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected leads?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedIds.length} selected lead opportunity records will be removed from the active pipeline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#E5E7EB]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                try {
                  await Promise.all(selectedIds.map((leadId) => api.delete(`/leads/${leadId}`)))
                  toast.success("Selected leads deleted.")
                  setSelectedIds([])
                  await loadLeads(pagination.page)
                } catch (error) {
                  toast.error(apiErrorMessage(error, "Unable to delete selected leads."))
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
