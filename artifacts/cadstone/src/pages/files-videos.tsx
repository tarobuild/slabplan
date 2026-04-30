import { useEffect, useState } from "react"
import { FolderOpen, Video } from "lucide-react"
import { useJobsGetJobs } from "@workspace/api-client-react"
import FileBrowser from "@/components/FileBrowser"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { toastApiError } from "@/lib/api-errors"

export default function FilesVideosPage() {
  useDocumentTitle("Videos")
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  // Use the generated typed hook so this page benefits from the same
  // tanstack-query cache and refetch behavior as the rest of the app.
  const jobsQuery = useJobsGetJobs()
  const jobs = jobsQuery.data?.jobs ?? []
  const loading = jobsQuery.isPending

  useEffect(() => {
    if (jobsQuery.error) {
      toastApiError(jobsQuery.error, "Failed to load jobs")
    }
  }, [jobsQuery.error])

  // Auto-select the first job once the list arrives, but only when the user
  // hasn't picked one yet (or the selection is no longer in the list).
  useEffect(() => {
    if (jobs.length === 0) return
    if (!selectedJobId || !jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(jobs[0].id)
    }
  }, [jobs, selectedJobId])

  const selectedJob = jobs.find((job) => job.id === selectedJobId)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Video className="size-6 text-slate-700" />
            <h1 className="text-2xl font-bold text-slate-900">Videos</h1>
          </div>
          {selectedJob && <p className="mt-0.5 text-sm text-slate-500">{selectedJob.title}</p>}
        </div>
        {loading ? (
          <Skeleton className="h-9 w-56" />
        ) : jobs.length > 0 ? (
          <Select value={selectedJobId ?? ""} onValueChange={(value) => setSelectedJobId(value)}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select a job" />
            </SelectTrigger>
            <SelectContent>
              {jobs.map((job) => (
                <SelectItem key={job.id} value={job.id}>
                  {job.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      <div className="border-t border-slate-200" />
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="py-16 text-center">
          <FolderOpen className="mx-auto mb-3 size-8 text-slate-200" />
          <p className="text-sm text-slate-500">
            No jobs available. You&apos;ll see files here once you&apos;re assigned to a job.
          </p>
        </div>
      ) : selectedJobId ? (
        <FileBrowser key={selectedJobId} mediaType="video" jobIdOverride={selectedJobId} />
      ) : (
        <div className="py-16 text-center">
          <FolderOpen className="mx-auto mb-3 size-8 text-slate-200" />
          <p className="text-sm text-slate-400">Select a job to view its videos.</p>
        </div>
      )}
    </div>
  )
}
