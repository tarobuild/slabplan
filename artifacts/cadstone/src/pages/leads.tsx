import { useEffect, useRef, useState } from "react"
import {
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Edit2,
  File,
  FileImage,
  FileText,
  FileVideo,
  Loader2,
  Mail,
  MapPin,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react"
import { api } from "@/lib/api"
import { useDocumentTitle } from "@/hooks/use-document-title"
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes"
import { invalidateAppData } from "@/lib/data-refresh"
import { uploadAcceptForMediaType, validateSelectedFiles } from "@/lib/uploads"
import { useFilePreview } from "@/components/files/file-preview-context"
import type { PreviewFile } from "@/components/files/FilePreview"
import { toast } from "sonner"
import { classifyApiError, toastApiError } from "@/lib/api-errors"

type LeadContact = {
  id: string
  displayName: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  cellPhone: string | null
  label: string | null
}

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

type LeadAttachment = {
  id: string
  fileId: string
  originalName: string
  fileUrl: string
  fileSize: number | null
  mimeType: string | null
  createdAt: string
  uploadedByName: string | null
}

type LeadDetail = {
  id: string
  title: string
  status: string
  city: string | null
  state: string | null
  zipCode: string | null
  streetAddress: string | null
  projectType: string | null
  confidence: number | null
  estimatedRevenueMin: string | null
  estimatedRevenueMax: string | null
  projectedSalesDate: string | null
  notes: string | null
  leadSource: string | null
  createdAt: string
  updatedAt: string | null
  createdByName: string | null
  contacts: LeadContact[]
  clientContact: LeadContact | null
  tags: string[]
  sources: string[]
  salespeople: { id: string; fullName: string }[]
  attachments: LeadAttachment[]
}

type Pagination = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

const STATUS_COLORS: Record<string, string> = {
  open: "bg-green-50 text-green-700 border-green-200",
  in_negotiation: "bg-yellow-50 text-yellow-700 border-yellow-200",
  won: "bg-emerald-100 text-emerald-800 border-emerald-300",
  lost: "bg-red-50 text-red-700 border-red-200",
  archived: "bg-slate-50 text-slate-500 border-slate-200",
}

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_negotiation: "In Negotiation",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function fmtCurrency(v: string | null) {
  if (!v) return null
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(v))
}

function fmtFileSize(bytes: number | null): string {
  if (bytes == null) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getAttachmentIcon(mimeType: string | null) {
  if (!mimeType) return <File className="size-4 text-slate-400" />
  if (mimeType.startsWith("image/")) return <FileImage className="size-4 text-blue-400" />
  if (mimeType.startsWith("video/")) return <FileVideo className="size-4 text-purple-400" />
  if (mimeType === "application/pdf") return <FileText className="size-4 text-red-400" />
  if (
    mimeType.includes("word") ||
    mimeType.includes("document") ||
    mimeType.includes("text")
  )
    return <FileText className="size-4 text-blue-500" />
  return <File className="size-4 text-slate-400" />
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

type ContactForm = {
  displayName: string
  email: string
  phone: string
}

type EditForm = CreateForm & {
  streetAddress: string
  zipCode: string
  tags: string
  sources: string
  contactDisplayName: string
  contactEmail: string
  contactPhone: string
}

const emptyCreate: CreateForm = {
  title: "",
  status: "open",
  projectType: "",
  city: "",
  state: "",
  estimatedRevenueMin: "",
  estimatedRevenueMax: "",
  confidence: "",
  projectedSalesDate: "",
  notes: "",
  leadSource: "",
}

const emptyContact: ContactForm = {
  displayName: "",
  email: "",
  phone: "",
}

function buildEditForm(lead: LeadDetail): EditForm {
  return {
    title: lead.title,
    status: lead.status,
    projectType: lead.projectType ?? "",
    streetAddress: lead.streetAddress ?? "",
    city: lead.city ?? "",
    state: lead.state ?? "",
    zipCode: lead.zipCode ?? "",
    estimatedRevenueMin: lead.estimatedRevenueMin ?? "",
    estimatedRevenueMax: lead.estimatedRevenueMax ?? "",
    confidence: lead.confidence != null ? String(lead.confidence) : "",
    projectedSalesDate: lead.projectedSalesDate
      ? lead.projectedSalesDate.slice(0, 10)
      : "",
    notes: lead.notes ?? "",
    leadSource: lead.leadSource ?? "",
    tags: lead.tags.join(", "),
    sources: lead.sources.join(", "),
    contactDisplayName: lead.clientContact?.displayName ?? "",
    contactEmail: lead.clientContact?.email ?? "",
    contactPhone: lead.clientContact?.phone ?? "",
  }
}

function serializeEditForm(form: EditForm | null) {
  return form ? JSON.stringify(form) : ""
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode
  label: string
  value: React.ReactNode
}) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      {icon && <span className="mt-0.5 text-slate-400 shrink-0">{icon}</span>}
      <div className="min-w-0">
        <p className="text-xs text-slate-400 leading-tight">{label}</p>
        <p className="text-sm text-slate-800 font-medium mt-0.5">{value}</p>
      </div>
    </div>
  )
}

export default function LeadsPage() {
  useDocumentTitle("Leads")
  const filePreview = useFilePreview()
  const [leads, setLeads] = useState<Lead[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 1,
  })
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [loading, setLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CreateForm>(emptyCreate)
  const [contactForm, setContactForm] = useState<ContactForm>(emptyContact)
  const [saving, setSaving] = useState(false)
  const [createFiles, setCreateFiles] = useState<File[]>([])
  const [createFileError, setCreateFileError] = useState<string | null>(null)
  const [createdLeadId, setCreatedLeadId] = useState<string | null>(null)
  const [failedUploads, setFailedUploads] = useState<{ name: string; error: string }[]>([])
  const createFilesInputRef = useRef<HTMLInputElement | null>(null)

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [sheetLeadId, setSheetLeadId] = useState<string | null>(null)
  const [leadDetail, setLeadDetail] = useState<LeadDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [savedEditForm, setSavedEditForm] = useState<EditForm | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [confirmDeleteAttachmentId, setConfirmDeleteAttachmentId] = useState<string | null>(null)
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasUnsavedLeadChanges =
    isEditing &&
    !!editForm &&
    !!savedEditForm &&
    serializeEditForm(editForm) !== serializeEditForm(savedEditForm)
  const leadUnsavedChanges = useUnsavedChangesGuard(hasUnsavedLeadChanges && !savingEdit)

  const fetchLeads = (s = search, st = status, p = pagination.page) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), pageSize: "10" })
    if (s) params.set("search", s)
    if (st !== "all") params.set("status", st)
    api
      .get(`/leads?${params}`)
      .then((r) => {
        setLeads(r.data.leads)
        setPagination(r.data.pagination)
      })
      .catch((err: unknown) => toastApiError(err, "Failed to load leads"))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchLeads()
  }, [])

  const handleSearch = (v: string) => {
    setSearch(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchLeads(v, status, 1), 300)
  }

  const handleStatus = (v: string) => {
    setStatus(v)
    fetchLeads(search, v, 1)
  }

  const handlePage = (p: number) => fetchLeads(search, status, p)

  const openSheet = (leadId: string) => {
    setSheetLeadId(leadId)
    setIsEditing(false)
    setLeadDetail(null)
    setEditForm(null)
    setSavedEditForm(null)
    setAttachmentError(null)
    setLoadingDetail(true)
    api
      .get(`/leads/${leadId}`)
      .then((r) => {
        const lead: LeadDetail = r.data.lead
        const nextEditForm = buildEditForm(lead)
        setLeadDetail(lead)
        setEditForm(nextEditForm)
        setSavedEditForm(nextEditForm)
      })
      .catch((err: unknown) => toastApiError(err, "Failed to load lead details"))
      .finally(() => setLoadingDetail(false))
  }

  const handleSaveEdit = async () => {
    if (!sheetLeadId || !editForm || !leadDetail) return
    setSavingEdit(true)
    try {
      const tags = editForm.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
      const sources = editForm.sources
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)

      const { data } = await api.put(`/leads/${sheetLeadId}`, {
        title: editForm.title,
        status: editForm.status,
        projectType: editForm.projectType || null,
        streetAddress: editForm.streetAddress || null,
        city: editForm.city || null,
        state: editForm.state || null,
        zipCode: editForm.zipCode || null,
        estimatedRevenueMin: editForm.estimatedRevenueMin || null,
        estimatedRevenueMax: editForm.estimatedRevenueMax || null,
        confidence: editForm.confidence ? Number(editForm.confidence) : 0,
        projectedSalesDate: editForm.projectedSalesDate || null,
        notes: editForm.notes || null,
        leadSource: editForm.leadSource || null,
        tags,
        sources,
        salespeople: leadDetail.salespeople.map((sp) => sp.id),
      })

      const existingContact = leadDetail.clientContact
      if (existingContact?.id) {
        await api.put(`/leads/${sheetLeadId}/contacts/${existingContact.id}`, {
          displayName: editForm.contactDisplayName || null,
          email: editForm.contactEmail || null,
          phone: editForm.contactPhone || null,
        })
      } else if (editForm.contactDisplayName && editForm.contactEmail) {
        await api.post(`/leads/${sheetLeadId}/contacts`, {
          displayName: editForm.contactDisplayName,
          email: editForm.contactEmail,
          phone: editForm.contactPhone || null,
        })
      }

      const { data: freshData } = await api.get(`/leads/${sheetLeadId}`)
      setLeadDetail(freshData.lead)
      setEditForm(buildEditForm(freshData.lead))
      setSavedEditForm(buildEditForm(freshData.lead))
      setIsEditing(false)
      toast.success("Lead updated")
      fetchLeads()
      invalidateAppData(["leads", "navigation"])
    } catch (err: unknown) {
      toastApiError(err, "Failed to save changes")
    } finally {
      setSavingEdit(false)
    }
  }

  const resetCreateDialogState = () => {
    setForm(emptyCreate)
    setContactForm(emptyContact)
    setCreateFiles([])
    setCreateFileError(null)
    setCreatedLeadId(null)
    setFailedUploads([])
    if (createFilesInputRef.current) createFilesInputRef.current.value = ""
  }

  const handleCreateOpenChange = (open: boolean) => {
    if (saving) return
    if (!open) {
      setCreateOpen(false)
      resetCreateDialogState()
    } else {
      setCreateOpen(true)
    }
  }

  const handleSelectCreateFiles = (fileList: FileList) => {
    const newFiles = Array.from(fileList)
    if (newFiles.length === 0) return
    const combined = [...createFiles, ...newFiles]
    const validationError = validateSelectedFiles(combined, "document")
    if (validationError) {
      setCreateFileError(validationError)
      if (createFilesInputRef.current) createFilesInputRef.current.value = ""
      return
    }
    setCreateFileError(null)
    setCreateFiles(combined)
    if (createFilesInputRef.current) createFilesInputRef.current.value = ""
  }

  const removeCreateFile = (index: number) => {
    const next = createFiles.filter((_, i) => i !== index)
    setCreateFiles(next)
    const validationError = next.length > 0 ? validateSelectedFiles(next, "document") : null
    setCreateFileError(validationError)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (createFileError) return
    setSaving(true)

    let leadId = createdLeadId
    try {
      if (!leadId) {
        const { data } = await api.post("/leads", {
          title: form.title,
          status: form.status,
          projectType: form.projectType || null,
          city: form.city || null,
          state: form.state || null,
          estimatedRevenueMin: form.estimatedRevenueMin || null,
          estimatedRevenueMax: form.estimatedRevenueMax || null,
          confidence: form.confidence ? Number(form.confidence) : 0,
          projectedSalesDate: form.projectedSalesDate || null,
          notes: form.notes || null,
          leadSource: form.leadSource || null,
        })

        leadId = data.lead?.id ?? data.id

        if (!leadId) {
          toast.error("Failed to create lead")
          setSaving(false)
          return
        }

        setCreatedLeadId(leadId)

        if (contactForm.displayName && contactForm.email) {
          try {
            await api.post(`/leads/${leadId}/contacts`, {
              displayName: contactForm.displayName,
              email: contactForm.email,
              phone: contactForm.phone || null,
            })
          } catch (err: unknown) {
            const classified = classifyApiError(err, "Lead created but failed to add contact")
            // 401 (session expired) and 403 (forbidden) are already toasted by
            // the global axios interceptor; stay silent here so we don't
            // double-toast.
            if (classified.kind === "toast") {
              toast.error(`Lead created, but couldn't add the contact: ${classified.message}`)
            }
          }
        }
      }
    } catch (err: unknown) {
      toastApiError(err, "Failed to create lead")
      setSaving(false)
      return
    }

    const successfulIndexes: number[] = []
    const failures: { name: string; error: string }[] = []

    for (let i = 0; i < createFiles.length; i++) {
      const file = createFiles[i]
      try {
        const fd = new FormData()
        fd.append("files", file)
        await api.post(`/leads/${leadId}/attachments`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        })
        successfulIndexes.push(i)
      } catch (err) {
        const classified = classifyApiError(err, "Upload failed")
        // 401 (session expired) and 403 (forbidden) are already toasted
        // (debounced) by the global axios interceptor; skip adding to local
        // failures so we don't duplicate that feedback. The file stays in
        // createFiles (not in successfulIndexes), so the user can retry it.
        if (classified.kind === "toast") {
          failures.push({ name: file.name, error: classified.message })
        }
      }
    }

    const remainingFiles = createFiles.filter((_, i) => !successfulIndexes.includes(i))
    setCreateFiles(remainingFiles)

    fetchLeads()
    invalidateAppData(["leads", "navigation"])

    if (failures.length === 0) {
      toast.success("Lead created")
      setCreateOpen(false)
      resetCreateDialogState()
    } else {
      setFailedUploads(failures)
      toast.error(
        failures.length === 1
          ? `Failed to upload ${failures[0].name}: ${failures[0].error}`
          : `${failures.length} files failed to upload`,
      )
    }

    setSaving(false)
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      await api.delete(`/leads/${deleteId}`)
      toast.success("Lead deleted")
      setDeleteId(null)
      if (sheetLeadId === deleteId) setSheetLeadId(null)
      fetchLeads()
      invalidateAppData(["leads", "navigation"])
    } catch (err: unknown) {
      toastApiError(err, "Failed to delete lead")
    } finally {
      setDeleting(false)
    }
  }

  const handleUploadAttachments = async (fileList: FileList) => {
    if (!sheetLeadId || fileList.length === 0) return
    const selectedFiles = Array.from(fileList)
    const validationError = validateSelectedFiles(selectedFiles, "document")

    if (validationError) {
      setAttachmentError(validationError)
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }

    setAttachmentError(null)
    setUploadingAttachment(true)
    try {
      const formData = new FormData()
      selectedFiles.forEach((file) => formData.append("files", file))
      const { data } = await api.post(`/leads/${sheetLeadId}/attachments`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      const newAttachments: LeadAttachment[] = data.attachments
      toast.success(
        newAttachments.length === 1
          ? "File uploaded"
          : `${newAttachments.length} files uploaded`,
      )
      const { data: freshData } = await api.get(`/leads/${sheetLeadId}`)
      setLeadDetail(freshData.lead)
    } catch (err: unknown) {
      toastApiError(err, "Failed to upload file(s)")
    } finally {
      setUploadingAttachment(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleDeleteAttachment = async () => {
    if (!sheetLeadId || !confirmDeleteAttachmentId) return
    setDeletingAttachmentId(confirmDeleteAttachmentId)
    setConfirmDeleteAttachmentId(null)
    try {
      await api.delete(`/leads/${sheetLeadId}/attachments/${confirmDeleteAttachmentId}`)
      setLeadDetail((prev) =>
        prev
          ? {
              ...prev,
              attachments: prev.attachments.filter(
                (a) => a.id !== confirmDeleteAttachmentId,
              ),
            }
          : prev,
      )
      toast.success("Attachment deleted")
    } catch (err: unknown) {
      toastApiError(err, "Failed to delete attachment")
    } finally {
      setDeletingAttachmentId(null)
    }
  }

  const setField =
    (k: keyof CreateForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  const setEditField =
    (k: keyof EditForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setEditForm((f) => (f ? { ...f, [k]: e.target.value } : f))

  const closeLeadEditor = () => {
    leadUnsavedChanges.confirmDiscardChanges(() => {
      setIsEditing(false)
      if (leadDetail) {
        const nextEditForm = buildEditForm(leadDetail)
        setEditForm(nextEditForm)
        setSavedEditForm(nextEditForm)
      }
    })
  }

  const handleSheetOpenChange = (open: boolean) => {
    if (open) {
      return
    }

    leadUnsavedChanges.confirmDiscardChanges(() => {
      setSheetLeadId(null)
      setIsEditing(false)
      setAttachmentError(null)
    })
  }

  const revenue = (lead: Lead) => {
    const min = fmtCurrency(lead.estimatedRevenueMin)
    const max = fmtCurrency(lead.estimatedRevenueMax)
    if (min && max && min !== max) return `${min} – ${max}`
    return min ?? max ?? "—"
  }

  return (
    <div className="space-y-4">
      {leadUnsavedChanges.dialog}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Sales Leads</h1>
        <Button
          size="sm"
          onClick={() => {
            resetCreateDialogState()
            setCreateOpen(true)
          }}
        >
          <Plus className="mr-1.5 size-3.5" />
          New Lead
        </Button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search leads…"
            className="pl-8 h-9"
          />
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

      {/* Desktop table */}
      <div className="hidden md:block rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
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
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-sm text-slate-400">
                  No leads found.{" "}
                  <button
                    onClick={() => {
                      resetCreateDialogState()
                      setCreateOpen(true)
                    }}
                    className="text-orange-600 hover:underline"
                  >
                    Create your first lead
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              leads.map((lead) => (
                <TableRow
                  key={lead.id}
                  className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => openSheet(lead.id)}
                >
                  <TableCell className="font-medium text-slate-900">{lead.title}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs ${STATUS_COLORS[lead.status] ?? ""}`}
                    >
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
                    {revenue(lead)}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {fmtDate(lead.createdAt)}
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteId(lead.id)
                      }}
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

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-[#E5E7EB] bg-white p-4 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))
        ) : leads.length === 0 ? (
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-8 text-center text-sm text-slate-400">
            No leads found.
          </div>
        ) : (
          leads.map(lead => (
            <div
              key={lead.id}
              className="rounded-lg border border-[#E5E7EB] bg-white p-4 cursor-pointer active:bg-slate-50"
              onClick={() => openSheet(lead.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{lead.title}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[lead.status] ?? ""}`}>
                      {STATUS_LABELS[lead.status] ?? lead.status}
                    </Badge>
                    {lead.projectType && <span className="text-xs capitalize text-slate-500">{lead.projectType}</span>}
                  </div>
                  <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                    {(lead.city || lead.state) && (
                      <p>{[lead.city, lead.state].filter(Boolean).join(", ")}</p>
                    )}
                    {lead.clientContact?.displayName && <p>{lead.clientContact.displayName}</p>}
                    {(lead.estimatedRevenueMin || lead.estimatedRevenueMax) && (
                      <p className="font-medium text-slate-700">{revenue(lead)}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setDeleteId(lead.id) }}
                  className="shrink-0 p-1 text-slate-400 transition-colors hover:text-red-500"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {!loading && pagination.totalItems > pagination.pageSize && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            Showing {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.totalItems)} of{" "}
            {pagination.totalItems}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePage(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              <ChevronLeft className="size-3.5 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePage(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              Next
              <ChevronRight className="size-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Create Lead Dialog */}
      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Lead Opportunity</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="lead-title">Title *</Label>
                <Input
                  id="lead-title"
                  value={form.title}
                  onChange={setField("title")}
                  required
                  placeholder="e.g. Smith Residence Countertops"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
                <Input
                  id="lead-projectType"
                  value={form.projectType}
                  onChange={setField("projectType")}
                  placeholder="e.g. countertops"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-city">City</Label>
                <Input
                  id="lead-city"
                  value={form.city}
                  onChange={setField("city")}
                  placeholder="Austin"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-state">State</Label>
                <Input
                  id="lead-state"
                  value={form.state}
                  onChange={setField("state")}
                  placeholder="TX"
                  maxLength={2}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-revMin">Revenue Min ($)</Label>
                <Input
                  id="lead-revMin"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.estimatedRevenueMin}
                  onChange={setField("estimatedRevenueMin")}
                  placeholder="0"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-revMax">Revenue Max ($)</Label>
                <Input
                  id="lead-revMax"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.estimatedRevenueMax}
                  onChange={setField("estimatedRevenueMax")}
                  placeholder="0"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-confidence">Confidence (0–100)</Label>
                <Input
                  id="lead-confidence"
                  type="number"
                  min="0"
                  max="100"
                  value={form.confidence}
                  onChange={setField("confidence")}
                  placeholder="50"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-salesDate">Projected Sales Date</Label>
                <Input
                  id="lead-salesDate"
                  type="date"
                  value={form.projectedSalesDate}
                  onChange={setField("projectedSalesDate")}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-source">Lead Source</Label>
                <Input
                  id="lead-source"
                  value={form.leadSource}
                  onChange={setField("leadSource")}
                  placeholder="Referral, Web, etc."
                />
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="lead-notes">Notes</Label>
                <Textarea
                  id="lead-notes"
                  value={form.notes}
                  onChange={setField("notes")}
                  placeholder="Additional details…"
                  rows={2}
                />
              </div>

              {/* Contact section */}
              <div className="col-span-2 pt-2">
                <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
                  <User className="size-3.5" />
                  Primary Contact <span className="font-normal text-slate-400">(optional)</span>
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-name">Display Name</Label>
                    <Input
                      id="contact-name"
                      value={contactForm.displayName}
                      onChange={(e) =>
                        setContactForm((c) => ({ ...c, displayName: e.target.value }))
                      }
                      placeholder="Jane Smith"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-email">Email</Label>
                    <Input
                      id="contact-email"
                      type="email"
                      value={contactForm.email}
                      onChange={(e) =>
                        setContactForm((c) => ({ ...c, email: e.target.value }))
                      }
                      placeholder="jane@example.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-phone">Phone</Label>
                    <Input
                      id="contact-phone"
                      type="tel"
                      value={contactForm.phone}
                      onChange={(e) =>
                        setContactForm((c) => ({ ...c, phone: e.target.value }))
                      }
                      placeholder="(555) 000-0000"
                    />
                  </div>
                </div>
                {contactForm.displayName && !contactForm.email && (
                  <p className="text-xs text-amber-600 mt-2">
                    Email is required when adding a contact.
                  </p>
                )}
              </div>

              {/* Attachments section */}
              <div className="col-span-2 pt-2">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                    <Paperclip className="size-3.5" />
                    Attachments
                    {createFiles.length > 0 && (
                      <span className="text-slate-400 font-normal text-xs">
                        ({createFiles.length})
                      </span>
                    )}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs px-2.5 gap-1.5"
                    disabled={saving}
                    onClick={() => createFilesInputRef.current?.click()}
                  >
                    <Upload className="size-3" />
                    Add files
                  </Button>
                  <input
                    ref={createFilesInputRef}
                    type="file"
                    multiple
                    accept={uploadAcceptForMediaType("document")}
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleSelectCreateFiles(e.target.files)
                      }
                    }}
                  />
                </div>

                {createFileError && (
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {createFileError}
                  </div>
                )}

                {createdLeadId && failedUploads.length > 0 && (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <p className="font-medium">
                      Lead saved, but {failedUploads.length === 1
                        ? "1 file failed to upload"
                        : `${failedUploads.length} files failed to upload`}:
                    </p>
                    <ul className="mt-1 list-disc list-inside space-y-0.5">
                      {failedUploads.map((f, i) => (
                        <li
                          key={`${f.name}-${i}`}
                          className="truncate"
                          title={`${f.name}: ${f.error}`}
                        >
                          {f.name} — {f.error}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-amber-700">
                      Retry the failed files or dismiss to finish.
                    </p>
                  </div>
                )}

                {createFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center border border-dashed border-slate-200 rounded-lg">
                    <Paperclip className="size-6 text-slate-300 mb-2" />
                    <p className="text-sm text-slate-400">No files selected</p>
                    <button
                      type="button"
                      onClick={() => !saving && createFilesInputRef.current?.click()}
                      disabled={saving}
                      className="mt-1 text-xs text-orange-600 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Choose files to attach
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {createFiles.map((file, index) => (
                      <div
                        key={`${file.name}-${index}`}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-slate-200 bg-slate-50/60"
                      >
                        <span className="shrink-0">
                          {getAttachmentIcon(file.type || null)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-sm text-slate-800 font-medium truncate"
                            title={file.name}
                          >
                            {file.name}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {fmtFileSize(file.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 text-slate-400 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
                          disabled={saving}
                          onClick={() => removeCreateFile(index)}
                          aria-label={`Remove ${file.name}`}
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => handleCreateOpenChange(false)}
              >
                {createdLeadId ? "Done" : "Cancel"}
              </Button>
              <Button
                type="submit"
                disabled={saving || !!createFileError || (createdLeadId !== null && createFiles.length === 0)}
              >
                {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                {createdLeadId
                  ? "Retry Failed Uploads"
                  : createFiles.length > 0
                    ? `Create Lead & Upload ${createFiles.length} File${createFiles.length === 1 ? "" : "s"}`
                    : "Create Lead"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this lead. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lead Detail Sheet */}
      <Sheet
        open={!!sheetLeadId}
        onOpenChange={handleSheetOpenChange}
      >
        <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0 gap-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB]">
            <SheetHeader className="space-y-0 text-left">
              <SheetTitle className="text-base font-semibold text-slate-900">
                {leadDetail?.title ?? "Lead Details"}
              </SheetTitle>
              {leadDetail && (
                <Badge
                  variant="outline"
                  className={`w-fit text-xs mt-1 ${STATUS_COLORS[leadDetail.status] ?? ""}`}
                >
                  {STATUS_LABELS[leadDetail.status] ?? leadDetail.status}
                </Badge>
              )}
            </SheetHeader>
            <div className="flex items-center gap-2">
              {!isEditing && leadDetail && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditing(true)}
                >
                  <Pencil className="mr-1.5 size-3.5" />
                  Edit
                </Button>
              )}
              {isEditing && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={closeLeadEditor}
                  >
                    <X className="mr-1.5 size-3.5" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveEdit} disabled={savingEdit}>
                    {savingEdit && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                    Save
                  </Button>
                  {leadUnsavedChanges.isDirty ? (
                    <span className="text-xs font-medium text-amber-700">Unsaved changes</span>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {loadingDetail ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : leadDetail && editForm ? (
              <>
                {isEditing ? (
                  <div className="space-y-5">
                    <div className="space-y-1.5">
                      <Label>Title *</Label>
                      <Input
                        value={editForm.title}
                        onChange={setEditField("title")}
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Status</Label>
                        <Select
                          value={editForm.status}
                          onValueChange={(v) =>
                            setEditForm((f) => (f ? { ...f, status: v } : f))
                          }
                        >
                          <SelectTrigger>
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

                      <div className="space-y-1.5">
                        <Label>Project Type</Label>
                        <Input
                          value={editForm.projectType}
                          onChange={setEditField("projectType")}
                          placeholder="e.g. countertops"
                        />
                      </div>

                      <div className="col-span-2 space-y-1.5">
                        <Label>Street Address</Label>
                        <Input
                          value={editForm.streetAddress}
                          onChange={setEditField("streetAddress")}
                          placeholder="123 Main St"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>City</Label>
                        <Input
                          value={editForm.city}
                          onChange={setEditField("city")}
                          placeholder="Austin"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label>State</Label>
                          <Input
                            value={editForm.state}
                            onChange={setEditField("state")}
                            placeholder="TX"
                            maxLength={2}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Zip Code</Label>
                          <Input
                            value={editForm.zipCode}
                            onChange={setEditField("zipCode")}
                            placeholder="78701"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Revenue Min ($)</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editForm.estimatedRevenueMin}
                          onChange={setEditField("estimatedRevenueMin")}
                          placeholder="0"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Revenue Max ($)</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editForm.estimatedRevenueMax}
                          onChange={setEditField("estimatedRevenueMax")}
                          placeholder="0"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Confidence (0–100)</Label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={editForm.confidence}
                          onChange={setEditField("confidence")}
                          placeholder="50"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Projected Sales Date</Label>
                        <Input
                          type="date"
                          value={editForm.projectedSalesDate}
                          onChange={setEditField("projectedSalesDate")}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Lead Source</Label>
                        <Input
                          value={editForm.leadSource}
                          onChange={setEditField("leadSource")}
                          placeholder="Referral, Web, etc."
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Tags (comma-separated)</Label>
                        <Input
                          value={editForm.tags}
                          onChange={setEditField("tags")}
                          placeholder="roofing, residential"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Sources (comma-separated)</Label>
                        <Input
                          value={editForm.sources}
                          onChange={setEditField("sources")}
                          placeholder="referral, web"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Notes</Label>
                      <Textarea
                        value={editForm.notes}
                        onChange={setEditField("notes")}
                        placeholder="Additional details…"
                        rows={3}
                      />
                    </div>

                    <Separator />

                    <div>
                      <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
                        <User className="size-3.5" />
                        Primary Contact
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label>Display Name</Label>
                          <Input
                            value={editForm.contactDisplayName}
                            onChange={setEditField("contactDisplayName")}
                            placeholder="Jane Smith"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Email</Label>
                          <Input
                            type="email"
                            value={editForm.contactEmail}
                            onChange={setEditField("contactEmail")}
                            placeholder="jane@example.com"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Phone</Label>
                          <Input
                            type="tel"
                            value={editForm.contactPhone}
                            onChange={setEditField("contactPhone")}
                            placeholder="(555) 000-0000"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-0">
                      <DetailRow
                        icon={<Building2 className="size-4" />}
                        label="Project Type"
                        value={leadDetail.projectType}
                      />
                      <DetailRow
                        icon={<MapPin className="size-4" />}
                        label="Address"
                        value={
                          [
                            leadDetail.streetAddress,
                            [leadDetail.city, leadDetail.state].filter(Boolean).join(", "),
                            leadDetail.zipCode,
                          ]
                            .filter(Boolean)
                            .join(", ") || null
                        }
                      />
                      <DetailRow
                        label="Confidence"
                        value={
                          leadDetail.confidence != null
                            ? `${leadDetail.confidence}%`
                            : null
                        }
                      />
                      <DetailRow
                        icon={<Calendar className="size-4" />}
                        label="Projected Sales Date"
                        value={
                          leadDetail.projectedSalesDate
                            ? fmtDate(leadDetail.projectedSalesDate)
                            : null
                        }
                      />
                      <DetailRow
                        label="Revenue Estimate"
                        value={(() => {
                          const min = fmtCurrency(leadDetail.estimatedRevenueMin)
                          const max = fmtCurrency(leadDetail.estimatedRevenueMax)
                          if (min && max && min !== max) return `${min} – ${max}`
                          return min ?? max ?? null
                        })()}
                      />
                      <DetailRow
                        label="Lead Source"
                        value={leadDetail.leadSource}
                      />
                      <DetailRow
                        label="Created By"
                        value={leadDetail.createdByName}
                      />
                      <DetailRow
                        label="Created"
                        value={fmtDate(leadDetail.createdAt)}
                      />
                    </div>

                    {leadDetail.notes && (
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Notes</p>
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">
                          {leadDetail.notes}
                        </p>
                      </div>
                    )}

                    {leadDetail.tags.length > 0 && (
                      <div>
                        <p className="text-xs text-slate-400 mb-2 flex items-center gap-1">
                          <Tag className="size-3" />
                          Tags
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {leadDetail.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <Separator />

                    <div>
                      <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
                        <User className="size-3.5" />
                        Primary Contact
                      </p>
                      {leadDetail.clientContact ? (
                        <div className="space-y-1.5">
                          <p className="text-sm font-medium text-slate-800">
                            {leadDetail.clientContact.displayName ?? "Unnamed Contact"}
                          </p>
                          {leadDetail.clientContact.email && (
                            <a
                              href={`mailto:${leadDetail.clientContact.email}`}
                              className="flex items-center gap-1.5 text-sm text-orange-600 hover:underline"
                            >
                              <Mail className="size-3.5 text-slate-400" />
                              {leadDetail.clientContact.email}
                            </a>
                          )}
                          {leadDetail.clientContact.phone && (
                            <a
                              href={`tel:${leadDetail.clientContact.phone}`}
                              className="flex items-center gap-1.5 text-sm text-slate-700"
                            >
                              <Phone className="size-3.5 text-slate-400" />
                              {leadDetail.clientContact.phone}
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-slate-400">
                          <p>No contact added yet.</p>
                          <button
                            onClick={() => setIsEditing(true)}
                            className="text-orange-600 hover:underline text-sm flex items-center gap-1"
                          >
                            <Edit2 className="size-3" />
                            Add contact
                          </button>
                        </div>
                      )}
                    </div>

                    {leadDetail.contacts.length > 1 && (
                      <div>
                        <p className="text-xs text-slate-400 mb-2">
                          Other Contacts ({leadDetail.contacts.length - 1})
                        </p>
                        <div className="space-y-2">
                          {leadDetail.contacts.slice(1).map((c) => (
                            <div key={c.id} className="text-sm text-slate-600">
                              {c.displayName}
                              {c.email && ` · ${c.email}`}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <Separator />

                    {/* Attachments */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                          <Paperclip className="size-3.5" />
                          Attachments
                          {leadDetail.attachments.length > 0 && (
                            <span className="text-slate-400 font-normal text-xs">
                              ({leadDetail.attachments.length})
                            </span>
                          )}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs px-2.5 gap-1.5"
                          disabled={uploadingAttachment}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {uploadingAttachment ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Upload className="size-3" />
                          )}
                          Upload files
                        </Button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept={uploadAcceptForMediaType("document")}
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                              handleUploadAttachments(e.target.files)
                            }
                          }}
                        />
                      </div>
                      {attachmentError ? (
                        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                          {attachmentError}
                        </div>
                      ) : null}

                      {leadDetail.attachments.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-slate-200 rounded-lg">
                          <Paperclip className="size-7 text-slate-300 mb-2" />
                          <p className="text-sm text-slate-400">No attachments yet</p>
                          <button
                            onClick={() => !uploadingAttachment && fileInputRef.current?.click()}
                            disabled={uploadingAttachment}
                            className="mt-1 text-xs text-orange-600 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Upload a file
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {leadDetail.attachments.map((att, attIdx) => {
                            const previewFiles: PreviewFile[] = leadDetail.attachments.map((a) => ({
                              id: a.id,
                              fileId: a.fileId,
                              name: a.originalName,
                              mimeType: a.mimeType,
                              fileSize: a.fileSize,
                              uploadedByName: a.uploadedByName,
                              createdAt: a.createdAt,
                            }))
                            return (
                            <div
                              key={att.id}
                              className="flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-slate-50 group"
                            >
                              <span className="shrink-0">
                                {getAttachmentIcon(att.mimeType)}
                              </span>
                              <div className="flex-1 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => filePreview.open(previewFiles, attIdx)}
                                  className="text-sm text-slate-800 font-medium truncate block hover:text-orange-600 hover:underline text-left w-full"
                                  title={att.originalName}
                                >
                                  {att.originalName}
                                </button>
                                <p className="text-xs text-slate-400 mt-0.5">
                                  {[
                                    fmtFileSize(att.fileSize),
                                    fmtDate(att.createdAt),
                                    att.uploadedByName,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </p>
                              </div>
                              <button
                                className="shrink-0 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity"
                                disabled={deletingAttachmentId === att.id}
                                onClick={() => setConfirmDeleteAttachmentId(att.id)}
                                aria-label="Delete attachment"
                              >
                                {deletingAttachmentId === att.id ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <Trash2 className="size-4" />
                                )}
                              </button>
                            </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {/* Attachment Delete Confirmation */}
      <AlertDialog
        open={!!confirmDeleteAttachmentId}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteAttachmentId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Attachment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the file. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAttachment}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
