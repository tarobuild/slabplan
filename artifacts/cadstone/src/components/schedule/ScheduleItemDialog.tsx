import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDropzone } from "react-dropzone"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Copy,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  MoreHorizontal,
  Plus,
  Send,
  Trash2,
  Upload,
} from "lucide-react"
import { api } from "@/lib/api"
import { toastApiError } from "@/lib/api-errors"
import { useAuthStore } from "@/store/auth"
import {
  calculateBusinessEndDate,
  calculateWorkDaysBetween,
  cleanTags,
  dateKey,
  DEFAULT_SCHEDULE_COLOR,
  fmtDateTime,
  getInitials,
  SCHEDULE_COLOR_OPTIONS,
  SCHEDULE_PREDECESSOR_TYPES,
  SCHEDULE_REMINDER_OPTIONS,
  type ScheduleItemPayload,
  type ScheduleItemRecord,
  type ScheduleNote,
  type SchedulePredecessor,
  type ScheduleSettings,
  type ScheduleTodo,
  type ScheduleWorkdayException,
} from "@/lib/schedule"
import { uploadAcceptForMediaType, validateSelectedFiles } from "@/lib/uploads"
import { useFilePreview } from "@/components/files/file-preview-context"
import type { PreviewFile } from "@/components/files/FilePreview"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { completionStateForProgress } from "./schedule-progress"

type UserOption = {
  id: string
  fullName: string
  email: string
  role: string
  avatarUrl: string | null
}

type ScheduleFormValues = {
  title: string
  displayColor: string
  assigneeIds: string[]
  startDate: string
  workDays: number
  endDate: string
  isHourly: boolean
  startTime: string
  endTime: string
  progress: number
  reminder: string
  phaseId: string | null
  tagsInput: string
  predecessors: Array<{
    scheduleItemId: string
    dependencyType: SchedulePredecessor["dependencyType"]
    lagDays: number
  }>
  showOnGantt: boolean
  visibleToEstimators: boolean
  visibleToInstallers: boolean
  visibleToOfficeStaff: boolean
  isComplete: boolean
}

const UNASSIGNED_PHASE = "__unassigned__"

export type SchedulePreview = {
  startDate: string
  endDate: string
  isHourly: boolean
  startTime: string | null
  endTime: string | null
  displayColor: string
  title: string
}

type ScheduleItemDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string
  itemId: string | null
  initialStartDate?: string | null
  initialStartTime?: string | null
  initialEndTime?: string | null
  initialTitle?: string | null
  initialAssigneeIds?: string[] | null
  initialIsHourly?: boolean | null
  items: ScheduleItemRecord[]
  users: UserOption[]
  settings: ScheduleSettings
  workdayExceptions: ScheduleWorkdayException[]
  refreshSettings: () => Promise<void>
  onRefresh: () => Promise<void>
  draftMode?: boolean
  readOnly?: boolean
  onDraftSave?: (params: {
    itemId: string | null
    payload: ScheduleItemPayload
    note: string | null
  }) => Promise<ScheduleItemRecord>
  onDraftAddNote?: (itemId: string, note: string) => Promise<ScheduleItemRecord>
  onDraftDelete?: (itemId: string) => Promise<void>
  onPreviewChange?: (preview: SchedulePreview | null) => void
}

function defaultForm(startDate: string, workdayExceptions: ScheduleWorkdayException[] = []): ScheduleFormValues {
  return {
    title: "",
    displayColor: DEFAULT_SCHEDULE_COLOR,
    assigneeIds: [],
    startDate,
    workDays: 1,
    endDate: calculateBusinessEndDate(startDate, 1, workdayExceptions),
    isHourly: true,
    startTime: "08:00",
    endTime: "17:00",
    progress: 0,
    reminder: "none",
    phaseId: null,
    tagsInput: "",
    predecessors: [],
    showOnGantt: true,
    visibleToEstimators: true,
    visibleToInstallers: true,
    visibleToOfficeStaff: true,
    isComplete: false,
  }
}

function formFromItem(item: ScheduleItemRecord): ScheduleFormValues {
  return {
    title: item.title,
    displayColor: item.displayColor || DEFAULT_SCHEDULE_COLOR,
    assigneeIds: item.assigneeIds,
    startDate: item.startDate,
    workDays: item.workDays,
    endDate: item.endDate,
    isHourly: !!item.isHourly,
    startTime: item.startTime?.slice(0, 5) || "08:00",
    endTime: item.endTime?.slice(0, 5) || "17:00",
    progress: item.progress ?? 0,
    reminder: item.reminder || "none",
    phaseId: item.phaseId,
    tagsInput: item.tags.join(", "),
    predecessors: item.predecessors.map((predecessor) => ({
      scheduleItemId: predecessor.scheduleItemId,
      dependencyType: predecessor.dependencyType,
      lagDays: predecessor.lagDays,
    })),
    showOnGantt: item.showOnGantt ?? true,
    visibleToEstimators: item.visibleToEstimators ?? true,
    visibleToInstallers: item.visibleToInstallers ?? true,
    visibleToOfficeStaff: item.visibleToOfficeStaff ?? true,
    isComplete: item.isComplete ?? false,
  }
}

function hasManualEndDate(
  item: ScheduleItemRecord,
  workdayExceptions: ScheduleWorkdayException[],
): boolean {
  if (item.manualEndDate) return true
  return item.endDate !== calculateBusinessEndDate(item.startDate, item.workDays, workdayExceptions)
}

function attachmentIcon(icon: string) {
  if (icon === "pdf" || icon === "doc") {
    return FileText
  }

  if (icon === "sheet") {
    return FileSpreadsheet
  }

  if (icon === "image") {
    return FileImage
  }

  return File
}

export function ScheduleItemDialog({
  open,
  onOpenChange,
  jobId,
  itemId,
  initialStartDate,
  initialStartTime,
  initialEndTime,
  initialTitle,
  initialAssigneeIds,
  initialIsHourly,
  items,
  users,
  settings,
  workdayExceptions,
  refreshSettings,
  onRefresh,
  draftMode = false,
  readOnly = false,
  onDraftSave,
  onDraftAddNote,
  onDraftDelete,
  onPreviewChange,
}: ScheduleItemDialogProps) {
  const today = dateKey(new Date())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const filePreview = useFilePreview()

  const currentUser = useAuthStore((s) => s.user)
  const isCrewMember = currentUser?.role === "crew_member"

  const [topTab, setTopTab] = useState("details")
  const [subTab, setSubTab] = useState("predecessors")
  const [item, setItem] = useState<ScheduleItemRecord | null>(null)
  const [values, setValues] = useState<ScheduleFormValues>(defaultForm(today, workdayExceptions))
  const [assigneeQuery, setAssigneeQuery] = useState("")
  const [notifyAssignees, setNotifyAssignees] = useState(false)
  const [noteDraft, setNoteDraft] = useState("")
  const [loadingItem, setLoadingItem] = useState(false)
  const [saving, setSaving] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [manualEndDate, setManualEndDate] = useState(false)
  const [addingPhase, setAddingPhase] = useState("")
  const [editingPhases, setEditingPhases] = useState<Record<string, string>>({})
  const [showAddPhase, setShowAddPhase] = useState(false)
  const [showEditPhases, setShowEditPhases] = useState(false)
  const [addingTag, setAddingTag] = useState("")
  const [editingTags, setEditingTags] = useState<Record<string, string>>({})
  const [showAddTag, setShowAddTag] = useState(false)
  const [showEditTags, setShowEditTags] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [pendingDeleteAttachmentId, setPendingDeleteAttachmentId] = useState<string | null>(null)
  const [multiDay, setMultiDay] = useState(false)
  const [createDocConfirmOpen, setCreateDocConfirmOpen] = useState(false)
  const [docPreviewOpen, setDocPreviewOpen] = useState(false)
  const [docPreviewLoading, setDocPreviewLoading] = useState(false)
  const [docPreviewBody, setDocPreviewBody] = useState("")
  const [docPreviewTitle, setDocPreviewTitle] = useState("")
  const loadItemSeqRef = useRef(0)

  useEffect(() => {
    if (!open) {
      setAttachmentError(null)
    }
  }, [open])

  // Sync multiDay toggle with loaded item or form values
  useEffect(() => {
    if (item) {
      setMultiDay(item.workDays > 1)
    } else {
      setMultiDay(false)
    }
  }, [item])

  async function loadItem(nextItemId: string) {
    const requestSeq = ++loadItemSeqRef.current
    setLoadingItem(true)

    try {
      if (draftMode) {
        const draftItem = items.find((candidate) => candidate.id === nextItemId)

        if (!draftItem) {
          throw new Error("Draft schedule item not found")
        }

	        if (requestSeq === loadItemSeqRef.current) {
	          setItem(draftItem)
	          setValues(formFromItem(draftItem))
	          setNoteDraft("")
	          setNotifyAssignees(false)
	          setManualEndDate(hasManualEndDate(draftItem, workdayExceptions))
	        }
        return
      }

      const response = await api.get<{ item: ScheduleItemRecord }>(`/schedule-items/${nextItemId}`)
      if (requestSeq !== loadItemSeqRef.current) return
      setItem(response.data.item)
	      setValues(formFromItem(response.data.item))
	      setNoteDraft("")
	      setNotifyAssignees(false)
	      setManualEndDate(hasManualEndDate(response.data.item, workdayExceptions))
    } catch (err) {
      if (requestSeq === loadItemSeqRef.current) {
        toastApiError(err, "Failed to load schedule item")
      }
    } finally {
      if (requestSeq === loadItemSeqRef.current) {
        setLoadingItem(false)
      }
    }
  }

  function resetForNewItem() {
    loadItemSeqRef.current += 1
    setItem(null)
    const form = defaultForm(initialStartDate || today, workdayExceptions)
    if (initialStartTime) {
      form.isHourly = true
      form.startTime = initialStartTime
      form.endTime = initialEndTime || "17:00"
    } else if (initialIsHourly === false) {
      form.isHourly = false
    }
    if (initialTitle) {
      form.title = initialTitle
    }
    if (initialAssigneeIds && initialAssigneeIds.length > 0) {
      form.assigneeIds = [...initialAssigneeIds]
    }
    setValues(form)
    setAssigneeQuery("")
    setNotifyAssignees(false)
    setNoteDraft("")
    setManualEndDate(false)
    setTopTab("details")
    setSubTab("predecessors")
  }

  useEffect(() => {
    if (!open) {
      loadItemSeqRef.current += 1
      return
    }

    setTopTab("details")
    setSubTab("predecessors")
    setShowAddPhase(false)
    setShowEditPhases(false)
    setShowAddTag(false)
    setShowEditTags(false)
    setAddingPhase("")
    setAddingTag("")
    if (itemId) {
      void loadItem(itemId)
      return
    }

    resetForNewItem()
  }, [itemId, open, today, initialStartDate, initialStartTime, initialEndTime, initialTitle, initialAssigneeIds, initialIsHourly, workdayExceptions])

  useEffect(() => {
    if (!open) {
      return
    }

    setEditingPhases((current) =>
      Object.fromEntries(
        settings.phases.map((phase) => [phase.id, current[phase.id] ?? phase.name]),
      ),
    )
  }, [open, settings.phases])

  useEffect(() => {
    if (!open) {
      return
    }

    setEditingTags((current) =>
      Object.fromEntries(settings.tags.map((tag) => [tag.id, current[tag.id] ?? tag.name])),
    )
  }, [open, settings.tags])

  useEffect(() => {
    if (!open || !draftMode || !itemId) {
      return
    }

    const draftItem = items.find((candidate) => candidate.id === itemId)

    if (!draftItem) {
      onOpenChange(false)
      return
    }

    setItem(draftItem)
    setValues(formFromItem(draftItem))
  }, [draftMode, itemId, items, onOpenChange, open])

  useEffect(() => {
    if (!onPreviewChange) {
      return
    }

    if (!open || itemId) {
      onPreviewChange(null)
      return
    }

    onPreviewChange({
      startDate: values.startDate,
      endDate: values.endDate || values.startDate,
      isHourly: values.isHourly,
      startTime: values.isHourly ? values.startTime : null,
      endTime: values.isHourly ? values.endTime : null,
      displayColor: values.displayColor || DEFAULT_SCHEDULE_COLOR,
      title: values.title.trim() || "New schedule item",
    })
  }, [
    onPreviewChange,
    open,
    itemId,
    values.startDate,
    values.endDate,
    values.isHourly,
    values.startTime,
    values.endTime,
    values.displayColor,
    values.title,
  ])

  useEffect(() => {
    return () => {
      onPreviewChange?.(null)
    }
  }, [onPreviewChange])

  useEffect(() => {
    if (!open) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        if (!saving && !loadingItem) {
          void handleSave("stay")
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [loadingItem, open, saving, values, item, noteDraft, notifyAssignees])

  const availablePredecessors = useMemo(
    () => items.filter((candidate) => candidate.id !== item?.id),
    [item?.id, items],
  )

  const selectedAssignees = useMemo(
    () =>
      users
        .filter((user) => values.assigneeIds.includes(user.id))
        .sort((left, right) => left.fullName.localeCompare(right.fullName)),
    [users, values.assigneeIds],
  )

  const assigneeMatches = useMemo(() => {
    const query = assigneeQuery.trim().toLowerCase()

    return users
      .filter((user) => !values.assigneeIds.includes(user.id))
      .filter((user) => {
        if (!query) {
          return true
        }

        return (
          user.fullName.toLowerCase().includes(query) ||
          user.email.toLowerCase().includes(query)
        )
      })
      .slice(0, 8)
  }, [assigneeQuery, users, values.assigneeIds])

  const notesLabel =
    item && item.noteCount > 0 ? `Notes (${item.noteCount} new)` : "Notes"

  const relatedCount = item?.relatedTodoCount ?? 0

  function updateValues(updater: (current: ScheduleFormValues) => ScheduleFormValues) {
    setValues((current) => updater(current))
  }

  function addAssignee(userId: string) {
    updateValues((current) => ({
      ...current,
      assigneeIds: current.assigneeIds.includes(userId)
        ? current.assigneeIds
        : [...current.assigneeIds, userId],
    }))
    setAssigneeQuery("")
  }

  function removeAssignee(userId: string) {
    updateValues((current) => ({
      ...current,
      assigneeIds: current.assigneeIds.filter((candidate) => candidate !== userId),
    }))
  }

  function buildPayload(): ScheduleItemPayload {
    return {
      title: values.title.trim(),
      displayColor: values.displayColor,
      assigneeIds: values.assigneeIds,
      startDate: values.startDate,
      workDays: values.workDays,
      endDate: manualEndDate && values.endDate ? values.endDate : null,
      isHourly: values.isHourly,
      startTime: values.isHourly ? values.startTime : null,
      endTime: values.isHourly ? values.endTime : null,
      progress: values.progress,
      reminder: values.reminder,
      notes: item?.notes ?? null,
      notifyUserIds: notifyAssignees ? values.assigneeIds : [],
      tags: cleanTags(values.tagsInput),
      predecessors: values.predecessors.filter((predecessor) => predecessor.scheduleItemId),
      phaseId: values.phaseId,
      showOnGantt: values.showOnGantt,
      visibleToEstimators: values.visibleToEstimators,
      visibleToInstallers: values.visibleToInstallers,
      visibleToOfficeStaff: values.visibleToOfficeStaff,
      isComplete: values.isComplete,
    }
  }

  async function handleSave(mode: "stay" | "close" | "new") {
    if (readOnly) {
      return null
    }
    if (!values.title.trim()) {
      toast.error("Title is required")
      return null
    }

    setSaving(true)

    try {
      const payload = buildPayload()
      const pendingNote = noteDraft.trim() || null
      let savedItem: ScheduleItemRecord

      if (draftMode) {
        if (!onDraftSave) {
          throw new Error("Draft save handler is not configured.")
        }

        savedItem = await onDraftSave({
          itemId: item?.id ?? null,
          payload,
          note: pendingNote,
        })
      } else {
        savedItem = (
          item
            ? await api.put<{ item: ScheduleItemRecord }>(`/schedule-items/${item.id}`, payload)
            : await api.post<{ item: ScheduleItemRecord }>(`/jobs/${jobId}/schedule`, payload)
        ).data.item
      }

      if (!draftMode && pendingNote) {
        await api.post(`/schedule-items/${savedItem.id}/notes`, {
          note: pendingNote,
        })
      }

      if (notifyAssignees && draftMode && values.assigneeIds.length > 0) {
        toast.info("Assigned-user notifications will be available after publish")
      }

      if (!draftMode) {
        await onRefresh()
      }

      if (mode === "new") {
        resetForNewItem()
        toast.success(item ? "Schedule item saved" : "Schedule item created")
        return savedItem.id
      }

      if (mode === "close") {
        onOpenChange(false)
        toast.success(item ? "Schedule item saved" : "Schedule item created")
        return savedItem.id
      }

	      if (draftMode) {
	        setItem(savedItem)
	        setValues(formFromItem(savedItem))
	        setNoteDraft("")
	        setNotifyAssignees(false)
	        setManualEndDate(hasManualEndDate(savedItem, workdayExceptions))
	      } else {
        await loadItem(savedItem.id)
      }
      setNotifyAssignees(false)
      toast.success(item ? "Schedule item saved" : "Schedule item created")
      return savedItem.id
    } catch (err) {
      toastApiError(err, "Failed to save schedule item")
      return null
    } finally {
      setSaving(false)
    }
  }

  async function handleAddNote() {
    if (readOnly) {
      return
    }
    if (!item || !noteDraft.trim()) {
      return
    }

    setSaving(true)

    try {
      if (draftMode && !onDraftAddNote) {
        throw new Error("Draft note handler is not configured.")
      }

      if (draftMode) {
        if (!onDraftAddNote) {
          throw new Error("Draft note handler is not configured.")
        }

        const updatedItem = await onDraftAddNote(item.id, noteDraft.trim())
        setItem(updatedItem)
        setValues(formFromItem(updatedItem))
        setNoteDraft("")
        toast.success("Note added to the draft")
        return
      }

      const response = await api.post<{ note: ScheduleNote }>(`/schedule-items/${item.id}/notes`, {
        note: noteDraft.trim(),
      })
      setItem((current) =>
        current
          ? {
              ...current,
              notesStream: [response.data.note, ...current.notesStream],
              noteCount: current.noteCount + 1,
            }
          : current,
      )
      setNoteDraft("")
      await onRefresh()
      toast.success("Note added")
    } catch (err) {
      toastApiError(err, "Failed to add note")
    } finally {
      setSaving(false)
    }
  }

  const onDropFiles = useCallback(
    async (droppedFiles: File[]) => {
      if (readOnly) {
        return
      }
      if (draftMode) {
        toast.info("Publish draft changes before managing attachments")
        return
      }
      if (!item || droppedFiles.length === 0) return
      const validationError = validateSelectedFiles(droppedFiles, "document")
      if (validationError) {
        setAttachmentError(validationError)
        return
      }
      setAttachmentError(null)
      const formData = new FormData()
      droppedFiles.forEach((file) => formData.append("files", file))
      setSaving(true)
      try {
        await api.post(`/schedule-items/${item.id}/attachments`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        })
        await Promise.all([loadItem(item.id), onRefresh()])
        toast.success("Files uploaded")
      } catch (err) {
        toastApiError(err, "Failed to upload files")
      } finally {
        setSaving(false)
      }
    },
    [item, draftMode, onRefresh, readOnly],
  )

  const attachmentDropzone = useDropzone({
    onDrop: onDropFiles,
    noKeyboard: true,
    disabled: !item || draftMode || readOnly,
  })

  async function handleUploadFiles(event: React.ChangeEvent<HTMLInputElement>) {
    if (readOnly) {
      event.target.value = ""
      return
    }
    if (draftMode) {
      toast.info("Publish draft changes before managing attachments")
      event.target.value = ""
      return
    }

    if (!item || !event.target.files?.length) {
      return
    }

    const selectedFiles = Array.from(event.target.files)
    const validationError = validateSelectedFiles(selectedFiles, "document")

    if (validationError) {
      setAttachmentError(validationError)
      event.target.value = ""
      return
    }

    setAttachmentError(null)
    const formData = new FormData()

    selectedFiles.forEach((file) => {
      formData.append("files", file)
    })

    setSaving(true)

    try {
      await api.post(`/schedule-items/${item.id}/attachments`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      await Promise.all([loadItem(item.id), onRefresh()])
      toast.success("Files uploaded")
    } catch (err) {
      toastApiError(err, "Failed to upload files")
    } finally {
      event.target.value = ""
      setSaving(false)
    }
  }

  function isFormDirty(): boolean {
    if (!item) {
      return false
    }
    if (noteDraft.trim().length > 0) {
      return true
    }
    try {
      return JSON.stringify(values) !== JSON.stringify(formFromItem(item))
    } catch {
      return false
    }
  }

  async function performCreateDoc(defaultTitleSource?: string) {
    if (readOnly) {
      return
    }
    if (!item) {
      return
    }

    const baseName = (defaultTitleSource ?? item.title).trim() || item.title
    const initialTitle = `${baseName} Notes`

    setDocPreviewTitle(initialTitle)
    setDocPreviewBody("")
    setDocPreviewOpen(true)
    setDocPreviewLoading(true)

    try {
      const response = await api.post<{
        preview: { title: string; defaultTitle: string; body: string }
      }>(`/schedule-items/${item.id}/attachments/new-doc/preview`, {
        title: initialTitle,
      })
      setDocPreviewBody(response.data.preview.body)
    } catch (err) {
      setDocPreviewOpen(false)
      toastApiError(err, "Failed to load document preview")
    } finally {
      setDocPreviewLoading(false)
    }
  }

  async function handleConfirmCreateDoc() {
    if (readOnly) {
      return
    }
    if (!item) {
      return
    }

    const title = docPreviewTitle.trim()
    if (!title) {
      toast.error("Document name is required")
      return
    }

    setSaving(true)

    try {
      await api.post(`/schedule-items/${item.id}/attachments/new-doc`, { title })
      await Promise.all([loadItem(item.id), onRefresh()])
      setDocPreviewOpen(false)
      toast.success("Document created")
    } catch (err) {
      toastApiError(err, "Failed to create document")
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateDoc() {
    if (readOnly) {
      return
    }
    if (draftMode) {
      toast.info("Publish draft changes before creating attachments")
      return
    }

    if (!item) {
      return
    }

    if (isFormDirty()) {
      setCreateDocConfirmOpen(true)
      return
    }

    await performCreateDoc()
  }

  async function handleSaveThenCreateDoc() {
    if (readOnly) {
      return
    }
    setCreateDocConfirmOpen(false)
    const savedTitle = values.title
    const savedId = await handleSave("stay")
    if (savedId) {
      await performCreateDoc(savedTitle)
    }
  }

  async function handleCreateDocAnyway() {
    if (readOnly) {
      return
    }
    setCreateDocConfirmOpen(false)
    await performCreateDoc()
  }

  async function handleDeleteAttachment(attachmentId: string) {
    if (readOnly) {
      return
    }
    if (draftMode) {
      toast.info("Publish draft changes before deleting attachments")
      return
    }

    if (!item) {
      return
    }

    setSaving(true)

    try {
      await api.delete(`/schedule-items/${item.id}/attachments/${attachmentId}`)
      await Promise.all([loadItem(item.id), onRefresh()])
      toast.success("Attachment removed")
    } catch (err) {
      toastApiError(err, "Failed to remove attachment")
    } finally {
      setSaving(false)
    }
  }

  async function handleCopy() {
    if (readOnly) {
      return
    }
    if (!item) {
      return
    }

    setSaving(true)

    try {
      const payload = buildPayload()
      let copiedItem: ScheduleItemRecord

      if (draftMode) {
        if (!onDraftSave) {
          throw new Error("Draft save handler is not configured.")
        }

        copiedItem = await onDraftSave({
          itemId: null,
          payload: {
            ...payload,
            title: `${payload.title} (Copy)`,
            progress: 0,
            isComplete: false,
          },
          note: null,
        })
      } else {
        copiedItem = (
          await api.post<{ item: ScheduleItemRecord }>(`/jobs/${jobId}/schedule`, {
            ...payload,
            title: `${payload.title} (Copy)`,
            progress: 0,
            isComplete: false,
          })
        ).data.item
      }
      if (!draftMode) {
        await onRefresh()
      }
      await loadItem(copiedItem.id)
      toast.success("Schedule item copied")
    } catch (err) {
      toastApiError(err, "Failed to copy schedule item")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (readOnly) {
      return
    }
    if (!item) {
      return
    }

    setSaving(true)

    try {
      if (draftMode) {
        if (!onDraftDelete) {
          throw new Error("Draft delete handler is not configured.")
        }

        await onDraftDelete(item.id)
      } else {
        await api.delete(`/schedule-items/${item.id}`)
      }
      if (!draftMode) {
        await onRefresh()
      }
      setDeleteConfirmOpen(false)
      onOpenChange(false)
      toast.success("Schedule item deleted")
    } catch (err) {
      toastApiError(err, "Failed to delete schedule item")
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateTodo() {
    if (readOnly) {
      return
    }
    if (draftMode) {
      toast.info("Publish draft changes before creating linked to-do's")
      return
    }

    const itemTitle = values.title.trim() || item?.title || "New To-Do"
    const nextItemId = await handleSave("stay")

    if (!nextItemId) {
      return
    }

    const title = window.prompt("To-Do name", itemTitle)

    if (!title?.trim()) {
      return
    }

    setSaving(true)

    try {
      await api.post(`/schedule-items/${nextItemId}/todos`, {
        title: title.trim(),
      })
      await Promise.all([loadItem(nextItemId), onRefresh()])
      toast.success("Linked to-do created")
    } catch (err) {
      toastApiError(err, "Failed to create linked to-do")
    } finally {
      setSaving(false)
    }
  }

  // Crew members can't issue a full PUT on the schedule item (admin-only),
  // but they CAN call the narrow POST /complete endpoint when assigned to it.
  // Persist their toggle immediately rather than buffering it into the form
  // — the form's Save button calls PUT, which would 403 for them.
  async function handleToggleCompleteAsCrew(nextIsComplete: boolean) {
    if (readOnly) {
      return
    }
    if (!item || draftMode) {
      return
    }

    const previousProgress = values.progress
    const nextProgress = nextIsComplete
      ? 100
      : previousProgress >= 100
      ? 99
      : previousProgress

    // Optimistic: flip the form state right away so the UI reflects the
    // tap, then revert on failure.
    updateValues((current) => ({
      ...current,
      isComplete: nextIsComplete,
      progress: nextProgress,
    }))

    setSaving(true)
    try {
      const response = await api.post<{ item: ScheduleItemRecord }>(
        `/schedule-items/${item.id}/complete`,
        { isComplete: nextIsComplete, progress: nextProgress },
      )
      setItem(response.data.item)
      setValues(formFromItem(response.data.item))
      await onRefresh()
      toast.success(
        nextIsComplete
          ? "Marked schedule item complete"
          : "Reopened schedule item",
      )
    } catch (err) {
      updateValues((current) => ({
        ...current,
        isComplete: !nextIsComplete,
        progress: previousProgress,
      }))
      toastApiError(err, "Failed to update completion")
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleTodo(todo: ScheduleTodo) {
    if (readOnly) {
      return
    }
    if (draftMode) {
      toast.info("Publish draft changes before updating linked to-do's")
      return
    }

    if (!item) {
      return
    }

    setSaving(true)

    try {
      await api.put(`/schedule-items/${item.id}/todos/${todo.id}`, {
        isComplete: !todo.isComplete,
      })
      await Promise.all([loadItem(item.id), onRefresh()])
    } catch (err) {
      toastApiError(err, "Failed to update linked to-do")
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteTodo(todoId: string) {
    if (readOnly) {
      return
    }
    if (draftMode) {
      toast.info("Publish draft changes before removing linked to-do's")
      return
    }

    if (!item) {
      return
    }

    setSaving(true)

    try {
      await api.delete(`/schedule-items/${item.id}/todos/${todoId}`)
      await Promise.all([loadItem(item.id), onRefresh()])
      toast.success("Linked to-do removed")
    } catch (err) {
      toastApiError(err, "Failed to remove linked to-do")
    } finally {
      setSaving(false)
    }
  }

  async function handleAddPhase() {
    if (readOnly) {
      return
    }
    if (!addingPhase.trim()) {
      return
    }

    setSaving(true)

    try {
      await api.post(`/jobs/${jobId}/schedule/settings/phases`, {
        name: addingPhase.trim(),
      })
      await refreshSettings()
      setAddingPhase("")
      setShowAddPhase(false)
      toast.success("Phase added")
    } catch (err) {
      toastApiError(err, "Failed to add phase")
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePhase(phaseId: string) {
    if (readOnly) {
      return
    }
    const name = editingPhases[phaseId]?.trim()

    if (!name) {
      return
    }

    setSaving(true)

    try {
      await api.put(`/jobs/${jobId}/schedule/settings/phases/${phaseId}`, { name })
      await refreshSettings()
      toast.success("Phase updated")
    } catch (err) {
      toastApiError(err, "Failed to update phase")
    } finally {
      setSaving(false)
    }
  }

  async function handleAddTag() {
    if (readOnly) {
      return
    }
    if (!addingTag.trim()) {
      return
    }

    setSaving(true)

    try {
      await api.post(`/jobs/${jobId}/schedule/settings/tags`, {
        name: addingTag.trim(),
      })
      await refreshSettings()
      setAddingTag("")
      setShowAddTag(false)
      toast.success("Tag added")
    } catch (err) {
      toastApiError(err, "Failed to add tag")
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveTag(tagId: string) {
    if (readOnly) {
      return
    }
    const name = editingTags[tagId]?.trim()

    if (!name) {
      return
    }

    setSaving(true)

    try {
      await api.put(`/jobs/${jobId}/schedule/settings/tags/${tagId}`, { name })
      await refreshSettings()
      toast.success("Tag updated")
    } catch (err) {
      toastApiError(err, "Failed to update tag")
    } finally {
      setSaving(false)
    }
  }

  const saveMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 rounded-l-none border-l-0 px-2"
          disabled={saving || loadingItem}
        >
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void handleSave("close")}>
          Save and close
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleSave("new")}>
          Save and new
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] max-w-5xl overflow-hidden border-[#E5E7EB] bg-white p-0">
        <DialogHeader className="border-b border-[#E5E7EB] px-6 py-4">
          <DialogTitle>{item ? "Edit Schedule Item" : "Add Schedule Item"}</DialogTitle>
        </DialogHeader>

        {loadingItem ? (
          <div className="flex min-h-[420px] items-center justify-center">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="max-h-[calc(95vh-145px)] overflow-y-auto px-6 py-5">
              <Tabs value={topTab} onValueChange={setTopTab}>
                <TabsList className="grid w-full grid-cols-2 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-1">
                  <TabsTrigger value="details">Schedule Item Details</TabsTrigger>
                  <TabsTrigger value="related">Related Items ({relatedCount})</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="mt-5">
                  <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
                    {/* Left column — Title, Assignees, Sub-tabs */}
                    <div className="space-y-5 min-w-0">
                      {item ? (
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            disabled={isCrewMember && saving}
                            className={cn(
                              "inline-flex size-7 items-center justify-center rounded-full border transition-colors shrink-0",
                              values.isComplete
                                ? "border-emerald-600 bg-emerald-600 text-white"
                                : "border-slate-300 bg-white text-slate-400 hover:border-slate-400",
                              isCrewMember && saving && "opacity-60",
                            )}
                            onClick={() => {
                              if (isCrewMember && !draftMode) {
                                void handleToggleCompleteAsCrew(!values.isComplete)
                                return
                              }

                              updateValues((current) => ({
                                ...current,
                                isComplete: !current.isComplete,
                                progress: current.isComplete
                                  ? current.progress >= 100
                                    ? 99
                                    : current.progress
                                  : 100,
                              }))
                            }}
                          >
                            {values.isComplete ? (
                              <Check className="size-4" />
                            ) : (
                              <Circle className="size-4" />
                            )}
                          </button>
                          <div>
                            <p className="text-sm font-medium text-slate-900">Complete</p>
                            <p className="text-xs text-slate-500">
                              Mark this item done
                            </p>
                          </div>
                        </div>
                      ) : null}

                      <div className="space-y-2">
                        <Label htmlFor="schedule-item-title">Title</Label>
                        <Input
                          id="schedule-item-title"
                          value={values.title}
                          required
                          autoFocus={!item}
                          placeholder='e.g. "Granite Countertop Template"'
                          onChange={(event) =>
                            updateValues((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Assignees</Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={cn(
                              "h-8 px-2.5 text-xs",
                              notifyAssignees && "border-primary/20 bg-primary/10 text-primary",
                            )}
                            onClick={() => setNotifyAssignees((current) => !current)}
                          >
                            <Send className="mr-1 size-3" />
                            Notify
                          </Button>
                        </div>
                        <div className="rounded-md border border-[#E5E7EB] px-3 py-2">
                          {selectedAssignees.length > 0 ? (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {selectedAssignees.map((user) => (
                                <button
                                  key={user.id}
                                  type="button"
                                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                                  onClick={() => removeAssignee(user.id)}
                                >
                                  {user.fullName}
                                  <span className="text-slate-400">×</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                          <Input
                            value={assigneeQuery}
                            placeholder="Search users"
                            className="border-0 px-0 shadow-none focus-visible:ring-0 h-8"
                            onChange={(event) => setAssigneeQuery(event.target.value)}
                          />
                          {assigneeMatches.length > 0 ? (
                            <div className="mt-1.5 rounded-md border border-[#E5E7EB] bg-white max-h-36 overflow-y-auto">
                              {assigneeMatches.map((user) => (
                                <button
                                  key={user.id}
                                  type="button"
                                  className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-slate-50"
                                  onClick={() => addAssignee(user.id)}
                                >
                                  <div>
                                    <p className="text-sm font-medium text-slate-900">
                                      {user.fullName}
                                    </p>
                                    <p className="text-xs text-slate-500">{user.email}</p>
                                  </div>
                                  <span className="text-xs text-slate-400">
                                    {user.role.replaceAll("_", " ")}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <Tabs value={subTab} onValueChange={setSubTab}>
                    <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-1">
                      <TabsTrigger value="predecessors">Predecessors &amp; Links</TabsTrigger>
                      <TabsTrigger value="phases">Phases &amp; Tags</TabsTrigger>
                      <TabsTrigger value="viewing">Viewing</TabsTrigger>
                      <TabsTrigger value="notes">{notesLabel}</TabsTrigger>
                      <TabsTrigger value="files">Files</TabsTrigger>
                    </TabsList>

                    <TabsContent value="predecessors" className="space-y-4 rounded-xl border border-[#E5E7EB] p-4">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">Predecessors</h3>
                      </div>
                      {values.predecessors.map((predecessor, index) => (
                        <div key={`${predecessor.scheduleItemId || "new"}-${index}`} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_120px_auto]">
                          <Select
                            value={predecessor.scheduleItemId || "__empty__"}
                            onValueChange={(value) =>
                              updateValues((current) => ({
                                ...current,
                                predecessors: current.predecessors.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        scheduleItemId: value === "__empty__" ? "" : value,
                                      }
                                    : entry,
                                ),
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={
                                  availablePredecessors.length === 0
                                    ? "There are no items to select"
                                    : "Select item"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {availablePredecessors.length === 0 ? (
                                <SelectItem value="__empty__" disabled>
                                  There are no items to select
                                </SelectItem>
                              ) : (
                                availablePredecessors.map((candidate) => (
                                  <SelectItem key={candidate.id} value={candidate.id}>
                                    {candidate.title}
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>

                          <Select
                            value={predecessor.dependencyType}
                            onValueChange={(value) =>
                              updateValues((current) => ({
                                ...current,
                                predecessors: current.predecessors.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        dependencyType: value as SchedulePredecessor["dependencyType"],
                                      }
                                    : entry,
                                ),
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SCHEDULE_PREDECESSOR_TYPES.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <div className="relative">
                            <Input
                              type="number"
                              min="0"
                              value={predecessor.lagDays}
                              onChange={(event) =>
                                updateValues((current) => ({
                                  ...current,
                                  predecessors: current.predecessors.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? {
                                          ...entry,
                                          lagDays: Math.max(0, Number(event.target.value) || 0),
                                        }
                                      : entry,
                                  ),
                                }))
                              }
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                              days
                            </span>
                          </div>

                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              updateValues((current) => ({
                                ...current,
                                predecessors: current.predecessors.filter(
                                  (_entry, entryIndex) => entryIndex !== index,
                                ),
                              }))
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}

                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          updateValues((current) => ({
                            ...current,
                            predecessors: [
                              ...current.predecessors,
                              {
                                scheduleItemId: "",
                                dependencyType: "finish_to_start",
                                lagDays: 0,
                              },
                            ],
                          }))
                        }
                      >
                        <Plus className="mr-2 size-4" />
                        Add Predecessor
                      </Button>
                    </TabsContent>

                    <TabsContent value="phases" className="space-y-6 rounded-xl border border-[#E5E7EB] p-4">
                      <section className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-semibold text-slate-900">
                              Schedule Item Phase
                            </h3>
                          </div>
                          {!readOnly ? (
                          <div className="flex items-center gap-4 text-sm">
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={() => setShowAddPhase((current) => !current)}
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={() => setShowEditPhases((current) => !current)}
                            >
                              Edit
                            </button>
                          </div>
                          ) : null}
                        </div>

                        <Select
                          value={values.phaseId || UNASSIGNED_PHASE}
                          onValueChange={(value) =>
                            updateValues((current) => ({
                              ...current,
                              phaseId: value === UNASSIGNED_PHASE ? null : value,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNASSIGNED_PHASE}>Unassigned</SelectItem>
                            {settings.phases.map((phase) => (
                              <SelectItem key={phase.id} value={phase.id}>
                                {phase.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {showAddPhase ? (
                          <div className="flex gap-2">
                            <Input
                              value={addingPhase}
                              placeholder="New phase name"
                              onChange={(event) => setAddingPhase(event.target.value)}
                            />
                            <Button type="button" onClick={() => void handleAddPhase()}>
                              Save
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setAddingPhase("")
                                setShowAddPhase(false)
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : null}

                        {showEditPhases ? (
                          <div className="space-y-2">
                            {settings.phases.map((phase) => (
                              <div key={phase.id} className="flex gap-2">
                                <Input
                                  value={editingPhases[phase.id] ?? phase.name}
                                  onChange={(event) =>
                                    setEditingPhases((current) => ({
                                      ...current,
                                      [phase.id]: event.target.value,
                                    }))
                                  }
                                />
                                <Button type="button" onClick={() => void handleSavePhase(phase.id)}>
                                  Save
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </section>

                      <section className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-semibold text-slate-900">
                              Schedule Item Tags
                            </h3>
                          </div>
                          {!readOnly ? (
                          <div className="flex items-center gap-4 text-sm">
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={() => setShowAddTag((current) => !current)}
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={() => setShowEditTags((current) => !current)}
                            >
                              Edit
                            </button>
                          </div>
                          ) : null}
                        </div>

                        <Input
                          value={values.tagsInput}
                          placeholder="template, fabrication, install"
                          onChange={(event) =>
                            updateValues((current) => ({
                              ...current,
                              tagsInput: event.target.value,
                            }))
                          }
                        />

                        {settings.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {settings.tags.map((tag) => (
                              <button
                                key={tag.id}
                                type="button"
                                className="rounded-full border border-[#E5E7EB] bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-primary/20 hover:text-primary"
                                onClick={() =>
                                  updateValues((current) => {
                                    const tags = cleanTags(current.tagsInput)
                                    return {
                                      ...current,
                                      tagsInput: cleanTags([...tags, tag.name].join(", ")).join(", "),
                                    }
                                  })
                                }
                              >
                                {tag.name}
                              </button>
                            ))}
                          </div>
                        ) : null}

                        {showAddTag ? (
                          <div className="flex gap-2">
                            <Input
                              value={addingTag}
                              placeholder="New tag name"
                              onChange={(event) => setAddingTag(event.target.value)}
                            />
                            <Button type="button" onClick={() => void handleAddTag()}>
                              Save
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setAddingTag("")
                                setShowAddTag(false)
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : null}

                        {showEditTags ? (
                          <div className="space-y-2">
                            {settings.tags.map((tag) => (
                              <div key={tag.id} className="flex gap-2">
                                <Input
                                  value={editingTags[tag.id] ?? tag.name}
                                  onChange={(event) =>
                                    setEditingTags((current) => ({
                                      ...current,
                                      [tag.id]: event.target.value,
                                    }))
                                  }
                                />
                                <Button type="button" onClick={() => void handleSaveTag(tag.id)}>
                                  Save
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </section>
                    </TabsContent>

                    <TabsContent value="viewing" className="space-y-4 rounded-xl border border-[#E5E7EB] p-4">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">Schedule Viewing</h3>
                      </div>
                      {[
                        {
                          key: "showOnGantt",
                          label: "Show on Gantt",
                          checked: values.showOnGantt,
                        },
                        {
                          key: "visibleToEstimators",
                          label: "Visible to Estimators",
                          checked: values.visibleToEstimators,
                        },
                        {
                          key: "visibleToInstallers",
                          label: "Visible to Installers",
                          checked: values.visibleToInstallers,
                        },
                        {
                          key: "visibleToOfficeStaff",
                          label: "Visible to Office Staff",
                          checked: values.visibleToOfficeStaff,
                        },
                      ].map((option) => (
                        <label key={option.key} className="flex items-center gap-3">
                          <Checkbox
                            checked={option.checked}
                            onCheckedChange={(checked) =>
                              updateValues((current) => ({
                                ...current,
                                [option.key]: checked === true,
                              }))
                            }
                          />
                          <span className="text-sm text-slate-700">{option.label}</span>
                        </label>
                      ))}
                    </TabsContent>

                    <TabsContent value="notes" className="space-y-4 rounded-xl border border-[#E5E7EB] p-4">
                      <Textarea
                        rows={4}
                        value={noteDraft}
                        placeholder="Type a note"
                        onChange={(event) => setNoteDraft(event.target.value)}
                      />

                      {item && !readOnly ? (
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            disabled={saving || !noteDraft.trim()}
                            onClick={() => void handleAddNote()}
                          >
                            Add Note
                          </Button>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">Notes are available after save.</p>
                      )}

                      {item && item.notesStream.length > 0 ? (
                        <div className="space-y-3">
                          {item.notesStream.map((note) => (
                            <div key={note.id} className="rounded-xl border border-[#E5E7EB] p-4">
                              <div className="mb-2 flex items-center gap-3">
                                <Avatar className="size-8">
                                  <AvatarImage src={note.authorAvatarUrl || undefined} />
                                  <AvatarFallback className="text-xs">
                                    {getInitials(note.authorName)}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="text-sm font-medium text-slate-900">
                                    {note.authorName || "Unknown"}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {fmtDateTime(note.createdAt)}
                                  </p>
                                </div>
                              </div>
                              <p className="whitespace-pre-wrap text-sm text-slate-700">
                                {note.note}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : item ? (
                        <p className="text-sm text-slate-500">No notes yet.</p>
                      ) : null}
                    </TabsContent>

                    <TabsContent value="files" className="space-y-4 rounded-xl border border-[#E5E7EB] p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-900">Attachments</h3>
                        {item && !readOnly ? (
                          <div className="flex gap-2">
                            <input
                              ref={fileInputRef}
                              type="file"
                              className="hidden"
                              multiple
                              accept={uploadAcceptForMediaType("document")}
                              onChange={handleUploadFiles}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => fileInputRef.current?.click()}
                            >
                              Add
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => void handleCreateDoc()}
                            >
                              Create new doc
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      {attachmentError ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                          {attachmentError}
                        </div>
                      ) : null}

                      {!item ? (
                        <p className="text-sm text-slate-500">Attachments are available after save.</p>
                      ) : (
                        <>
                          {!readOnly ? (
                          <div
                            {...attachmentDropzone.getRootProps()}
                            className={cn(
                              "relative cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors",
                              attachmentDropzone.isDragActive
                                ? "border-primary/45 bg-primary/10"
                                : "border-slate-300 bg-slate-50 hover:border-primary/45 hover:bg-accent/50",
                            )}
                          >
                            <input {...attachmentDropzone.getInputProps({ accept: uploadAcceptForMediaType("document") })} />
                            {attachmentDropzone.isDragActive ? (
                              <>
                                <Upload className="mx-auto size-5 text-primary" />
                                <div className="mt-2 text-sm font-medium text-primary">Drop files here</div>
                              </>
                            ) : (
                              <>
                                <Upload className="mx-auto size-5 text-slate-400" />
                                <div className="mt-2 text-sm text-slate-500">Drag & drop files here, or click to browse</div>
                              </>
                            )}
                          </div>
                          ) : null}
                          {item.attachments.length > 0 ? (
                            <div className="space-y-2">
                              {item.attachments.map((attachment, attIndex) => {
                                const Icon = attachmentIcon(attachment.icon)
                                const previewFiles: PreviewFile[] = item.attachments.map((a) => ({
                                  id: a.id,
                                  fileId: a.fileId,
                                  name: a.originalName || a.filename,
                                  mimeType: a.mimeType,
                                  fileSize: a.fileSize,
                                  createdAt: a.createdAt,
                                }))
                                const isMissing = attachment.storageStatus === "missing"

                                return (
                                  <div
                                    key={attachment.id}
                                    className={
                                      isMissing
                                        ? "flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
                                        : "flex items-center justify-between rounded-lg border border-[#E5E7EB] px-4 py-3"
                                    }
                                  >
                                    <div className="flex items-center gap-3">
                                      <div
                                        className={
                                          isMissing
                                            ? "rounded-lg bg-amber-100 p-2 text-amber-600"
                                            : "rounded-lg bg-slate-100 p-2 text-slate-500"
                                        }
                                      >
                                        {isMissing ? (
                                          <AlertTriangle className="size-4" />
                                        ) : (
                                          <Icon className="size-4" />
                                        )}
                                      </div>
                                      <div>
                                        {isMissing ? (
                                          <>
                                            <span className="text-sm font-medium text-slate-900 line-through decoration-amber-400">
                                              {attachment.originalName}
                                            </span>
                                            <p className="text-xs text-amber-700">Original file unavailable</p>
                                          </>
                                        ) : (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => filePreview.open(previewFiles, attIndex)}
                                              className="text-left text-sm font-medium text-slate-900 hover:text-primary"
                                            >
                                              {attachment.originalName}
                                            </button>
                                            <p className="text-xs text-slate-500">
                                              {attachment.mimeType || "Unknown"} • {fmtDateTime(attachment.createdAt)}
                                            </p>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                    {!readOnly ? (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => setPendingDeleteAttachmentId(attachment.id)}
                                        title={isMissing ? "Remove orphan attachment" : "Delete attachment"}
                                        aria-label={
                                          isMissing ? "Remove orphan attachment" : "Delete attachment"
                                        }
                                      >
                                        <Trash2 className="size-4" />
                                      </Button>
                                    ) : null}
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </>
                      )}
                    </TabsContent>
                  </Tabs>
                    </div>

                    {/* Right column — Dates, Time, Color, Progress, Reminder */}
                    <div className="space-y-4">
                      <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Multi-day</Label>
                          <Switch
                            checked={multiDay}
                            onCheckedChange={(checked) => {
                              setMultiDay(checked)
                              if (!checked) {
                                setManualEndDate(false)
                                updateValues((current) => ({
                                  ...current,
                                  workDays: 1,
                                  endDate: current.startDate,
                                }))
                              }
                            }}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="schedule-item-start-date" className="text-xs">Start Date</Label>
                          <Input
                            id="schedule-item-start-date"
                            type="date"
                            value={values.startDate}
                            className="h-9"
                            onChange={(event) =>
                              updateValues((current) => {
                                const startDate = event.target.value
                                return {
                                  ...current,
                                  startDate,
                                  endDate: multiDay
                                    ? calculateBusinessEndDate(startDate, current.workDays, workdayExceptions)
                                    : startDate,
                                }
                              })
                            }
                          />
                        </div>
                        {multiDay ? (
                          <>
                            <div className="space-y-1.5">
                              <Label htmlFor="schedule-item-end-date" className="text-xs">End Date</Label>
                              <Input
                                id="schedule-item-end-date"
                                type="date"
                                value={values.endDate}
                                className="h-9"
                                onChange={(event) => {
                                  const endDate = event.target.value
                                  setManualEndDate(true)
                                  updateValues((current) => ({
                                    ...current,
                                    endDate,
                                    workDays: calculateWorkDaysBetween(current.startDate, endDate, workdayExceptions),
                                  }))
                                }}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="schedule-item-work-days" className="text-xs">Work Days</Label>
                              <div className="relative">
                                <Input
                                  id="schedule-item-work-days"
                                  type="number"
                                  min="1"
                                  max="365"
                                  value={values.workDays}
                                  className="h-9"
                                  onChange={(event) => {
                                    const workDays = Math.max(1, Number(event.target.value) || 1)
                                    setManualEndDate(false)
                                    updateValues((current) => ({
                                      ...current,
                                      workDays,
                                      endDate: calculateBusinessEndDate(current.startDate, workDays, workdayExceptions),
                                    }))
                                  }}
                                />
                                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                                  {values.workDays === 1 ? "day" : "days"}
                                </span>
                              </div>
                            </div>
                          </>
                        ) : null}
                      </div>

                      <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Set time range</Label>
                          <Switch
                            checked={values.isHourly}
                            onCheckedChange={(checked) =>
                              updateValues((current) => ({
                                ...current,
                                isHourly: checked,
                                startTime: checked ? current.startTime : "08:00",
                                endTime: checked ? current.endTime : "17:00",
                              }))
                            }
                          />
                        </div>
                        {values.isHourly ? (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[11px] font-medium text-slate-500">Start</label>
                              <div className="relative">
                                <Clock3 className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                                <Input
                                  type="time"
                                  value={values.startTime}
                                  className="h-9 pl-8 text-sm"
                                  onChange={(event) =>
                                    updateValues((current) => ({
                                      ...current,
                                      startTime: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] font-medium text-slate-500">End</label>
                              <div className="relative">
                                <Clock3 className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                                <Input
                                  type="time"
                                  value={values.endTime}
                                  className="h-9 pl-8 text-sm"
                                  onChange={(event) =>
                                    updateValues((current) => ({
                                      ...current,
                                      endTime: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Display Color</Label>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {SCHEDULE_COLOR_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() =>
                                updateValues((current) => ({ ...current, displayColor: option.value }))
                              }
                              title={option.label}
                              className={cn(
                                "size-6 rounded-full transition-all hover:scale-110 shrink-0",
                                values.displayColor === option.value && "ring-2 ring-offset-2 ring-slate-400 scale-110",
                              )}
                              style={{ backgroundColor: option.value }}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Progress</Label>
                          <span className="text-xs font-medium text-slate-500 tabular-nums">{values.progress}%</span>
                        </div>
                        <Slider
                          value={[values.progress]}
                          min={0}
                          max={100}
                          step={1}
                          onValueChange={([nextProgress]) =>
                            updateValues((current) => ({
                              ...current,
                              ...completionStateForProgress(nextProgress),
                            }))
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Reminder</Label>
                        <Select
                          value={values.reminder}
                          onValueChange={(value) =>
                            updateValues((current) => ({ ...current, reminder: value }))
                          }
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SCHEDULE_REMINDER_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="related" className="mt-5 rounded-xl border border-[#E5E7EB] p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Related To-Do&apos;s</h3>
                  {!item ? (
                    <p className="mt-3 text-sm text-slate-500">To-Do&apos;s available after save</p>
                  ) : (
                    <div className="mt-3 space-y-4">
                      {!readOnly ? (
                        <Button
                          type="button"
                          disabled={saving}
                          onClick={() => void handleCreateTodo()}
                        >
                          Save and Create To-Do
                        </Button>
                      ) : null}
                      {item.relatedTodos.length > 0 ? (
                        <div className="space-y-2">
                          {item.relatedTodos.map((todo) => (
                            <div
                              key={todo.id}
                              className="flex items-center justify-between rounded-lg border border-[#E5E7EB] px-4 py-3"
                            >
                              <label className="flex items-center gap-3">
                                <Checkbox
                                  checked={todo.isComplete === true}
                                  onCheckedChange={() => void handleToggleTodo(todo)}
                                />
                                <div>
                                  <p
                                    className={cn(
                                      "text-sm font-medium text-slate-900",
                                      todo.isComplete && "text-slate-400 line-through",
                                    )}
                                  >
                                    {todo.title}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {todo.createdByName || "Unknown"} • {fmtDateTime(todo.createdAt)}
                                  </p>
                                </div>
                              </label>
                              {!readOnly ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => void handleDeleteTodo(todo.id)}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">No linked to-do&apos;s yet.</p>
                      )}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>

            <div className="border-t border-[#E5E7EB] px-6 py-4">
              {item ? (
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-3 text-sm text-slate-600">
                    <Avatar className="size-8">
                      <AvatarImage src={item.createdByAvatarUrl || undefined} />
                      <AvatarFallback className="text-xs">
                        {getInitials(item.createdByName)}
                      </AvatarFallback>
                    </Avatar>
                    <span>
                      Created by <span className="font-medium text-slate-900">{item.createdByName || "Unknown"}</span>{" "}
                      on {fmtDateTime(item.createdAt)}
                    </span>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                      Close
                    </Button>

                    {!readOnly ? (
                      <>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="outline" size="icon">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => void handleCopy()}>
                              <Copy className="size-4" />
                              Copy
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => setDeleteConfirmOpen(true)}
                            >
                              <Trash2 className="size-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <div className="flex">
                          <Button
                            type="button"
                            className="rounded-r-none"
                            disabled={saving}
                            onClick={() => void handleSave("stay")}
                          >
                            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                            Save
                          </Button>
                          {saveMenu}
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    {readOnly ? "Close" : "Cancel"}
                  </Button>
                  {!readOnly ? (
                    <div className="flex">
                      <Button type="button" className="rounded-r-none" disabled={saving} onClick={() => void handleSave("stay")}>
                        {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                        Save
                      </Button>
                      {saveMenu}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
    <AlertDialog open={createDocConfirmOpen} onOpenChange={setCreateDocConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
          <AlertDialogDescription>
            The document will use the last saved version of this item. Save your changes first?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => void handleCreateDocAnyway()}
          >
            Create anyway
          </Button>
          <AlertDialogAction
            disabled={saving}
            onClick={(event) => {
              event.preventDefault()
              void handleSaveThenCreateDoc()
            }}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save &amp; create
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Dialog open={docPreviewOpen} onOpenChange={(next) => { if (!saving) setDocPreviewOpen(next) }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preview document</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="schedule-doc-title">Document name</Label>
            <Input
              id="schedule-doc-title"
              value={docPreviewTitle}
              onChange={(event) => setDocPreviewTitle(event.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-1">
            <Label>Preview</Label>
            <div className="rounded-md border bg-muted/30">
              {docPreviewLoading ? (
                <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Building preview…
                </div>
              ) : (
                <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap p-3 text-xs font-mono">
                  {docPreviewBody}
                </pre>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Saved as a .txt attachment on this schedule item.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => setDocPreviewOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || docPreviewLoading || !docPreviewTitle.trim()}
            onClick={() => void handleConfirmCreateDoc()}
          >
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Save document
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    <AlertDialog
      open={pendingDeleteAttachmentId !== null}
      onOpenChange={(next) => {
        if (!next && !saving) setPendingDeleteAttachmentId(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove attachment</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove this attachment? This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            className="bg-red-600 text-white hover:bg-red-700"
            onClick={(event) => {
              event.preventDefault()
              const id = pendingDeleteAttachmentId
              if (!id) return
              setPendingDeleteAttachmentId(null)
              void handleDeleteAttachment(id)
            }}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Schedule Item</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this schedule item? This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            className="bg-red-600 text-white hover:bg-red-700"
            onClick={(event) => {
              event.preventDefault()
              void handleDelete()
            }}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
