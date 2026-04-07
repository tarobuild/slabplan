import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { addDays, format, getDay, parse, startOfWeek } from "date-fns"
import { enUS } from "date-fns/locale/en-US"
import Gantt, { type GanttTask } from "frappe-gantt"
import {
  Calendar as BigCalendar,
  dateFnsLocalizer,
  type View,
} from "react-big-calendar"
import "react-big-calendar/lib/css/react-big-calendar.css"
import {
  CalendarDays,
  Filter,
  HelpCircle,
  MoreHorizontal,
  Plus,
  Settings2,
} from "lucide-react"
import { toast } from "sonner"
import { useOutletContext, useSearchParams } from "react-router-dom"
import { api } from "@/lib/api"
import {
  apiErrorMessage,
  calculateBusinessEndDate,
  formatDate,
  formatDateTime,
  JobShellContext,
  scheduleStatusClass,
  titleCaseStatus,
  type UserOption,
} from "@/feature-utils"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 0 }),
  getDay,
  locales: {
    "en-US": enUS,
  },
})

type ScheduleItemRecord = {
  id: string
  jobId: string | null
  title: string
  displayColor: string
  startDate: string
  endDate: string
  workDays: number
  isHourly: boolean | null
  startTime: string | null
  endTime: string | null
  progress: number | null
  reminder: string | null
  notes: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  createdByName: string | null
  tags: string[]
  assigneeIds: string[]
  assignees: UserOption[]
  predecessors: Array<{
    scheduleItemId: string
    title: string
    dependencyType: string
    lagDays: number
  }>
  status: string
}

type ActivityEntry = {
  id: string
  entityType: string
  entityId: string
  action: string
  metadata: Record<string, unknown> | null
  createdAt: string
  userName: string | null
}

type ScheduleFormState = {
  title: string
  displayColor: string
  assigneeIds: string[]
  startDate: string
  workDays: number
  endDate: string
  isHourly: boolean
  startTime: string
  endTime: string
  progress: number
  reminder: string
  notes: string
  tagsInput: string
  predecessors: ScheduleItemRecord["predecessors"]
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <CalendarDays className="size-6 text-slate-400" />
        <div className="space-y-1">
          <h3 className="font-semibold text-slate-950">{title}</h3>
          <p className="max-w-md text-sm text-slate-500">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function pageHeading(actions: ReactNode) {
  return (
    <CardHeader className="flex flex-col gap-3 border-b border-[#E5E7EB] pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <CardTitle className="text-xl font-semibold text-slate-950">Schedule</CardTitle>
        <CardDescription>
          Coordinate tasks across calendar, list, and Gantt views for the selected job.
        </CardDescription>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </CardHeader>
  )
}

function defaultForm(startDate: string): ScheduleFormState {
  return {
    title: "",
    displayColor: "#2563EB",
    assigneeIds: [],
    startDate,
    workDays: 1,
    endDate: calculateBusinessEndDate(startDate, 1),
    isHourly: false,
    startTime: "08:00",
    endTime: "17:00",
    progress: 0,
    reminder: "none",
    notes: "",
    tagsInput: "",
    predecessors: [],
  }
}

function formFromItem(item: ScheduleItemRecord): ScheduleFormState {
  return {
    title: item.title,
    displayColor: item.displayColor || "#2563EB",
    assigneeIds: item.assigneeIds,
    startDate: item.startDate,
    workDays: item.workDays,
    endDate: item.endDate,
    isHourly: !!item.isHourly,
    startTime: item.startTime?.slice(0, 5) || "08:00",
    endTime: item.endTime?.slice(0, 5) || "17:00",
    progress: item.progress ?? 0,
    reminder: item.reminder || "none",
    notes: item.notes || "",
    tagsInput: item.tags.join(", "),
    predecessors: item.predecessors,
  }
}

function ScheduleActivityDialog({
  jobId,
  open,
  onOpenChange,
}: {
  jobId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    let active = true
    setLoading(true)

    void api
      .get<{ entries: ActivityEntry[] }>(`/activity?jobId=${jobId}&page=1&limit=50`)
      .then((response) => {
        if (!active) {
          return
        }

        setEntries(response.data.entries.filter((entry) => entry.entityType === "schedule_item"))
      })
      .catch((error) => {
        if (active) {
          toast.error(apiErrorMessage(error, "Unable to load schedule activity."))
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [jobId, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-[#E5E7EB] bg-white">
        <DialogHeader>
          <DialogTitle>Schedule Activity</DialogTitle>
          <DialogDescription>
            Recent create, update, and delete events tied to schedule items for this job.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="size-5 text-blue-600" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyPanel title="No schedule activity yet" description="Changes will appear here once the team starts planning work." />
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-[#E5E7EB] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-950">
                      {String(entry.metadata?.description || titleCaseStatus(entry.action))}
                    </p>
                    <p className="text-xs text-slate-500">
                      {entry.userName || "System"} • {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-[#E5E7EB] bg-[#F9FAFB] text-slate-600">
                    {titleCaseStatus(entry.action)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ScheduleGanttChart({
  items,
  viewMode,
  onSelect,
}: {
  items: ScheduleItemRecord[]
  viewMode: "Day" | "Week" | "Month"
  onSelect: (item: ScheduleItemRecord) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    containerRef.current.innerHTML = ""

    const taskMap = new Map(items.map((item) => [item.id, item]))
    const tasks: GanttTask[] = items.map((item) => ({
      id: item.id,
      name: item.title,
      start: item.startDate,
      end: addDays(new Date(`${item.endDate}T00:00:00.000Z`), 1).toISOString().slice(0, 10),
      progress: item.progress ?? 0,
      dependencies: item.predecessors.map((predecessor) => predecessor.scheduleItemId),
      custom_class: "cadstone-gantt-task",
      description: `${item.assignees.map((assignee) => assignee.fullName).join(", ") || "Unassigned"} • ${item.status.replaceAll("_", " ")}`,
    }))

    const chart = new Gantt(containerRef.current, tasks, {
      view_mode: viewMode,
      readonly: true,
      today_button: false,
      ignore: "weekend",
      on_click(task) {
        const selected = taskMap.get(task.id)

        if (selected) {
          onSelect(selected)
        }
      },
    })

    chart.change_view_mode(viewMode, true)
  }, [items, onSelect, viewMode])

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-3">
      <div ref={containerRef} className="cadstone-gantt min-h-[420px] overflow-x-auto" />
    </div>
  )
}

function ScheduleItemDialog({
  open,
  onOpenChange,
  item,
  items,
  users,
  jobId,
  onSaved,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: ScheduleItemRecord | null
  items: ScheduleItemRecord[]
  users: UserOption[]
  jobId: string
  onSaved: () => Promise<void>
  onDeleted: () => Promise<void>
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [activeTab, setActiveTab] = useState("details")
  const [values, setValues] = useState<ScheduleFormState>(defaultForm(today))
  const [saving, setSaving] = useState(false)
  const [filterValue, setFilterValue] = useState("")
  const [dependencyType, setDependencyType] = useState("finish_to_start")
  const [lagDays, setLagDays] = useState("0")
  const [predecessorId, setPredecessorId] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      setActiveTab("details")
      setValues(defaultForm(today))
      setFilterValue("")
      setDependencyType("finish_to_start")
      setLagDays("0")
      setPredecessorId("")
      return
    }

    setValues(item ? formFromItem(item) : defaultForm(today))
  }, [item, open, today])

  const availablePredecessors = useMemo(
    () => items.filter((candidate) => candidate.id !== item?.id),
    [item?.id, items],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto border-[#E5E7EB] bg-white">
        <DialogHeader>
          <DialogTitle>{item ? "Update Schedule Item" : "New Schedule Item"}</DialogTitle>
          <DialogDescription>
            Define task timing, assignees, progress, reminders, dependencies, and tags.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-1">
            <TabsTrigger value="details">Schedule Item Details</TabsTrigger>
            <TabsTrigger value="related">Related Items</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="mt-5 space-y-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Task name</label>
                  <Input
                    value={values.title}
                    className="border-[#E5E7EB]"
                    onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-900">Start date</label>
                    <Input
                      type="date"
                      value={values.startDate}
                      className="border-[#E5E7EB]"
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          startDate: event.target.value,
                          endDate: calculateBusinessEndDate(event.target.value, current.workDays),
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-900">Work days</label>
                    <Input
                      type="number"
                      min={1}
                      value={values.workDays}
                      className="border-[#E5E7EB]"
                      onChange={(event) => {
                        const nextValue = Number(event.target.value) || 1
                        setValues((current) => ({
                          ...current,
                          workDays: nextValue,
                          endDate: calculateBusinessEndDate(current.startDate, nextValue),
                        }))
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-900">End date</label>
                    <Input
                      type="date"
                      value={values.endDate}
                      className="border-[#E5E7EB]"
                      onChange={(event) => setValues((current) => ({ ...current, endDate: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-900">Reminder</label>
                    <Select
                      value={values.reminder}
                      onValueChange={(value) => setValues((current) => ({ ...current, reminder: value }))}
                    >
                      <SelectTrigger className="border-[#E5E7EB]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="1_day_before">1 day before</SelectItem>
                        <SelectItem value="3_days_before">3 days before</SelectItem>
                        <SelectItem value="1_week_before">1 week before</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-900">Display color</label>
                    <Input
                      type="color"
                      value={values.displayColor}
                      className="h-10 border-[#E5E7EB] p-1"
                      onChange={(event) =>
                        setValues((current) => ({ ...current, displayColor: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-slate-900">Progress</label>
                      <span className="text-sm text-slate-500">{values.progress}%</span>
                    </div>
                    <Slider
                      value={[values.progress]}
                      max={100}
                      step={1}
                      onValueChange={([value]) =>
                        setValues((current) => ({ ...current, progress: value ?? 0 }))
                      }
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-900">Hourly task</p>
                      <p className="text-sm text-slate-500">Track start and end time instead of all-day work only.</p>
                    </div>
                    <Switch
                      checked={values.isHourly}
                      onCheckedChange={(checked) => setValues((current) => ({ ...current, isHourly: checked }))}
                    />
                  </div>
                  {values.isHourly ? (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-900">Start time</label>
                        <Input
                          type="time"
                          value={values.startTime}
                          className="border-[#E5E7EB] bg-white"
                          onChange={(event) =>
                            setValues((current) => ({ ...current, startTime: event.target.value }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-900">End time</label>
                        <Input
                          type="time"
                          value={values.endTime}
                          className="border-[#E5E7EB] bg-white"
                          onChange={(event) =>
                            setValues((current) => ({ ...current, endTime: event.target.value }))
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Notes</label>
                  <Textarea
                    rows={6}
                    value={values.notes}
                    className="border-[#E5E7EB]"
                    onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold text-slate-950">Assignees</h3>
                  <p className="text-sm text-slate-500">Choose the crew and PMs covering this task.</p>
                </div>
                <div className="space-y-2 rounded-lg border border-[#E5E7EB] p-3">
                  {users.map((user) => (
                    <label key={user.id} className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-[#F9FAFB]">
                      <Checkbox
                        checked={values.assigneeIds.includes(user.id)}
                        onCheckedChange={(checked) =>
                          setValues((current) => ({
                            ...current,
                            assigneeIds: checked
                              ? [...current.assigneeIds, user.id]
                              : current.assigneeIds.filter((itemId) => itemId !== user.id),
                          }))
                        }
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-900">{user.fullName}</p>
                        <p className="text-xs text-slate-500">{user.role.replaceAll("_", " ")}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="related" className="mt-5 space-y-5">
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px_120px_auto]">
                <Select value={predecessorId} onValueChange={setPredecessorId}>
                  <SelectTrigger className="border-[#E5E7EB] bg-white">
                    <SelectValue placeholder="Search existing tasks" />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePredecessors.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={dependencyType} onValueChange={setDependencyType}>
                  <SelectTrigger className="border-[#E5E7EB] bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="finish_to_start">Finish to Start</SelectItem>
                    <SelectItem value="start_to_start">Start to Start</SelectItem>
                    <SelectItem value="finish_to_finish">Finish to Finish</SelectItem>
                    <SelectItem value="start_to_finish">Start to Finish</SelectItem>
                  </SelectContent>
                </Select>

                <Input
                  value={lagDays}
                  type="number"
                  min={0}
                  className="border-[#E5E7EB] bg-white"
                  onChange={(event) => setLagDays(event.target.value)}
                />

                <Button
                  type="button"
                  onClick={() => {
                    const selected = availablePredecessors.find((candidate) => candidate.id === predecessorId)

                    if (!selected) {
                      return
                    }

                    setValues((current) => ({
                      ...current,
                      predecessors: [
                        ...current.predecessors.filter((entry) => entry.scheduleItemId !== selected.id),
                        {
                          scheduleItemId: selected.id,
                          title: selected.title,
                          dependencyType,
                          lagDays: Number(lagDays) || 0,
                        },
                      ],
                    }))
                    setPredecessorId("")
                    setLagDays("0")
                  }}
                >
                  Add
                </Button>
              </div>
            </div>

            {values.predecessors.length === 0 ? (
              <EmptyPanel title="No related items yet" description="Add predecessor tasks and any lag days needed for scheduling dependencies." />
            ) : (
              <div className="space-y-2">
                {values.predecessors.map((predecessor) => (
                  <div key={predecessor.scheduleItemId} className="flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] px-4 py-3">
                    <div>
                      <p className="font-medium text-slate-950">{predecessor.title}</p>
                      <p className="text-sm text-slate-500">
                        {titleCaseStatus(predecessor.dependencyType)} • {predecessor.lagDays} lag day(s)
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setValues((current) => ({
                          ...current,
                          predecessors: current.predecessors.filter((entry) => entry.scheduleItemId !== predecessor.scheduleItemId),
                        }))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Tags</label>
              <Input
                value={values.tagsInput}
                className="border-[#E5E7EB]"
                placeholder="demo, fabrication, site-ready"
                onChange={(event) => setValues((current) => ({ ...current, tagsInput: event.target.value }))}
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          {item ? (
            <Button
              type="button"
              variant="outline"
              className="mr-auto border-red-200 text-red-600 hover:text-red-700"
              onClick={() => setDeleteOpen(true)}
            >
              Delete
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="border-[#E5E7EB]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || !values.title.trim()}
            onClick={async () => {
              setSaving(true)

              try {
                const payload = {
                  title: values.title.trim(),
                  displayColor: values.displayColor,
                  assigneeIds: values.assigneeIds,
                  startDate: values.startDate,
                  workDays: values.workDays,
                  endDate: values.endDate,
                  isHourly: values.isHourly,
                  startTime: values.isHourly ? values.startTime : null,
                  endTime: values.isHourly ? values.endTime : null,
                  progress: values.progress,
                  reminder: values.reminder,
                  notes: values.notes || null,
                  tags: values.tagsInput
                    .split(",")
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                  predecessors: values.predecessors.map((predecessor) => ({
                    scheduleItemId: predecessor.scheduleItemId,
                    dependencyType: predecessor.dependencyType,
                    lagDays: predecessor.lagDays,
                  })),
                }

                if (item) {
                  await api.put(`/schedule-items/${item.id}`, payload)
                  toast.success("Schedule item updated.")
                } else {
                  await api.post(`/jobs/${jobId}/schedule`, payload)
                  toast.success("Schedule item created.")
                }

                await onSaved()
                onOpenChange(false)
              } catch (error) {
                toast.error(apiErrorMessage(error, "Unable to save schedule item."))
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? <Spinner className="size-4" /> : null}
            Save Item
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="border-[#E5E7EB] bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete schedule item?</AlertDialogTitle>
            <AlertDialogDescription>
              This task will be removed from the calendar, list, and gantt views for this job.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#E5E7EB]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                if (!item) {
                  return
                }

                try {
                  await api.delete(`/schedule-items/${item.id}`)
                  toast.success("Schedule item deleted.")
                  await onDeleted()
                  onOpenChange(false)
                  setDeleteOpen(false)
                } catch (error) {
                  toast.error(apiErrorMessage(error, "Unable to delete this schedule item."))
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

export function SchedulePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { job } = useOutletContext<JobShellContext>()
  const [items, setItems] = useState<ScheduleItemRecord[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [scheduleOffline, setScheduleOffline] = useState(false)
  const [view, setView] = useState<"calendar" | "list" | "gantt">("calendar")
  const [calendarView, setCalendarView] = useState<View>("month")
  const [ganttView, setGanttView] = useState<"Day" | "Week" | "Month">("Week")
  const [filterOpen, setFilterOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState("all")
  const [assigneeFilter, setAssigneeFilter] = useState("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeItem, setActiveItem] = useState<ScheduleItemRecord | null>(null)

  async function loadData() {
    setLoading(true)

    try {
      const [itemsResponse, usersResponse] = await Promise.all([
        api.get<{ items: ScheduleItemRecord[] }>(`/jobs/${job.id}/schedule`),
        api.get<{ users: UserOption[] }>("/users"),
      ])

      setItems(itemsResponse.data.items)
      setUsers(usersResponse.data.users)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Unable to load the job schedule."))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [job.id])

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setActiveItem(null)
      setDialogOpen(true)
    }
  }, [searchParams])

  useEffect(() => {
    const itemId = searchParams.get("item")

    if (!itemId || items.length === 0) {
      return
    }

    const match = items.find((item) => item.id === itemId)

    if (match) {
      setActiveItem(match)
      setDialogOpen(true)
    }
  }, [items, searchParams])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false
      }

      if (assigneeFilter !== "all" && !item.assigneeIds.includes(assigneeFilter)) {
        return false
      }

      return true
    })
  }, [assigneeFilter, items, statusFilter])

  const events = useMemo(
    () =>
      filteredItems.map((item) => ({
        title: item.title,
        start: new Date(`${item.startDate}T00:00:00`),
        end: addDays(new Date(`${item.endDate}T00:00:00`), 1),
        resource: item,
      })),
    [filteredItems],
  )

  return (
    <>
      <Card className="border-[#E5E7EB] bg-white shadow-sm">
        {pageHeading(
          <>
            <Button
              type="button"
              variant="outline"
              className="h-9 border-[#E5E7EB] bg-white text-slate-600"
              onClick={() => toast.info("Schedule help content is not published yet.")}
            >
              <HelpCircle className="size-4" />
              Help
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 border-[#E5E7EB] bg-white text-slate-600"
              onClick={() => toast.info("Schedule settings are not configured yet.")}
            >
              <Settings2 className="size-4" />
              Settings
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 border-[#E5E7EB] bg-white text-slate-600"
              onClick={() => setActivityOpen(true)}
            >
              Activity
            </Button>
            <div className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] px-3 py-2">
              <span className="text-sm text-slate-600">Schedule Offline</span>
              <Switch checked={scheduleOffline} onCheckedChange={setScheduleOffline} />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="h-9 border-[#E5E7EB] bg-white text-slate-600">
                  <MoreHorizontal className="size-4" />
                  More Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => toast.info("Export is not wired yet.")}>Export Schedule</DropdownMenuItem>
                <DropdownMenuItem onClick={() => toast.info("Clear filters from the filter panel.")}>Reset Filters</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="outline"
              className="h-9 border-[#E5E7EB] bg-white text-slate-600"
              onClick={() => setFilterOpen(true)}
            >
              <Filter className="size-4" />
              Filter
              {(statusFilter !== "all" || assigneeFilter !== "all") ? (
                <Badge variant="outline" className="ml-1 border-blue-200 bg-blue-50 text-blue-700">
                  {(statusFilter !== "all" ? 1 : 0) + (assigneeFilter !== "all" ? 1 : 0)}
                </Badge>
              ) : null}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setActiveItem(null)
                setDialogOpen(true)
              }}
            >
              <Plus className="size-4" />
              New Schedule Item
            </Button>
          </>,
        )}
        <CardContent className="space-y-5 p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs value={view} onValueChange={(nextValue) => setView(nextValue as typeof view)}>
              <TabsList className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-1">
                <TabsTrigger value="calendar">Calendar</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="gantt">Gantt</TabsTrigger>
              </TabsList>
            </Tabs>

            {view === "calendar" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" className="h-9 border-[#E5E7EB] bg-white" onClick={() => setCalendarView("month")}>
                  Month
                </Button>
                <Button type="button" variant="outline" className="h-9 border-[#E5E7EB] bg-white" onClick={() => setCalendarView("week")}>
                  Week
                </Button>
                <Button type="button" variant="outline" className="h-9 border-[#E5E7EB] bg-white" onClick={() => setCalendarView("day")}>
                  Day
                </Button>
                <Button type="button" variant="outline" className="h-9 border-[#E5E7EB] bg-white" onClick={() => setCalendarView("agenda")}>
                  Agenda
                </Button>
              </div>
            ) : null}

            {view === "gantt" ? (
              <div className="flex items-center gap-2">
                {(["Day", "Week", "Month"] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={ganttView === value ? "default" : "outline"}
                    className={ganttView === value ? "" : "border-[#E5E7EB] bg-white"}
                    onClick={() => setGanttView(value)}
                  >
                    {value}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>

          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-64 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            </div>
          ) : filteredItems.length === 0 ? (
            <EmptyPanel title="No schedule items yet" description="Create the first task to map labor, lead times, and milestones for this job." />
          ) : (
            <>
              {view === "calendar" ? (
                <div className="cadstone-schedule-calendar rounded-lg border border-[#E5E7EB] bg-white p-4">
                    <BigCalendar
                      localizer={localizer}
                      events={events}
                      view={calendarView}
                      onView={(nextView: View) => setCalendarView(nextView)}
                      style={{ height: 720 }}
                      eventPropGetter={(event: { resource: ScheduleItemRecord }) => {
                        const item = event.resource
                        return {
                          style: {
                            backgroundColor: item.displayColor,
                          borderColor: item.displayColor,
                          borderRadius: "999px",
                          color: "white",
                        },
                      }
                    }}
                      dayPropGetter={(date: Date) => ({
                        className:
                          date.getDay() === 0 || date.getDay() === 6 ? "cadstone-weekend" : "",
                      })}
                      onSelectEvent={(event: { resource: ScheduleItemRecord }) => {
                        setActiveItem(event.resource)
                        setDialogOpen(true)
                      }}
                    />
                </div>
              ) : null}

              {view === "list" ? (
                <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Task name</TableHead>
                        <TableHead>Assigned to</TableHead>
                        <TableHead>Start date</TableHead>
                        <TableHead>End date</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Progress</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <button
                              type="button"
                              className="font-medium text-blue-700 hover:underline"
                              onClick={() => {
                                setActiveItem(item)
                                setDialogOpen(true)
                              }}
                            >
                              {item.title}
                            </button>
                          </TableCell>
                          <TableCell>{item.assignees.map((assignee) => assignee.fullName).join(", ") || "Unassigned"}</TableCell>
                          <TableCell>{formatDate(item.startDate)}</TableCell>
                          <TableCell>{formatDate(item.endDate)}</TableCell>
                          <TableCell>{item.workDays} days</TableCell>
                          <TableCell>{item.progress ?? 0}%</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={scheduleStatusClass(item.status)}>
                              {titleCaseStatus(item.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="outline"
                              className="border-[#E5E7EB] bg-white"
                              onClick={() => {
                                setActiveItem(item)
                                setDialogOpen(true)
                              }}
                            >
                              Open
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}

              {view === "gantt" ? (
                <ScheduleGanttChart
                  items={filteredItems}
                  viewMode={ganttView}
                  onSelect={(item) => {
                    setActiveItem(item)
                    setDialogOpen(true)
                  }}
                />
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="right" className="w-full max-w-md border-[#E5E7EB] bg-white">
          <SheetHeader>
            <SheetTitle>Schedule Filters</SheetTitle>
            <SheetDescription>
              Narrow the calendar and list views by status or assignee.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="border-[#E5E7EB]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Assigned to</label>
              <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                <SelectTrigger className="border-[#E5E7EB]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All assignees</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                className="border-[#E5E7EB]"
                onClick={() => {
                  setStatusFilter("all")
                  setAssigneeFilter("all")
                }}
              >
                Clear all
              </Button>
              <Button type="button" onClick={() => setFilterOpen(false)}>
                Apply
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ScheduleItemDialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          setDialogOpen(nextOpen)

          if (!nextOpen) {
            setActiveItem(null)

            if (searchParams.get("create") || searchParams.get("item")) {
              const next = new URLSearchParams(searchParams)
              next.delete("create")
              next.delete("item")
              setSearchParams(next, { replace: true })
            }
          }
        }}
        item={activeItem}
        items={items}
        users={users}
        jobId={job.id}
        onSaved={loadData}
        onDeleted={loadData}
      />

      <ScheduleActivityDialog jobId={job.id} open={activityOpen} onOpenChange={setActivityOpen} />
    </>
  )
}
