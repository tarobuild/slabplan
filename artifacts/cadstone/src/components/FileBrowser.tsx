import { useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { ChevronRight, File, FileText, Folder, FolderOpen, Loader2, Plus, Upload } from "lucide-react"
import { api } from "@/lib/api"
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
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"

type FolderItem = {
  id: string
  title: string
  childFolderCount: number
  fileCount: number
  parentFolderId: string | null
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
  uploadedByName: string | null
  createdAt: string
}

type MediaType = "document" | "photo" | "video"

function formatFileSize(bytes: number | null) {
  if (!bytes) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function FileIcon({ mimeType }: { mimeType: string | null }) {
  if (!mimeType) return <File className="size-4 text-slate-400" />
  if (mimeType.startsWith("image/")) return <span className="text-blue-500 text-sm">🖼️</span>
  if (mimeType.startsWith("video/")) return <span className="text-purple-500 text-sm">🎬</span>
  if (mimeType === "application/pdf") return <span className="text-red-500 text-sm">📄</span>
  return <FileText className="size-4 text-slate-400" />
}

export default function FileBrowser({ mediaType }: { mediaType: MediaType }) {
  const { jobId } = useParams<{ jobId: string }>()
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([])
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filesLoading, setFilesLoading] = useState(false)
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadFolders = (parentId: string | null = null) => {
    if (!jobId) return
    setLoading(true)
    const params = new URLSearchParams({ mediaType })
    if (parentId) params.set("parentId", parentId)
    api.get(`/jobs/${jobId}/folders?${params}`)
      .then(r => {
        setFolders(r.data.folders ?? [])
        setBreadcrumb(r.data.breadcrumb ?? [])
      })
      .catch(() => toast.error("Failed to load folders"))
      .finally(() => setLoading(false))
  }

  const loadFiles = (folderId: string) => {
    setFilesLoading(true)
    api.get(`/folders/${folderId}/files`)
      .then(r => setFiles(r.data.files ?? []))
      .catch(() => toast.error("Failed to load files"))
      .finally(() => setFilesLoading(false))
  }

  useEffect(() => {
    loadFolders(null)
    setCurrentFolderId(null)
    setFiles([])
  }, [jobId, mediaType])

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
    if (!jobId) return
    setCreatingFolder(true)
    try {
      await api.post(`/jobs/${jobId}/folders`, {
        title: newFolderName,
        mediaType,
        parentFolderId: currentFolderId,
      })
      toast.success("Folder created")
      setCreateFolderOpen(false)
      setNewFolderName("")
      loadFolders(currentFolderId)
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create folder")
    } finally {
      setCreatingFolder(false)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentFolderId || !e.target.files?.length) return
    const formData = new FormData()
    Array.from(e.target.files).forEach(f => formData.append("files", f))
    setUploading(true)
    try {
      await api.post(`/folders/${currentFolderId}/files`, formData, {
        headers: { "Content-Type": "multipart/form-data" }
      })
      toast.success(`${e.target.files.length} file(s) uploaded`)
      loadFiles(currentFolderId)
    } catch {
      toast.error("Upload failed")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const mediaLabel = mediaType === "document" ? "Documents" : mediaType === "photo" ? "Photos" : "Videos"

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm">
          <button
            onClick={() => navigateTo(null)}
            className={`font-medium transition-colors ${currentFolderId ? "text-blue-600 hover:underline" : "text-slate-900"}`}
          >
            {mediaLabel}
          </button>
          {breadcrumb.map(crumb => (
            <span key={crumb.id} className="flex items-center gap-1.5">
              <ChevronRight className="size-3.5 text-slate-400" />
              <button
                onClick={() => navigateTo(crumb.id)}
                className={`font-medium transition-colors ${crumb.id === currentFolderId ? "text-slate-900" : "text-blue-600 hover:underline"}`}
              >
                {crumb.title}
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          {currentFolderId && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleUpload}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Upload className="mr-1.5 size-3.5" />}
                Upload
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => { setNewFolderName(""); setCreateFolderOpen(true) }}>
            <Plus className="mr-1.5 size-3.5" />New Folder
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {folders.length > 0 && (
            <div className="space-y-1">
              {folders.map(folder => (
                <button
                  key={folder.id}
                  onClick={() => openFolder(folder)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] bg-white hover:border-blue-200 hover:bg-blue-50/40 transition-colors text-left group"
                >
                  {currentFolderId === folder.id
                    ? <FolderOpen className="size-5 text-yellow-500 shrink-0" />
                    : <Folder className="size-5 text-yellow-500 shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{folder.title}</p>
                    <p className="text-xs text-slate-400">
                      {folder.fileCount} file{folder.fileCount !== 1 ? "s" : ""}
                      {folder.childFolderCount > 0 && `, ${folder.childFolderCount} subfolder${folder.childFolderCount !== 1 ? "s" : ""}`}
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-slate-300 group-hover:text-slate-500 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {currentFolderId && (
            <>
              {filesLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded" />
                  ))}
                </div>
              ) : files.length > 0 ? (
                <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden mt-3">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-[#E5E7EB]">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Name</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Size</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Uploaded By</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {files.map(file => (
                        <tr key={file.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <FileIcon mimeType={file.mimeType} />
                              {file.fileUrl ? (
                                <a href={file.fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-xs">
                                  {file.originalName || file.filename}
                                </a>
                              ) : (
                                <span className="text-slate-700 truncate max-w-xs">{file.originalName || file.filename}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-500 tabular-nums">{formatFileSize(file.fileSize)}</td>
                          <td className="px-4 py-3 text-slate-500">{file.uploadedByName || "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{fmtDate(file.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : folders.length === 0 ? (
                <div className="py-16 text-center">
                  <FolderOpen className="mx-auto mb-3 size-8 text-slate-200" />
                  <p className="text-sm text-slate-400">This folder is empty.</p>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-1 text-sm text-blue-600 hover:underline"
                  >
                    Upload files
                  </button>
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-slate-400">
                  No files in this folder yet. Upload files to get started.
                </div>
              )}
            </>
          )}

          {!currentFolderId && folders.length === 0 && (
            <div className="py-16 text-center">
              <Folder className="mx-auto mb-3 size-8 text-slate-200" />
              <p className="text-sm text-slate-400">No folders yet.</p>
              <button
                onClick={() => { setNewFolderName(""); setCreateFolderOpen(true) }}
                className="mt-1 text-sm text-blue-600 hover:underline"
              >
                Create the first folder
              </button>
            </div>
          )}
        </>
      )}

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
                onChange={e => setNewFolderName(e.target.value)}
                required
                placeholder="e.g. Blueprints"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateFolderOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creatingFolder}>
                {creatingFolder && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
