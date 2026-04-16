import { useEffect, useRef, useState } from "react"
import { CalendarDays, ChevronRight, Clock, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DEFAULT_SCHEDULE_COLOR,
  SCHEDULE_COLOR_OPTIONS,
} from "@/lib/schedule"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"

export type QuickCreateDraft = {
  title: string
  startDate: string
  endDate: string
  isAllDay: boolean
  startTime: string
  endTime: string
  displayColor: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialDate: string
  onSave: (draft: QuickCreateDraft) => Promise<void>
  onMoreOptions: (draft: QuickCreateDraft) => void
}

function fmtDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

const TIME_OPTIONS: string[] = []
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    const hh = String(h).padStart(2, "0")
    const mm = String(m).padStart(2, "0")
    TIME_OPTIONS.push(`${hh}:${mm}`)
  }
}

function fmtTime(t: string) {
  const [hStr, mStr] = t.split(":")
  const h = Number(hStr)
  const m = mStr
  const period = h >= 12 ? "PM" : "AM"
  const hour = h % 12 || 12
  return `${hour}:${m} ${period}`
}

function TimeDropdown({
  value,
  onChange,
  min,
}: {
  value: string
  onChange: (v: string) => void
  min?: string
}) {
  const options = min
    ? TIME_OPTIONS.filter((t) => t > min)
    : TIME_OPTIONS

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400 cursor-pointer"
    >
      {options.map((t) => (
        <option key={t} value={t}>
          {fmtTime(t)}
        </option>
      ))}
    </select>
  )
}

export function ScheduleQuickCreate({
  open,
  onOpenChange,
  initialDate,
  onSave,
  onMoreOptions,
}: Props) {
  const titleRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState("")
  const [startDate, setStartDate] = useState(initialDate)
  const [endDate, setEndDate] = useState(initialDate)
  const [isAllDay, setIsAllDay] = useState(true)
  const [startTime, setStartTime] = useState("08:00")
  const [endTime, setEndTime] = useState("17:00")
  const [color, setColor] = useState(DEFAULT_SCHEDULE_COLOR)
  const [saving, setSaving] = useState(false)
  const [showDatePickers, setShowDatePickers] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle("")
      setStartDate(initialDate)
      setEndDate(initialDate)
      setIsAllDay(true)
      setStartTime("08:00")
      setEndTime("17:00")
      setColor(DEFAULT_SCHEDULE_COLOR)
      setSaving(false)
      setShowDatePickers(false)
      setTimeout(() => titleRef.current?.focus(), 50)
    }
  }, [open, initialDate])

  function buildDraft(): QuickCreateDraft {
    return { title, startDate, endDate, isAllDay, startTime, endTime, displayColor: color }
  }

  async function handleSave() {
    if (!title.trim()) {
      titleRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      await onSave(buildDraft())
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  function handleMoreOptions() {
    onMoreOptions(buildDraft())
    onOpenChange(false)
  }

  const isSameDay = startDate === endDate

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-sm w-full overflow-hidden rounded-2xl shadow-2xl border border-slate-200">
        {/* Color bar at top */}
        <div className="h-1.5 w-full" style={{ backgroundColor: color }} />

        <div className="px-5 pt-4 pb-5 space-y-4">
          {/* Title row */}
          <div className="flex items-center gap-3">
            <div
              className="size-3 rounded-full shrink-0 ring-2 ring-offset-1 ring-slate-200"
              style={{ backgroundColor: color }}
            />
            <Input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave()
                if (e.key === "Escape") onOpenChange(false)
              }}
              placeholder="Add title"
              className="border-0 border-b border-slate-200 rounded-none px-0 h-9 text-base font-semibold text-slate-900 placeholder:text-slate-400 focus-visible:ring-0 focus-visible:border-orange-400"
            />
            <button
              onClick={() => onOpenChange(false)}
              className="shrink-0 rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Date row */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowDatePickers((v) => !v)}
              className="flex items-center gap-2.5 w-full rounded-lg px-2 py-2 hover:bg-slate-50 text-sm text-slate-700 transition-colors group"
            >
              <CalendarDays className="size-4 text-slate-400 shrink-0" />
              <span className="font-medium">{fmtDate(startDate)}</span>
              {!isSameDay && (
                <>
                  <ChevronRight className="size-3.5 text-slate-400" />
                  <span className="font-medium">{fmtDate(endDate)}</span>
                </>
              )}
              {isSameDay && (
                <span className="text-slate-400 ml-auto text-xs group-hover:text-slate-500">
                  {isAllDay ? "All day" : `${fmtTime(startTime)} – ${fmtTime(endTime)}`}
                </span>
              )}
            </button>

            {showDatePickers && (
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Start</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        const v = e.target.value
                        setStartDate(v)
                        if (v > endDate) setEndDate(v)
                      }}
                      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">End</label>
                    <input
                      type="date"
                      value={endDate}
                      min={startDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Time row */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setIsAllDay((v) => !v)}
              className="flex items-center gap-2.5 w-full rounded-lg px-2 py-2 hover:bg-slate-50 text-sm transition-colors group"
            >
              <Clock className="size-4 text-slate-400 shrink-0" />
              <span className={cn("font-medium", isAllDay ? "text-slate-700" : "text-slate-400")}>
                All day
              </span>
              <div
                className={cn(
                  "ml-auto relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                  isAllDay ? "bg-orange-500" : "bg-slate-200",
                )}
              >
                <span
                  className={cn(
                    "inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform",
                    isAllDay ? "translate-x-4" : "translate-x-0.5",
                  )}
                />
              </div>
            </button>

            {!isAllDay && (
              <div className="flex items-center gap-2 pl-9">
                <TimeDropdown value={startTime} onChange={(v) => {
                  setStartTime(v)
                  if (v >= endTime) {
                    const idx = TIME_OPTIONS.indexOf(v)
                    setEndTime(TIME_OPTIONS[Math.min(idx + 2, TIME_OPTIONS.length - 1)])
                  }
                }} />
                <span className="text-slate-400 text-sm">–</span>
                <TimeDropdown value={endTime} onChange={setEndTime} min={startTime} />
              </div>
            )}
          </div>

          {/* Color picker */}
          <div className="flex items-center gap-1.5 pl-2">
            {SCHEDULE_COLOR_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setColor(opt.value)}
                title={opt.label}
                className={cn(
                  "size-5 rounded-full transition-transform hover:scale-110",
                  color === opt.value && "ring-2 ring-offset-2 ring-slate-400",
                )}
                style={{ backgroundColor: opt.value }}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={handleMoreOptions}
              className="text-sm text-slate-500 hover:text-orange-600 hover:underline transition-colors"
            >
              More options
            </button>
            <Button
              onClick={() => void handleSave()}
              disabled={saving || !title.trim()}
              size="sm"
              className="bg-orange-600 hover:bg-orange-700 text-white px-5"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
