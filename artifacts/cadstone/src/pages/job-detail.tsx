import { useCallback, useEffect, useState } from "react"
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router-dom"
import { useDropzone } from "react-dropzone"
import {
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  FileText,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Upload,
  type LucideIcon,
} from "lucide-react"
import {
  customFetch,
  getFoldersGetJobsJobIdFoldersUrl,
  jobsDeleteJobsId,
  jobsGetJobsId,
  jobsPutJobsId,
  type JobsJobPayloadSchema,
} from "@workspace/api-client-react"
import { JobsPutJobsIdBody } from "@workspace/api-zod"
import { api } from "@/lib/api"
import { validatePayload } from "@/lib/validate-payload"
import { validateSelectedFiles } from "@/lib/uploads"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { invalidateAppData, subscribeToDataRefresh } from "@/lib/data-refresh"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import { toast } from "sonner"
import { toastApiError } from "@/lib/api-errors"

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

type TabDef = {
  label: string
  path: string
  icon: LucideIcon
  matchPrefix?: string
}
const TABS: readonly TabDef[] = [
  { label: "Daily Logs", path: "daily-logs", icon: ClipboardList },
  { label: "Schedule", path: "schedule", icon: CalendarDays },
  { label: "Summary", path: "summary", icon: FileText },
  { label: "Files", path: "files/documents", matchPrefix: "files/", icon: FolderOpen },
]

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role === "admin"
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pageUploading, setPageUploading] = useState(false)

  // Job actions: Mark complete and Delete project. Both are admin-only.
  const [markCompleteOpen, setMarkCompleteOpen] = useState(false)
  const [markingComplete, setMarkingComplete] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deletingJob, setDeletingJob] = useState(false)

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
        // Get the root documents folder for this job. The OpenAPI spec
        // doesn't yet capture the `mediaType` query param, so we go through
        // the typed `customFetch` and append the param ourselves rather
        // than calling `foldersGetJobsJobIdFolders(jobId)` (which returns
        // every media type).
        type FoldersResponse = { folders?: { id: string }[] }
        const foldersUrl = `${getFoldersGetJobsJobIdFoldersUrl(jobId)}?mediaType=document`
        const foldersData = await customFetch<FoldersResponse>(foldersUrl, {
          method: "GET",
        })
        const folders = foldersData.folders ?? []
        if (folders.length === 0) {
          toast.error("No documents folder found for this job")
          return
        }
        const targetFolderId = folders[0].id
        const formData = new FormData()
        droppedFiles.forEach((file) => formData.append("files", file))
        // Multipart upload: keep using axios here. The generated typed
        // function expects a typed array body and the route is well-served
        // by axios's automatic FormData boundary handling.
        await api.post(`/folders/${targetFolderId}/files`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        })
        toast.success(`${droppedFiles.length} file(s) uploaded to Documents`)
      } catch (err: unknown) {
        toastApiError(err, "Failed to upload files")
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

    jobsGetJobsId(jobId)
      .then((r) => {
        // The typed response is `JobDetailResponse` whose `job` shape is a
        // superset of what this header card actually renders, so cast down
        // to our local `Job` to keep state shape-stable.
        setJob(r.job as unknown as Job)
      })
      .catch((err: unknown) => {
        setError("Unable to load this job.")
        toastApiError(err, "Failed to load job")
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

  // Reset the delete dialog's typed-confirmation when closed so reopening
  // it doesn't flash the previous text.
  useEffect(() => {
    if (!deleteDialogOpen) setDeleteConfirmText("")
  }, [deleteDialogOpen])

  const handleMarkComplete = async () => {
    if (!job || !jobId) return
    setMarkingComplete(true)
    try {
      // PUT /jobs/:id replaces the whole record via toJobInsert — any field
      // missing from the payload becomes null. Fetch the current hydrated
      // job first so we can send back every field unchanged except status.
      const currentRes = await jobsGetJobsId(jobId)
      const current = currentRes.job as unknown as Record<string, unknown>
      const payload: JobsJobPayloadSchema = {
        title: current.title as string,
        status: "closed",
        streetAddress: (current.streetAddress as string | null) ?? null,
        city: (current.city as string | null) ?? null,
        state: (current.state as string | null) ?? null,
        zipCode: (current.zipCode as string | null) ?? null,
        contractPrice: (current.contractPrice as string | null) ?? null,
        jobType: (current.jobType as string | null) ?? null,
        workDays: (current.workDays as JobsJobPayloadSchema["workDays"]) ?? null,
        projectedStart: (current.projectedStart as string | null) ?? null,
        projectedCompletion: (current.projectedCompletion as string | null) ?? null,
        actualStart: (current.actualStart as string | null) ?? null,
        actualCompletion: (current.actualCompletion as string | null) ?? null,
        contractType: current.contractType as JobsJobPayloadSchema["contractType"],
        internalNotes: (current.internalNotes as string | null) ?? null,
        subVendorNotes: (current.subVendorNotes as string | null) ?? null,
        squareFeet: (current.squareFeet as string | null) ?? null,
        permitNumber: (current.permitNumber as string | null) ?? null,
        projectManagerId: (current.projectManagerId as string | null) ?? null,
        clientId: (current.clientId as string | null) ?? null,
      }
      // Run the generated Zod schema to surface client-side validation
      // issues (matches the pattern used by clients/jobs/leads pages).
      const validated = validatePayload(JobsPutJobsIdBody, payload)
      if (!validated) return
      const res = await jobsPutJobsId(jobId, validated)
      const updatedJob = res.job as unknown as Job
      setJob((prev) =>
        prev
          ? {
              ...prev,
              status: updatedJob.status,
              title: updatedJob.title ?? prev.title,
              city: updatedJob.city ?? prev.city,
              state: updatedJob.state ?? prev.state,
            }
          : prev,
      )
      invalidateAppData(["jobs", "navigation"])
      toast.success("Project marked as complete")
      setMarkCompleteOpen(false)
    } catch (err: unknown) {
      toastApiError(err, "Failed to mark project complete")
    } finally {
      setMarkingComplete(false)
    }
  }

  const handleDeleteJob = async () => {
    if (!job || !jobId) return
    setDeletingJob(true)
    try {
      await jobsDeleteJobsId(jobId)
      invalidateAppData(["jobs", "navigation"])
      toast.success("Project deleted")
      setDeleteDialogOpen(false)
      navigate("/jobs")
    } catch (err: unknown) {
      toastApiError(err, "Failed to delete project")
    } finally {
      setDeletingJob(false)
    }
  }

  const deleteConfirmed =
    !!job &&
    deleteConfirmText.trim().toLowerCase() === job.title.trim().toLowerCase()

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

      {/* Row 1: back link */}
      <div className="mb-2">
        <Link
          to="/jobs"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          All jobs
        </Link>
      </div>

      {/* Row 2: H1 title + status + location + actions */}
      <div className="flex items-center gap-3 pb-3">
        {loading ? (
          <Skeleton className="h-8 w-64" />
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-slate-900 truncate">
              {job?.title}
            </h1>
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
              <span className="text-sm text-slate-500 truncate">
                {[job.city, job.state].filter(Boolean).join(", ")}
              </span>
            )}
            {isAdmin && job && (
              <div className="ml-auto shrink-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                    >
                      <MoreHorizontal className="size-4" />
                      Job actions
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {job.status === "open" && (
                      <>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.preventDefault()
                            setMarkCompleteOpen(true)
                          }}
                        >
                          Mark project complete
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.preventDefault()
                        setDeleteDialogOpen(true)
                      }}
                      className="text-red-600 focus:text-red-600"
                    >
                      Delete project
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-b border-[#E5E7EB]">
        <nav className="-mb-px flex gap-0 overflow-x-auto scrollbar-none">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = tab.matchPrefix
              ? location.pathname.includes(`/${tab.matchPrefix}`)
              : location.pathname.endsWith(`/${tab.path}`)
            return (
              <Link
                key={tab.path}
                to={`/jobs/${jobId}/${tab.path}`}
                className={cn(
                  "inline-flex shrink-0 items-center whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-orange-500 text-orange-600"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900",
                )}
              >
                <Icon className="size-3.5 mr-1.5" />
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="pt-4">
        <Outlet context={{ job, setJob, jobId }} />
      </div>

      {/* Mark complete — simple confirmation */}
      <AlertDialog
        open={markCompleteOpen}
        onOpenChange={(open) => {
          if (!open && !markingComplete) setMarkCompleteOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This officially marks {job?.title ? `"${job.title}"` : "this project"}{" "}
              as complete. The job will move to the Closed list and stop
              appearing on active dashboards. You can re-open it later by
              changing the status back to Open.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={markingComplete}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleMarkComplete()
              }}
              disabled={markingComplete}
              className="bg-orange-600 hover:bg-orange-700 focus:ring-orange-600"
            >
              {markingComplete && <Loader2 className="mr-2 size-3.5 animate-spin" />}
              Yes, complete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete project — typed-confirmation */}
      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!open && !deletingJob) setDeleteDialogOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will hide {job?.title ? `"${job.title}"` : "this project"} and
              all of its schedule items, daily logs, and files from the app.
              This cannot be undone from the app. Type the project name to
              confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 pt-1">
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={job?.title ?? ""}
              disabled={deletingJob}
              autoFocus
            />
            <p className="text-xs text-slate-400">
              Type <span className="font-medium text-slate-600">{job?.title}</span>{" "}
              exactly (case-insensitive).
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingJob}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                if (!deleteConfirmed) return
                void handleDeleteJob()
              }}
              disabled={!deleteConfirmed || deletingJob}
              className="bg-red-600 hover:bg-red-700"
            >
              {deletingJob && <Loader2 className="mr-2 size-3.5 animate-spin" />}
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
