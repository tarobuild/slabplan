import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  Briefcase,
  CalendarDays,
  ChevronRight,
  FileText,
  MapPin,
  TrendingUp,
} from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuthStore } from "@/store/auth"

type Stats = {
  activeJobs: number
  openLeads: number
  openScheduleItems: number
  myDailyLogs: number
}

type ActivityEntry = {
  id: string
  description: string
  action: string
  entityType: string
  createdAt: string
  userName?: string | null
}

type ScheduleItem = {
  id: string
  title: string
  startDate: string | null
  endDate: string | null
  displayColor: string | null
  progress: number | null
  jobId: string
  jobTitle: string | null
}

type DailyLog = {
  id: string
  logDate: string
  title: string | null
  notes: string | null
  jobId: string
  jobTitle: string | null
  createdByName: string | null
}

type RecentJob = {
  id: string
  title: string
  status: string
  city: string | null
  state: string | null
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
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
  const [stats, setStats] = useState<Stats | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [upcoming, setUpcoming] = useState<ScheduleItem[]>([])
  const [recentLogs, setRecentLogs] = useState<DailyLog[]>([])
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([])
  const [loading, setLoading] = useState(true)
  const [agendaLoading, setAgendaLoading] = useState(true)

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  useEffect(() => {
    Promise.all([
      api.get("/dashboard/stats").then(r => r.data.stats),
      api.get("/activity?limit=15").then(r => r.data.entries ?? []),
    ])
      .then(([s, a]) => { setStats(s); setActivity(a) })
      .finally(() => setLoading(false))

    api.get("/dashboard/agenda")
      .then(r => {
        setUpcoming(r.data.upcomingItems ?? [])
        setRecentLogs(r.data.recentLogs ?? [])
        setRecentJobs(r.data.recentJobs ?? [])
      })
      .finally(() => setAgendaLoading(false))
  }, [])

  const statCards = [
    {
      label: "Active Jobs",
      value: stats?.activeJobs ?? 0,
      icon: Briefcase,
      href: "/jobs",
      iconClass: "text-orange-600 bg-orange-50",
      valueClass: "text-slate-900",
    },
    {
      label: "Open Leads",
      value: stats?.openLeads ?? 0,
      icon: TrendingUp,
      href: "/sales/leads",
      iconClass: "text-emerald-600 bg-emerald-50",
      valueClass: "text-slate-900",
    },
    {
      label: "Schedule Items",
      value: stats?.openScheduleItems ?? 0,
      icon: CalendarDays,
      href: "/jobs",
      iconClass: "text-blue-600 bg-blue-50",
      valueClass: "text-slate-900",
    },
    {
      label: "My Daily Logs",
      value: stats?.myDailyLogs ?? 0,
      icon: FileText,
      href: "/jobs",
      iconClass: "text-violet-600 bg-violet-50",
      valueClass: "text-slate-900",
    },
  ]

  return (
    <div className="min-h-full bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Good {getGreeting()}, {user?.fullName?.split(" ")[0] ?? "there"}.
            </h1>
            <p className="mt-1 text-sm text-slate-500">{today}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50" asChild>
              <Link to="/sales/leads">New Lead</Link>
            </Button>
            <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white" asChild>
              <Link to="/jobs">New Job</Link>
            </Button>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {statCards.map((card) => (
            <Link key={card.label} to={card.href}>
              <Card className="border-[#E5E7EB] bg-white hover:border-orange-300 hover:shadow-sm transition-all cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide leading-none">
                        {card.label}
                      </p>
                      {loading ? (
                        <Skeleton className="mt-2.5 h-8 w-12" />
                      ) : (
                        <p className="mt-2 text-3xl font-bold text-slate-900 leading-none">
                          {card.value}
                        </p>
                      )}
                    </div>
                    <div className={`p-2.5 rounded-lg shrink-0 ${card.iconClass}`}>
                      <card.icon className="size-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Main content + sidebar */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

          {/* Left — Activity Feed */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="border-[#E5E7EB] bg-white">
              <CardHeader className="px-5 py-4 border-b border-[#E5E7EB]">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-slate-900">
                    Recent Activity
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="px-5 py-4 space-y-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="flex gap-3">
                        <Skeleton className="size-8 rounded-full shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-3/4" />
                          <Skeleton className="h-3 w-1/3" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : activity.length === 0 ? (
                  <div className="py-16 text-center">
                    <p className="text-sm text-slate-400">No activity yet — start by creating a job or logging your day.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {activity.map(entry => (
                      <div key={entry.id} className="flex items-start gap-3 px-5 py-3.5">
                        <div className="mt-0.5 size-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-semibold text-slate-500">
                            {entry.userName?.charAt(0)?.toUpperCase() ?? "S"}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-700 leading-snug">{entry.description}</p>
                          <div className="mt-1 flex items-center gap-2">
                            {entry.entityType && (
                              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${entityBadgeColor(entry.entityType)}`}>
                                {entityLabel(entry.entityType)}
                              </span>
                            )}
                            {entry.userName && (
                              <span className="text-xs text-slate-400">{entry.userName}</span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-slate-400 whitespace-nowrap shrink-0 mt-0.5">
                          {timeAgo(entry.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-5">

            {/* This Week's Agenda */}
            <Card className="border-[#E5E7EB] bg-white">
              <CardHeader className="px-5 py-4 border-b border-[#E5E7EB]">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-slate-900">
                    Upcoming Schedule
                  </CardTitle>
                  <Link
                    to="/jobs"
                    className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                  >
                    View all
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {agendaLoading ? (
                  <div className="px-5 py-4 space-y-3">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : upcoming.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <CalendarDays className="mx-auto mb-2 size-8 text-slate-200" />
                    <p className="text-xs text-slate-400">No upcoming schedule items</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {upcoming.map(item => (
                      <Link
                        key={item.id}
                        to={`/jobs/${item.jobId}/schedule`}
                        className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors"
                      >
                        <div
                          className="mt-1 size-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: item.displayColor ?? "#f97316" }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate leading-snug">
                            {item.title}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5 truncate">
                            {item.jobTitle ?? ""}
                            {item.startDate ? ` · ${formatDate(item.startDate)}` : ""}
                          </p>
                        </div>
                        <ChevronRight className="size-3.5 text-slate-300 shrink-0 mt-0.5" />
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Daily Logs */}
            <Card className="border-[#E5E7EB] bg-white">
              <CardHeader className="px-5 py-4 border-b border-[#E5E7EB]">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-slate-900">
                    Recent Daily Logs
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {agendaLoading ? (
                  <div className="px-5 py-4 space-y-3">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : recentLogs.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <FileText className="mx-auto mb-2 size-8 text-slate-200" />
                    <p className="text-xs text-slate-400">No daily logs yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {recentLogs.map(log => (
                      <Link
                        key={log.id}
                        to={`/jobs/${log.jobId}/daily-logs/${log.id}`}
                        className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors"
                      >
                        <div className="mt-1 size-2.5 rounded-full bg-violet-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate leading-snug">
                            {log.title || formatDate(log.logDate)}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5 truncate">
                            {log.jobTitle ?? ""}
                            {log.createdByName ? ` · ${log.createdByName}` : ""}
                          </p>
                        </div>
                        <ChevronRight className="size-3.5 text-slate-300 shrink-0 mt-0.5" />
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Open Jobs Quick Access */}
            <Card className="border-[#E5E7EB] bg-white">
              <CardHeader className="px-5 py-4 border-b border-[#E5E7EB]">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-slate-900">
                    Open Jobs
                  </CardTitle>
                  <Link
                    to="/jobs"
                    className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                  >
                    View all
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {agendaLoading ? (
                  <div className="px-5 py-4 space-y-3">
                    {[1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : recentJobs.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <Briefcase className="mx-auto mb-2 size-8 text-slate-200" />
                    <p className="text-xs text-slate-400">No open jobs</p>
                    <Link to="/jobs" className="mt-2 inline-block text-xs text-orange-600 hover:underline">
                      Create your first job
                    </Link>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {recentJobs.map(job => (
                      <Link
                        key={job.id}
                        to={`/jobs/${job.id}`}
                        className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors"
                      >
                        <div className="size-2 rounded-full bg-emerald-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate leading-snug">
                            {job.title}
                          </p>
                          {(job.city || job.state) && (
                            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                              <MapPin className="size-3" />
                              {[job.city, job.state].filter(Boolean).join(", ")}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="size-3.5 text-slate-300 shrink-0" />
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

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return "morning"
  if (h < 17) return "afternoon"
  return "evening"
}
