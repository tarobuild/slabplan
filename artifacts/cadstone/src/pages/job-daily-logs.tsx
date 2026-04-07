import { useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { CalendarDays, Clock, Loader2, Plus, Search } from "lucide-react"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
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

type DailyLog = {
  id: string
  logDate: string
  title: string | null
  notes: string | null
  weatherNotes: string | null
  isPrivate: boolean
  publishedAt: string | null
  createdAt: string
  createdByName: string | null
  tags: { tag: string }[]
}

type Pagination = { page: number; pageSize: number; totalItems: number; totalPages: number }

type CreateForm = {
  logDate: string
  title: string
  notes: string
  weatherNotes: string
  isPrivate: boolean
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
}

function today() {
  return new Date().toISOString().split("T")[0]
}

const emptyForm: CreateForm = {
  logDate: today(),
  title: "",
  notes: "",
  weatherNotes: "",
  isPrivate: false,
}

export default function JobDailyLogsPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [logs, setLogs] = useState<DailyLog[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
  const [keywords, setKeywords] = useState("")
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CreateForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchLogs = (kw = keywords, p = 1) => {
    if (!jobId) return
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), pageSize: "10" })
    if (kw) params.set("keywords", kw)
    api.get(`/jobs/${jobId}/daily-logs?${params}`)
      .then(r => {
        setLogs(r.data.logs ?? r.data.dailyLogs ?? [])
        if (r.data.pagination) setPagination(r.data.pagination)
      })
      .catch(() => toast.error("Failed to load daily logs"))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchLogs() }, [jobId])

  const handleSearch = (v: string) => {
    setKeywords(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchLogs(v, 1), 300)
  }

  const handlePage = (p: number) => fetchLogs(keywords, p)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!jobId) return
    setSaving(true)
    try {
      await api.post(`/jobs/${jobId}/daily-logs`, {
        logDate: form.logDate,
        title: form.title || null,
        notes: form.notes || null,
        weatherNotes: form.weatherNotes || null,
        isPrivate: form.isPrivate,
        includeWeather: false,
      })
      toast.success("Daily log created")
      setCreateOpen(false)
      setForm({ ...emptyForm, logDate: today() })
      fetchLogs()
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create log")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Daily Logs</h1>
        <Button size="sm" onClick={() => { setForm({ ...emptyForm, logDate: today() }); setCreateOpen(true) }}>
          <Plus className="mr-1.5 size-3.5" />New Log
        </Button>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" />
        <Input value={keywords} onChange={e => handleSearch(e.target.value)} placeholder="Search logs…" className="pl-8 h-9" />
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="py-16 text-center">
          <CalendarDays className="mx-auto mb-3 size-8 text-slate-300" />
          <p className="text-sm text-slate-400">No daily logs yet.</p>
          <button onClick={() => { setForm({ ...emptyForm, logDate: today() }); setCreateOpen(true) }} className="mt-2 text-sm text-blue-600 hover:underline">
            Create the first one
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map(log => (
            <div key={log.id} className="rounded-lg border border-[#E5E7EB] bg-white p-4 hover:border-blue-200 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                      <CalendarDays className="size-3.5" />
                      {fmtDate(log.logDate)}
                    </span>
                    {log.isPrivate && (
                      <Badge variant="outline" className="text-xs text-slate-500 border-slate-200">Private</Badge>
                    )}
                    {log.publishedAt && (
                      <Badge variant="outline" className="text-xs text-green-700 border-green-200 bg-green-50">Published</Badge>
                    )}
                    {log.tags?.map(t => (
                      <Badge key={t.tag} variant="outline" className="text-xs text-blue-600 border-blue-200 bg-blue-50">
                        {t.tag}
                      </Badge>
                    ))}
                  </div>
                  {log.title && (
                    <p className="mt-1.5 font-medium text-slate-900">{log.title}</p>
                  )}
                  {log.notes && (
                    <p className="mt-1 text-sm text-slate-600 line-clamp-2">{log.notes}</p>
                  )}
                  {log.weatherNotes && (
                    <p className="mt-1 text-xs text-slate-400 italic">{log.weatherNotes}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {log.createdByName && (
                    <p className="text-xs text-slate-400">{log.createdByName}</p>
                  )}
                  <p className="text-xs text-slate-400 flex items-center gap-1 justify-end mt-0.5">
                    <Clock className="size-3" />
                    {new Date(log.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && pagination.totalItems > pagination.pageSize && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            {(pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.totalItems)} of {pagination.totalItems}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => handlePage(pagination.page - 1)} disabled={pagination.page <= 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => handlePage(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Daily Log</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="dl-date">Log Date *</Label>
                <Input id="dl-date" type="date" value={form.logDate} onChange={e => setForm(f => ({ ...f, logDate: e.target.value }))} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dl-title">Title</Label>
                <Input id="dl-title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Installation Day 1" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dl-notes">Notes</Label>
                <textarea
                  id="dl-notes"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Describe what happened on site today…"
                  rows={4}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dl-weather">Weather Notes</Label>
                <Input id="dl-weather" value={form.weatherNotes} onChange={e => setForm(f => ({ ...f, weatherNotes: e.target.value }))} placeholder="e.g. Sunny, 75°F" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isPrivate}
                  onChange={e => setForm(f => ({ ...f, isPrivate: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                <span className="text-sm text-slate-600">Private (internal only)</span>
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                Create Log
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
