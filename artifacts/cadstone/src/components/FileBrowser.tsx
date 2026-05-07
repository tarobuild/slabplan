import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { useDropzone } from "react-dropzone"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  FileText,
  Folder,
  FolderOpen,
  Grid2X2,
  List,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
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
  uploadAcceptForMediaType,
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
}

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
  const isReadOnly = isResourceScope && user?.role !== "admin"
  const showCrewPhotoNote = user?.role === "crew_member" && mediaType === "photo"

  const resolvedDefault: ViewMode =
    defaultView ?? (mediaType === "document" ? "list" : "grid")

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([])
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
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

  const [deleteConfirmFolder, setDeleteConfirmFolder] = useState<FolderItem | null>(null)
  const [deletingFolder, setDeletingFolder] = useState(false)

  const [deleteConfirmFile, setDeleteConfirmFile] = useState<FileItem | null>(null)
  const [deletingFile, setDeletingFile] = useState(false)

  // The backend's `assertCanManageFile` ends in `canUploadToFolderForRole`,
  // which for admin-owned folders admits admins, PMs-of-the-job, and the
  // original uploader. To mirror that UI-side we need the job's PM id.
  // Resource scope is admin-only write, so we skip the fetch there.
  const [jobProjectManagerId, setJobProjectManagerId] = useState<string | null>(null)

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

  const loadFolders = (parentId: string | null = null) => {
    setLoading(true)
    if (!isResourceScope && !jobId) {
      setLoading(false)
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
        setFolders(r.data.folders ?? [])
        setBreadcrumb(r.data.breadcrumb ?? [])
      })
      .catch((err: unknown) => toastApiError(err, "Failed to load folders"))
      .finally(() => setLoading(false))
  }

  const loadFiles = (folderId: string) => {
    setFilesLoading(true)
    api
      .get(
        isResourceScope
          ? `/resources/folders/${folderId}/files`
          : `/folders/${folderId}/files?page=1&limit=100`,
      )
      .then((r) => setFiles(r.data.files ?? []))
      .catch((err: unknown) => toastApiError(err, "Failed to load files"))
      .finally(() => setFilesLoading(false))
  }

  useEffect(() => {
    setCurrentFolderId(null)
    setFiles([])
    setBreadcrumb([])
    setUploadError(null)
    setSelectedUploadFiles([])
    setUploadNote("")
    loadFolders(null)
  }, [jobId, mediaType, scope])

  // Fetch the job's project-manager id once so we can mirror the backend's
  // manage-file rule client-side (admin / PM of this job / uploader).
  useEffect(() => {
    if (isResourceScope || !jobId) {
      setJobProjectManagerId(null)
      return
    }
    let cancelled = false
    api
      .get(`/jobs/${jobId}`)
      .then((r) => {
        if (cancelled) return
        const j = r.data.job ?? r.data
        setJobProjectManagerId(j?.projectManagerId ?? null)
      })
      .catch(() => {
        // Non-fatal — failing closed just means the overflow won't show
        // for a PM whose job-fetch failed. Admins stay unaffected.
      })
    return () => {
      cancelled = true
    }
  }, [jobId, isResourceScope])

  const canManageFile = useCallback(
    (file: FileItem): boolean => {
      if (!user) return false
      if (user.role === "admin") return true
      // Resource-scope folders are admin-write-only; mirror that here.
      if (isResourceScope) return false
      if (file.uploadedBy && file.uploadedBy === user.id) return true
      if (
        user.role === "project_manager" &&
        jobProjectManagerId &&
        jobProjectManagerId === user.id
      )
        return true
      return false
    },
    [user, isResourceScope, jobProjectManagerId],
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
    setCurrentFolderId(folder.id)
    loadFolders(folder.id)
    loadFiles(folder.id)
  }

  const navigateTo = (folderId: string | null) => {
    setCurrentFolderId(folderId)
    setFiles([])
    loadFolders(folderId)
    if (folderId) loadFiles(folderId)
  }

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isResourceScope && !jobId) return
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
    const validationError = await validateSelectedFilesAsync(nextFiles, mediaType)

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

    const formData = new FormData()
    selectedUploadFiles.forEach((file) => formData.append("files", file))
    if (uploadNote.trim()) {
      formData.append("note", uploadNote.trim())
    }
    // Capture the per-file duration the same way the validator does so
    // the server can persist it once instead of every render re-decoding
    // the clip (Task #368). Probe failures yield null and we still
    // upload — the column is purely a UX hint.
    const durations = await probeVideoDurations(selectedUploadFiles)
    if (durations.some((d) => d != null)) {
      formData.append("videoDurations", JSON.stringify(durations))
    }
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
      await uploadWithProgress({
        url: isResourceScope
          ? `/resources/folders/${currentFolderId}/upload`
          : `/folders/${currentFolderId}/files`,
        formData,
        signal: controller.signal,
        onProgress: (p) =>
          setUploadTask((prev) =>
            prev && prev.id === taskId
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
            prev && prev.id === taskId
              ? { ...prev, status: "retrying", retryAttempt: attempt, retryReason: reason }
              : prev,
          )
        },
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
    const url = buildFileViewUrl(file.id)
    if (!url) return
    try {
      const res = await api.get<Blob>(url, { responseType: "blob" })
      const objectUrl = URL.createObjectURL(res.data)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = displayName(file)
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(objectUrl)
    } catch (err: unknown) {
      toastApiError(err, "Failed to download file")
    }
  }

  const handleViewInNewTab = (file: FileItem) => {
    // PDFs are previewed in-app so users can use the markup tools.
    // Other document types (Word, Excel, plain text, etc.) still open in a
    // new browser tab via the existing blob-URL flow below.
    if ((file.mimeType ?? "").toLowerCase().includes("pdf")) {
      openFilePreview(file)
      return
    }

    const url = buildFileViewUrl(file.id)
    if (!url) return

    // Open the new tab SYNCHRONOUSLY inside the click handler so the browser
    // treats it as a direct user gesture. If we awaited the blob fetch before
    // calling window.open, most browsers would block the popup. We intentionally
    // omit "noopener" so we can assign the blob URL to newWindow.location after
    // the fetch resolves — blob URLs are same-origin, so there's no cross-origin
    // tab-napping risk here.
    const newWindow = window.open("about:blank", "_blank")
    if (!newWindow) {
      toast.error("Please allow pop-ups to view files in a new tab.")
      return
    }

    try {
      newWindow.document.write(
        '<!DOCTYPE html><title>Loading…</title>' +
          '<body style="margin:0;display:flex;align-items:center;justify-content:center;' +
          'height:100vh;font-family:sans-serif;color:#cbd5e1;background:#0f172a;">Loading…</body>',
      )
    } catch {
      // about:blank is same-origin so this should not fail, but fall through
      // gracefully if any browser prevents the write.
    }

    api
      .get<Blob>(url, { responseType: "blob" })
      .then((res) => {
        const objectUrl = URL.createObjectURL(res.data)
        newWindow.location.replace(objectUrl)
        // Delay revocation so the newly opened tab has time to load the blob.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
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
  const canManageFolders = !isReadOnly
  const canUploadFiles = !!currentFolderId && !isReadOnly

  async function uploadFilesImmediately(files: File[], note?: string) {
    if (!currentFolderId || files.length === 0) return
    if (uploadTask) {
      toast.info("Wait for the current upload to finish or cancel it first.")
      return
    }
    const formData = new FormData()
    files.forEach((file) => formData.append("files", file))
    if (note?.trim()) {
      formData.append("note", note.trim())
    }
    // Same per-file duration capture as the dialog upload path — see
    // Task #368.
    const durations = await probeVideoDurations(files)
    if (durations.some((d) => d != null)) {
      formData.append("videoDurations", JSON.stringify(durations))
    }
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
      await uploadWithProgress({
        url: isResourceScope
          ? `/resources/folders/${currentFolderId}/upload`
          : `/folders/${currentFolderId}/files`,
        formData,
        signal: controller.signal,
        onProgress: (p) =>
          setUploadTask((prev) =>
            prev && prev.id === taskId
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
            prev && prev.id === taskId
              ? { ...prev, status: "retrying", retryAttempt: attempt, retryReason: reason }
              : prev,
          )
        },
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
      if (!currentFolderId || isReadOnly) return
      // Refuse a second concurrent upload — we only track one task and
      // letting another overwrite it would corrupt the progress UI.
      if (uploadTask) {
        toast.info("Wait for the current upload to finish or cancel it first.")
        return
      }
      const validationError = await validateSelectedFilesAsync(droppedFiles, mediaType)
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
    [currentFolderId, isReadOnly, mediaType, showCrewPhotoNote, uploadTask],
  )

  const { getRootProps, getInputProps, isDragActive, open: openDropzone } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    disabled: !currentFolderId || isReadOnly || uploading,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm min-w-0">
          <button
            onClick={() => navigateTo(null)}
            className={`font-medium transition-colors shrink-0 ${
              currentFolderId ? "text-orange-600 hover:underline" : "text-slate-900"
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
                    : "text-orange-600 hover:underline"
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
          {canManageFolders ? (
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
              : "border-orange-200 bg-orange-50"
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {uploadTask.status === "retrying" ? (
                <AlertTriangle className="size-4 shrink-0 text-amber-600" />
              ) : (
                <Loader2 className="size-4 shrink-0 animate-spin text-orange-600" />
              )}
              <div className="min-w-0">
                <div
                  className={`font-medium ${
                    uploadTask.status === "retrying" ? "text-amber-800" : "text-orange-800"
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
                  showActions={canManageFolders}
                  onOpen={() => openFolder(folder)}
                  onRename={() => {
                    setRenameFolderTarget(folder)
                    setRenameFolderName(folder.title)
                  }}
                  onDelete={() => setDeleteConfirmFolder(folder)}
                />
              ))}
            </div>
          )}

          {currentFolderId && (
            <div
              {...getRootProps()}
              className={`relative mt-3 rounded-lg transition-colors ${isDragActive ? "ring-2 ring-orange-400 ring-dashed bg-orange-50/50" : ""}`}
            >
              <input {...getInputProps()} />
              {isDragActive && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-orange-400 bg-orange-50/80">
                  <Upload className="mb-2 size-6 text-orange-500" />
                  <span className="text-sm font-medium text-orange-600">Drop files here</span>
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
                  {mediaType === "photo" && viewMode === "grid" ? (
                    <PhotoGrid
                      files={sortedFiles}
                      buildViewUrl={buildFileViewUrl}
                      onOpenLightbox={openFilePreview}
                      onDownload={handleDownload}
                      onRequestDelete={setDeleteConfirmFile}
                      canManageFile={canManageFile}
                    />
                  ) : mediaType === "video" && viewMode === "grid" ? (
                    <VideoGrid
                      files={sortedFiles}
                      onOpenPlayer={openFilePreview}
                      onDownload={handleDownload}
                      onRequestDelete={setDeleteConfirmFile}
                      canManageFile={canManageFile}
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
                    />
                  )}
                  {canUploadFiles && (
                    <div
                      onClick={() => { setUploadError(null); openDropzone() }}
                      className={`mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 transition-colors ${
                        isDragActive ? "border-orange-400 bg-orange-50" : "border-slate-300 hover:border-orange-400 hover:bg-orange-50/50"
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
                      isDragActive ? "border-orange-400 bg-orange-50" : "border-slate-300 hover:border-orange-400 hover:bg-orange-50/50"
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
                    isDragActive ? "border-orange-400 bg-orange-50" : "border-slate-300 hover:border-orange-400 hover:bg-orange-50/50"
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
              {canManageFolders ? (
                <button
                  onClick={() => {
                    setNewFolderName("")
                    setCreateFolderOpen(true)
                  }}
                  className="mt-1 text-sm text-orange-600 hover:underline"
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
                    : "border-orange-200 bg-orange-50"
                }`}
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-2">
                  {uploadTask.status === "retrying" ? (
                    <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                  ) : (
                    <Loader2 className="size-4 shrink-0 animate-spin text-orange-600" />
                  )}
                  <div
                    className={`font-medium ${
                      uploadTask.status === "retrying" ? "text-amber-800" : "text-orange-800"
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

    </div>
  )
}

function FolderCard({
  folder,
  isOpen,
  showActions,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: FolderItem
  isOpen: boolean
  showActions: boolean
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <div className="relative group flex flex-col gap-2 px-4 py-3 rounded-xl border border-[#E5E7EB] bg-white hover:border-orange-200 hover:bg-orange-50/30 transition-colors cursor-pointer select-none">
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

function AuthPhoto({
  file,
  viewUrl,
  onClick,
  onDownload,
  onRequestDelete,
  canManage,
}: {
  file: FileItem
  viewUrl: string | null
  onClick: () => void
  onDownload: (file: FileItem) => void
  onRequestDelete: (file: FileItem) => void
  canManage: boolean
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
      className="group relative flex flex-col rounded-xl overflow-hidden border border-[#E5E7EB] bg-slate-100 hover:border-orange-300 transition-colors text-left"
    >
      <button onClick={onClick} className="flex flex-col text-left">
        <div className="relative aspect-square overflow-hidden bg-slate-100">
          {!isVisible && (
            <div className="w-full h-full" aria-hidden="true" />
          )}
          {isVisible && loading && (
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
            <div className="w-full h-full flex items-center justify-center text-slate-300">
              <span className="text-3xl">🖼️</span>
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

function PhotoGrid({
  files,
  buildViewUrl,
  onOpenLightbox,
  onDownload,
  onRequestDelete,
  canManageFile,
}: {
  files: FileItem[]
  buildViewUrl: (fileId: string) => string | null
  onOpenLightbox: (file: FileItem) => void
  onDownload: (file: FileItem) => void
  onRequestDelete: (file: FileItem) => void
  canManageFile: (file: FileItem) => boolean
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
}: {
  files: FileItem[]
  onOpenPlayer: (file: FileItem) => void
  onDownload: (file: FileItem) => void
  onRequestDelete: (file: FileItem) => void
  canManageFile: (file: FileItem) => boolean
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {files.map((file) => {
        const isMissing = file.storageStatus === "missing"
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
            className="group relative rounded-xl overflow-hidden border border-[#E5E7EB] bg-slate-900 aspect-video hover:border-orange-300 transition-colors text-left"
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
}) {
  const showNotes = files.some((file) => !!file.note)

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-[#E5E7EB]">
          <tr>
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
            return (
              <tr
                key={file.id}
                className={
                  isMissing
                    ? "group bg-amber-50/40 hover:bg-amber-50"
                    : "group hover:bg-slate-50"
                }
              >
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
                        className="text-orange-600 hover:underline truncate max-w-xs text-left"
                      >
                        {label}
                      </button>
                    ) : canVideo ? (
                      <button
                        type="button"
                        onClick={() => onOpenPlayer!(file)}
                        className="text-orange-600 hover:underline truncate max-w-xs text-left"
                      >
                        {label}
                      </button>
                    ) : file.fileUrl ? (
                      <button
                        type="button"
                        onClick={() => onOpenInNewTab(file)}
                        className="text-orange-600 hover:underline truncate max-w-xs text-left"
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
