import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List,
  MapPin,
} from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { subscribeToDataRefresh } from "@/lib/data-refresh"
import { useAuthStore } from "@/store/auth"
import { cn } from "@/lib/utils"
import {
  dateKey,
  itemEndDate,
  itemOverlapsDateRange,
  todayStr,
} from "@/lib/schedule"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type CalItem = {
  id: string
  title: string
  startDate: string
  endDate: string | null
  displayColor: string | null
  progress: number | null
  isComplete: boolean | null
  jobId: string
  jobTitle: string | null
}

type ActivityEntry = {
  id: string
  description: string
  entityType: string
  createdAt: string
  userName?: string | null
}

type RecentJob = {
  id: string
  title: string
  city: string | null
  state: string | null
}

// ---------------------------------------------------------------------------
// Calendar date helpers (matching job-schedule.tsx exactly)
// ---------------------------------------------------------------------------
function cloneDate(d: Date) { return new Date(d.getTime()) }
function parseDate(value: string) { return new Date(`${value}T12:00:00`) }
function addDays(date: Date, amount: number) { const n = cloneDate(date); n.setDate(n.getDate() + amount); return n }
function addMonths(date: Date, amount: number) { const n = cloneDate(date); n.setMonth(n.getMonth() + amount); return n }
function startOfWeek(date: Date) { const n = cloneDate(date); n.setDate(n.getDate() - n.getDay()); n.setHours(0, 0, 0, 0); return n }
function endOfWeek(date: Date) { return addDays(startOfWeek(date), 6) }
function startOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1) }
function endOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0) }

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date)
}

function formatRangeLabel(start: Date, end: Date) {
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  if (sameMonth) {
    return `${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(start)}–${new Intl.DateTimeFormat("en-US", { day: "numeric", year: "numeric" }).format(end)}`
  }
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(start)} – ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(end)}`
}

function buildMonthWeeks(date: Date): string[][] {
  const firstDay = startOfMonth(date)
  const lastDay = endOfMonth(date)
  const rangeStart = startOfWeek(firstDay)
  const rangeEnd = endOfWeek(lastDay)
  const weeks: string[][] = []
  const cursor = cloneDate(rangeStart)
  while (cursor <= rangeEnd) {
    const week: string[] = []
    for (let i = 0; i < 7; i++) { week.push(dateKey(cursor)); cursor.setDate(cursor.getDate() + 1) }
    weeks.push(week)
  }
  return weeks
}

type WeekSegment = { item: CalItem; lane: number; startIndex: number; endIndex: number }

function buildWeekSegments(week: string[], items: CalItem[]): WeekSegment[] {
  const weekStart = week[0]
  const weekEnd = week[6]
  const laneEndDates: string[] = []

  return items
    .filter(item => itemOverlapsDateRange(item as any, weekStart, weekEnd))
    .sort((a, b) => {
      const sc = a.startDate.localeCompare(b.startDate)
      if (sc !== 0) return sc
      const ec = (itemEndDate(b as any) || b.startDate).localeCompare(itemEndDate(a as any) || a.startDate)
      if (ec !== 0) return ec
      return a.title.localeCompare(b.title)
    })
    .map(item => {
      const segmentStart = item.startDate > weekStart ? item.startDate : weekStart
      const segmentEnd = (itemEndDate(item as any) || item.startDate) < weekEnd
        ? (itemEndDate(item as any) || item.startDate)
        : weekEnd
      const startIndex = week.indexOf(segmentStart)
      const endIndex = week.indexOf(segmentEnd)
      let lane = 0
      while (laneEndDates[lane] && laneEndDates[lane] >= segmentStart) lane++
      laneEndDates[lane] = segmentEnd
      return { item, lane, startIndex, endIndex }
    })
}

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DEFAULT_COLOR = "#E85D04"

// ---------------------------------------------------------------------------
// Month calendar view — matches per-job design exactly
// ---------------------------------------------------------------------------
function MonthCalendar({ anchor, items, navigate }: {
  anchor: Date
  items: CalItem[]
  navigate: (path: string) => void
}) {
  const today = todayStr()
  const monthWeeks = useMemo(() => buildMonthWeeks(anchor), [anchor])
  const currentMonthPrefix = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}`

  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-[#E5E7EB] bg-[#F8FAFC]">
        {DAYS_OF_WEEK.map(day => (
          <div key={day} className="px-3 py-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{day}</p>
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div>
        {monthWeeks.map(week => {
          const segments = buildWeekSegments(week, items)
          const maxLane = segments.reduce((max, s) => Math.max(max, s.lane), -1)
          const laneCount = Math.max(maxLane + 1, 1)
          const rowHeight = 80 + laneCount * 28

          return (
            <div
              key={week[0]}
              className="relative grid grid-cols-7 border-b border-[#E5E7EB] last:border-b-0"
              style={{ minHeight: `${rowHeight}px` }}
            >
              {/* Day cells */}
              {week.map(day => {
                const isCurrentMonth = day.startsWith(currentMonthPrefix)
                const isToday = day === today
                const parsed = parseDate(day)

                return (
                  <div
                    key={day}
                    className={cn(
                      "border-r border-[#E5E7EB] p-2 last:border-r-0",
                      isCurrentMonth ? "bg-white" : "bg-slate-50/70",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full text-xs font-medium",
                        isToday ? "bg-orange-600 text-white" : isCurrentMonth ? "text-slate-700" : "text-slate-300",
                      )}
                    >
                      {parsed.getDate()}
                    </span>
                  </div>
                )
              })}

              {/* Absolute event bars */}
              <div className="pointer-events-none absolute inset-x-0 top-9 bottom-2">
                {segments.map(seg => (
                  <button
                    key={`${seg.item.id}-${seg.startIndex}-${seg.lane}`}
                    type="button"
                    className="pointer-events-auto absolute flex h-6 items-center overflow-hidden rounded-full px-3 text-left text-xs font-medium text-white shadow-sm transition hover:opacity-90"
                    style={{
                      backgroundColor: seg.item.displayColor || DEFAULT_COLOR,
                      left: `calc(${(seg.startIndex / 7) * 100}% + 4px)`,
                      width: `calc(${((seg.endIndex - seg.startIndex + 1) / 7) * 100}% - 8px)`,
                      top: `${seg.lane * 28}px`,
                    }}
                    onClick={() => navigate(`/jobs/${seg.item.jobId}/schedule`)}
                    title={`${seg.item.title}${seg.item.jobTitle ? ` — ${seg.item.jobTitle}` : ""}`}
                  >
                    <span className="truncate">
                      {seg.item.isComplete ? "✓ " : ""}
                      {seg.item.jobTitle
                        ? <><span className="opacity-70 mr-1">{seg.item.jobTitle.split(" ")[0]}</span>{seg.item.title}</>
                        : seg.item.title}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Week calendar view — matches per-job design
// ---------------------------------------------------------------------------
function WeekCalendar({ anchor, items, navigate }: {
  anchor: Date
  items: CalItem[]
  navigate: (path: string) => void
}) {
  const today = todayStr()
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)), [anchor])
  const week = days.map(d => dateKey(d))
  const segments = useMemo(() => buildWeekSegments(week, items), [items, anchor])
  const maxLane = segments.reduce((max, s) => Math.max(max, s.lane), -1)
  const laneCount = Math.max(maxLane + 1, 1)

  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
      {/* Day headers */}
      <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-[#E5E7EB] bg-[#F8FAFC]">
        <div className="border-r border-[#E5E7EB] p-3" />
        {days.map((day, i) => {
          const key = dateKey(day)
          const isToday = key === today
          return (
            <div key={key} className="border-r border-[#E5E7EB] p-3 last:border-r-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">
                  {new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(day)}
                </p>
                <span className={cn(
                  "flex size-7 items-center justify-center rounded-full text-xs font-medium",
                  isToday ? "bg-orange-600 text-white" : "text-slate-600",
                )}>
                  {day.getDate()}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Event bars */}
      <div
        className="relative grid grid-cols-[72px_repeat(7,minmax(0,1fr))]"
        style={{ minHeight: `${60 + laneCount * 30}px` }}
      >
        <div className="border-r border-[#E5E7EB] bg-[#F8FAFC] flex items-center justify-center">
          <span className="text-[10px] text-slate-400 font-medium">All day</span>
        </div>
        {days.map((day, i) => (
          <div key={i} className="border-r border-[#E5E7EB] last:border-r-0 p-1" />
        ))}
        {/* Absolute positioned bars (offset by 72px gutter) */}
        <div className="pointer-events-none absolute" style={{ left: 72, top: 8, right: 0, bottom: 8 }}>
          {segments.map(seg => (
            <button
              key={`${seg.item.id}-${seg.startIndex}-${seg.lane}`}
              type="button"
              className="pointer-events-auto absolute flex h-7 items-center overflow-hidden rounded-full px-3 text-left text-xs font-medium text-white shadow-sm transition hover:opacity-90"
              style={{
                backgroundColor: seg.item.displayColor || DEFAULT_COLOR,
                left: `calc(${(seg.startIndex / 7) * 100}% + 4px)`,
                width: `calc(${((seg.endIndex - seg.startIndex + 1) / 7) * 100}% - 8px)`,
                top: `${seg.lane * 32}px`,
              }}
              onClick={() => navigate(`/jobs/${seg.item.jobId}/schedule`)}
              title={`${seg.item.title}${seg.item.jobTitle ? ` — ${seg.item.jobTitle}` : ""}`}
            >
              <span className="truncate">
                {seg.item.isComplete ? "✓ " : ""}{seg.item.title}
                {seg.item.jobTitle && <span className="ml-1 opacity-70">— {seg.item.jobTitle}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// List view — matches per-job list style
// ---------------------------------------------------------------------------
function ListCalendar({ items, navigate }: { items: CalItem[]; navigate: (path: string) => void }) {
  const today = todayStr()
  const sorted = useMemo(() =>
    [...items].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [items]
  )

  if (sorted.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white py-20 text-center">
        <CalendarDays className="mx-auto size-10 text-slate-200 mb-3" />
        <p className="text-sm text-slate-500">No scheduled items in this period.</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
      {/* Header row */}
      <div className="grid grid-cols-[minmax(0,1fr)_120px_120px_100px] border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
        <span>Item</span>
        <span>Start</span>
        <span>End</span>
        <span>Progress</span>
      </div>

      <div className="divide-y divide-[#E5E7EB] bg-white">
        {sorted.map(item => {
          const done = item.isComplete || (item.progress ?? 0) >= 100
          const overdue = !done && (itemEndDate(item as any) || item.startDate) < today
          const color = item.displayColor || DEFAULT_COLOR

          return (
            <button
              key={item.id}
              type="button"
              className="grid w-full grid-cols-[minmax(0,1fr)_120px_120px_100px] items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
              onClick={() => navigate(`/jobs/${item.jobId}/schedule`)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <div className="min-w-0">
                  <p className={cn("text-sm font-medium text-slate-900 truncate", done && "line-through opacity-60")}>
                    {item.title}
                  </p>
                  {item.jobTitle && (
                    <p className="text-xs text-slate-400 truncate mt-0.5">{item.jobTitle}</p>
                  )}
                </div>
              </div>

              <span className="text-sm text-slate-600 tabular-nums">
                {item.startDate
                  ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parseDate(item.startDate))
                  : "—"}
              </span>
              <span className="text-sm text-slate-600 tabular-nums">
                {itemEndDate(item as any)
                  ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parseDate(itemEndDate(item as any)))
                  : "—"}
              </span>

              <div className="flex items-center gap-2">
                {done ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Done</span>
                ) : overdue ? (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">Overdue</span>
                ) : (
                  <>
                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full" style={{ width: `${item.progress ?? 0}%`, backgroundColor: color }} />
                    </div>
                    <span className="text-[11px] text-slate-500 tabular-nums">{item.progress ?? 0}%</span>
                  </>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function getGreeting() {
  const h = new Date().getHours()
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function entityBadgeColor(type: string) {
  const map: Record<string, string> = {
    job: "bg-orange-100 text-orange-700",
    lead: "bg-green-100 text-green-700",
    schedule_item: "bg-yellow-100 text-yellow-700",
    daily_log: "bg-purple-100 text-purple-700",
    document: "bg-slate-100 text-slate-600",
    photo: "bg-pink-100 text-pink-700",
  }
  return map[type] ?? "bg-slate-100 text-slate-600"
}

function entityLabel(type: string) {
  const map: Record<string, string> = {
    job: "Job", lead: "Lead", schedule_item: "Schedule", daily_log: "Daily Log",
    document: "Document", photo: "Photo",
  }
  return map[type] ?? type
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------
type CalView = "calendar" | "list"
type CalPeriod = "month" | "week"

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const [today, setToday] = useState(() => new Date())

  useEffect(() => {
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const timer = window.setTimeout(() => setToday(new Date()), nextMidnight.getTime() - now.getTime())
    return () => window.clearTimeout(timer)
  }, [today])

  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([])
  const [sidebarLoading, setSidebarLoading] = useState(true)

  const [calView, setCalView] = useState<CalView>("calendar")
  const [calPeriod, setCalPeriod] = useState<CalPeriod>("month")
  const [anchor, setAnchor] = useState(today)
  const [calItems, setCalItems] = useState<CalItem[]>([])
  const [calLoading, setCalLoading] = useState(true)

  // Compute fetch range
  const fetchRange = useMemo(() => {
    if (calView === "list") {
      return { start: dateKey(today), end: dateKey(addDays(today, 60)) }
    }
    if (calPeriod === "week") {
      const sun = startOfWeek(anchor)
      return { start: dateKey(sun), end: dateKey(addDays(sun, 6)) }
    }
    // month: include the full grid (up to 6 weeks)
    const gridStart = startOfWeek(startOfMonth(anchor))
    return { start: dateKey(gridStart), end: dateKey(addDays(gridStart, 41)) }
  }, [calView, calPeriod, anchor])

  const fetchCal = useCallback(() => {
    setCalLoading(true)
    api.get(`/dashboard/schedule?start=${fetchRange.start}&end=${fetchRange.end}`)
      .then(r => setCalItems((r.data.items ?? []).filter((i: any) => i.startDate)))
      .catch(() => {})
      .finally(() => setCalLoading(false))
  }, [fetchRange])

  useEffect(() => { fetchCal() }, [fetchCal])

  const fetchSidebarData = useCallback(() => {
    setSidebarLoading(true)

    Promise.all([
      api.get<{ data: ActivityEntry[] }>("/activity?limit=12"),
      api.get("/dashboard/agenda"),
    ])
      .then(([activityResponse, agendaResponse]) => {
        setActivity(activityResponse.data.data ?? [])
        setRecentJobs(agendaResponse.data.recentJobs ?? [])
      })
      .catch(() => {})
      .finally(() => setSidebarLoading(false))
  }, [])

  useEffect(() => {
    fetchSidebarData()
  }, [fetchSidebarData])

  useEffect(
    () =>
      subscribeToDataRefresh("jobs", () => {
        fetchCal()
        fetchSidebarData()
      }),
    [fetchCal, fetchSidebarData],
  )

  function nav(dir: -1 | 1) {
    setAnchor(prev => calPeriod === "month" ? addMonths(prev, dir) : addDays(prev, dir * 7))
  }

  const rangeLabel = useMemo(() => {
    if (calView === "list") return "Next 60 Days"
    if (calPeriod === "month") return formatMonthLabel(anchor)
    return formatRangeLabel(startOfWeek(anchor), endOfWeek(anchor))
  }, [calView, calPeriod, anchor])

  const todayDisplay = today.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  })

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-[1600px] px-4 py-4 lg:px-6 lg:py-5 space-y-5">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              Good {getGreeting()}, {user?.fullName?.split(" ")[0] ?? "there"}.
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">{todayDisplay}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="orange" className="text-xs h-8" asChild>
              <Link to="/jobs">New Job</Link>
            </Button>
          </div>
        </div>

        {/* Calendar + Sidebar */}
        <div className="flex flex-col gap-5 lg:flex-row">

          {/* Calendar panel */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* Toolbar — matches per-job schedule exactly */}
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {/* View mode toggle */}
                <div className="flex items-center gap-2">
                  <div className="flex overflow-hidden rounded-lg border border-[#D8E0EA] bg-[#F8FAFC]">
                    <button
                      type="button"
                      className={cn(
                        "flex h-10 items-center gap-2 px-4 text-sm font-medium transition-colors",
                        calView === "calendar" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-white",
                      )}
                      onClick={() => setCalView("calendar")}
                    >
                      <CalendarDays className="size-4" />
                      Calendar
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex h-10 items-center gap-2 border-l border-[#D8E0EA] px-4 text-sm font-medium transition-colors",
                        calView === "list" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-white",
                      )}
                      onClick={() => setCalView("list")}
                    >
                      <List className="size-4" />
                      List
                    </button>
                  </div>

                  {/* Period selector (month/week) — only when in calendar view */}
                  {calView === "calendar" && (
                    <div className="flex overflow-hidden rounded-lg border border-[#D8E0EA] bg-[#F8FAFC]">
                      {(["month", "week"] as CalPeriod[]).map((p, i) => (
                        <button
                          key={p}
                          type="button"
                          className={cn(
                            "flex h-10 items-center px-4 text-sm font-medium capitalize transition-colors",
                            i > 0 && "border-l border-[#D8E0EA]",
                            calPeriod === p ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-white",
                          )}
                          onClick={() => setCalPeriod(p)}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Navigation */}
                {calView === "calendar" && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center overflow-hidden rounded-lg border border-[#D8E0EA] bg-[#F8FAFC]">
                      <button
                        type="button"
                        className="flex h-10 w-10 items-center justify-center text-slate-500 hover:bg-white transition-colors"
                        onClick={() => nav(-1)}
                      >
                        <ChevronLeft className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="h-10 px-3 text-sm font-medium text-slate-600 border-l border-r border-[#D8E0EA] hover:bg-white transition-colors"
                        onClick={() => setAnchor(today)}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        className="flex h-10 w-10 items-center justify-center text-slate-500 hover:bg-white transition-colors"
                        onClick={() => nav(1)}
                      >
                        <ChevronRight className="size-4" />
                      </button>
                    </div>
                    <span className="text-sm font-semibold text-slate-900 min-w-[160px]">{rangeLabel}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Calendar body */}
            {calLoading ? (
              <div className="rounded-xl border border-[#E5E7EB] bg-white p-8">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/5" />
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                  {calView === "calendar" && calPeriod === "month" ? (
                    <MonthCalendar anchor={anchor} items={calItems} navigate={navigate} />
                  ) : calView === "calendar" && calPeriod === "week" ? (
                    <WeekCalendar anchor={anchor} items={calItems} navigate={navigate} />
                  ) : (
                    <ListCalendar items={calItems} navigate={navigate} />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <div className="w-full space-y-4 lg:w-64 lg:shrink-0">

            {/* Recent Activity */}
            <Card className="border-[#E5E7EB] bg-white">
              <CardHeader className="px-4 py-3 border-b border-[#E5E7EB]">
                <CardTitle className="text-xs font-semibold text-slate-900 uppercase tracking-[0.08em]">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent className="p-0 max-h-72 overflow-y-auto">
                {sidebarLoading ? (
                  <div className="p-4 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
                ) : activity.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">No activity yet</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {activity.map(entry => (
                      <div key={entry.id} className="px-4 py-2.5">
                        <p className="text-xs text-slate-700 leading-snug line-clamp-2">{entry.description}</p>
                        <div className="mt-1 flex items-center gap-1.5">
                          {entry.entityType && (
                            <span className={`text-[10px] font-medium rounded px-1 py-0.5 ${entityBadgeColor(entry.entityType)}`}>
                              {entityLabel(entry.entityType)}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400">{timeAgo(entry.createdAt)}</span>
                          {entry.userName ? (
                            <span className="text-[10px] text-slate-400">
                              by {entry.userName === user?.fullName ? "You" : entry.userName}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Open Jobs */}
            <Card className="border-[#E5E7EB] bg-white">
              <CardHeader className="px-4 py-3 border-b border-[#E5E7EB]">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs font-semibold text-slate-900 uppercase tracking-[0.08em]">Open Jobs</CardTitle>
                  <Link to="/jobs" className="text-[10px] font-medium hover:underline" style={{ color: "#E85D04" }}>All</Link>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {sidebarLoading ? (
                  <div className="p-4 space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
                ) : recentJobs.length === 0 ? (
                  <div className="py-6 text-center">
                    <p className="text-xs text-slate-400">No open jobs</p>
                    <Link to="/jobs" className="mt-1 block text-xs hover:underline" style={{ color: "#E85D04" }}>Create one</Link>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {recentJobs.map(job => (
                      <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                        <div className="size-2 rounded-full bg-emerald-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-800 truncate">{job.title}</p>
                          {(job.city || job.state) && (
                            <p className="text-[10px] text-slate-400 flex items-center gap-0.5 mt-0.5">
                              <MapPin className="size-2.5" />
                              {[job.city, job.state].filter(Boolean).join(", ")}
                            </p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </div>
  )
}
