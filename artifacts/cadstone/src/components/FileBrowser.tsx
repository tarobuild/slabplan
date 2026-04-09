import { useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import {
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
    loadFolders(null)
  }, [jobId, mediaType, scope])

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

  const mediaLabel =
    mediaType === "document" ? "Documents" : mediaType === "photo" ? "Photos" : "Videos"
  const rootFolderLabel = rootLabel ?? mediaLabel
  const canToggleView = true
  const canManageFolders = !isReadOnly
  const canUploadFiles = !!currentFolderId && !isReadOnly

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm min-w-0">
          <button
            onClick={() => navigateTo(null)}
            className={`font-medium transition-colors shrink-0 ${
              currentFolderId ? "text-blue-600 hover:underline" : "text-slate-900"
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
                    : "text-blue-600 hover:underline"
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
            <>
              {filesLoading ? (
                <div className="space-y-2 mt-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded" />
                  ))}
                </div>
              ) : sortedFiles.length > 0 ? (
                <div className="mt-3">
                  {mediaType === "photo" && viewMode === "grid" ? (
                    <PhotoGrid files={sortedFiles} onOpenLightbox={setLightboxFile} />
                  ) : mediaType === "video" && viewMode === "grid" ? (
                    <VideoGrid files={sortedFiles} onOpenPlayer={setVideoPlayerFile} />
                  ) : (
                    <FileTable files={sortedFiles} showDuration={mediaType === "video"} />
                  )}
                </div>
              ) : sortedFolders.length === 0 ? (
                <div className="py-16 text-center mt-3">
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
                      className="mt-1 text-sm text-blue-600 hover:underline"
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
            </>
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
                  className="mt-1 text-sm text-blue-600 hover:underline"
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
            className="absolute top-3 right-3 z-10 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
          >
            <X className="size-4" />
          </button>
          {lightboxFile?.fileUrl && (
            <div className="flex flex-col items-center">
              <img
                src={lightboxFile.fileUrl}
                alt={displayName(lightboxFile)}
                className="max-h-[80vh] max-w-full object-contain"
              />
              <div className="flex w-full items-center justify-between gap-4 bg-black/80 px-4 py-3 text-white">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{displayName(lightboxFile)}</p>
                  {lightboxFile.note ? (
                    <p className="mt-1 text-xs text-white/70">{lightboxFile.note}</p>
                  ) : null}
                </div>
                <a
                  href={lightboxFile.fileUrl}
                  download={displayName(lightboxFile)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-blue-300 hover:text-blue-200 shrink-0"
                >
                  <Download className="size-3.5" />
                  Download
                </a>
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
          >
            <X className="size-4" />
          </button>
          {videoPlayerFile?.fileUrl && (
            <div className="flex flex-col">
              <video
                src={videoPlayerFile.fileUrl}
                controls
                autoPlay
                className="w-full max-h-[75vh] bg-black"
              />
              <div className="flex items-center justify-between px-4 py-3 bg-black/80 text-white">
                <span className="text-sm font-medium truncate max-w-xs">
                  {displayName(videoPlayerFile)}
                </span>
                <a
                  href={videoPlayerFile.fileUrl}
                  download={displayName(videoPlayerFile)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-blue-300 hover:text-blue-200 shrink-0"
                >
                  <Download className="size-3.5" />
                  Download
                </a>
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
    <div className="relative group flex flex-col gap-2 px-4 py-3 rounded-xl border border-[#E5E7EB] bg-white hover:border-blue-200 hover:bg-blue-50/30 transition-colors cursor-pointer select-none">
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

function PhotoGrid({
  files,
  onOpenLightbox,
}: {
  files: FileItem[]
  onOpenLightbox: (file: FileItem) => void
}) {
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set())

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {files.map((file) => {
        const isBroken = brokenImages.has(file.id)
        const hasUrl = !!file.fileUrl && !isBroken

        return (
          <button
            key={file.id}
            onClick={() => onOpenLightbox(file)}
            className="group flex flex-col rounded-xl overflow-hidden border border-[#E5E7EB] bg-slate-100 hover:border-blue-300 transition-colors text-left"
          >
            <div className="relative aspect-square overflow-hidden bg-slate-100">
              {hasUrl ? (
                <img
                  src={file.fileUrl!}
                  alt={displayName(file)}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  onError={() =>
                    setBrokenImages((prev) => {
                      const next = new Set(prev)
                      next.add(file.id)
                      return next
                    })
                  }
                />
              ) : (
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
      })}
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
          className="group relative rounded-xl overflow-hidden border border-[#E5E7EB] bg-slate-900 aspect-video hover:border-blue-300 transition-colors text-left"
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
}: {
  files: FileItem[]
  showDuration?: boolean
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
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {files.map((file) => (
            <tr key={file.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <FileIcon mimeType={file.mimeType} />
                  {file.fileUrl ? (
                    <a
                      href={file.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline truncate max-w-xs"
                    >
                      {displayName(file)}
                    </a>
                  ) : (
                    <span className="text-slate-700 truncate max-w-xs">{displayName(file)}</span>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
