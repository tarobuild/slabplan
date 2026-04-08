import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  Briefcase,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  List,
  MapPin,
  TrendingUp,
} from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuthStore } from "@/store/auth"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Stats = {
  activeJobs: number
  openLeads: number
  openScheduleItems: number
  myDailyLogs: number
}

type CalItem = {
  id: string
  title: string
  startDate: string | null
  endDate: string | null
  workDays: number | null
  displayColor: string | null
  progress: number | null
  isComplete: boolean | null
  jobId: string
  jobTitle: string | null
  jobCity: string | null
  jobState: string | null
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
// Date helpers (no library)
// ---------------------------------------------------------------------------
function dateStr(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

function startOfWeek(d: Date) {
  const day = d.getDay()
  return addDays(d, -day)
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

function monthLabel(d: Date) {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

function weekRangeLabel(d: Date) {
  const sun = startOfWeek(d)
  const sat = addDays(sun, 6)
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
  return `${sun.toLocaleDateString("en-US", opts)} – ${sat.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`
}

function shortDate(s: string) {
  return parseDate(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

// ---------------------------------------------------------------------------
// Calendar event component
// ---------------------------------------------------------------------------
function EventPill({ item, navigate }: { item: CalItem; navigate: (path: string) => void }) {
  const color = item.displayColor ?? "#E85D04"
  const done = item.isComplete || (item.progress ?? 0) >= 100
  return (
    <button
      onClick={() => navigate(`/jobs/${item.jobId}/schedule`)}
      className="w-full text-left truncate rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight mt-0.5 first:mt-0 hover:opacity-80 transition-opacity"
      style={{ backgroundColor: color + "22", color, borderLeft: `2px solid ${color}` }}
      title={`${item.title} — ${item.jobTitle ?? ""}`}
    >
      <span className={done ? "line-through opacity-60" : ""}>{item.title}</span>
      {item.jobTitle && (
        <span className="ml-1 opacity-60 font-normal">{item.jobTitle}</span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Month view
// ---------------------------------------------------------------------------
function MonthView({ cursor, items, today, navigate }: {
  cursor: Date
  items: CalItem[]
  today: Date
  navigate: (path: string) => void
}) {
  const gridStart = startOfWeek(startOfMonth(cursor))

  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [cursor])

  const byDate = useMemo(() => {
    const map: Record<string, CalItem[]> = {}
    items.forEach(item => {
      if (!item.startDate) return
      const key = item.startDate
      if (!map[key]) map[key] = []
      map[key].push(item)
    })
    return map
  }, [items])

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-slate-200">
        {DOW.map(d => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {d}
          </div>
        ))}
      </div>
      {/* Calendar grid */}
      <div className="flex-1 grid grid-cols-7" style={{ gridTemplateRows: "repeat(6, minmax(0,1fr))" }}>
        {cells.map((cell, i) => {
          const key = dateStr(cell)
          const dayItems = byDate[key] ?? []
          const inMonth = isSameMonth(cell, cursor)
          const isToday = isSameDay(cell, today)
          return (
            <div
              key={key}
              className={`border-b border-r border-slate-200 p-1.5 overflow-hidden ${!inMonth ? "bg-slate-50/70" : "bg-white"} ${i % 7 === 0 ? "border-l border-slate-200" : ""}`}
            >
              <div className={`mb-1 flex items-center justify-center size-5 rounded-full text-xs font-semibold leading-none ${isToday ? "text-white" : inMonth ? "text-slate-700" : "text-slate-400"}`}
                style={isToday ? { backgroundColor: "#E85D04" } : {}}>
                {cell.getDate()}
              </div>
              {dayItems.slice(0, 3).map(item => (
                <EventPill key={item.id} item={item} navigate={navigate} />
              ))}
              {dayItems.length > 3 && (
                <p className="text-[10px] text-slate-400 mt-0.5 pl-1">+{dayItems.length - 3} more</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Week view
// ---------------------------------------------------------------------------
function WeekView({ cursor, items, today, navigate }: {
  cursor: Date
  items: CalItem[]
  today: Date
  navigate: (path: string) => void
}) {
  const sun = startOfWeek(cursor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(sun, i))

  const byDate = useMemo(() => {
    const map: Record<string, CalItem[]> = {}
    items.forEach(item => {
      if (!item.startDate) return
      if (!map[item.startDate]) map[item.startDate] = []
      map[item.startDate].push(item)
    })
    return map
  }, [items])

  return (
    <div className="flex-1 overflow-auto">
      <div className="grid grid-cols-7 border-b border-slate-200 sticky top-0 bg-white z-10">
        {days.map(d => {
          const isToday = isSameDay(d, today)
          return (
            <div key={dateStr(d)} className="p-2 text-center border-r border-slate-200 last:border-r-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {d.toLocaleDateString("en-US", { weekday: "short" })}
              </p>
              <p className={`mt-0.5 text-lg font-bold leading-none ${isToday ? "text-[#E85D04]" : "text-slate-800"}`}>
                {d.getDate()}
              </p>
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-7 min-h-64">
        {days.map(d => {
          const dayItems = byDate[dateStr(d)] ?? []
          return (
            <div key={dateStr(d)} className="border-r border-slate-200 last:border-r-0 p-2 space-y-1">
              {dayItems.map(item => (
                <EventPill key={item.id} item={item} navigate={navigate} />
              ))}
              {dayItems.length === 0 && (
                <p className="text-[10px] text-slate-300 text-center pt-4">–</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------
function ListView({ items, navigate }: { items: CalItem[]; navigate: (path: string) => void }) {
  const grouped = useMemo(() => {
    const map: Record<string, CalItem[]> = {}
    items.forEach(item => {
      const key = item.startDate ?? "no-date"
      if (!map[key]) map[key] = []
      map[key].push(item)
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [items])

  if (grouped.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-slate-400 py-16">
          <CalendarDays className="size-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No scheduled items in this period</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto divide-y divide-slate-100">
      {grouped.map(([dateKey, dayItems]) => (
        <div key={dateKey} className="flex gap-4 px-4 py-3">
          <div className="w-28 shrink-0 pt-0.5">
            <p className="text-xs font-semibold text-slate-700">
              {dateKey !== "no-date" ? shortDate(dateKey) : "No date"}
            </p>
          </div>
          <div className="flex-1 space-y-1.5">
            {dayItems.map(item => {
              const color = item.displayColor ?? "#E85D04"
              const done = item.isComplete || (item.progress ?? 0) >= 100
              return (
                <button
                  key={item.id}
                  onClick={() => navigate(`/jobs/${item.jobId}/schedule`)}
                  className="w-full text-left flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-slate-300 hover:shadow-sm transition-all"
                >
                  <div className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium text-slate-800 truncate ${done ? "line-through opacity-60" : ""}`}>
                      {item.title}
                    </p>
                    {item.jobTitle && (
                      <p className="text-xs text-slate-400 truncate mt-0.5">{item.jobTitle}</p>
                    )}
                  </div>
                  {typeof item.progress === "number" && !done && (
                    <div className="shrink-0 flex items-center gap-1.5">
                      <div className="w-16 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${item.progress}%`, backgroundColor: color }} />
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium">{item.progress}%</span>
                    </div>
                  )}
                  {done && (
                    <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 rounded px-1.5 py-0.5 shrink-0">Done</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------
type CalView = "month" | "week" | "list"

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return "morning"
  if (h < 17) return "afternoon"
  return "evening"
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
    job: "bg-blue-100 text-blue-700",
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
    job: "Job",
    lead: "Lead",
    schedule_item: "Schedule",
    daily_log: "Daily Log",
    document: "Document",
    photo: "Photo",
  }
  return map[type] ?? type
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  const today = useMemo(() => new Date(), [])
  const todayStr = dateStr(today)

  const [stats, setStats] = useState<Stats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([])
  const [sidebarLoading, setSidebarLoading] = useState(true)

  const [calView, setCalView] = useState<CalView>("month")
  const [cursor, setCursor] = useState(today)
  const [calItems, setCalItems] = useState<CalItem[]>([])
  const [calLoading, setCalLoading] = useState(true)

  // Compute fetch range based on view + cursor
  const fetchRange = useMemo((): { start: string; end: string } => {
    if (calView === "month") {
      const first = startOfMonth(cursor)
      const gridStart = startOfWeek(first)
      return { start: dateStr(gridStart), end: dateStr(addDays(gridStart, 41)) }
    }
    if (calView === "week") {
      const sun = startOfWeek(cursor)
      return { start: dateStr(sun), end: dateStr(addDays(sun, 6)) }
    }
    // list: next 60 days
    return { start: todayStr, end: dateStr(addDays(today, 60)) }
  }, [calView, cursor])

  // Fetch schedule items
  const fetchCal = useCallback(() => {
    setCalLoading(true)
    api.get(`/dashboard/schedule?start=${fetchRange.start}&end=${fetchRange.end}`)
      .then(r => setCalItems(r.data.items ?? []))
      .finally(() => setCalLoading(false))
  }, [fetchRange])

  useEffect(() => { fetchCal() }, [fetchCal])

  // Fetch stats + sidebar
  useEffect(() => {
    Promise.all([
      api.get("/dashboard/stats").then(r => r.data.stats),
      api.get("/activity?limit=12").then(r => r.data.entries ?? []),
    ])
      .then(([s, a]) => { setStats(s); setActivity(a) })
      .finally(() => setStatsLoading(false))

    api.get("/dashboard/agenda")
      .then(r => setRecentJobs(r.data.recentJobs ?? []))
      .finally(() => setSidebarLoading(false))
  }, [])

  // Navigation
  function nav(dir: -1 | 1) {
    setCursor(prev => {
      if (calView === "month") return new Date(prev.getFullYear(), prev.getMonth() + dir, 1)
      if (calView === "week") return addDays(prev, dir * 7)
      return addDays(prev, dir * 30)
    })
  }

  const periodLabel = calView === "month" ? monthLabel(cursor) : calView === "week" ? weekRangeLabel(cursor) : "Next 60 Days"

  const statCards = [
    { label: "Active Jobs", value: stats?.activeJobs ?? 0, icon: Briefcase, href: "/jobs", iconColor: "#E85D04" },
    { label: "Open Leads", value: stats?.openLeads ?? 0, icon: TrendingUp, href: "/sales/leads", iconColor: "#10b981" },
    { label: "Schedule Items", value: stats?.openScheduleItems ?? 0, icon: CalendarDays, href: "/jobs", iconColor: "#3b82f6" },
    { label: "My Daily Logs", value: stats?.myDailyLogs ?? 0, icon: FileText, href: "/jobs", iconColor: "#8b5cf6" },
  ]

  const todayDisplay = today.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  })

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">
      <div className="px-6 pt-5 pb-3 shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              Good {getGreeting()}, {user?.fullName?.split(" ")[0] ?? "there"}.
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">{todayDisplay}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-xs h-8" asChild>
              <Link to="/sales/leads">New Lead</Link>
            </Button>
            <Button size="sm" className="text-xs h-8 text-white" style={{ backgroundColor: "#E85D04" }} asChild>
              <Link to="/jobs">New Job</Link>
            </Button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statCards.map((card) => (
            <Link key={card.label} to={card.href}>
              <Card className="border-[#E5E7EB] bg-white hover:shadow-sm hover:border-slate-300 transition-all cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide leading-none">
                        {card.label}
                      </p>
                      {statsLoading ? (
                        <Skeleton className="mt-2 h-7 w-10" />
                      ) : (
                        <p className="mt-1.5 text-2xl font-bold text-slate-900 leading-none">
                          {card.value}
                        </p>
                      )}
                    </div>
                    <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: card.iconColor + "18" }}>
                      <card.icon className="size-4" style={{ color: card.iconColor }} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Calendar + Sidebar */}
      <div className="flex-1 min-h-0 flex gap-4 px-6 pb-5">

        {/* Calendar panel */}
        <Card className="flex-1 min-w-0 border-[#E5E7EB] bg-white flex flex-col overflow-hidden">
          {/* Calendar toolbar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => nav(-1)}
                className="size-7 flex items-center justify-center rounded hover:bg-slate-100 transition-colors text-slate-600"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                onClick={() => nav(1)}
                className="size-7 flex items-center justify-center rounded hover:bg-slate-100 transition-colors text-slate-600"
              >
                <ChevronRight className="size-4" />
              </button>
              <button
                onClick={() => setCursor(today)}
                className="px-2.5 py-1 text-xs font-medium text-slate-600 border border-slate-300 rounded hover:bg-slate-50 transition-colors"
              >
                Today
              </button>
              <span className="text-sm font-semibold text-slate-900 ml-1">{periodLabel}</span>
            </div>

            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              {(["month", "week", "list"] as CalView[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setCalView(v)}
                  className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-all ${calView === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                >
                  {v === "list" ? <List className="size-3.5" /> : v}
                </button>
              ))}
            </div>
          </div>

          {/* Calendar body */}
          {calLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="space-y-3 w-full p-6">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>
            </div>
          ) : calView === "month" ? (
            <MonthView cursor={cursor} items={calItems} today={today} navigate={navigate} />
          ) : calView === "week" ? (
            <WeekView cursor={cursor} items={calItems} today={today} navigate={navigate} />
          ) : (
            <ListView items={calItems} navigate={navigate} />
          )}
        </Card>

        {/* Right sidebar */}
        <div className="w-64 shrink-0 flex flex-col gap-4 overflow-y-auto">

          {/* Recent Activity */}
          <Card className="border-[#E5E7EB] bg-white flex-1 min-h-0 flex flex-col">
            <CardHeader className="px-4 py-3 border-b border-slate-100 shrink-0">
              <CardTitle className="text-xs font-semibold text-slate-900 uppercase tracking-wide">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-y-auto flex-1">
              {sidebarLoading ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
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
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Open Jobs */}
          <Card className="border-[#E5E7EB] bg-white shrink-0">
            <CardHeader className="px-4 py-3 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold text-slate-900 uppercase tracking-wide">Open Jobs</CardTitle>
                <Link to="/jobs" className="text-[10px] font-medium hover:underline" style={{ color: "#E85D04" }}>All</Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {sidebarLoading ? (
                <div className="p-4 space-y-2">
                  {[1, 2].map(i => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : recentJobs.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-xs text-slate-400">No open jobs</p>
                  <Link to="/jobs" className="mt-1 block text-xs hover:underline" style={{ color: "#E85D04" }}>Create one</Link>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {recentJobs.map(job => (
                    <Link
                      key={job.id}
                      to={`/jobs/${job.id}`}
                      className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 transition-colors"
                    >
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
  )
}
