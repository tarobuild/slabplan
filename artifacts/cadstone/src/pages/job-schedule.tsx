import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { CalendarDays, Loader2, Plus } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"

type ScheduleItem = {
  id: string
  title: string
  startDate: string
  endDate: string | null
  workDays: number
  progress: number
  displayColor: string | null
  isHourly: boolean
  startTime: string | null
  endTime: string | null
  reminder: string
  notes: string | null
  createdAt: string
  assignees?: { userId: string; fullName: string | null }[]
  tags?: string[]
}

type CreateForm = {
  title: string
  startDate: string
  workDays: string
  progress: string
  displayColor: string
  notes: string
}

function fmtDate(d: string | null) {
  if (!d) return "—"
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function today() {
  return new Date().toISOString().split("T")[0]
}

const emptyForm: CreateForm = {
  title: "",
  startDate: today(),
  workDays: "1",
  progress: "0",
  displayColor: "#2563EB",
  notes: "",
}

const COLOR_OPTIONS = [
  { label: "Blue", value: "#2563EB" },
  { label: "Green", value: "#16A34A" },
  { label: "Red", value: "#DC2626" },
  { label: "Yellow", value: "#D97706" },
  { label: "Purple", value: "#7C3AED" },
  { label: "Pink", value: "#DB2777" },
  { label: "Gray", value: "#6B7280" },
]

export default function JobSchedulePage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [items, setItems] = useState<ScheduleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CreateForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  const fetchItems = () => {
    if (!jobId) return
    setLoading(true)
    api.get(`/jobs/${jobId}/schedule`)
      .then(r => setItems(r.data.items ?? []))
      .catch(() => toast.error("Failed to load schedule"))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchItems() }, [jobId])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!jobId) return
    setSaving(true)
    try {
      await api.post(`/jobs/${jobId}/schedule`, {
        title: form.title,
        startDate: form.startDate,
        workDays: Number(form.workDays) || 1,
        progress: Number(form.progress) || 0,
        displayColor: form.displayColor,
        notes: form.notes || null,
      })
      toast.success("Schedule item created")
      setCreateOpen(false)
      setForm(emptyForm)
      fetchItems()
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create item")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Schedule</h1>
        <Button size="sm" onClick={() => { setForm(emptyForm); setCreateOpen(true) }}>
          <Plus className="mr-1.5 size-3.5" />Add Item
        </Button>
      </div>

      <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="font-semibold text-slate-600 w-4" />
              <TableHead className="font-semibold text-slate-600">Title</TableHead>
              <TableHead className="font-semibold text-slate-600">Start</TableHead>
              <TableHead className="font-semibold text-slate-600">End</TableHead>
              <TableHead className="font-semibold text-slate-600">Days</TableHead>
              <TableHead className="font-semibold text-slate-600">Progress</TableHead>
              <TableHead className="font-semibold text-slate-600">Assignees</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center">
                  <CalendarDays className="mx-auto mb-2 size-7 text-slate-300" />
                  <p className="text-sm text-slate-400">No schedule items yet.</p>
                  <button onClick={() => { setForm(emptyForm); setCreateOpen(true) }} className="mt-1 text-sm text-blue-600 hover:underline">
                    Add the first item
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              items.map(item => (
                <TableRow key={item.id} className="hover:bg-slate-50">
                  <TableCell>
                    <div
                      className="size-3 rounded-full shrink-0"
                      style={{ background: item.displayColor ?? "#2563EB" }}
                    />
                  </TableCell>
                  <TableCell className="font-medium text-slate-900">{item.title}</TableCell>
                  <TableCell className="text-sm text-slate-500">{fmtDate(item.startDate)}</TableCell>
                  <TableCell className="text-sm text-slate-500">{fmtDate(item.endDate)}</TableCell>
                  <TableCell className="text-sm text-slate-500">{item.workDays}d</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 max-w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500 tabular-nums">{item.progress}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {item.assignees && item.assignees.length > 0
                      ? item.assignees.map(a => a.fullName || "Unknown").join(", ")
                      : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Schedule Item</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="sc-title">Title *</Label>
                <Input id="sc-title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="e.g. Stone Fabrication" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sc-start">Start Date *</Label>
                  <Input id="sc-start" type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sc-days">Work Days</Label>
                  <Input id="sc-days" type="number" min="1" max="365" value={form.workDays} onChange={e => setForm(f => ({ ...f, workDays: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sc-progress">Progress (%)</Label>
                  <Input id="sc-progress" type="number" min="0" max="100" value={form.progress} onChange={e => setForm(f => ({ ...f, progress: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Color</Label>
                  <Select value={form.displayColor} onValueChange={v => setForm(f => ({ ...f, displayColor: v }))}>
                    <SelectTrigger>
                      <div className="flex items-center gap-2">
                        <div className="size-3 rounded-full" style={{ background: form.displayColor }} />
                        <SelectValue />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {COLOR_OPTIONS.map(c => (
                        <SelectItem key={c.value} value={c.value}>
                          <div className="flex items-center gap-2">
                            <div className="size-3 rounded-full" style={{ background: c.value }} />
                            {c.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sc-notes">Notes</Label>
                <Input id="sc-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes…" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                Add Item
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
