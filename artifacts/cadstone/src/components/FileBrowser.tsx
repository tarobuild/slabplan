import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { useDropzone } from "react-dropzone"
import {
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
import { api } from "@/lib/api"
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
import { uploadAcceptForMediaType, validateSelectedFiles } from "@/lib/uploads"
import { useAuthStore } from "@/store/auth"
import { toast } from "sonner"

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
  uploadedByName: string | null
  createdAt: string
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

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { response?: { data?: { message?: string } }; message?: string }
    return e.response?.data?.message ?? e.message ?? fallback
  }
  return fallback
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

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([])
  const [uploadNote, setUploadNote] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [lightboxFile, setLightboxFile] = useState<FileItem | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState<number>(0)
  const [videoPlayerFile, setVideoPlayerFile] = useState<FileItem | null>(null)

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
      .catch((err: unknown) => toast.error(getApiErrorMessage(err, "Failed to load folders")))
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
      .catch((err: unknown) => toast.error(getApiErrorMessage(err, "Failed to load files")))
      .finally(() => setFilesLoading(false))
  }

  useEffect(() => {
    setCurrentFolderId(null)
    setFiles([])
    setBreadcrumb([])
    setUploadError(null)
    setSelectedUploadFiles([])
    setUploadNote("")
    setLightboxFile(null)
    setLightboxIndex(0)
    setVideoPlayerFile(null)
    loadFolders(null)
  }, [jobId, mediaType, scope])

  const openFolder = (folder: FolderItem) => {
    setLightboxFile(null)
    setVideoPlayerFile(null)
    setCurrentFolderId(folder.id)
    loadFolders(folder.id)
    loadFiles(folder.id)
  }

  const navigateTo = (folderId: string | null) => {
    setLightboxFile(null)
    setVideoPlayerFile(null)
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
      toast.error(getApiErrorMessage(err, "Failed to create folder"))
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
      toast.error(getApiErrorMessage(err, "Failed to rename folder"))
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
      toast.error(getApiErrorMessage(err, "Failed to delete folder"))
    } finally {
      setDeletingFolder(false)
    }
  }

  const handleUploadSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
    const nextFiles = Array.from(e.target.files)
    const validationError = validateSelectedFiles(nextFiles, mediaType)

    if (validationError) {
      setUploadError(validationError)
      setSelectedUploadFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }

    setUploadError(null)
    setSelectedUploadFiles(nextFiles)
  }

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
    setUploading(true)
    try {
      await api.post(
        isResourceScope
          ? `/resources/folders/${currentFolderId}/upload`
          : `/folders/${currentFolderId}/files`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        },
      )
      toast.success(`${selectedUploadFiles.length} file(s) uploaded`)
      setUploadDialogOpen(false)
      setSelectedUploadFiles([])
      setUploadNote("")
      loadFiles(currentFolderId)
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Upload failed"))
    } finally {
      setUploading(false)
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
      toast.error(getApiErrorMessage(err, "Failed to download file"))
    }
  }

  const handleViewInNewTab = (file: FileItem) => {
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
        toast.error(getApiErrorMessage(err, "Failed to open file"))
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

  const openLightbox = (file: FileItem) => {
    const idx = sortedFiles.findIndex((f) => f.id === file.id)
    setLightboxFile(file)
    setLightboxIndex(idx >= 0 ? idx : 0)
  }

  useEffect(() => {
    if (!lightboxFile) return
    const handler = (event: KeyboardEvent) => {
      if (sortedFiles.length <= 1) return
      if (event.key === "ArrowRight") {
        event.preventDefault()
        const next = (lightboxIndex + 1) % sortedFiles.length
        setLightboxFile(sortedFiles[next])
        setLightboxIndex(next)
      } else if (event.key === "ArrowLeft") {
        event.preventDefault()
        const prev = (lightboxIndex - 1 + sortedFiles.length) % sortedFiles.length
        setLightboxFile(sortedFiles[prev])
        setLightboxIndex(prev)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [lightboxFile, lightboxIndex, sortedFiles])

  const lightboxViewUrl = lightboxFile ? buildFileViewUrl(lightboxFile.id) : null
  const {
    blobUrl: lightboxBlobUrl,
    loading: lightboxLoading,
    error: lightboxError,
  } = useAuthenticatedUrl(lightboxViewUrl)

  const videoViewUrl = videoPlayerFile ? buildFileViewUrl(videoPlayerFile.id) : null
  const {
    blobUrl: videoBlobUrl,
    loading: videoLoading,
    error: videoError,
  } = useAuthenticatedUrl(videoViewUrl)

  const mediaLabel =
    mediaType === "document" ? "Documents" : mediaType === "photo" ? "Photos" : "Videos"
  const rootFolderLabel = rootLabel ?? mediaLabel
  const canToggleView = true
  const canManageFolders = !isReadOnly
  const canUploadFiles = !!currentFolderId && !isReadOnly

  const onDrop = useCallback(
    (droppedFiles: File[]) => {
      if (!currentFolderId || isReadOnly) return
      const validationError = validateSelectedFiles(droppedFiles, mediaType)
      if (validationError) {
        setUploadError(validationError)
        setSelectedUploadFiles([])
        return
      }
      setUploadError(null)
      setSelectedUploadFiles(droppedFiles)
      setUploadDialogOpen(true)
    },
    [currentFolderId, isReadOnly, mediaType],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    disabled: !currentFolderId || isReadOnly,
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
                  setSelectedUploadFiles([])
                  setUploadNote("")
                  setUploadDialogOpen(true)
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
              className={`relative mt-3 rounded-lg transition-colors ${isDragActive ? "ring-2 ring-blue-400 ring-dashed bg-blue-50/50" : ""}`}
            >
              <input {...getInputProps()} />
              {isDragActive && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-400 bg-blue-50/80">
                  <span className="text-sm font-medium text-blue-600">Drop files here</span>
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
                      onOpenLightbox={openLightbox}
                    />
                  ) : mediaType === "video" && viewMode === "grid" ? (
                    <VideoGrid files={sortedFiles} onOpenPlayer={setVideoPlayerFile} />
                  ) : (
                    <FileTable
                      files={sortedFiles}
                      showDuration={mediaType === "video"}
                      mediaType={mediaType}
                      onOpenLightbox={mediaType === "photo" ? openLightbox : undefined}
                      onOpenPlayer={mediaType === "video" ? setVideoPlayerFile : undefined}
                      onOpenInNewTab={handleViewInNewTab}
                      onDownload={handleDownload}
                    />
                  )}
                </div>
              ) : sortedFolders.length === 0 ? (
                <div className="py-16 text-center">
                  <FolderOpen className="mx-auto mb-3 size-8 text-slate-200" />
                  <p className="text-sm text-slate-400">This folder is empty.</p>
                  {canUploadFiles ? (
                    <button
                      onClick={() => {
                        setUploadError(null)
                        setSelectedUploadFiles([])
                        setUploadNote("")
                        setUploadDialogOpen(true)
                      }}
                      className="mt-1 text-sm text-orange-600 hover:underline"
                    >
                      Upload files
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-slate-400">
                  No files in this folder yet. Upload files to get started.
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
          setUploadDialogOpen(open)
          if (!open) {
            setSelectedUploadFiles([])
            setUploadNote("")
            setUploadError(null)
            if (fileInputRef.current) fileInputRef.current.value = ""
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload {mediaLabel}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUploadSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Files</Label>
              <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-slate-50 p-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose Files
                </Button>
                {selectedUploadFiles.length > 0 ? (
                  <div className="mt-3 space-y-1">
                    {selectedUploadFiles.map((file) => (
                      <p key={`${file.name}-${file.size}`} className="truncate text-sm text-slate-600">
                        {file.name}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">No files selected.</p>
                )}
              </div>
            </div>

            {showCrewPhotoNote ? (
              <div className="space-y-1.5">
                <Label htmlFor="upload-note">Note (required)</Label>
                <Input
                  id="upload-note"
                  value={uploadNote}
                  onChange={(event) => setUploadNote(event.target.value)}
                  placeholder="Describe the area or work shown in these photos"
                  required
                />
              </div>
            ) : null}

            {uploadError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {uploadError}
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setUploadDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={uploading}>
                {uploading && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                Upload
              </Button>
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

      <Dialog
        open={!!lightboxFile}
        onOpenChange={(open) => {
          if (!open) setLightboxFile(null)
        }}
      >
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-black border-0">
          <button
            onClick={() => setLightboxFile(null)}
            className="absolute top-3 right-3 z-20 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
          {lightboxFile && (
            <div className="relative flex flex-col items-center">
              {sortedFiles.length > 1 && (
                <>
                  <button
                    onClick={() => {
                      const prev = (lightboxIndex - 1 + sortedFiles.length) % sortedFiles.length
                      setLightboxFile(sortedFiles[prev])
                      setLightboxIndex(prev)
                    }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition-colors"
                    aria-label="Previous photo"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <button
                    onClick={() => {
                      const next = (lightboxIndex + 1) % sortedFiles.length
                      setLightboxFile(sortedFiles[next])
                      setLightboxIndex(next)
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition-colors"
                    aria-label="Next photo"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                </>
              )}

              <div className="flex w-full min-h-[50vh] max-h-[80vh] items-center justify-center bg-black">
                {lightboxLoading && (
                  <Loader2 className="size-8 text-white/50 animate-spin" />
                )}
                {lightboxBlobUrl && (
                  <img
                    src={lightboxBlobUrl}
                    alt={displayName(lightboxFile)}
                    className="max-h-[80vh] max-w-full object-contain"
                  />
                )}
                {lightboxError && !lightboxLoading && (
                  <p className="text-sm text-white/70">Failed to load image.</p>
                )}
              </div>

              <div className="flex w-full items-center justify-between gap-4 bg-black/80 px-4 py-3 text-white">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{displayName(lightboxFile)}</p>
                  {lightboxFile.note ? (
                    <p className="mt-1 text-xs text-white/70">{lightboxFile.note}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {sortedFiles.length > 1 && (
                    <span className="text-xs text-white/60 tabular-nums">
                      {lightboxIndex + 1} / {sortedFiles.length}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDownload(lightboxFile)}
                    className="flex items-center gap-1.5 text-sm text-orange-300 hover:text-orange-200"
                  >
                    <Download className="size-3.5" />
                    Download
                  </button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!videoPlayerFile}
        onOpenChange={(open) => {
          if (!open) setVideoPlayerFile(null)
        }}
      >
        <DialogContent className="max-w-3xl p-0 overflow-hidden bg-black border-0">
          <button
            onClick={() => setVideoPlayerFile(null)}
            className="absolute top-3 right-3 z-10 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
          {videoPlayerFile && (
            <div className="flex flex-col">
              <div className="flex w-full min-h-[40vh] max-h-[75vh] items-center justify-center bg-black">
                {videoLoading && (
                  <Loader2 className="size-8 text-white/50 animate-spin" />
                )}
                {videoBlobUrl && (
                  <video
                    src={videoBlobUrl}
                    controls
                    autoPlay
                    preload="auto"
                    className="w-full max-h-[75vh] bg-black"
                  />
                )}
                {videoError && !videoLoading && (
                  <p className="text-sm text-white/70">Failed to load video.</p>
                )}
              </div>
              <div className="flex items-center justify-between px-4 py-3 bg-black/80 text-white">
                <span className="text-sm font-medium truncate max-w-xs">
                  {displayName(videoPlayerFile)}
                </span>
                <button
                  type="button"
                  onClick={() => handleDownload(videoPlayerFile)}
                  className="flex items-center gap-1.5 text-sm text-orange-300 hover:text-orange-200 shrink-0"
                >
                  <Download className="size-3.5" />
                  Download
                </button>
              </div>
            </div>
          )}
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
}: {
  file: FileItem
  viewUrl: string | null
  onClick: () => void
}) {
  const containerRef = useRef<HTMLButtonElement | null>(null)
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

  const { blobUrl, loading, error } = useAuthenticatedUrl(isVisible ? viewUrl : null)

  return (
    <button
      ref={containerRef}
      onClick={onClick}
      className="group flex flex-col rounded-xl overflow-hidden border border-[#E5E7EB] bg-slate-100 hover:border-orange-300 transition-colors text-left"
    >
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
      <div className="px-2.5 py-2 border-t border-[#E5E7EB] bg-white">
        <p className="text-xs font-medium text-slate-800 truncate">{displayName(file)}</p>
        <p className="text-xs text-slate-400">{formatFileSize(file.fileSize)}</p>
        {file.note ? (
          <p className="mt-1 line-clamp-2 text-xs text-slate-500">{file.note}</p>
        ) : null}
      </div>
    </button>
  )
}

function PhotoGrid({
  files,
  buildViewUrl,
  onOpenLightbox,
}: {
  files: FileItem[]
  buildViewUrl: (fileId: string) => string | null
  onOpenLightbox: (file: FileItem) => void
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {files.map((file) => (
        <AuthPhoto
          key={file.id}
          file={file}
          viewUrl={buildViewUrl(file.id)}
          onClick={() => onOpenLightbox(file)}
        />
      ))}
    </div>
  )
}

function VideoGrid({
  files,
  onOpenPlayer,
}: {
  files: FileItem[]
  onOpenPlayer: (file: FileItem) => void
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {files.map((file) => (
        <button
          key={file.id}
          onClick={() => onOpenPlayer(file)}
          className="group relative rounded-xl overflow-hidden border border-[#E5E7EB] bg-slate-900 aspect-video hover:border-orange-300 transition-colors text-left"
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="size-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-white/30 transition-colors">
              <Play className="size-5 text-white fill-white ml-0.5" />
            </div>
          </div>
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 py-2">
            <p className="text-white text-xs font-medium truncate">{displayName(file)}</p>
            <p className="text-white/60 text-xs">{formatFileSize(file.fileSize)}</p>
          </div>
        </button>
      ))}
    </div>
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
}: {
  files: FileItem[]
  showDuration?: boolean
  mediaType?: MediaType
  onOpenLightbox?: (file: FileItem) => void
  onOpenPlayer?: (file: FileItem) => void
  onOpenInNewTab: (file: FileItem) => void
  onDownload: (file: FileItem) => void
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
            <th className="px-4 py-2.5 text-right font-semibold text-slate-600 w-16">Download</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {files.map((file) => {
            const label = displayName(file)
            const canPhoto = mediaType === "photo" && !!onOpenLightbox
            const canVideo = mediaType === "video" && !!onOpenPlayer
            return (
              <tr key={file.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileIcon mimeType={file.mimeType} />
                    {canPhoto ? (
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
                {showDuration && <td className="px-4 py-3 text-slate-400">—</td>}
                {showNotes && (
                  <td className="px-4 py-3 text-slate-500">
                    {file.note ? <span className="line-clamp-2">{file.note}</span> : "—"}
                  </td>
                )}
                <td className="px-4 py-3 text-slate-500">{file.uploadedByName ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{fmtDate(file.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onDownload(file)}
                    className="inline-flex items-center justify-center rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                    aria-label={`Download ${label}`}
                    title="Download"
                  >
                    <Download className="size-4" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
