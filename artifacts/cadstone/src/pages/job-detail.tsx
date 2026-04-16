import { useCallback, useEffect, useState } from "react"
import { Link, Outlet, useLocation, useParams } from "react-router-dom"
import { useDropzone } from "react-dropzone"
import { Upload } from "lucide-react"
import { api } from "@/lib/api"
import { validateSelectedFiles } from "@/lib/uploads"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { subscribeToDataRefresh } from "@/lib/data-refresh"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

type Job = {
  id: string
  title: string
  status: "open" | "closed" | "archived"
  city: string | null
  state: string | null
}

const STATUS_COLORS: Record<string, string> = {
  open: "bg-green-50 text-green-700 border-green-200",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
  archived: "bg-slate-50 text-slate-400 border-slate-200",
}

const TABS = [
  { label: "Daily Logs", path: "daily-logs" },
  { label: "Schedule", path: "schedule" },
  { label: "Summary", path: "summary" },
  { label: "Files", path: "files/documents", matchPrefix: "files/" },
]

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const location = useLocation()
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pageUploading, setPageUploading] = useState(false)

  const isOnFilesTab = location.pathname.includes("/files/")

  const onPageDrop = useCallback(
    async (droppedFiles: File[]) => {
      if (!jobId || droppedFiles.length === 0) return
      const validationError = validateSelectedFiles(droppedFiles, "document")
      if (validationError) {
        toast.error(validationError)
        return
      }
      setPageUploading(true)
      try {
        // Get the root documents folder for this job
        const foldersRes = await api.get(`/jobs/${jobId}/folders?mediaType=document`)
        const folders = foldersRes.data.folders ?? []
        if (folders.length === 0) {
          toast.error("No documents folder found for this job")
          return
        }
        const targetFolderId = folders[0].id
        const formData = new FormData()
        droppedFiles.forEach((file) => formData.append("files", file))
        await api.post(`/folders/${targetFolderId}/files`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        })
        toast.success(`${droppedFiles.length} file(s) uploaded to Documents`)
      } catch {
        toast.error("Failed to upload files")
      } finally {
        setPageUploading(false)
      }
    },
    [jobId],
  )

  const pageDropzone = useDropzone({
    onDrop: onPageDrop,
    noClick: true,
    noKeyboard: true,
    disabled: !jobId || isOnFilesTab, // Disable on files tab since FileBrowser has its own drop zone
  })

  const loadJob = (showLoading = false) => {
    if (!jobId) return
    if (showLoading) {
      setLoading(true)
      setJob(null)
    }
    setError(null)

    api
      .get(`/jobs/${jobId}`)
      .then((r) => {
        setJob(r.data.job ?? r.data)
      })
      .catch(() => {
        setError("Unable to load this job.")
        toast.error("Failed to load job")
      })
      .finally(() => {
        if (showLoading) {
          setLoading(false)
        }
      })
  }

  useEffect(() => {
    loadJob(true)
  }, [jobId])

  useEffect(() => subscribeToDataRefresh("jobs", () => loadJob()), [jobId])

  if ((error && !job) || (!loading && !job)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 text-center">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-900">Job not found</h1>
          <p className="text-sm text-slate-500">{error ?? "This job could not be found."}</p>
        </div>
        <Link
          to="/jobs"
          className="text-sm font-medium text-orange-600 hover:text-orange-700"
        >
          Back to jobs
        </Link>
      </div>
    )
  }

  return (
    <div {...pageDropzone.getRootProps()} className="relative space-y-0">
      <input {...pageDropzone.getInputProps()} />

      {/* Page-level drop overlay */}
      {pageDropzone.isDragActive && !isOnFilesTab && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-orange-50/90 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-orange-400 bg-white px-12 py-10 text-center shadow-lg">
            <Upload className="mx-auto mb-3 size-10 text-orange-500" />
            <p className="text-lg font-semibold text-orange-700">Drop files to upload</p>
            <p className="mt-1 text-sm text-orange-500">Files will be saved to Documents</p>
          </div>
        </div>
      )}

      {pageUploading && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-orange-200 bg-white px-4 py-2 shadow-lg">
          <div className="size-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
          <span className="text-sm font-medium text-orange-700">Uploading...</span>
        </div>
      )}

      <div className="mb-3">
        {loading ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <Link
            to="/jobs"
            className="text-xs font-medium text-orange-600 hover:text-orange-700"
          >
            {job?.title}
          </Link>
        )}
      </div>

      <div className="flex items-center gap-3 pb-3">
        {loading ? (
          <Skeleton className="h-8 w-64" />
        ) : (
          <>
            {job?.status && (
              <Badge
                variant="outline"
                className={cn(
                  "capitalize text-xs shrink-0",
                  STATUS_COLORS[job.status],
                )}
              >
                {job.status}
              </Badge>
            )}
            {(job?.city || job?.state) && (
              <span className="text-sm text-slate-500">
                {[job.city, job.state].filter(Boolean).join(", ")}
              </span>
            )}
          </>
        )}
      </div>

      <div className="border-b border-[#E5E7EB]">
        <nav className="-mb-px flex gap-0 overflow-x-auto scrollbar-none">
          {TABS.map((tab) => {
            const isActive = tab.matchPrefix
              ? location.pathname.includes(`/${tab.matchPrefix}`)
              : location.pathname.endsWith(`/${tab.path}`)
            return (
              <Link
                key={tab.path}
                to={`/jobs/${jobId}/${tab.path}`}
                className={cn(
                  "shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-orange-500 text-orange-600"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900",
                )}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="pt-4">
        <Outlet context={{ job, setJob, jobId }} />
      </div>
    </div>
  )
}
