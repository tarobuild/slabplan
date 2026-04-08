import { useEffect, useMemo, useRef, useState } from "react"
import {
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
} from "lucide-react"
import { api } from "@/lib/api"
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

type ScheduleItemDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string
  itemId: string | null
  items: ScheduleItemRecord[]
  users: UserOption[]
  settings: ScheduleSettings
  workdayExceptions: ScheduleWorkdayException[]
  refreshSettings: () => Promise<void>
  onRefresh: () => Promise<void>
  draftMode?: boolean
  onDraftSave?: (params: {
    itemId: string | null
    payload: ScheduleItemPayload
    note: string | null
  }) => Promise<ScheduleItemRecord>
  onDraftAddNote?: (itemId: string, note: string) => Promise<ScheduleItemRecord>
  onDraftDelete?: (itemId: string) => Promise<void>
}

function getApiError(err: unknown, fallback: string) {
  if (typeof err === "object" && err !== null) {
    const e = err as { response?: { data?: { message?: string } }; message?: string }
    return e.response?.data?.message ?? e.message ?? fallback
  }

  return fallback
}

function defaultForm(startDate: string, workdayExceptions: ScheduleWorkdayException[] = []): ScheduleFormValues {
  return {
    title: "",
    displayColor: DEFAULT_SCHEDULE_COLOR,
    assigneeIds: [],
    startDate,
    workDays: 1,
    endDate: calculateBusinessEndDate(startDate, 1, workdayExceptions),
    isHourly: false,
    startTime: "08:00",
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
  items,
  users,
  settings,
  workdayExceptions,
  refreshSettings,
  onRefresh,
  draftMode = false,
  onDraftSave,
  onDraftAddNote,
  onDraftDelete,
}: ScheduleItemDialogProps) {
  const today = dateKey(new Date())
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

  useEffect(() => {
    if (!open) {
      setAttachmentError(null)
    }
  }, [open])

  async function loadItem(nextItemId: string) {
    setLoadingItem(true)

    try {
      if (draftMode) {
        const draftItem = items.find((candidate) => candidate.id === nextItemId)

        if (!draftItem) {
          throw new Error("Draft schedule item not found")
        }

        setItem(draftItem)
        setValues(formFromItem(draftItem))
        setNoteDraft("")
        setNotifyAssignees(false)
        setManualEndDate(false)
        return
      }

      const response = await api.get<{ item: ScheduleItemRecord }>(`/schedule-items/${nextItemId}`)
      setItem(response.data.item)
      setValues(formFromItem(response.data.item))
      setNoteDraft("")
      setNotifyAssignees(false)
      setManualEndDate(false)
    } catch (err) {
      toast.error(getApiError(err, "Failed to load schedule item"))
    } finally {
      setLoadingItem(false)
    }
  }

  function resetForNewItem() {
    setItem(null)
    setValues(defaultForm(today, workdayExceptions))
    setAssigneeQuery("")
    setNotifyAssignees(false)
    setNoteDraft("")
    setManualEndDate(false)
    setTopTab("details")
    setSubTab("predecessors")
  }

  useEffect(() => {
    if (!open) {
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
  }, [itemId, open, today, workdayExceptions])

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
      endDate: null,
      isHourly: values.isHourly,
      startTime: values.isHourly ? values.startTime : null,
      endTime: null,
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
    if (!values.title.trim()) {
      toast.error("Title is required")
      return null
    }

    setSaving(true)

    try {
      const payload = buildPayload()
      const pendingNote = noteDraft.trim() || null
      const savedItem = draftMode && onDraftSave
        ? await onDraftSave({
            itemId: item?.id ?? null,
            payload,
            note: pendingNote,
          })
        : (
            item
              ? await api.put<{ item: ScheduleItemRecord }>(`/schedule-items/${item.id}`, payload)
              : await api.post<{ item: ScheduleItemRecord }>(`/jobs/${jobId}/schedule`, payload)
          ).data.item

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
        setManualEndDate(false)
      } else {
        await loadItem(savedItem.id)
      }
      setNotifyAssignees(false)
      toast.success(item ? "Schedule item saved" : "Schedule item created")
      return savedItem.id
    } catch (err) {
      toast.error(getApiError(err, "Failed to save schedule item"))
      return null
    } finally {
      setSaving(false)
    }
  }

  async function handleAddNote() {
    if (!item || !noteDraft.trim()) {
      return
    }

    setSaving(true)

    try {
      if (draftMode && onDraftAddNote) {
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
      toast.error(getApiError(err, "Failed to add note"))
    } finally {
      setSaving(false)
    }
  }

  async function handleUploadFiles(event: React.ChangeEvent<HTMLInputElement>) {
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
      toast.error(getApiError(err, "Failed to upload files"))
    } finally {
      event.target.value = ""
      setSaving(false)
    }
  }

  async function handleCreateDoc() {
    if (draftMode) {
      toast.info("Publish draft changes before creating attachments")
      return
    }

    if (!item) {
      return
    }

    const title = window.prompt("Document name", `${item.title} Notes`)

    if (!title) {
      return
    }

    setSaving(true)

    try {
      await api.post(`/schedule-items/${item.id}/attachments/new-doc`, { title })
      await Promise.all([loadItem(item.id), onRefresh()])
      toast.success("Document created")
    } catch (err) {
      toast.error(getApiError(err, "Failed to create document"))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
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
      toast.error(getApiError(err, "Failed to remove attachment"))
    } finally {
      setSaving(false)
    }
  }

  async function handleCopy() {
    if (!item) {
      return
    }

    setSaving(true)

    try {
      const payload = buildPayload()
      const copiedItem = draftMode && onDraftSave
        ? await onDraftSave({
            itemId: null,
            payload: {
              ...payload,
              title: `${payload.title} (Copy)`,
              progress: 0,
              isComplete: false,
            },
            note: null,
          })
        : (
            await api.post<{ item: ScheduleItemRecord }>(`/jobs/${jobId}/schedule`, {
              ...payload,
              title: `${payload.title} (Copy)`,
              progress: 0,
              isComplete: false,
            })
          ).data.item
      if (!draftMode) {
        await onRefresh()
      }
      await loadItem(copiedItem.id)
      toast.success("Schedule item copied")
    } catch (err) {
      toast.error(getApiError(err, "Failed to copy schedule item"))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!item) {
      return
    }

    setSaving(true)

    try {
      if (draftMode && onDraftDelete) {
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
      toast.error(getApiError(err, "Failed to delete schedule item"))
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateTodo() {
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
      toast.error(getApiError(err, "Failed to create linked to-do"))
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleTodo(todo: ScheduleTodo) {
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
      toast.error(getApiError(err, "Failed to update linked to-do"))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteTodo(todoId: string) {
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
      toast.error(getApiError(err, "Failed to remove linked to-do"))
    } finally {
      setSaving(false)
    }
  }

  async function handleAddPhase() {
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
      toast.error(getApiError(err, "Failed to add phase"))
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePhase(phaseId: string) {
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
      toast.error(getApiError(err, "Failed to update phase"))
    } finally {
      setSaving(false)
    }
  }

  async function handleAddTag() {
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
      toast.error(getApiError(err, "Failed to add tag"))
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveTag(tagId: string) {
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
      toast.error(getApiError(err, "Failed to update tag"))
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
            <Loader2 className="size-5 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            <div className="max-h-[calc(95vh-145px)] overflow-y-auto px-6 py-5">
              <Tabs value={topTab} onValueChange={setTopTab}>
                <TabsList className="grid w-full grid-cols-2 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-1">
                  <TabsTrigger value="details">Schedule Item Details</TabsTrigger>
                  <TabsTrigger value="related">Related Items ({relatedCount})</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="mt-5 space-y-5">
                  <div className="space-y-5">
                    {item ? (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          className={cn(
                            "inline-flex size-7 items-center justify-center rounded-full border transition-colors",
                            values.isComplete
                              ? "border-emerald-600 bg-emerald-600 text-white"
                              : "border-slate-300 bg-white text-slate-400 hover:border-slate-400",
                          )}
                          onClick={() =>
                            updateValues((current) => ({
                              ...current,
                              isComplete: !current.isComplete,
                              progress: current.isComplete
                                ? current.progress >= 100
                                  ? 99
                                  : current.progress
                                : 100,
                            }))
                          }
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
                            Mark this item done without leaving the modal
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
                      <Label>Display Color</Label>
                      <Select
                        value={values.displayColor}
                        onValueChange={(value) =>
                          updateValues((current) => ({ ...current, displayColor: value }))
                        }
                      >
                        <SelectTrigger>
                          <div className="flex items-center gap-2">
                            <div
                              className="size-3 rounded-full"
                              style={{ backgroundColor: values.displayColor }}
                            />
                            <SelectValue />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {SCHEDULE_COLOR_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <div className="flex items-center gap-2">
                                <div
                                  className="size-3 rounded-full"
                                  style={{ backgroundColor: option.value }}
                                />
                                <span>{option.label}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Assignees</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-9 px-3",
                            notifyAssignees && "border-blue-200 bg-blue-50 text-blue-700",
                          )}
                          onClick={() => setNotifyAssignees((current) => !current)}
                        >
                          <Send className="mr-1.5 size-3.5" />
                          Notify
                        </Button>
                      </div>
                      <div className="rounded-md border border-[#E5E7EB] px-3 py-2">
                        {selectedAssignees.length > 0 ? (
                          <div className="mb-2 flex flex-wrap gap-2">
                            {selectedAssignees.map((user) => (
                              <button
                                key={user.id}
                                type="button"
                                className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
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
                          className="border-0 px-0 shadow-none focus-visible:ring-0"
                          onChange={(event) => setAssigneeQuery(event.target.value)}
                        />
                        {assigneeMatches.length > 0 ? (
                          <div className="mt-2 rounded-md border border-[#E5E7EB] bg-white">
                            {assigneeMatches.map((user) => (
                              <button
                                key={user.id}
                                type="button"
                                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
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

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="schedule-item-start-date">Start Date</Label>
                        <Input
                          id="schedule-item-start-date"
                          type="date"
                          value={values.startDate}
                          onChange={(event) =>
                            updateValues((current) => {
                              const startDate = event.target.value
    return {
      ...current,
      startDate,
      endDate: calculateBusinessEndDate(startDate, current.workDays, workdayExceptions),
    }
  })
}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="schedule-item-work-days">Work Days</Label>
                        <div className="relative">
                          <Input
                            id="schedule-item-work-days"
                            type="number"
                            min="1"
                            max="365"
                            value={values.workDays}
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
                      <div className="space-y-2">
                        <Label htmlFor="schedule-item-end-date">End Date</Label>
                        <Input
                          id="schedule-item-end-date"
                          type="date"
                          value={values.endDate}
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
                    </div>

                    <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-900">Hourly</p>
                          <p className="text-xs text-slate-500">
                            Add a start time to this schedule item
                          </p>
                        </div>
                        <Switch
                          checked={values.isHourly}
                          onCheckedChange={(checked) =>
                            updateValues((current) => ({
                              ...current,
                              isHourly: checked,
                              startTime: checked ? current.startTime : "08:00",
                            }))
                          }
                        />
                      </div>
                    </div>

                    {values.isHourly ? (
                      <div className="space-y-2">
                        <Label htmlFor="schedule-item-start-time">Start Time</Label>
                        <div className="relative">
                          <Clock3 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                          <Input
                            id="schedule-item-start-time"
                            type="time"
                            value={values.startTime}
                            className="pl-10"
                            onChange={(event) =>
                              updateValues((current) => ({
                                ...current,
                                startTime: event.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    ) : null}

                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_120px]">
                      <div className="space-y-2">
                        <Label>Progress</Label>
                        <div className="rounded-lg border border-[#E5E7EB] px-4 py-3">
                          <Slider
                            value={[values.progress]}
                            min={0}
                            max={100}
                            step={1}
                            onValueChange={([nextProgress]) =>
                              updateValues((current) => ({
                                ...current,
                                progress: nextProgress ?? 0,
                                isComplete: (nextProgress ?? 0) >= 100 ? true : current.isComplete,
                              }))
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="schedule-item-progress-number">Percent</Label>
                        <div className="relative">
                          <Input
                            id="schedule-item-progress-number"
                            type="number"
                            min="0"
                            max="100"
                            value={values.progress}
                            onChange={(event) => {
                              const progress = Math.max(
                                0,
                                Math.min(100, Number(event.target.value) || 0),
                              )
                              updateValues((current) => ({
                                ...current,
                                progress,
                                isComplete: progress >= 100 ? true : current.isComplete,
                              }))
                            }}
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                            %
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Reminder</Label>
                      <Select
                        value={values.reminder}
                        onValueChange={(value) =>
                          updateValues((current) => ({ ...current, reminder: value }))
                        }
                      >
                        <SelectTrigger>
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
                          <div className="flex items-center gap-4 text-sm">
                            <button
                              type="button"
                              className="text-blue-600 hover:underline"
                              onClick={() => setShowAddPhase((current) => !current)}
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              className="text-blue-600 hover:underline"
                              onClick={() => setShowEditPhases((current) => !current)}
                            >
                              Edit
                            </button>
                          </div>
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
                          <div className="flex items-center gap-4 text-sm">
                            <button
                              type="button"
                              className="text-blue-600 hover:underline"
                              onClick={() => setShowAddTag((current) => !current)}
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              className="text-blue-600 hover:underline"
                              onClick={() => setShowEditTags((current) => !current)}
                            >
                              Edit
                            </button>
                          </div>
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
                                className="rounded-full border border-[#E5E7EB] bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-blue-200 hover:text-blue-700"
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

                      {item ? (
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
                        {item ? (
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
                      ) : item.attachments.length > 0 ? (
                        <div className="space-y-2">
                          {item.attachments.map((attachment) => {
                            const Icon = attachmentIcon(attachment.icon)

                            return (
                              <div key={attachment.id} className="flex items-center justify-between rounded-lg border border-[#E5E7EB] px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <div className="rounded-lg bg-slate-100 p-2 text-slate-500">
                                    <Icon className="size-4" />
                                  </div>
                                  <div>
                                    <a
                                      href={attachment.fileUrl || "#"}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-sm font-medium text-slate-900 hover:text-blue-700"
                                    >
                                      {attachment.originalName}
                                    </a>
                                    <p className="text-xs text-slate-500">
                                      {attachment.mimeType || "Unknown"} • {fmtDateTime(attachment.createdAt)}
                                    </p>
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => void handleDeleteAttachment(attachment.id)}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">No attachments yet.</p>
                      )}
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                <TabsContent value="related" className="mt-5 rounded-xl border border-[#E5E7EB] p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Related To-Do&apos;s</h3>
                  {!item ? (
                    <p className="mt-3 text-sm text-slate-500">To-Do&apos;s available after save</p>
                  ) : (
                    <div className="mt-3 space-y-4">
                      <Button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleCreateTodo()}
                      >
                        Save and Create To-Do
                      </Button>
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
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => void handleDeleteTodo(todo.id)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
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
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <div className="flex">
                    <Button type="button" className="rounded-r-none" disabled={saving} onClick={() => void handleSave("stay")}>
                      {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                      Save
                    </Button>
                    {saveMenu}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
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
