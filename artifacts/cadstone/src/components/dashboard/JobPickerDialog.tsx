import { useEffect, useMemo, useState } from "react"
import { Briefcase, Loader2, Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { toastApiError } from "@/lib/api-errors"

type PickableJob = {
  id: string
  title: string
  status?: string | null
  city?: string | null
  state?: string | null
}

type JobPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  onSelect: (jobId: string) => void
}

// Lightweight picker fed by the existing /jobs?status=open endpoint.
// Cached in component state for the lifetime of the dialog open.
export function JobPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  onSelect,
}: JobPickerDialogProps) {
  const [jobs, setJobs] = useState<PickableJob[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    api
      .get("/jobs?status=open&pageSize=100")
      .then((response) => {
        if (cancelled) return
        const list: PickableJob[] = response.data?.jobs ?? []
        setJobs(list)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        toastApiError(err, "Failed to load jobs")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter((job) => {
      const haystack = [
        job.title,
        job.city ?? "",
        job.state ?? "",
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [jobs, search])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" />
            <Input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search jobs…"
              className="pl-8 h-9"
            />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border border-[#E5E7EB] bg-white">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-slate-400">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading jobs…
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">
                {search.trim()
                  ? "No matching jobs."
                  : "No open jobs to pick from."}
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filtered.map((job) => (
                  <li key={job.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(job.id)
                        onOpenChange(false)
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                    >
                      <span className="flex size-8 items-center justify-center rounded-full bg-orange-50 text-orange-500">
                        <Briefcase className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {job.title}
                        </span>
                        {(job.city || job.state) && (
                          <span className="block truncate text-xs text-slate-500">
                            {[job.city, job.state].filter(Boolean).join(", ")}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default JobPickerDialog
