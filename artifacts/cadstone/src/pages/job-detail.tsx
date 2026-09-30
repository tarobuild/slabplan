import { useCallback, useEffect, useRef, useState } from "react"
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router-dom"
import { useDropzone } from "react-dropzone"
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  ClipboardList,
  DollarSign,
  FileText,
  FolderOpen,
  Loader2,
  MapPin,
  MoreHorizontal,
  Upload,
  type LucideIcon,
} from "lucide-react"
import {
  customFetch,
  getFoldersGetJobsJobIdFoldersUrl,
  jobsDeleteJobsId,
  jobsGetJobsId,
  useJobsPutJobsId,
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
import { useSetBreadcrumbs } from "@/hooks/use-breadcrumbs"
import { hasRoleAccess, ROLE_GATES } from "@/lib/role-access"
import { revealOnFocus } from "@/lib/reveal-on-focus"
import { toast } from "sonner"
import { toastApiError } from "@/lib/api-errors"

type Job = {
  id: string
  title: string
  status: "open" | "closed" | "archived"
  city: string | null
  state: string | null
  contractValueCents: number | null
  amountPaidCents: number | null
  clientId: string | null
  clientName: string | null
  access?: {
    financials: boolean
  }
}

const STATUS_COLORS: Record<string, string> = {
  open: "border-transparent bg-emerald-50 text-emerald-800",
  closed: "border-transparent bg-slate-100 text-slate-700",
  archived: "border-transparent bg-slate-100 text-slate-500",
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
  { label: "Financials", path: "financials", icon: DollarSign },
  { label: "Files", path: "files/documents", matchPrefix: "files/", icon: FolderOpen },
]

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role === "admin"
  // Client pages are gated separately from jobs; only link to them (and name
  // them in the breadcrumb) for roles the clients route actually admits.
  const canOpenClients = hasRoleAccess(user?.role, ROLE_GATES.clients)
  const [job, setJob] = useState<Job | null>(null)
  const access = job?.access
  const visibleTabs = TABS
    .filter((tab) => {
      if (tab.path === "financials") return access?.financials ?? isAdmin
      return true
    })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
	  const [pageUploading, setPageUploading] = useState(false)
  const loadJobSeqRef = useRef(0)

  // Job actions: Mark complete and Delete project. Both are admin-only.
  const [markCompleteOpen, setMarkCompleteOpen] = useState(false)
  const [markingComplete, setMarkingComplete] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deletingJob, setDeletingJob] = useState(false)
  const stickySentinelRef = useRef<HTMLDivElement | null>(null)
  const [isStickyDocked, setIsStickyDocked] = useState(false)
  const updateJobMutation = useJobsPutJobsId()

  // Toggle a subtle shadow under the sticky job header when the user
  // has scrolled it into its docked position. We watch a 1px sentinel
  // placed above the sticky element so we can detect when it leaves
  // the scroll viewport without binding to any specific scroll parent.
  useEffect(() => {
    const sentinel = stickySentinelRef.current
    if (!sentinel || typeof IntersectionObserver === "undefined") {
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsStickyDocked(!entry.isIntersecting)
      },
      { threshold: [0, 1] },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  const isOnFilesTab = location.pathname.includes("/files/")

  // Name the trail with the real client and job instead of "Details".
  useSetBreadcrumbs(
    job
      ? [
          ...(canOpenClients && job.clientId
            ? [
                { label: "Clients", to: "/clients" },
                { label: job.clientName ?? "Client", to: `/clients/${job.clientId}` },
              ]
            : [{ label: "Jobs", to: "/jobs" }]),
          { label: job.title },
        ]
      : null,
  )

  const onPageDrop = useCallback(
    async (droppedFiles: File[]) => {
      if (!isAdmin || !jobId || droppedFiles.length === 0) return
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
    [isAdmin, jobId],
  )

  const pageDropzone = useDropzone({
    onDrop: onPageDrop,
    noClick: true,
    noKeyboard: true,
    disabled: !isAdmin || !jobId || isOnFilesTab, // Disable on files tab since FileBrowser has its own drop zone
  })

  const loadJob = (showLoading = false) => {
    const requestSeq = ++loadJobSeqRef.current
    const requestedJobId = jobId
	    if (!requestedJobId) return
	    if (showLoading) {
	      setLoading(true)
	      setJob(null)
    }
    setError(null)

	    jobsGetJobsId(requestedJobId)
	      .then((r) => {
          if (requestSeq !== loadJobSeqRef.current || requestedJobId !== jobId) return
	        // The typed response is `JobDetailResponse` whose `job` shape is a
	        // superset of what this header card actually renders, so cast down
	        // to our local `Job` to keep state shape-stable.
	        setJob(r.job as unknown as Job)
	      })
	      .catch((err: unknown) => {
          if (requestSeq !== loadJobSeqRef.current || requestedJobId !== jobId) return
          const status = (err as { response?: { status?: number } })?.response?.status
          if (status === 403 || status === 404) {
            setJob(null)
          }
	        setError(status === 403 ? "You no longer have access to this job." : "Unable to load this job.")
          toastApiError(err, "Failed to load job")
	      })
	      .finally(() => {
	        if (showLoading && requestSeq === loadJobSeqRef.current && requestedJobId === jobId) {
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
        contractValueCents: (current.contractValueCents as number | null) ?? null,
        amountPaidCents: (current.amountPaidCents as number | null) ?? null,
        jobType: (current.jobType as JobsJobPayloadSchema["jobType"]) ?? null,
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
      const res = await updateJobMutation.mutateAsync({ id: jobId, data: validated })
      const updatedJob = res.job as unknown as Job
      setJob((prev) =>
        prev
          ? {
              ...prev,
              status: updatedJob.status,
              title: updatedJob.title ?? prev.title,
              city: updatedJob.city ?? prev.city,
              state: updatedJob.state ?? prev.state,
              contractValueCents: updatedJob.contractValueCents ?? prev.contractValueCents,
              amountPaidCents: updatedJob.amountPaidCents ?? prev.amountPaidCents,
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
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-6 text-center">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-900">Job not found</h1>
          <p className="text-sm text-slate-500">{error ?? "This job could not be found."}</p>
        </div>
        <Link
          to="/jobs"
          className="text-sm font-medium text-primary hover:text-primary/80"
        >
          Back to jobs
        </Link>
      </div>
    )
	  }

  if (job && location.pathname.endsWith("/financials") && !(job.access?.financials ?? isAdmin)) {
    return <Navigate to={`/jobs/${job.id}/summary`} replace />
  }

	  return (
    <div {...pageDropzone.getRootProps()} className="relative space-y-0">
      {isAdmin ? (
        <input {...pageDropzone.getInputProps({ className: "hidden" })} />
      ) : null}

      {/* Page-level drop overlay */}
      {pageDropzone.isDragActive && !isOnFilesTab && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-accent/85 backdrop-blur-sm">
          <div className="rounded-lg border-2 border-dashed border-primary/45 bg-white px-12 py-10 text-center shadow-lg">
            <Upload className="mx-auto mb-3 size-10 text-primary" />
            <p className="text-lg font-semibold text-primary">Drop files to upload</p>
            <p className="mt-1 text-sm text-muted-foreground">Files will be saved to Documents</p>
          </div>
        </div>
      )}

      {pageUploading && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-primary/20 bg-white px-4 py-2 shadow-lg">
          <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm font-medium text-primary">Uploading...</span>
        </div>
      )}

      {/* Phones don't show the breadcrumb trail, so give them a way back. */}
      <div className="mb-2 md:hidden">
        <Link
          to={!canOpenClients || !job?.clientId ? "/jobs" : `/clients/${job.clientId}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {!canOpenClients || !job?.clientId ? "Jobs" : job.clientName ?? "Client"}
        </Link>
      </div>

      {/* Sticky sentinel: when this scrolls out of view we know the
          sticky title bar has docked, and can render the subtle shadow. */}
      <div ref={stickySentinelRef} aria-hidden className="h-px w-full" />

      {/* Sticky header: title block and the tab bar stay glued to the top
          of the scrollable region while the user scrolls through long
          detail pages. */}
      <div
        className={cn(
          "sticky top-0 z-20 -mx-4 bg-background/95 px-4 backdrop-blur transition-shadow supports-[backdrop-filter]:bg-background/85 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
          isStickyDocked ? "shadow-[0_6px_12px_-10px_rgba(15,23,42,0.35)]" : "",
        )}
      >
        {/* Title block: name + status, then client and location */}
        <div className="flex items-start gap-3 pb-4 pt-1">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-4 w-48" />
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              {/* The full record name always shows; long names wrap. */}
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                <h1 className="min-w-0 text-xl font-semibold leading-7 text-foreground [overflow-wrap:anywhere] sm:text-[26px] sm:leading-8">
                  {job?.title}
                </h1>
                {job?.status && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 capitalize",
                      STATUS_COLORS[job.status],
                    )}
                  >
                    {job.status}
                  </Badge>
                )}
              </div>
              {(job && ((canOpenClients && job.clientId) || job.city || job.state)) ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {canOpenClients && job.clientId ? (
                    <Link
                      to={`/clients/${job.clientId}`}
                      className="inline-flex min-w-0 items-center gap-1.5 transition-colors hover:text-foreground"
                    >
                      <Building2 className="size-4 shrink-0" />
                      <span className="truncate">{job.clientName ?? "Client"}</span>
                    </Link>
                  ) : null}
                  {job.city || job.state ? (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="size-4 shrink-0" />
                      {[job.city, job.state].filter(Boolean).join(", ")}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {isAdmin && job && (
              <div className="shrink-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      aria-label="Job actions"
                    >
                      <MoreHorizontal className="size-4" />
                      <span className="hidden sm:inline">Job actions</span>
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

        {/* Pill tabs. The scroller is padded so the selected pill and the
            keyboard focus ring are never clipped by its overflow edge. */}
        <div className="border-b border-border pb-2">
	          <nav
              aria-label="Job sections"
              className="scrollbar-none -mx-1.5 grid scroll-px-1.5 gap-1 p-1.5 md:flex md:overflow-x-auto"
              style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
            >
            {visibleTabs.map((tab) => {
              const Icon = tab.icon
              const isActive = tab.matchPrefix
                ? location.pathname.includes(`/${tab.matchPrefix}`)
                : location.pathname.endsWith(`/${tab.path}`)
              return (
                <Link
                  key={tab.path}
                  to={`/jobs/${jobId}/${tab.path}`}
                  aria-current={isActive ? "page" : undefined}
                  onFocus={revealOnFocus}
                  className={cn(
                    "group inline-flex min-w-0 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-center text-[11px] leading-tight transition-colors md:flex-row md:justify-start md:gap-2 md:whitespace-nowrap md:rounded-full md:px-4 md:text-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    isActive
                      ? "bg-accent font-semibold text-accent-foreground"
                      : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                    )}
                  />
                  <span className="min-w-0">{tab.label}</span>
                </Link>
              )
            })}
          </nav>
        </div>
      </div>

      <div className="pt-5">
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
              className="bg-primary hover:bg-primary/90 focus:ring-primary"
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
