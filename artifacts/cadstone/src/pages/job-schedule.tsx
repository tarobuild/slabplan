import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutList,
  Loader2,
  Plus,
} from "lucide-react"
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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

type AppUser = {
  id: string
  fullName: string
  email: string
}

type CreateForm = {
  title: string
  startDate: string
  workDays: string
  progress: string
  displayColor: string
  notes: string
}

type ViewMode = "calendar" | "list"

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function fmtDate(d: string | null) {
  if (!d) return "—"
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function todayStr() {
  return new Date().toISOString().split("T")[0]
}

function isoDate(d: Date) {
  return d.toISOString().split("T")[0]
}

function itemCoversDate(item: ScheduleItem, dayStr: string): boolean {
  const start = item.startDate
  const end = item.endDate ?? item.startDate
  return dayStr >= start && dayStr <= end
}

function getCalendarWeeks(year: number, month: number): string[][] {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  const startDay = new Date(firstDay)
  startDay.setDate(firstDay.getDate() - firstDay.getDay())

  const endDay = new Date(lastDay)
  const remaining = 6 - lastDay.getDay()
  endDay.setDate(lastDay.getDate() + remaining)

  const weeks: string[][] = []
  const cur = new Date(startDay)

  while (cur <= endDay) {
    const week: string[] = []
    for (let i = 0; i < 7; i++) {
      week.push(isoDate(cur))
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }

  return weeks
}

const emptyForm: CreateForm = {
  title: "",
  startDate: todayStr(),
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

function ItemPill({ item }: { item: ScheduleItem }) {
  const color = item.displayColor ?? "#2563EB"
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="w-full text-left px-1.5 py-0.5 rounded text-xs font-medium text-white truncate leading-tight cursor-pointer hover:opacity-80 transition-opacity"
          style={{ backgroundColor: color }}
          onClick={(e) => e.stopPropagation()}
        >
          {item.title}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" side="bottom" align="start">
        <p className="font-semibold text-sm text-slate-900 mb-1">{item.title}</p>
        <p className="text-xs text-slate-500">
          {fmtDate(item.startDate)}
          {item.endDate && item.endDate !== item.startDate && ` → ${fmtDate(item.endDate)}`}
        </p>
        {item.assignees && item.assignees.length > 0 && (
          <p className="text-xs text-slate-500 mt-1">
            {item.assignees.map((a) => a.fullName || "Unknown").join(", ")}
          </p>
        )}
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${item.progress}%`, backgroundColor: color }}
              />
            </div>
            <span className="text-xs text-slate-500 tabular-nums">{item.progress}%</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default function JobSchedulePage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [items, setItems] = useState<ScheduleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>("calendar")

  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth())

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CreateForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [users, setUsers] = useState<AppUser[]>([])
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([])

  const fetchItems = () => {
    if (!jobId) return
    setLoading(true)
    api
      .get(`/jobs/${jobId}/schedule`)
      .then((r) => setItems(r.data.items ?? []))
      .catch(() => toast.error("Failed to load schedule"))
      .finally(() => setLoading(false))
  }

  const fetchUsers = () => {
    api
      .get("/users")
      .then((r) => setUsers(r.data.users ?? []))
      .catch(() => {})
  }

  useEffect(() => {
    fetchItems()
  }, [jobId])

  useEffect(() => {
    if (createOpen) fetchUsers()
  }, [createOpen])

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
        assigneeIds: selectedAssignees,
      })
      toast.success("Schedule item created")
      setCreateOpen(false)
      setForm(emptyForm)
      setSelectedAssignees([])
      fetchItems()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e.response?.data?.message ?? "Failed to create item")
    } finally {
      setSaving(false)
    }
  }

  const toggleAssignee = (userId: string) => {
    setSelectedAssignees((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }

  const goToPrevMonth = () => {
    if (calMonth === 0) {
      setCalMonth(11)
      setCalYear((y) => y - 1)
    } else {
      setCalMonth((m) => m - 1)
    }
  }

  const goToNextMonth = () => {
    if (calMonth === 11) {
      setCalMonth(0)
      setCalYear((y) => y + 1)
    } else {
      setCalMonth((m) => m + 1)
    }
  }

  const goToToday = () => {
    const n = new Date()
    setCalYear(n.getFullYear())
    setCalMonth(n.getMonth())
  }

  const weeks = getCalendarWeeks(calYear, calMonth)
  const todayIso = todayStr()
  const currentMonthPrefix = `${String(calYear)}-${String(calMonth + 1).padStart(2, "0")}`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Schedule</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-[#E5E7EB] overflow-hidden">
            <button
              onClick={() => setViewMode("calendar")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "calendar"
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <CalendarDays className="size-3.5" />
              Calendar
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-l border-[#E5E7EB] ${
                viewMode === "list"
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <LayoutList className="size-3.5" />
              List
            </button>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setForm(emptyForm)
              setSelectedAssignees([])
              setCreateOpen(true)
            }}
          >
            <Plus className="mr-1.5 size-3.5" />
            Add Item
          </Button>
        </div>
      </div>

      {viewMode === "calendar" ? (
        <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB]">
            <div className="flex items-center gap-2">
              <button
                onClick={goToPrevMonth}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
              >
                <ChevronLeft className="size-4" />
              </button>
              <h2 className="text-sm font-semibold text-slate-800 min-w-36 text-center">
                {MONTH_NAMES[calMonth]} {calYear}
              </h2>
              <button
                onClick={goToNextMonth}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <button
              onClick={goToToday}
              className="text-xs font-medium text-blue-600 hover:underline px-2 py-1 rounded hover:bg-blue-50"
            >
              Today
            </button>
          </div>

          <div className="grid grid-cols-7 border-b border-[#E5E7EB]">
            {DAYS_OF_WEEK.map((d) => (
              <div
                key={d}
                className="text-center text-xs font-semibold text-slate-400 py-2"
              >
                {d}
              </div>
            ))}
          </div>

          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div>
              {weeks.map((week, wi) => (
                <div
                  key={wi}
                  className="grid grid-cols-7 border-b border-[#E5E7EB] last:border-b-0"
                >
                  {week.map((dayStr) => {
                    const isCurrentMonth = dayStr.startsWith(currentMonthPrefix)
                    const isToday = dayStr === todayIso
                    const dayNum = parseInt(dayStr.split("-")[2], 10)
                    const dayItems = items.filter((item) => itemCoversDate(item, dayStr))

                    return (
                      <div
                        key={dayStr}
                        className={`min-h-[88px] p-1.5 border-r border-[#E5E7EB] last:border-r-0 ${
                          isCurrentMonth ? "bg-white" : "bg-slate-50/50"
                        }`}
                      >
                        <div className="flex justify-end mb-1">
                          <span
                            className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                              isToday
                                ? "bg-blue-600 text-white"
                                : isCurrentMonth
                                ? "text-slate-700"
                                : "text-slate-300"
                            }`}
                          >
                            {dayNum}
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          {dayItems.slice(0, 3).map((item) => (
                            <ItemPill key={item.id + dayStr} item={item} />
                          ))}
                          {dayItems.length > 3 && (
                            <p className="text-xs text-slate-400 pl-1">
                              +{dayItems.length - 3} more
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
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
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center">
                    <CalendarDays className="mx-auto mb-2 size-7 text-slate-300" />
                    <p className="text-sm text-slate-400">No schedule items yet.</p>
                    <button
                      onClick={() => {
                        setForm(emptyForm)
                        setSelectedAssignees([])
                        setCreateOpen(true)
                      }}
                      className="mt-1 text-sm text-blue-600 hover:underline"
                    >
                      Add the first item
                    </button>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} className="hover:bg-slate-50">
                    <TableCell>
                      <div
                        className="size-3 rounded-full shrink-0"
                        style={{ background: item.displayColor ?? "#2563EB" }}
                      />
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">{item.title}</TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {fmtDate(item.startDate)}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {fmtDate(item.endDate)}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">{item.workDays}d</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 max-w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-500"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 tabular-nums">
                          {item.progress}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {item.assignees && item.assignees.length > 0
                        ? item.assignees.map((a) => a.fullName || "Unknown").join(", ")
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setSelectedAssignees([])
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Schedule Item</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="sc-title">Title *</Label>
                <Input
                  id="sc-title"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  required
                  placeholder="e.g. Stone Fabrication"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sc-start">Start Date *</Label>
                  <Input
                    id="sc-start"
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sc-days">Work Days</Label>
                  <Input
                    id="sc-days"
                    type="number"
                    min="1"
                    max="365"
                    value={form.workDays}
                    onChange={(e) => setForm((f) => ({ ...f, workDays: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sc-progress">Progress (%)</Label>
                  <Input
                    id="sc-progress"
                    type="number"
                    min="0"
                    max="100"
                    value={form.progress}
                    onChange={(e) => setForm((f) => ({ ...f, progress: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Color</Label>
                  <Select
                    value={form.displayColor}
                    onValueChange={(v) => setForm((f) => ({ ...f, displayColor: v }))}
                  >
                    <SelectTrigger>
                      <div className="flex items-center gap-2">
                        <div
                          className="size-3 rounded-full"
                          style={{ background: form.displayColor }}
                        />
                        <SelectValue />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {COLOR_OPTIONS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          <div className="flex items-center gap-2">
                            <div
                              className="size-3 rounded-full"
                              style={{ background: c.value }}
                            />
                            {c.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {users.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Assignees</Label>
                  <div className="rounded-md border border-[#E5E7EB] divide-y divide-[#E5E7EB] max-h-40 overflow-y-auto">
                    {users.map((u) => (
                      <label
                        key={u.id}
                        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAssignees.includes(u.id)}
                          onChange={() => toggleAssignee(u.id)}
                          className="rounded border-slate-300"
                        />
                        <span className="text-sm text-slate-700">{u.fullName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="sc-notes">Notes</Label>
                <Input
                  id="sc-notes"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes…"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
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
