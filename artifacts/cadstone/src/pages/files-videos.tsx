import { useEffect, useState } from "react"
import { FolderOpen, Video } from "lucide-react"
import FileBrowser from "@/components/FileBrowser"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { toast } from "sonner"

type Job = {
  id: string
  title: string
  status: string | null
}

function getApiError(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { response?: { data?: { message?: string } }; message?: string }
    return e.response?.data?.message ?? e.message ?? fallback
  }
  return fallback
}

export default function FilesVideosPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get("/jobs")
      .then((r) => {
        const list: Job[] = r.data.jobs ?? []
        setJobs(list)
        if (list.length > 0) setSelectedJobId(list[0].id)
      })
      .catch((err: unknown) => toast.error(getApiError(err, "Failed to load jobs")))
      .finally(() => setLoading(false))
  }, [])

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
        ) : (
          <p className="text-sm text-slate-400">No jobs found</p>
        )}
      </div>
      <div className="border-t border-slate-200" />
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
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
