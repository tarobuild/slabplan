import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2, X } from "lucide-react"
import { api } from "@/lib/api"
import { getInitials, type ScheduleItemRecord } from "@/lib/schedule"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"

export type QuickCreateUser = {
  id: string
  fullName: string
  email: string
  role: string
  avatarUrl: string | null
}

export type QuickCreateState = {
  date: string
  startTime: string | null
  endTime: string | null
  title: string
  assigneeIds: string[]
  isHourly: boolean
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string
  users: QuickCreateUser[]
  initialDate: string
  initialStartTime?: string | null
  initialEndTime?: string | null
  onSaved: (item: ScheduleItemRecord) => void | Promise<void>
  onMoreOptions: (state: QuickCreateState) => void
}

function getApiError(err: unknown, fallback: string) {
  if (typeof err === "object" && err !== null) {
    const value = err as { response?: { data?: { message?: string } }; message?: string }
    return value.response?.data?.message ?? value.message ?? fallback
  }

  return fallback
}

function formatLongDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`)
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed)
}

export function ScheduleQuickCreate({
  open,
  onOpenChange,
  jobId,
  users,
  initialDate,
  initialStartTime,
  initialEndTime,
  onSaved,
  onMoreOptions,
}: Props) {
  const [title, setTitle] = useState("")
  const [date, setDate] = useState(initialDate)
  const [isHourly, setIsHourly] = useState<boolean>(!!initialStartTime)
  const [startTime, setStartTime] = useState(initialStartTime ?? "08:00")
  const [endTime, setEndTime] = useState(initialEndTime ?? "09:00")
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [assigneeQuery, setAssigneeQuery] = useState("")
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setTitle("")
    setDate(initialDate)
    const hourly = !!initialStartTime
    setIsHourly(hourly)
    setStartTime(initialStartTime ?? "08:00")
    setEndTime(initialEndTime ?? "09:00")
    setAssigneeIds([])
    setAssigneeQuery("")
    setSaving(false)
    const timeout = window.setTimeout(() => titleRef.current?.focus(), 60)
    return () => window.clearTimeout(timeout)
  }, [open, initialDate, initialStartTime, initialEndTime])

  const selectedAssignees = useMemo(
    () =>
      users
        .filter((user) => assigneeIds.includes(user.id))
        .sort((left, right) => left.fullName.localeCompare(right.fullName)),
    [users, assigneeIds],
  )

  const assigneeMatches = useMemo(() => {
    const query = assigneeQuery.trim().toLowerCase()

    return users
      .filter((user) => !assigneeIds.includes(user.id))
      .filter((user) => {
        if (!query) {
          return true
        }

        return (
          user.fullName.toLowerCase().includes(query)
          || user.email.toLowerCase().includes(query)
        )
      })
      .slice(0, 6)
  }, [assigneeQuery, users, assigneeIds])

  function addAssignee(userId: string) {
    setAssigneeIds((current) => (current.includes(userId) ? current : [...current, userId]))
    setAssigneeQuery("")
  }

  function removeAssignee(userId: string) {
    setAssigneeIds((current) => current.filter((id) => id !== userId))
  }

  function buildState(): QuickCreateState {
    return {
      date,
      startTime: isHourly ? startTime : null,
      endTime: isHourly ? endTime : null,
      title,
      assigneeIds,
      isHourly,
    }
  }

  async function handleQuickSave() {
    const trimmed = title.trim()
    if (!trimmed) {
      toast.error("Title is required")
      titleRef.current?.focus()
      return
    }

    setSaving(true)

    try {
      const response = await api.post<{ item: ScheduleItemRecord }>(`/jobs/${jobId}/schedule`, {
        title: trimmed,
        startDate: date,
        workDays: 1,
        isHourly,
        startTime: isHourly ? startTime : null,
        endTime: isHourly ? endTime : null,
        assigneeIds,
      })
      await onSaved(response.data.item)
      toast.success("Schedule item created")
      onOpenChange(false)
    } catch (err) {
      toast.error(getApiError(err, "Failed to create schedule item"))
    } finally {
      setSaving(false)
    }
  }

  function handleQuickMoreOptions() {
    const state = buildState()
    onOpenChange(false)
    onMoreOptions(state)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 border-b border-[#E5E7EB] px-5 py-4 text-left">
          <DialogTitle className="text-base font-semibold text-slate-900">New schedule item</DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            {formatLongDate(date)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="quick-create-title" className="text-xs font-medium text-slate-600">
              Title
            </Label>
            <Input
              id="quick-create-title"
              ref={titleRef}
              value={title}
              placeholder="What needs to happen?"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !saving) {
                  event.preventDefault()
                  void handleQuickSave()
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-slate-600">Time</Label>
              <div className="flex items-center gap-2">
                <span className={cn("text-xs", isHourly ? "text-slate-400" : "text-slate-700")}>All day</span>
                <Switch
                  checked={isHourly}
                  onCheckedChange={(checked) => setIsHourly(!!checked)}
                  aria-label="Toggle hourly"
                />
                <span className={cn("text-xs", isHourly ? "text-slate-700" : "text-slate-400")}>Hourly</span>
              </div>
            </div>
            {isHourly ? (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  aria-label="Start time"
                />
                <Input
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  aria-label="End time"
                />
              </div>
            ) : (
              <p className="text-xs italic text-slate-500">All-day item — no specific time</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600">Assignees</Label>
            <div className="rounded-md border border-[#E5E7EB] px-2 py-1.5">
              {selectedAssignees.length > 0 ? (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {selectedAssignees.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                      onClick={() => removeAssignee(user.id)}
                    >
                      <Avatar className="size-4">
                        {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.fullName} /> : null}
                        <AvatarFallback className="text-[9px]">{getInitials(user.fullName)}</AvatarFallback>
                      </Avatar>
                      <span>{user.fullName}</span>
                      <X className="size-3 text-slate-400" />
                    </button>
                  ))}
                </div>
              ) : null}
              <Input
                value={assigneeQuery}
                placeholder={selectedAssignees.length > 0 ? "Add another assignee" : "Search team members"}
                className="h-7 border-0 px-1 text-sm shadow-none focus-visible:ring-0"
                onChange={(event) => setAssigneeQuery(event.target.value)}
              />
              {assigneeMatches.length > 0 ? (
                <div className="mt-1 max-h-36 overflow-y-auto rounded-md border border-[#E5E7EB] bg-white">
                  {assigneeMatches.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50"
                      onClick={() => addAssignee(user.id)}
                    >
                      <Avatar className="size-6">
                        {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.fullName} /> : null}
                        <AvatarFallback className="text-[10px]">{getInitials(user.fullName)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{user.fullName}</p>
                        <p className="truncate text-[11px] text-slate-500">{user.email}</p>
                      </div>
                      <span className="text-[10px] text-slate-400">{user.role.replaceAll("_", " ")}</span>
                    </button>
                  ))}
                </div>
              ) : assigneeQuery.trim() ? (
                <p className="mt-1 px-3 py-1 text-xs text-slate-400">No matching team members</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[#E5E7EB] px-5 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={handleQuickMoreOptions} disabled={saving}>
            More options
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void handleQuickSave()} disabled={saving}>
              {saving ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
