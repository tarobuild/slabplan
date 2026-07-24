import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { useDropzone } from "react-dropzone"
import {
  AlertTriangle,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  File,
  FileText,
  Folder,
  FolderOpen,
  Grid2X2,
  ImageIcon,
  List,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Scissors,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { api } from "@/lib/api"
import { useFilePreview } from "@/components/files/file-preview-context"
import type { PreviewFile } from "@/components/files/FilePreview"
import { Button } from "@/components/ui/button"
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  formatVideoDuration,
  probeVideoDurations,
  DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES,
  uploadAcceptForMediaType,
  uploadFileWithChunks,
  uploadWithProgress,
  validateSelectedFilesAsync,
  videoUploadHint,
} from "@/lib/uploads"
import { useAuthStore } from "@/store/auth"
import { toast } from "sonner"
import { toastApiError } from "@/lib/api-errors"

type FolderItem = {
  id: string
  title: string
  childFolderCount: number
  fileCount: number
  parentFolderId: string | null
  createdAt: string
  isGlobal: boolean
  viewingPermissions: FolderPermissions
  uploadingPermissions: FolderPermissions
}

type FolderTreeItem = FolderItem & {
  mediaType: MediaType
  path?: string
  pathSegments?: string[]
}

type FolderPermissions = {
  admin?: boolean
  project_manager?: boolean
  crew_member?: boolean
  drafter?: boolean
  internal?: boolean
  users?: Record<string, boolean>
} | null

type FolderAssignee = {
  id: string
  fullName: string
  email: string
  role: string
}

type FolderRolePermissionKey = "admin" | "project_manager" | "crew_member" | "drafter"

const folderAccessRoles: Array<{
  key: FolderRolePermissionKey
  label: string
  description: string
  locked?: boolean
}> = [
  {
    key: "admin",
    label: "Admins",
    description: "Always manage folders",
    locked: true,
  },
  {
    key: "project_manager",
    label: "Project Managers",
    description: "All project manager users",
  },
  {
    key: "crew_member",
    label: "Crew Workers",
    description: "All crew users",
  },
  {
    key: "drafter",
    label: "Drafters",
    description: "All drafter users",
  },
]

type BreadcrumbItem = {
  id: string
  title: string
}

type FileItem = {
  id: string
  filename: string
  originalName: string | null
  fileUrl: string | null
  fileSize: number | null
  mimeType: string | null
  note: string | null
  uploadedBy: string | null
  uploadedByName: string | null
  createdAt: string
  // Whole-second duration the API surfaces for video files (Task #368).
  // Null for non-videos and for older rows uploaded before we started
  // recording it.
  durationSeconds?: number | null
  storageStatus?: "ok" | "missing"
}

type MediaType = "document" | "photo" | "video"
type ViewMode = "grid" | "list"
type ScopeMode = "job" | "resource"
type BatchDestinationMode = "move" | "copy"
type SignedFileUrlResponse = {
  url: string
  expiresAt?: string
  expiresIn?: number
}

const SORT_OPTIONS = [
  "name-asc",
  "name-desc",
  "date-desc",
  "date-asc",
  "size-desc",
  "size-asc",
] as const
type SortOption = (typeof SORT_OPTIONS)[number]

function isSortOption(v: string): v is SortOption {
  return (SORT_OPTIONS as readonly string[]).includes(v)
}

function formatFileSize(bytes: number | null) {
  if (bytes == null) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function FileIcon({ mimeType }: { mimeType: string | null }) {
  if (!mimeType) return <File className="size-4 text-slate-400" />
  if (mimeType.startsWith("image/")) return <span className="text-blue-500 text-sm">🖼️</span>
  if (mimeType.startsWith("video/")) return <span className="text-purple-500 text-sm">🎬</span>
  if (mimeType === "application/pdf") return <span className="text-red-500 text-sm">📄</span>
  return <FileText className="size-4 text-slate-400" />
}

function displayName(file: FileItem) {
  return file.originalName || file.filename
}

function openLoadingTab(): Window | null {
  const newWindow = window.open("about:blank", "_blank")
  if (!newWindow) {
    toast.error("Please allow pop-ups to view files in a new tab.")
    return null
  }

  try {
    newWindow.document.write(
      '<!DOCTYPE html><title>Loading…</title>' +
        '<body style="margin:0;display:flex;align-items:center;justify-content:center;' +
        'height:100vh;font-family:sans-serif;color:#cbd5e1;background:#0f172a;">Loading…</body>',
    )
    newWindow.opener = null
  } catch {
    // about:blank is same-origin, but keep the open path resilient if a
    // browser extension or policy blocks writes to the loading tab.
  }

  return newWindow
}

function explicitFolderPermission(
  permissions: FolderPermissions,
  userId: string,
): boolean | null {
  const value = permissions?.users?.[userId]
  return typeof value === "boolean" ? value : null
}

function folderPermissionAllowsUser(
  permissions: FolderPermissions,
  assignee: Pick<FolderAssignee, "id" | "role"> | null | undefined,
) {
  if (!assignee) return false
  if (permissions === null) return true

  const explicit = explicitFolderPermission(permissions, assignee.id)
  if (explicit !== null) return explicit

  return permissions[assignee.role as keyof Omit<NonNullable<FolderPermissions>, "users">] === true ||
    permissions.internal === true
}

function updateFolderUserPermission(
  permissions: FolderPermissions,
  userId: string,
  allowed: boolean,
): FolderPermissions {
  return {
    ...(permissions ?? {}),
    users: {
      ...(permissions?.users ?? {}),
      [userId]: allowed,
    },
  }
}

function folderRolePermissionAllows(
  permissions: FolderPermissions,
  role: FolderRolePermissionKey,
) {
  if (role === "admin") return true
  if (permissions === null) return true
  if (permissions.internal === true) return true
  return permissions[role] === true
}

function expandFolderRolePermissions(
  permissions: FolderPermissions,
): NonNullable<FolderPermissions> {
  const next: NonNullable<FolderPermissions> = { ...(permissions ?? {}) }

  if (permissions === null || permissions?.internal === true) {
    next.internal = false
    next.admin = true
    next.project_manager = true
    next.crew_member = true
    next.drafter = true
  }

  return next
}

function updateFolderRolePermission(
  permissions: FolderPermissions,
  role: FolderRolePermissionKey,
  allowed: boolean,
): FolderPermissions {
  const next = expandFolderRolePermissions(permissions)
  next[role] = allowed
  return next
}

function roleLabel(role: string) {
  if (role === "project_manager") return "Project Manager"
  if (role === "crew_member") return "Crew Worker"
  if (role === "drafter") return "Drafter"
  if (role === "admin") return "Admin"
  return role
}

function useAuthenticatedUrl(viewUrl: string | null): {
  blobUrl: string | null
  loading: boolean
  error: boolean
} {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!viewUrl) {
      setBlobUrl(null)
      setLoading(false)
      setError(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(false)
    setBlobUrl(null)

    api
      .get<Blob>(viewUrl, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return
        const url = URL.createObjectURL(res.data)
        setBlobUrl(url)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [viewUrl])

  // Revoke blob URLs when they change or on unmount.
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  return { blobUrl, loading, error }
}

export default function FileBrowser({
  mediaType,
  defaultView,
  jobIdOverride,
  scope = "job",
  rootLabel,
}: {
  mediaType: MediaType
  defaultView?: ViewMode
  jobIdOverride?: string
  scope?: ScopeMode
  rootLabel?: string
}) {
  const { jobId: jobIdParam } = useParams<{ jobId: string }>()
  const jobId = jobIdOverride ?? jobIdParam
  const user = useAuthStore((state) => state.user)
  const isResourceScope = scope === "resource"
  const showCrewPhotoNote = user?.role === "crew_member" && mediaType === "photo"

  const resolvedDefault: ViewMode =
    defaultView ?? (mediaType === "document" ? "list" : "grid")

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [currentFolder, setCurrentFolder] = useState<FolderItem | null>(null)
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([])
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [folderAssignees, setFolderAssignees] = useState<FolderAssignee[]>([])
  const [loading, setLoading] = useState(true)
  const [filesLoading, setFilesLoading] = useState(false)

  const [viewMode, setViewMode] = useState<ViewMode>(resolvedDefault)
  const [sortBy, setSortBy] = useState<SortOption>("name-asc")

  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [creatingFolder, setCreatingFolder] = useState(false)

  const [renameFolderTarget, setRenameFolderTarget] = useState<FolderItem | null>(null)
  const [renameFolderName, setRenameFolderName] = useState("")
  const [renamingFolder, setRenamingFolder] = useState(false)

  const [accessFolderTarget, setAccessFolderTarget] = useState<FolderItem | null>(null)
  const [accessViewingPermissions, setAccessViewingPermissions] =
    useState<FolderPermissions>(null)
  const [accessUploadingPermissions, setAccessUploadingPermissions] =
    useState<FolderPermissions>(null)
  const [savingFolderAccess, setSavingFolderAccess] = useState(false)

  const [deleteConfirmFolder, setDeleteConfirmFolder] = useState<FolderItem | null>(null)
  const [deletingFolder, setDeletingFolder] = useState(false)

  const [deleteConfirmFile, setDeleteConfirmFile] = useState<FileItem | null>(null)
  const [deletingFile, setDeletingFile] = useState(false)
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(() => new Set())
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [batchDestinationMode, setBatchDestinationMode] =
    useState<BatchDestinationMode | null>(null)
  const [destinationFolders, setDestinationFolders] = useState<FolderTreeItem[]>([])
  const [destinationFolderId, setDestinationFolderId] = useState("")
  const [destinationLoading, setDestinationLoading] = useState(false)
  const [batchDestinationSaving, setBatchDestinationSaving] = useState(false)

  type UploadTask = {
    id: number
    fileNames: string[]
    fileCount: number
    totalBytes: number
    loaded: number
    percent: number
    status: "uploading" | "retrying"
    retryAttempt: number
    retryReason: string | null
    abort: () => void
  }
  const [uploadTask, setUploadTask] = useState<UploadTask | null>(null)
  const uploading = uploadTask !== null
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([])
  const [uploadNote, setUploadNote] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filePreview = useFilePreview()
  const currentFolderIdRef = useRef<string | null>(currentFolderId)
  const folderLoadRequestRef = useRef(0)
  const fileLoadRequestRef = useRef(0)

  currentFolderIdRef.current = currentFolderId

  function setActiveFolderId(folderId: string | null) {
    currentFolderIdRef.current = folderId
    setCurrentFolderId(folderId)
  }

  function clearFilesForFolderChange() {
    fileLoadRequestRef.current += 1
    setFiles([])
    setFilesLoading(false)
    setSelectedFileIds(new Set())
  }

  function isCurrentFolderLoad(requestId: number, parentId: string | null) {
    return folderLoadRequestRef.current === requestId && currentFolderIdRef.current === parentId
  }

  function isCurrentFileLoad(requestId: number, folderId: string) {
    return fileLoadRequestRef.current === requestId && currentFolderIdRef.current === folderId
  }

  const loadFolders = (parentId: string | null = null) => {
    if (currentFolderIdRef.current !== parentId) return
    const requestId = ++folderLoadRequestRef.current
    setLoading(true)
    if (!isResourceScope && !jobId) {
      if (isCurrentFolderLoad(requestId, parentId)) {
        setFolders([])
        setCurrentFolder(null)
        setBreadcrumb([])
        setLoading(false)
      }
      return
    }
    const params = new URLSearchParams()
    if (!isResourceScope) {
      params.set("mediaType", mediaType)
    }
    if (parentId) params.set("parentId", parentId)
    api
      .get(
        isResourceScope
          ? `/resources/folders?${params}`
          : `/jobs/${jobId}/folders?${params}`,
	      )
	      .then((r) => {
        if (!isCurrentFolderLoad(requestId, parentId)) return
	        setFolders(r.data.folders ?? [])
	        setCurrentFolder(r.data.currentFolder ?? null)
	        setBreadcrumb(r.data.breadcrumb ?? [])
	      })
      .catch((err: unknown) => {
        if (!isCurrentFolderLoad(requestId, parentId)) return
        setFolders([])
        setBreadcrumb([])
        toastApiError(err, "Failed to load folders")
      })
      .finally(() => {
        if (isCurrentFolderLoad(requestId, parentId)) {
          setLoading(false)
        }
      })
  }

  const loadFiles = (folderId: string) => {
    if (currentFolderIdRef.current !== folderId) return
    const requestId = ++fileLoadRequestRef.current
    setFilesLoading(true)
    api
      .get(
        isResourceScope
          ? `/resources/folders/${folderId}/files`
          : `/folders/${folderId}/files?page=1&limit=100`,
      )
      .then((r) => {
        if (!isCurrentFileLoad(requestId, folderId)) return
        setFiles(r.data.files ?? [])
      })
      .catch((err: unknown) => {
        if (!isCurrentFileLoad(requestId, folderId)) return
        setFiles([])
        toastApiError(err, "Failed to load files")
      })
      .finally(() => {
        if (isCurrentFileLoad(requestId, folderId)) {
          setFilesLoading(false)
        }
      })
  }

	  useEffect(() => {
	    setActiveFolderId(null)
	    setCurrentFolder(null)
	    clearFilesForFolderChange()
	    setBreadcrumb([])
    setUploadError(null)
    setSelectedUploadFiles([])
    setUploadNote("")
    setBatchDeleteOpen(false)
    setBatchDestinationMode(null)
    setDestinationFolderId("")
	    loadFolders(null)
	  }, [jobId, mediaType, scope])

  useEffect(() => {
    const liveFileIds = new Set(files.map((file) => file.id))
    setSelectedFileIds((prev) => {
      const next = new Set(Array.from(prev).filter((fileId) => liveFileIds.has(fileId)))
      return next.size === prev.size ? prev : next
    })
  }, [files])

	  useEffect(() => {
	    if (user?.role !== "admin" || isResourceScope || !jobId) {
	      setFolderAssignees([])
	      return
	    }

	    api
	      .get(`/jobs/${jobId}/assignees`)
	      .then((r) => setFolderAssignees(r.data.assignees ?? []))
	      .catch((err: unknown) => toastApiError(err, "Failed to load job access"))
	  }, [user?.role, isResourceScope, jobId])

  const canManageFile = useCallback(
    (_file: FileItem): boolean => user?.role === "admin",
    [user?.role],
  )

  const handleDeleteFile = async () => {
    if (!deleteConfirmFile) return
    setDeletingFile(true)
    const isMissing = deleteConfirmFile.storageStatus === "missing"
    try {
      // For an orphan row (the underlying object is gone) we go straight to
      // /purge so admins don't have to do the soft-delete-then-empty-trash
      // dance just to clear an entry that's already broken.
      if (isMissing) {
        await api.delete(`/files/${deleteConfirmFile.id}/purge`)
        toast.success("Orphan file row removed")
      } else {
        await api.delete(`/files/${deleteConfirmFile.id}`)
        toast.success("File deleted")
      }
      setDeleteConfirmFile(null)
      if (currentFolderId) loadFiles(currentFolderId)
    } catch (err: unknown) {
      toastApiError(err, isMissing ? "Failed to remove orphan row" : "Failed to delete file")
    } finally {
      setDeletingFile(false)
    }
  }

	  const openFolder = (folder: FolderItem) => {
	    setActiveFolderId(folder.id)
	    setCurrentFolder(folder)
	    clearFilesForFolderChange()
	    loadFolders(folder.id)
	    loadFiles(folder.id)
	  }

	  const navigateTo = (folderId: string | null) => {
	    setActiveFolderId(folderId)
	    setCurrentFolder(folderId ? folders.find((folder) => folder.id === folderId) ?? null : null)
	    clearFilesForFolderChange()
	    loadFolders(folderId)
    if (folderId) loadFiles(folderId)
  }

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isResourceScope && !jobId) return
    if (!canCreateFoldersForScope) return
    setCreatingFolder(true)
    try {
      if (isResourceScope) {
        await api.post("/resources/folders", {
          title: newFolderName,
          parentFolderId: currentFolderId,
        })
      } else {
        await api.post(`/jobs/${jobId}/folders`, {
          title: newFolderName,
          mediaType,
          parentFolderId: currentFolderId,
        })
      }
      toast.success("Folder created")
      setCreateFolderOpen(false)
      setNewFolderName("")
      loadFolders(currentFolderId)
    } catch (err: unknown) {
      toastApiError(err, "Failed to create folder")
    } finally {
      setCreatingFolder(false)
    }
  }

	  const handleRenameFolder = async (e: React.FormEvent) => {
	    e.preventDefault()
	    if (!renameFolderTarget) return
	    setRenamingFolder(true)
    try {
      await api.put(`/folders/${renameFolderTarget.id}`, { title: renameFolderName })
      toast.success("Folder renamed")
      setRenameFolderTarget(null)
      loadFolders(currentFolderId)
    } catch (err: unknown) {
      toastApiError(err, "Failed to rename folder")
    } finally {
	      setRenamingFolder(false)
	    }
	  }

	  const openFolderAccess = (folder: FolderItem) => {
	    setAccessFolderTarget(folder)
	    setAccessViewingPermissions(folder.viewingPermissions)
	    setAccessUploadingPermissions(folder.uploadingPermissions)
	  }

	  const handleSaveFolderAccess = async () => {
	    if (!accessFolderTarget) return
	    setSavingFolderAccess(true)
	    try {
	      const response = await api.put(`/folders/${accessFolderTarget.id}`, {
	        viewingPermissions: accessViewingPermissions,
	        uploadingPermissions: accessUploadingPermissions,
	      })
	      const updatedFolder = response.data.folder as FolderItem
	      setFolders((prev) =>
	        prev.map((folder) => (folder.id === updatedFolder.id ? { ...folder, ...updatedFolder } : folder)),
	      )
	      setCurrentFolder((prev) =>
	        prev?.id === updatedFolder.id ? { ...prev, ...updatedFolder } : prev,
	      )
	      setAccessFolderTarget(null)
	      toast.success("Folder access saved")
	      loadFolders(currentFolderId)
	    } catch (err: unknown) {
	      toastApiError(err, "Failed to save folder access")
	    } finally {
	      setSavingFolderAccess(false)
	    }
	  }

	  const handleDeleteFolder = async () => {
    if (!deleteConfirmFolder) return
    setDeletingFolder(true)
    try {
      await api.delete(`/folders/${deleteConfirmFolder.id}`)
      toast.success("Folder deleted")
      setDeleteConfirmFolder(null)
      loadFolders(currentFolderId)
    } catch (err: unknown) {
      toastApiError(err, "Failed to delete folder")
    } finally {
      setDeletingFolder(false)
    }
  }

  const handleUploadSelection = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
    if (uploadTask) {
      toast.info("Wait for the current upload to finish or cancel it first.")
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }
    const nextFiles = Array.from(e.target.files)
    // Single helper runs the synchronous type/size/count checks and
    // then the async video-duration probe so a long clip is rejected
    // before the upload starts.
    const validationError = await validateSelectedFilesAsync(nextFiles, mediaType, jobFileValidationOptions)

    if (validationError) {
      setUploadError(validationError)
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }

    if (showCrewPhotoNote) {
      setUploadError(null)
      setSelectedUploadFiles(nextFiles)
      setUploadDialogOpen(true)
      return
    }

    // Instant upload — no dialog
    if (fileInputRef.current) fileInputRef.current.value = ""
    void uploadFilesImmediately(nextFiles)
  }

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (uploadTask) return
    if (!currentFolderId || selectedUploadFiles.length === 0) {
      setUploadError("Select at least one file to upload.")
      return
    }

    if (showCrewPhotoNote && uploadNote.trim().length === 0) {
      setUploadError("A note is required when crew members upload photos.")
      return
    }

    // Capture the per-file duration the same way the validator does so
    // the server can persist it once instead of every render re-decoding
    // the clip (Task #368). Probe failures yield null and we still
    // upload — the column is purely a UX hint.
    const durations = await probeVideoDurations(selectedUploadFiles)
    const controller = new AbortController()
    const totalBytes = selectedUploadFiles.reduce((sum, f) => sum + f.size, 0)
    const taskId = Date.now()
    setUploadTask({
      id: taskId,
      fileNames: selectedUploadFiles.map((f) => f.name),
      fileCount: selectedUploadFiles.length,
      totalBytes,
      loaded: 0,
      percent: 0,
      status: "uploading",
      retryAttempt: 0,
      retryReason: null,
      abort: () => controller.abort(),
    })
    try {
      await uploadFilesWithProgress({
        files: selectedUploadFiles,
        note: uploadNote.trim(),
        durations,
        controller,
        taskId,
        totalBytes,
      })
      toast.success(`${selectedUploadFiles.length} file(s) uploaded`)
      setUploadDialogOpen(false)
      setSelectedUploadFiles([])
      setUploadNote("")
      loadFiles(currentFolderId)
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "UPLOAD_ABORTED") {
        toast.info("Upload cancelled")
      } else {
        toastApiError(err, "Upload failed")
      }
    } finally {
      setUploadTask(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const buildFileViewUrl = (fileId: string): string | null => {
    if (!currentFolderId) return null
    return isResourceScope
      ? `/resources/folders/${currentFolderId}/files/${fileId}/view`
      : `/folders/${currentFolderId}/files/${fileId}/view`
  }

  const handleDownload = async (file: FileItem) => {
    if (file.storageStatus === "missing" || !file.fileUrl) {
      toast.error("This file isn't available to download.")
      return
    }

    const progressToast = toast.loading("Preparing download…")
    try {
      const res = await api.post<SignedFileUrlResponse>(`/files/${file.id}/signed-download`)
      const signedUrl = res.data.url
      if (!signedUrl) throw new Error("Missing signed download URL")
      toast.dismiss(progressToast)
      window.location.assign(signedUrl)
    } catch (err: unknown) {
      toast.dismiss(progressToast)
      toastApiError(err, "Failed to download file")
    }
  }

  const handleViewInNewTab = (file: FileItem) => {
    if (file.storageStatus === "missing" || !file.fileUrl) {
      toast.error("This file isn't available to open.")
      return
    }

    // Open the new tab synchronously inside the click handler so browsers keep
    // treating it as a direct user action while we mint the signed URL.
    const newWindow = openLoadingTab()
    if (!newWindow) return

    api
      .post<SignedFileUrlResponse>(`/files/${file.id}/signed-view`)
      .then((res) => {
        const signedUrl = res.data.url
        if (!signedUrl) throw new Error("Missing signed view URL")
        newWindow.location.replace(signedUrl)
      })
      .catch((err: unknown) => {
        try {
          newWindow.close()
        } catch {
          // ignore
        }
        toastApiError(err, "Failed to open file")
      })
  }

  const sortedFolders = useMemo(() => {
    const arr = [...folders]
    switch (sortBy) {
      case "name-asc":
        arr.sort((a, b) => a.title.localeCompare(b.title))
        break
      case "name-desc":
        arr.sort((a, b) => b.title.localeCompare(a.title))
        break
      case "date-desc":
        arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        break
      case "date-asc":
        arr.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        break
      case "size-desc":
        arr.sort((a, b) => b.fileCount - a.fileCount)
        break
      case "size-asc":
        arr.sort((a, b) => a.fileCount - b.fileCount)
        break
    }
    return arr
  }, [folders, sortBy])

  const sortedFiles = useMemo(() => {
    const arr = [...files]
    const name = (f: FileItem) => displayName(f).toLowerCase()
    switch (sortBy) {
      case "name-asc":
        arr.sort((a, b) => name(a).localeCompare(name(b)))
        break
      case "name-desc":
        arr.sort((a, b) => name(b).localeCompare(name(a)))
        break
      case "date-desc":
        arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        break
      case "date-asc":
        arr.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        break
      case "size-desc":
        arr.sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0))
        break
      case "size-asc":
        arr.sort((a, b) => (a.fileSize ?? 0) - (b.fileSize ?? 0))
        break
    }
    return arr
  }, [files, sortBy])

  const batchSelectionEnabled = !isResourceScope
  const selectedFiles = useMemo(
    () => sortedFiles.filter((file) => selectedFileIds.has(file.id)),
    [selectedFileIds, sortedFiles],
  )
  const selectedFileIdsList = useMemo(
    () => selectedFiles.map((file) => file.id),
    [selectedFiles],
  )
  const downloadableSelectedFiles = useMemo(
    () => selectedFiles.filter((file) => file.storageStatus !== "missing" && !!file.fileUrl),
    [selectedFiles],
  )
  const allVisibleFilesSelected =
    sortedFiles.length > 0 && sortedFiles.every((file) => selectedFileIds.has(file.id))
  const canBatchManageFiles = user?.role === "admin" && batchSelectionEnabled

  const clearSelectedFiles = useCallback(() => {
    setSelectedFileIds(new Set())
  }, [])

  const toggleFileSelection = useCallback((fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev)
      if (next.has(fileId)) {
        next.delete(fileId)
      } else {
        next.add(fileId)
      }
      return next
    })
  }, [])

  const toggleAllVisibleFiles = useCallback(() => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev)
      if (sortedFiles.length > 0 && sortedFiles.every((file) => next.has(file.id))) {
        for (const file of sortedFiles) next.delete(file.id)
      } else {
        for (const file of sortedFiles) next.add(file.id)
      }
      return next
    })
  }, [sortedFiles])

  const handleBatchDownload = async () => {
    const fileIds = downloadableSelectedFiles.map((file) => file.id)
    if (fileIds.length === 0) return

    try {
      const res = await api.post<Blob>(
        "/files/batch/download",
        { fileIds },
        { responseType: "blob" },
      )
      const objectUrl = URL.createObjectURL(res.data)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = `selected-${mediaType}-files.zip`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(objectUrl)

      const skippedCount = selectedFiles.length - downloadableSelectedFiles.length
      if (skippedCount > 0) {
        toast.info(
          `Downloaded ${fileIds.length} file${fileIds.length === 1 ? "" : "s"}; skipped ${skippedCount} unavailable file${skippedCount === 1 ? "" : "s"}.`,
        )
      } else {
        toast.success(`Downloaded ${fileIds.length} file${fileIds.length === 1 ? "" : "s"}`)
      }
    } catch (err: unknown) {
      toastApiError(err, "Failed to download selected files")
    }
  }

  const openBatchDestinationDialog = async (mode: BatchDestinationMode) => {
    if (!jobId || isResourceScope || selectedFiles.length === 0) return
    setBatchDestinationMode(mode)
    setDestinationFolderId("")
    setDestinationLoading(true)

    try {
      const response = await api.get(`/jobs/${jobId}/folder-tree?mediaType=${mediaType}`)
      const folders = (response.data.folders ?? []) as FolderTreeItem[]
      setDestinationFolders(folders.filter((folder) => folder.id !== currentFolderId))
    } catch (err: unknown) {
      setBatchDestinationMode(null)
      toastApiError(err, "Failed to load destination folders")
    } finally {
      setDestinationLoading(false)
    }
  }

  const handleBatchDestinationSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!batchDestinationMode || !destinationFolderId || selectedFileIdsList.length === 0) return

    setBatchDestinationSaving(true)
    const endpoint =
      batchDestinationMode === "move" ? "/files/batch/move" : "/files/batch/copy"
    const verb = batchDestinationMode === "move" ? "moved" : "copied"

    try {
      await api.post(endpoint, {
        fileIds: selectedFileIdsList,
        destinationFolderId,
      })
      toast.success(
        `${selectedFileIdsList.length} file${selectedFileIdsList.length === 1 ? "" : "s"} ${verb}`,
      )
      setBatchDestinationMode(null)
      setDestinationFolderId("")
      clearSelectedFiles()
      if (currentFolderId) {
        loadFiles(currentFolderId)
        loadFolders(currentFolderId)
      }
    } catch (err: unknown) {
      toastApiError(
        err,
        `Failed to ${batchDestinationMode === "move" ? "move" : "copy"} selected files`,
      )
    } finally {
      setBatchDestinationSaving(false)
    }
  }

  const handleBatchDeleteFiles = async () => {
    if (selectedFileIdsList.length === 0) return
    setBatchDeleting(true)

    try {
      await api.post("/files/batch/delete", { fileIds: selectedFileIdsList })
      toast.success(
        `${selectedFileIdsList.length} file${selectedFileIdsList.length === 1 ? "" : "s"} deleted`,
      )
      setBatchDeleteOpen(false)
      clearSelectedFiles()
      if (currentFolderId) {
        loadFiles(currentFolderId)
        loadFolders(currentFolderId)
      }
    } catch (err: unknown) {
      toastApiError(err, "Failed to delete selected files")
    } finally {
      setBatchDeleting(false)
    }
  }

  const fileItemToPreview = useCallback(
    (file: FileItem): PreviewFile => ({
      id: file.id,
      fileId: file.id,
      viewUrl: buildFileViewUrl(file.id),
      name: displayName(file),
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      uploadedByName: file.uploadedByName,
      createdAt: file.createdAt,
    }),
    // buildFileViewUrl depends on currentFolderId / scope which are stable
    // within this render; the resulting preview list is also rebuilt below
    // each time it's opened, so no stale-closure risk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentFolderId, isResourceScope],
  )

  const openFilePreview = (file: FileItem) => {
    const idx = sortedFiles.findIndex((f) => f.id === file.id)
    const previewFiles = sortedFiles.map(fileItemToPreview)
    filePreview.open(previewFiles, idx >= 0 ? idx : 0)
  }

  const mediaLabel =
    mediaType === "document" ? "Documents" : mediaType === "photo" ? "Photos" : "Videos"
	  const rootFolderLabel = rootLabel ?? mediaLabel
	  const canToggleView = true
	  const canManageFolders = user?.role === "admin"
	  const canCreateFoldersForScope = user?.role === "admin"
	  const currentUserForFolder =
	    user ? { id: user.id, role: user.role } : null
	  const currentFolderAllowsUpload =
	    !!currentFolderId &&
	    folderPermissionAllowsUser(currentFolder?.uploadingPermissions ?? null, currentUserForFolder)
	  const canUploadFiles =
	    !!currentFolderId &&
	    (user?.role === "admin" ||
	      (!isResourceScope && currentFolderAllowsUpload))

  const jobFileValidationOptions = useMemo(
    () => (isResourceScope ? undefined : { maxFileSizeBytes: Number.POSITIVE_INFINITY }),
    [isResourceScope],
  )

  async function uploadFilesWithProgress(params: {
    files: File[]
    note?: string
    durations: Array<number | null>
    controller: AbortController
    taskId: number
    totalBytes: number
  }) {
    if (!currentFolderId) return
    const shouldUseChunkedJobUpload =
      !isResourceScope &&
      (mediaType !== "document" ||
        params.files.some((file) => file.size > DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES))

    if (!shouldUseChunkedJobUpload) {
      const formData = new FormData()
      params.files.forEach((file) => formData.append("files", file))
      if (params.note?.trim()) {
        formData.append("note", params.note.trim())
      }
      if (params.durations.some((d) => d != null)) {
        formData.append("videoDurations", JSON.stringify(params.durations))
      }

      await uploadWithProgress({
        url: isResourceScope
          ? `/resources/folders/${currentFolderId}/upload`
          : `/folders/${currentFolderId}/files`,
        formData,
        signal: params.controller.signal,
        onProgress: (p) =>
          setUploadTask((prev) =>
            prev && prev.id === params.taskId
              ? {
                  ...prev,
                  loaded: p.loaded,
                  totalBytes: p.total || prev.totalBytes,
                  percent: p.percent,
                  status: "uploading",
                }
              : prev,
          ),
        onRetry: (attempt, reason) => {
          setUploadTask((prev) =>
            prev && prev.id === params.taskId
              ? { ...prev, status: "retrying", retryAttempt: attempt, retryReason: reason }
              : prev,
          )
        },
      })
      return
    }

    let completedBytes = 0
    for (const [index, file] of params.files.entries()) {
      const updateProgress = (loadedForFile: number) => {
        const loaded = Math.min(params.totalBytes, completedBytes + loadedForFile)
        const percent =
          params.totalBytes > 0 ? Math.round((loaded / params.totalBytes) * 100) : 100
        setUploadTask((prev) =>
          prev && prev.id === params.taskId
            ? {
                ...prev,
                loaded,
                totalBytes: params.totalBytes,
                percent,
                status: "uploading",
              }
            : prev,
        )
      }

      if (mediaType !== "document" || file.size > DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES) {
        await uploadFileWithChunks({
          folderId: currentFolderId,
          file,
          note: params.note,
          videoDurationSeconds: params.durations[index] ?? null,
          signal: params.controller.signal,
          onProgress: (p) => updateProgress(p.loaded),
          onRetry: (attempt, reason) => {
            setUploadTask((prev) =>
              prev && prev.id === params.taskId
                ? { ...prev, status: "retrying", retryAttempt: attempt, retryReason: reason }
                : prev,
            )
          },
        })
      } else {
        const formData = new FormData()
        formData.append("files", file)
        if (params.note?.trim()) {
          formData.append("note", params.note.trim())
        }
        if (params.durations[index] != null) {
          formData.append("videoDurations", JSON.stringify([params.durations[index]]))
        }
        await uploadWithProgress({
          url: `/folders/${currentFolderId}/files`,
          formData,
          signal: params.controller.signal,
          onProgress: (p) => updateProgress(Math.min(file.size, p.loaded)),
          onRetry: (attempt, reason) => {
            setUploadTask((prev) =>
              prev && prev.id === params.taskId
                ? { ...prev, status: "retrying", retryAttempt: attempt, retryReason: reason }
                : prev,
            )
          },
        })
      }

      completedBytes += file.size
      updateProgress(file.size)
    }
  }

  async function uploadFilesImmediately(files: File[], note?: string) {
    if (!currentFolderId || files.length === 0) return
    if (uploadTask) {
      toast.info("Wait for the current upload to finish or cancel it first.")
      return
    }
    // Same per-file duration capture as the dialog upload path — see
    // Task #368.
    const durations = await probeVideoDurations(files)
    setUploadError(null)
    const controller = new AbortController()
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
    const taskId = Date.now()
    setUploadTask({
      id: taskId,
      fileNames: files.map((f) => f.name),
      fileCount: files.length,
      totalBytes,
      loaded: 0,
      percent: 0,
      status: "uploading",
      retryAttempt: 0,
      retryReason: null,
      abort: () => controller.abort(),
    })
    try {
      await uploadFilesWithProgress({
        files,
        note,
        durations,
        controller,
        taskId,
        totalBytes,
      })
      toast.success(`${files.length} file(s) uploaded`)
      loadFiles(currentFolderId)
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "UPLOAD_ABORTED") {
        toast.info("Upload cancelled")
      } else {
        toastApiError(err, "Upload failed")
      }
    } finally {
      setUploadTask(null)
    }
  }

  const onDrop = useCallback(
    async (droppedFiles: File[]) => {
      if (!canUploadFiles) return
      // Refuse a second concurrent upload — we only track one task and
      // letting another overwrite it would corrupt the progress UI.
      if (uploadTask) {
        toast.info("Wait for the current upload to finish or cancel it first.")
        return
      }
      const validationError = await validateSelectedFilesAsync(
        droppedFiles,
        mediaType,
        jobFileValidationOptions,
      )
      if (validationError) {
        setUploadError(validationError)
        return
      }
      if (showCrewPhotoNote) {
        // Crew photo uploads need a note — show the inline prompt
        setUploadError(null)
        setSelectedUploadFiles(droppedFiles)
        setUploadDialogOpen(true)
        return
      }
      // Instant upload — no dialog
      void uploadFilesImmediately(droppedFiles)
    },
    [canUploadFiles, currentFolderId, isResourceScope, mediaType, jobFileValidationOptions, showCrewPhotoNote, uploadTask],
  )

  const { getRootProps, getInputProps, isDragActive, open: openDropzone } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    disabled: !canUploadFiles || uploading,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm min-w-0">
          <button
            onClick={() => navigateTo(null)}
            className={`font-medium transition-colors shrink-0 ${
              currentFolderId ? "text-primary hover:underline" : "text-slate-900"
            }`}
          >
            {rootFolderLabel}
          </button>
          {breadcrumb.map((crumb) => (
            <span key={crumb.id} className="flex items-center gap-1.5 min-w-0">
              <ChevronRight className="size-3.5 text-slate-400 shrink-0" />
              <button
                onClick={() => navigateTo(crumb.id)}
                className={`font-medium transition-colors truncate ${
                  crumb.id === currentFolderId
                    ? "text-slate-900"
                    : "text-primary hover:underline"
                }`}
              >
                {crumb.title}
              </button>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Select
            value={sortBy}
            onValueChange={(v) => {
              if (isSortOption(v)) setSortBy(v)
            }}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name A–Z</SelectItem>
              <SelectItem value="name-desc">Name Z–A</SelectItem>
              <SelectItem value="date-desc">Newest First</SelectItem>
              <SelectItem value="date-asc">Oldest First</SelectItem>
              <SelectItem value="size-desc">Largest First</SelectItem>
              <SelectItem value="size-asc">Smallest First</SelectItem>
            </SelectContent>
          </Select>

          {canToggleView && (
            <div className="flex border border-[#E5E7EB] rounded-md overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={`px-2 py-1.5 transition-colors ${
                  viewMode === "grid"
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-500 hover:bg-slate-50"
                }`}
                title="Grid view"
              >
                <Grid2X2 className="size-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`px-2 py-1.5 border-l border-[#E5E7EB] transition-colors ${
                  viewMode === "list"
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-500 hover:bg-slate-50"
                }`}
                title="List view"
              >
                <List className="size-3.5" />
              </button>
            </div>
          )}

          {canUploadFiles && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={uploadAcceptForMediaType(mediaType)}
                className="hidden"
                onChange={handleUploadSelection}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setUploadError(null)
                  fileInputRef.current?.click()
                }}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 size-3.5" />
                )}
                Upload
              </Button>
            </>
          )}
          {canCreateFoldersForScope ? (
            <Button
              size="sm"
              onClick={() => {
                setNewFolderName("")
                setCreateFolderOpen(true)
              }}
            >
              <Plus className="mr-1.5 size-3.5" />
              New Folder
            </Button>
          ) : null}
        </div>
      </div>

      {uploadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {uploadError}
        </div>
      ) : null}

      {uploadTask ? (
        <div
          className={`rounded-lg border px-3 py-2.5 text-sm ${
            uploadTask.status === "retrying"
              ? "border-amber-200 bg-amber-50"
              : "border-primary/20 bg-primary/10"
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {uploadTask.status === "retrying" ? (
                <AlertTriangle className="size-4 shrink-0 text-amber-600" />
              ) : (
                <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
              )}
              <div className="min-w-0">
                <div
                  className={`font-medium ${
                    uploadTask.status === "retrying" ? "text-amber-800" : "text-primary"
                  }`}
                >
                  {uploadTask.status === "retrying"
                    ? `Retrying upload (attempt ${uploadTask.retryAttempt})…`
                    : `Uploading ${uploadTask.fileCount} file${uploadTask.fileCount === 1 ? "" : "s"}…`}
                </div>
                <div className="truncate text-xs text-slate-600">
                  {uploadTask.status === "retrying" && uploadTask.retryReason
                    ? uploadTask.retryReason
                    : uploadTask.fileNames.join(", ")}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs tabular-nums text-slate-600">
                {formatFileSize(uploadTask.loaded)} / {formatFileSize(uploadTask.totalBytes)} ·{" "}
                {uploadTask.percent}%
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-slate-600 hover:text-red-600"
                onClick={() => uploadTask.abort()}
                aria-label="Cancel upload"
              >
                <X className="mr-1 size-3.5" />
                Cancel
              </Button>
            </div>
          </div>
          <Progress value={uploadTask.percent} className="mt-2 h-1.5" />
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {sortedFolders.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {sortedFolders.map((folder) => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  isOpen={currentFolderId === folder.id}
                  showActions={canManageFolders && !folder.isGlobal}
                  onOpen={() => openFolder(folder)}
	                  onRename={() => {
	                    setRenameFolderTarget(folder)
	                    setRenameFolderName(folder.title)
	                  }}
	                  onAccess={() => openFolderAccess(folder)}
	                  onDelete={() => setDeleteConfirmFolder(folder)}
	                />
              ))}
            </div>
          )}

          {currentFolderId && (
            <div
              {...getRootProps()}
              className={`relative mt-3 rounded-lg transition-colors ${isDragActive ? "ring-2 ring-primary/40 ring-dashed bg-primary/10" : ""}`}
            >
              <input {...getInputProps({ className: "hidden" })} />
              {isDragActive && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary/40 bg-primary/10/80">
                  <Upload className="mb-2 size-6 text-primary" />
                  <span className="text-sm font-medium text-primary">Drop files here</span>
                </div>
              )}
              {filesLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded" />
                  ))}
                </div>
              ) : sortedFiles.length > 0 ? (
                <div>
                  {batchSelectionEnabled ? (
                    <BatchFileSelectionToolbar
                      selectedCount={selectedFiles.length}
                      visibleCount={sortedFiles.length}
                      allVisibleSelected={allVisibleFilesSelected}
                      downloadableCount={downloadableSelectedFiles.length}
                      canManage={canBatchManageFiles}
                      onToggleAll={toggleAllVisibleFiles}
                      onClear={clearSelectedFiles}
                      onDownload={handleBatchDownload}
                      onMove={() => void openBatchDestinationDialog("move")}
                      onCopy={() => void openBatchDestinationDialog("copy")}
                      onDelete={() => setBatchDeleteOpen(true)}
                    />
                  ) : null}
                  {mediaType === "photo" && viewMode === "grid" ? (
                    <PhotoGrid
                      files={sortedFiles}
                      buildViewUrl={buildFileViewUrl}
                      onOpenLightbox={openFilePreview}
                      onDownload={handleDownload}
                      onRequestDelete={setDeleteConfirmFile}
                      canManageFile={canManageFile}
                      selectionEnabled={batchSelectionEnabled}
                      selectedFileIds={selectedFileIds}
                      onToggleSelection={toggleFileSelection}
                    />
                  ) : mediaType === "video" && viewMode === "grid" ? (
                    <VideoGrid
                      files={sortedFiles}
                      onOpenPlayer={openFilePreview}
                      onDownload={handleDownload}
                      onRequestDelete={setDeleteConfirmFile}
                      canManageFile={canManageFile}
                      selectionEnabled={batchSelectionEnabled}
                      selectedFileIds={selectedFileIds}
                      onToggleSelection={toggleFileSelection}
                    />
                  ) : (
                    <FileTable
                      files={sortedFiles}
                      showDuration={mediaType === "video"}
                      mediaType={mediaType}
                      onOpenLightbox={mediaType === "photo" ? openFilePreview : undefined}
                      onOpenPlayer={mediaType === "video" ? openFilePreview : undefined}
                      onOpenInNewTab={handleViewInNewTab}
                      onDownload={handleDownload}
                      onRequestDelete={setDeleteConfirmFile}
                      canManageFile={canManageFile}
                      selectionEnabled={batchSelectionEnabled}
                      selectedFileIds={selectedFileIds}
                      onToggleSelection={toggleFileSelection}
                    />
                  )}
                  {canUploadFiles && (
                    <div
                      onClick={() => { setUploadError(null); openDropzone() }}
                      className={`mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 transition-colors ${
                        isDragActive ? "border-primary/40 bg-primary/10" : "border-slate-300 hover:border-primary/40 hover:bg-primary/10"
                      }`}
                    >
                      <Upload className="size-4 text-slate-400" />
                      <span className="text-sm text-slate-500">Drag files here or click to upload</span>
                    </div>
                  )}
                </div>
              ) : sortedFolders.length === 0 ? (
                canUploadFiles ? (
                  <div
                    onClick={() => { setUploadError(null); openDropzone() }}
                    className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-16 text-center transition-colors ${
                      isDragActive ? "border-primary/40 bg-primary/10" : "border-slate-300 hover:border-primary/40 hover:bg-primary/10"
                    }`}
                  >
                    <Upload className="mx-auto mb-3 size-8 text-slate-300" />
                    <p className="text-sm font-medium text-slate-500">Drag & drop files here, or click to upload</p>
                    {mediaType === "video" ? (
                      <p className="mt-1 text-xs text-slate-400">{videoUploadHint()}</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="py-16 text-center">
                    <FolderOpen className="mx-auto mb-3 size-8 text-slate-200" />
                    <p className="text-sm text-slate-400">This folder is empty.</p>
                  </div>
                )
              ) : canUploadFiles ? (
                <div
                  onClick={() => { setUploadError(null); openDropzone() }}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 text-center transition-colors ${
                    isDragActive ? "border-primary/40 bg-primary/10" : "border-slate-300 hover:border-primary/40 hover:bg-primary/10"
                  }`}
                >
                  <Upload className="mb-2 size-5 text-slate-300" />
                  <p className="text-sm text-slate-500">Drag & drop files here, or click to upload</p>
                  {mediaType === "video" ? (
                    <p className="mt-1 text-xs text-slate-400">{videoUploadHint()}</p>
                  ) : null}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-slate-400">
                  No files in this folder yet.
                </div>
              )}
            </div>
          )}

          {!currentFolderId && sortedFolders.length === 0 && (
            <div className="py-16 text-center">
              <Folder className="mx-auto mb-3 size-8 text-slate-200" />
              <p className="text-sm text-slate-400">No folders yet.</p>
              {canCreateFoldersForScope ? (
                <button
                  onClick={() => {
                    setNewFolderName("")
                    setCreateFolderOpen(true)
                  }}
                  className="mt-1 text-sm text-primary hover:underline"
                >
                  Create the first folder
                </button>
              ) : null}
            </div>
          )}
        </>
      )}

      <Dialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          // Don't allow the dialog to close while an upload is in flight —
          // the user should explicitly cancel via the Cancel button so we
          // can abort the request rather than orphan it.
          if (!open && uploading) return
          setUploadDialogOpen(open)
          if (!open) {
            setSelectedUploadFiles([])
            setUploadNote("")
            setUploadError(null)
            if (fileInputRef.current) fileInputRef.current.value = ""
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a note for your photos</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUploadSubmit} className="space-y-4">
            <div className="text-sm text-slate-500">
              {selectedUploadFiles.length} file{selectedUploadFiles.length === 1 ? "" : "s"} selected
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="upload-note">Note (required)</Label>
              <Input
                id="upload-note"
                value={uploadNote}
                autoFocus
                onChange={(event) => setUploadNote(event.target.value)}
                placeholder="Describe the area or work shown in these photos"
                required
                disabled={uploading}
              />
            </div>

            {uploadTask ? (
              <div
                className={`rounded-lg border px-3 py-2.5 text-sm ${
                  uploadTask.status === "retrying"
                    ? "border-amber-200 bg-amber-50"
                    : "border-primary/20 bg-primary/10"
                }`}
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-2">
                  {uploadTask.status === "retrying" ? (
                    <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                  ) : (
                    <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                  )}
                  <div
                    className={`font-medium ${
                      uploadTask.status === "retrying" ? "text-amber-800" : "text-primary"
                    }`}
                  >
                    {uploadTask.status === "retrying"
                      ? `Retrying upload (attempt ${uploadTask.retryAttempt})…`
                      : `Uploading ${uploadTask.fileCount} file${uploadTask.fileCount === 1 ? "" : "s"}…`}
                  </div>
                </div>
                {uploadTask.status === "retrying" && uploadTask.retryReason ? (
                  <div className="mt-1 truncate text-xs text-slate-600">
                    {uploadTask.retryReason}
                  </div>
                ) : null}
                <Progress value={uploadTask.percent} className="mt-2 h-1.5" />
                <div className="mt-1 text-right text-xs tabular-nums text-slate-600">
                  {formatFileSize(uploadTask.loaded)} / {formatFileSize(uploadTask.totalBytes)} ·{" "}
                  {uploadTask.percent}%
                </div>
              </div>
            ) : null}

            {uploadError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {uploadError}
              </div>
            ) : null}

            <DialogFooter>
              {uploading ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => uploadTask?.abort()}
                >
                  <X className="mr-1.5 size-3.5" />
                  Cancel upload
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setUploadDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">Upload</Button>
                </>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateFolder}>
            <div className="py-4 space-y-1.5">
              <Label htmlFor="folder-name">Folder Name *</Label>
              <Input
                id="folder-name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                required
                placeholder="e.g. Blueprints"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateFolderOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creatingFolder}>
                {creatingFolder && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

	      <Dialog
	        open={!!renameFolderTarget}
	        onOpenChange={(open) => {
	          if (!open) setRenameFolderTarget(null)
	        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRenameFolder}>
            <div className="py-4 space-y-1.5">
              <Label htmlFor="rename-folder-name">Folder Name *</Label>
              <Input
                id="rename-folder-name"
                value={renameFolderName}
                onChange={(e) => setRenameFolderName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameFolderTarget(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={renamingFolder}>
                {renamingFolder && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
	        </DialogContent>
	      </Dialog>

	      <Dialog
	        open={!!accessFolderTarget}
	        onOpenChange={(open) => {
	          if (!open && !savingFolderAccess) setAccessFolderTarget(null)
	        }}
	      >
	        <DialogContent className="sm:max-w-lg">
	          <DialogHeader>
	            <DialogTitle>Folder Access</DialogTitle>
	          </DialogHeader>
	          <div className="space-y-5 py-2">
	            <div className="space-y-2">
	              <div className="px-1 text-sm font-semibold text-slate-900">Roles</div>
	              <div className="grid grid-cols-[1fr_72px_72px] items-center gap-3 border-b border-slate-200 px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
	                <span>Role</span>
	                <span className="text-center">View</span>
	                <span className="text-center">Upload</span>
	              </div>
	              {folderAccessRoles.map((role) => {
	                const canView = folderRolePermissionAllows(accessViewingPermissions, role.key)
	                const canUpload = folderRolePermissionAllows(accessUploadingPermissions, role.key)

	                return (
	                  <div
	                    key={role.key}
	                    className="grid grid-cols-[1fr_72px_72px] items-center gap-3 rounded-lg border border-slate-200 px-3 py-2"
	                  >
	                    <div className="min-w-0">
	                      <div className="truncate text-sm font-medium text-slate-900">
	                        {role.label}
	                      </div>
	                      <div className="truncate text-xs text-slate-500">
	                        {role.description}
	                      </div>
	                    </div>
	                    <div className="flex justify-center">
	                      <Switch
	                        checked={canView}
	                        disabled={role.locked || savingFolderAccess}
	                        onCheckedChange={(checked) =>
	                          setAccessViewingPermissions((prev) =>
	                            updateFolderRolePermission(prev, role.key, checked),
	                          )
	                        }
	                        aria-label={`${role.label} can view ${accessFolderTarget?.title ?? "folder"}`}
	                      />
	                    </div>
	                    <div className="flex justify-center">
	                      <Switch
	                        checked={canUpload}
	                        disabled={role.locked || savingFolderAccess}
	                        onCheckedChange={(checked) =>
	                          setAccessUploadingPermissions((prev) =>
	                            updateFolderRolePermission(prev, role.key, checked),
	                          )
	                        }
	                        aria-label={`${role.label} can upload to ${accessFolderTarget?.title ?? "folder"}`}
	                      />
	                    </div>
	                  </div>
	                )
	              })}
	            </div>

	            <div className="space-y-2">
	              <div className="px-1 text-sm font-semibold text-slate-900">People</div>
	              <div className="grid grid-cols-[1fr_72px_72px] items-center gap-3 border-b border-slate-200 px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
	                <span>Person</span>
	                <span className="text-center">View</span>
	                <span className="text-center">Upload</span>
	              </div>
	              {folderAssignees.length === 0 ? (
	                <div className="rounded-lg border border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
	                  Assign people to this job first.
	                </div>
	              ) : (
	                folderAssignees.map((assignee) => {
	                  const canView = folderPermissionAllowsUser(accessViewingPermissions, assignee)
	                  const canUpload = folderPermissionAllowsUser(accessUploadingPermissions, assignee)

	                  return (
	                    <div
	                      key={assignee.id}
	                      className="grid grid-cols-[1fr_72px_72px] items-center gap-3 rounded-lg border border-slate-200 px-3 py-2"
	                    >
	                      <div className="min-w-0">
	                        <div className="truncate text-sm font-medium text-slate-900">
	                          {assignee.fullName}
	                        </div>
	                        <div className="truncate text-xs text-slate-500">
	                          {roleLabel(assignee.role)}
	                        </div>
	                      </div>
	                      <div className="flex justify-center">
	                        <Switch
	                          checked={canView}
	                          disabled={savingFolderAccess}
	                          onCheckedChange={(checked) =>
	                            setAccessViewingPermissions((prev) =>
	                              updateFolderUserPermission(prev, assignee.id, checked),
	                            )
	                          }
	                          aria-label={`${assignee.fullName} can view ${accessFolderTarget?.title ?? "folder"}`}
	                        />
	                      </div>
	                      <div className="flex justify-center">
	                        <Switch
	                          checked={canUpload}
	                          disabled={savingFolderAccess}
	                          onCheckedChange={(checked) =>
	                            setAccessUploadingPermissions((prev) =>
	                              updateFolderUserPermission(prev, assignee.id, checked),
	                            )
	                          }
	                          aria-label={`${assignee.fullName} can upload to ${accessFolderTarget?.title ?? "folder"}`}
	                        />
	                      </div>
	                    </div>
	                  )
	                })
	              )}
	            </div>
	          </div>
	          <DialogFooter>
	            <Button
	              type="button"
	              variant="outline"
	              onClick={() => setAccessFolderTarget(null)}
	              disabled={savingFolderAccess}
	            >
	              Cancel
	            </Button>
	            <Button
	              type="button"
	              onClick={handleSaveFolderAccess}
	              disabled={savingFolderAccess}
	            >
	              {savingFolderAccess && <Loader2 className="mr-2 size-3.5 animate-spin" />}
	              Save Access
	            </Button>
	          </DialogFooter>
	        </DialogContent>
	      </Dialog>

	      <AlertDialog
	        open={!!deleteConfirmFolder}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmFolder(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteConfirmFolder?.title}" and all its contents will be permanently deleted. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFolder}
              disabled={deletingFolder}
              className="bg-red-600 hover:bg-red-700"
            >
              {deletingFolder && <Loader2 className="mr-2 size-3.5 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deleteConfirmFile}
        onOpenChange={(open) => {
          if (!open && !deletingFile) setDeleteConfirmFile(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            {deleteConfirmFile?.storageStatus === "missing" ? (
              <>
                <AlertDialogTitle>Remove this orphan file row?</AlertDialogTitle>
                <AlertDialogDescription>
                  "{deleteConfirmFile ? displayName(deleteConfirmFile) : ""}"
                  no longer has an underlying upload. The database row will be
                  permanently removed. This cannot be undone.
                </AlertDialogDescription>
              </>
            ) : (
              <>
                <AlertDialogTitle>Delete this file?</AlertDialogTitle>
                <AlertDialogDescription>
                  "{deleteConfirmFile ? displayName(deleteConfirmFile) : ""}" will be
                  moved to trash. An admin can restore it from the database within
                  30 days.
                </AlertDialogDescription>
              </>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingFile}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Stop the AlertDialog's default close-on-click so we can await
                // the network call and show a spinner on the button.
                e.preventDefault()
                void handleDeleteFile()
              }}
              disabled={deletingFile}
              className="bg-red-600 hover:bg-red-700"
            >
              {deletingFile && <Loader2 className="mr-2 size-3.5 animate-spin" />}
              {deleteConfirmFile?.storageStatus === "missing" ? "Remove permanently" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={batchDeleteOpen}
        onOpenChange={(open) => {
          if (!open && !batchDeleting) setBatchDeleteOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected files?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedFiles.length} selected file{selectedFiles.length === 1 ? "" : "s"} will be
              moved to trash. An admin can restore them from the database within 30 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleBatchDeleteFiles()
              }}
              disabled={batchDeleting || selectedFileIdsList.length === 0}
              className="bg-red-600 hover:bg-red-700"
            >
              {batchDeleting && <Loader2 className="mr-2 size-3.5 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={batchDestinationMode !== null}
        onOpenChange={(open) => {
          if (!open && !batchDestinationSaving) {
            setBatchDestinationMode(null)
            setDestinationFolderId("")
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleBatchDestinationSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {batchDestinationMode === "copy" ? "Copy selected files" : "Move selected files"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="batch-destination-folder">Destination folder</Label>
              <Select
                value={destinationFolderId}
                onValueChange={setDestinationFolderId}
                disabled={destinationLoading || batchDestinationSaving}
              >
                <SelectTrigger id="batch-destination-folder">
                  <SelectValue
                    placeholder={
                      destinationLoading ? "Loading folders..." : "Choose a folder"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {destinationFolders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.path ?? folder.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!destinationLoading && destinationFolders.length === 0 ? (
                <p className="text-xs text-slate-500">No other folders available.</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setBatchDestinationMode(null)
                  setDestinationFolderId("")
                }}
                disabled={batchDestinationSaving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  batchDestinationSaving ||
                  destinationLoading ||
                  !destinationFolderId ||
                  selectedFileIdsList.length === 0
                }
              >
                {batchDestinationSaving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                {batchDestinationMode === "copy" ? "Copy" : "Move"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  )
}

function FolderCard({
  folder,
  isOpen,
  showActions,
	  onOpen,
	  onRename,
	  onAccess,
	  onDelete,
	}: {
	  folder: FolderItem
	  isOpen: boolean
	  showActions: boolean
	  onOpen: () => void
	  onRename: () => void
	  onAccess: () => void
	  onDelete: () => void
	}) {
  return (
    <div className="relative group flex flex-col gap-2 px-4 py-3 rounded-xl border border-[#E5E7EB] bg-white hover:border-primary/20 hover:bg-primary/5 transition-colors cursor-pointer select-none">
      <button
        className="absolute inset-0 rounded-xl"
        onClick={onOpen}
        aria-label={`Open ${folder.title}`}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          {isOpen ? (
            <FolderOpen className="size-8 text-yellow-400 shrink-0" />
          ) : (
            <Folder className="size-8 text-yellow-400 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate leading-tight">
              {folder.title}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {folder.fileCount} file{folder.fileCount !== 1 ? "s" : ""}
              {folder.childFolderCount > 0 &&
                ` · ${folder.childFolderCount} subfolder${folder.childFolderCount !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>

        <div className="relative z-10">
          {showActions ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Folder options"
                >
                  <MoreHorizontal className="size-4" />
                </button>
	              </DropdownMenuTrigger>
	              <DropdownMenuContent align="end" className="w-40">
	                <DropdownMenuItem
	                  onClick={(e) => {
	                    e.stopPropagation()
	                    onAccess()
	                  }}
	                >
	                  Access
	                </DropdownMenuItem>
	                <DropdownMenuItem
	                  onClick={(e) => {
	                    e.stopPropagation()
                    onRename()
                  }}
                >
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete()
                  }}
                  className="text-red-600 focus:text-red-600"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SelectionToggleButton({
  selected,
  label,
  className = "",
  onToggle,
}: {
  selected: boolean
  label: string
  className?: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={`inline-flex size-7 items-center justify-center rounded-md border transition-colors ${
        selected
          ? "border-primary/40 bg-primary/100 text-white"
          : "border-slate-200 text-slate-500 hover:border-primary/40 hover:text-primary"
      } ${className}`}
      aria-pressed={selected}
      aria-label={label}
      title={label}
    >
      {selected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
    </button>
  )
}

function AuthPhoto({
  file,
  viewUrl,
  onClick,
  onDownload,
  onRequestDelete,
  canManage,
  selectionEnabled,
  selected,
  onToggleSelection,
}: {
  file: FileItem
  viewUrl: string | null
  onClick: () => void
  onDownload: (file: FileItem) => void
  onRequestDelete: (file: FileItem) => void
  canManage: boolean
  selectionEnabled: boolean
  selected: boolean
  onToggleSelection: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Start as hidden — only once the card has been in (or near) the viewport
  // do we hand a real URL to useAuthenticatedUrl. This prevents large photo
  // folders from eagerly downloading every original image on mount.
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (isVisible) return
    const node = containerRef.current
    if (!node) return

    // If the browser doesn't support IntersectionObserver, fall back to
    // loading immediately so we never leave cards permanently blank.
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true)
            observer.disconnect()
            break
          }
        }
      },
      { rootMargin: "200px" },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [isVisible])

  const isMissing = file.storageStatus === "missing"
  const { blobUrl, loading, error } = useAuthenticatedUrl(
    isVisible && !isMissing ? viewUrl : null,
  )

  if (isMissing) {
    return (
      <div
        ref={containerRef}
        className="group relative flex flex-col rounded-xl overflow-hidden border border-amber-200 bg-amber-50 text-left"
      >
        <div className="flex flex-col text-left">
          <div className="relative aspect-square overflow-hidden bg-amber-50">
            <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 px-3 text-center text-amber-700">
              <AlertTriangle className="size-7" />
              <span className="text-xs font-semibold">
                Original file unavailable
              </span>
            </div>
          </div>
          <div className="px-2.5 py-2 border-t border-amber-200 bg-white w-full">
            <p className="text-xs font-medium text-slate-800 truncate">{displayName(file)}</p>
            <p className="text-xs text-amber-600">Upload missing from storage</p>
            {file.note ? (
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{file.note}</p>
            ) : null}
          </div>
        </div>

        {selectionEnabled ? (
          <SelectionToggleButton
            selected={selected}
            label={`Select ${displayName(file)}`}
            className="absolute top-1.5 left-1.5 z-10 bg-white/95 shadow-sm"
            onToggle={onToggleSelection}
          />
        ) : null}
        <div className="absolute top-1.5 right-1.5 z-10">
          <FileActionsMenu
            file={file}
            canManage={canManage}
            onDownload={onDownload}
            onRequestDelete={onRequestDelete}
            triggerClassName="p-1 rounded-md bg-white/90 text-slate-600 hover:text-slate-900 hover:bg-white shadow-sm"
          />
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="group relative flex flex-col rounded-xl overflow-hidden border border-[#E5E7EB] bg-slate-100 hover:border-primary/40 transition-colors text-left"
    >
      <button onClick={onClick} className="flex flex-col text-left">
        <div className="relative aspect-square overflow-hidden bg-slate-100">
          {!isVisible && (
            <div className="flex h-full w-full items-center justify-center text-slate-300" aria-hidden="true">
              <ImageIcon className="size-7" />
            </div>
          )}
          {isVisible && loading && !blobUrl && (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 className="size-5 text-slate-300 animate-spin" />
            </div>
          )}
          {blobUrl && (
            <img
              src={blobUrl}
              alt={displayName(file)}
              className="w-full h-full object-cover transition-transform group-hover:scale-105"
            />
          )}
          {isVisible && error && !loading && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-400">
              <ImageIcon className="size-7" />
              <span className="text-[11px] font-medium">Preview unavailable</span>
            </div>
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors" />
        </div>
        <div className="px-2.5 py-2 border-t border-[#E5E7EB] bg-white w-full">
          <p className="text-xs font-medium text-slate-800 truncate">{displayName(file)}</p>
          <p className="text-xs text-slate-400">{formatFileSize(file.fileSize)}</p>
          {file.note ? (
            <p className="mt-1 line-clamp-2 text-xs text-slate-500">{file.note}</p>
          ) : null}
        </div>
      </button>

      {selectionEnabled ? (
        <SelectionToggleButton
          selected={selected}
          label={`Select ${displayName(file)}`}
          className="absolute top-1.5 left-1.5 z-10 bg-white/95 shadow-sm"
          onToggle={onToggleSelection}
        />
      ) : null}
      <div className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <FileActionsMenu
          file={file}
          canManage={canManage}
          onOpen={onClick}
          onDownload={onDownload}
          onRequestDelete={onRequestDelete}
          triggerClassName="p-1 rounded-md bg-white/90 text-slate-600 hover:text-slate-900 hover:bg-white shadow-sm"
        />
      </div>
    </div>
  )
}

function BatchFileSelectionToolbar({
  selectedCount,
  visibleCount,
  allVisibleSelected,
  downloadableCount,
  canManage,
  onToggleAll,
  onClear,
  onDownload,
  onMove,
  onCopy,
  onDelete,
}: {
  selectedCount: number
  visibleCount: number
  allVisibleSelected: boolean
  downloadableCount: number
  canManage: boolean
  onToggleAll: () => void
  onClear: () => void
  onDownload: () => void
  onMove: () => void
  onCopy: () => void
  onDelete: () => void
}) {
  const hasSelection = selectedCount > 0

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8"
          onClick={onToggleAll}
          disabled={visibleCount === 0}
        >
          {allVisibleSelected ? (
            <CheckSquare className="mr-1.5 size-3.5" />
          ) : (
            <Square className="mr-1.5 size-3.5" />
          )}
          {allVisibleSelected ? "Deselect all" : "Select all"}
        </Button>
        <span className="text-xs font-medium text-slate-600">
          {selectedCount} selected
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8"
          onClick={onDownload}
          disabled={downloadableCount === 0}
          title="Download selected files as a ZIP"
        >
          <Download className="mr-1.5 size-3.5" />
          ZIP
        </Button>
        {canManage ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={onCopy}
              disabled={!hasSelection}
              title="Copy selected files"
            >
              <Copy className="mr-1.5 size-3.5" />
              Copy
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={onMove}
              disabled={!hasSelection}
              title="Move selected files"
            >
              <Scissors className="mr-1.5 size-3.5" />
              Move
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={onDelete}
              disabled={!hasSelection}
              title="Delete selected files"
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Delete
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 px-2"
          onClick={onClear}
          disabled={!hasSelection}
          title="Clear selection"
          aria-label="Clear selected files"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function PhotoGrid({
  files,
  buildViewUrl,
  onOpenLightbox,
  onDownload,
  onRequestDelete,
  canManageFile,
  selectionEnabled,
  selectedFileIds,
  onToggleSelection,
}: {
  files: FileItem[]
  buildViewUrl: (fileId: string) => string | null
  onOpenLightbox: (file: FileItem) => void
  onDownload: (file: FileItem) => void
  onRequestDelete: (file: FileItem) => void
  canManageFile: (file: FileItem) => boolean
  selectionEnabled: boolean
  selectedFileIds: Set<string>
  onToggleSelection: (fileId: string) => void
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {files.map((file) => (
        <AuthPhoto
          key={file.id}
          file={file}
          viewUrl={buildViewUrl(file.id)}
          onClick={() => onOpenLightbox(file)}
          onDownload={onDownload}
          onRequestDelete={onRequestDelete}
          canManage={canManageFile(file)}
          selectionEnabled={selectionEnabled}
          selected={selectedFileIds.has(file.id)}
          onToggleSelection={() => onToggleSelection(file.id)}
        />
      ))}
    </div>
  )
}

function VideoGrid({
  files,
  onOpenPlayer,
  onDownload,
  onRequestDelete,
  canManageFile,
  selectionEnabled,
  selectedFileIds,
  onToggleSelection,
}: {
  files: FileItem[]
  onOpenPlayer: (file: FileItem) => void
  onDownload: (file: FileItem) => void
  onRequestDelete: (file: FileItem) => void
  canManageFile: (file: FileItem) => boolean
  selectionEnabled: boolean
  selectedFileIds: Set<string>
  onToggleSelection: (fileId: string) => void
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {files.map((file) => {
        const isMissing = file.storageStatus === "missing"
        const selected = selectedFileIds.has(file.id)
        if (isMissing) {
          return (
            <div
              key={file.id}
              className="group relative rounded-xl overflow-hidden border border-amber-200 bg-amber-50 aspect-video text-left"
            >
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center text-amber-700">
                <AlertTriangle className="size-7" />
                <span className="text-xs font-semibold">
                  Original file unavailable
                </span>
                <span className="text-[10px] truncate max-w-full">{displayName(file)}</span>
              </div>
              {selectionEnabled ? (
                <SelectionToggleButton
                  selected={selected}
                  label={`Select ${displayName(file)}`}
                  className="absolute top-1.5 left-1.5 z-10 bg-white/95 shadow-sm"
                  onToggle={() => onToggleSelection(file.id)}
                />
              ) : null}
              <div className="absolute top-1.5 right-1.5 z-10">
                <FileActionsMenu
                  file={file}
                  canManage={canManageFile(file)}
                  onDownload={onDownload}
                  onRequestDelete={onRequestDelete}
                  triggerClassName="p-1 rounded-md bg-white/90 text-slate-600 hover:text-slate-900 hover:bg-white shadow-sm"
                />
              </div>
            </div>
          )
        }
        return (
          <div
            key={file.id}
            className="group relative rounded-xl overflow-hidden border border-[#E5E7EB] bg-slate-900 aspect-video hover:border-primary/40 transition-colors text-left"
          >
            <button
              onClick={() => onOpenPlayer(file)}
              className="absolute inset-0 text-left"
              aria-label={`Play ${displayName(file)}`}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="size-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-white/30 transition-colors">
                  <Play className="size-5 text-white fill-white ml-0.5" />
                </div>
              </div>
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 py-2">
                <p className="text-white text-xs font-medium truncate">{displayName(file)}</p>
                <p className="text-white/60 text-xs">
                  {formatFileSize(file.fileSize)}
                  {file.durationSeconds != null && ` · ${formatVideoDuration(file.durationSeconds)}`}
                </p>
              </div>
            </button>

            {file.durationSeconds != null && (
              <span
                className="absolute bottom-1.5 right-1.5 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white pointer-events-none"
                aria-label={`Duration ${formatVideoDuration(file.durationSeconds)}`}
              >
                {formatVideoDuration(file.durationSeconds)}
              </span>
            )}

            {selectionEnabled ? (
              <SelectionToggleButton
                selected={selected}
                label={`Select ${displayName(file)}`}
                className="absolute top-1.5 left-1.5 z-10 bg-white/95 shadow-sm"
                onToggle={() => onToggleSelection(file.id)}
              />
            ) : null}
            <div className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <FileActionsMenu
                file={file}
                canManage={canManageFile(file)}
                onOpen={() => onOpenPlayer(file)}
                onDownload={onDownload}
                onRequestDelete={onRequestDelete}
                triggerClassName="p-1 rounded-md bg-white/90 text-slate-600 hover:text-slate-900 hover:bg-white shadow-sm"
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Shared three-dot overflow menu for a single file, used by AuthPhoto,
 * VideoGrid tile, and FileTable row. Renders Open / Download and, when
 * `canManage` is true, a red "Delete file" item that delegates the
 * confirmation dialog back to the parent via onRequestDelete.
 */
function FileActionsMenu({
  file,
  canManage,
  onOpen,
  onDownload,
  onRequestDelete,
  triggerClassName,
  triggerAriaLabel,
}: {
  file: FileItem
  canManage: boolean
  onOpen?: () => void
  onDownload: (file: FileItem) => void
  onRequestDelete: (file: FileItem) => void
  triggerClassName?: string
  triggerAriaLabel?: string
}) {
  const isMissing = file.storageStatus === "missing"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={
            triggerClassName ??
            "p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          }
          aria-label={triggerAriaLabel ?? `Actions for ${displayName(file)}`}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {onOpen && !isMissing && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
          >
            Open
          </DropdownMenuItem>
        )}
        {!isMissing && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onDownload(file)
            }}
          >
            Download
          </DropdownMenuItem>
        )}
        {canManage && (
          <>
            {!isMissing && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onRequestDelete(file)
              }}
              className="text-red-600 focus:text-red-600"
            >
              {isMissing ? "Remove orphan row" : "Delete file"}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FileTable({
  files,
  showDuration,
  mediaType,
  onOpenLightbox,
  onOpenPlayer,
  onOpenInNewTab,
  onDownload,
  onRequestDelete,
  canManageFile,
  selectionEnabled,
  selectedFileIds,
  onToggleSelection,
}: {
  files: FileItem[]
  showDuration?: boolean
  mediaType?: MediaType
  onOpenLightbox?: (file: FileItem) => void
  onOpenPlayer?: (file: FileItem) => void
  onOpenInNewTab: (file: FileItem) => void
  onDownload: (file: FileItem) => void
  onRequestDelete: (file: FileItem) => void
  canManageFile: (file: FileItem) => boolean
  selectionEnabled: boolean
  selectedFileIds: Set<string>
  onToggleSelection: (fileId: string) => void
}) {
  const showNotes = files.some((file) => !!file.note)

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-[#E5E7EB]">
          <tr>
            {selectionEnabled ? (
              <th className="w-10 px-3 py-2.5 text-left font-semibold text-slate-600">
                <span className="sr-only">Select</span>
              </th>
            ) : null}
            <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Name</th>
            <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Size</th>
            {showDuration && (
              <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Duration</th>
            )}
            {showNotes && (
              <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Note</th>
            )}
            <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Uploaded By</th>
            <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Date</th>
            <th className="px-4 py-2.5 text-right font-semibold text-slate-600 w-16">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {files.map((file) => {
            const label = displayName(file)
            const isMissing = file.storageStatus === "missing"
            const canPhoto = mediaType === "photo" && !!onOpenLightbox && !isMissing
            const canVideo = mediaType === "video" && !!onOpenPlayer && !isMissing
            const handleOpen = canPhoto
              ? () => onOpenLightbox!(file)
              : canVideo
                ? () => onOpenPlayer!(file)
                : () => onOpenInNewTab(file)
            const selected = selectedFileIds.has(file.id)
            return (
              <tr
                key={file.id}
                className={
                  isMissing
                    ? "group bg-amber-50/40 hover:bg-amber-50"
                    : "group hover:bg-slate-50"
                }
              >
                {selectionEnabled ? (
                  <td className="px-3 py-3">
                    <SelectionToggleButton
                      selected={selected}
                      label={`Select ${label}`}
                      onToggle={() => onToggleSelection(file.id)}
                    />
                  </td>
                ) : null}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {isMissing ? (
                      <AlertTriangle className="size-4 text-amber-600 shrink-0" />
                    ) : (
                      <FileIcon mimeType={file.mimeType} />
                    )}
                    {isMissing ? (
                      <div className="flex flex-col min-w-0">
                        <span className="text-slate-700 truncate max-w-xs line-through decoration-amber-400">
                          {label}
                        </span>
                        <span className="text-[11px] font-medium text-amber-700">
                          Original file unavailable
                        </span>
                      </div>
                    ) : canPhoto ? (
                      <button
                        type="button"
                        onClick={() => onOpenLightbox!(file)}
                        className="text-primary hover:underline truncate max-w-xs text-left"
                      >
                        {label}
                      </button>
                    ) : canVideo ? (
                      <button
                        type="button"
                        onClick={() => onOpenPlayer!(file)}
                        className="text-primary hover:underline truncate max-w-xs text-left"
                      >
                        {label}
                      </button>
                    ) : file.fileUrl ? (
                      <button
                        type="button"
                        onClick={() => onOpenInNewTab(file)}
                        className="text-primary hover:underline truncate max-w-xs text-left"
                      >
                        {label}
                      </button>
                    ) : (
                      <span className="text-slate-700 truncate max-w-xs">{label}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500 tabular-nums">
                  {formatFileSize(file.fileSize)}
                </td>
                {showDuration && (
                  <td className="px-4 py-3 text-slate-500 tabular-nums">
                    {file.durationSeconds != null
                      ? formatVideoDuration(file.durationSeconds)
                      : "—"}
                  </td>
                )}
                {showNotes && (
                  <td className="px-4 py-3 text-slate-500">
                    {file.note ? <span className="line-clamp-2">{file.note}</span> : "—"}
                  </td>
                )}
                <td className="px-4 py-3 text-slate-500">{file.uploadedByName ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{fmtDate(file.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    {!isMissing && (
                      <button
                        type="button"
                        onClick={() => onDownload(file)}
                        className="inline-flex items-center justify-center rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                        aria-label={`Download ${label}`}
                        title="Download"
                      >
                        <Download className="size-4" />
                      </button>
                    )}
                    <FileActionsMenu
                      file={file}
                      canManage={canManageFile(file)}
                      onOpen={isMissing ? undefined : handleOpen}
                      onDownload={onDownload}
                      onRequestDelete={onRequestDelete}
                      triggerAriaLabel={`Actions for ${label}`}
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
