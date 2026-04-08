import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Briefcase, CalendarDays, FileText, Plus, TrendingUp } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

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

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get("/dashboard/stats").then(r => r.data.stats),
      api.get("/activity?limit=20").then(r => r.data.entries ?? []),
    ])
      .then(([s, a]) => { setStats(s); setActivity(a) })
      .finally(() => setLoading(false))
  }, [])

  const statCards = [
    { label: "Active Jobs", value: stats?.activeJobs ?? 0, icon: Briefcase, href: "/jobs", color: "text-blue-600 bg-blue-50" },
    { label: "Open Leads", value: stats?.openLeads ?? 0, icon: TrendingUp, href: "/sales/leads", color: "text-green-600 bg-green-50" },
    { label: "Schedule Items", value: stats?.openScheduleItems ?? 0, icon: CalendarDays, href: "/jobs", color: "text-yellow-600 bg-yellow-50" },
    { label: "My Daily Logs", value: stats?.myDailyLogs ?? 0, icon: FileText, href: "/daily-logs/mine", color: "text-purple-600 bg-purple-50" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-500">Welcome back. Here's what's happening.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to="/sales/leads"><Plus className="mr-1.5 size-3.5" />New Lead</Link>
          </Button>
          <Button size="sm" asChild>
            <Link to="/jobs"><Plus className="mr-1.5 size-3.5" />New Job</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((card) => (
          <Link key={card.label} to={card.href}>
            <Card className="border-[#E5E7EB] hover:border-blue-300 transition-colors cursor-pointer">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{card.label}</p>
                    {loading ? (
                      <Skeleton className="mt-1.5 h-7 w-12" />
                    ) : (
                      <p className="mt-1 text-2xl font-bold text-slate-900">{card.value}</p>
                    )}
                  </div>
                  <div className={`p-2.5 rounded-lg ${card.color}`}>
                    <card.icon className="size-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="border-[#E5E7EB]">
        <CardHeader className="pb-3 border-b border-[#E5E7EB]">
          <CardTitle className="text-sm font-semibold text-slate-900">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="px-5 py-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">No activity yet</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {activity.map(entry => (
                <div key={entry.id} className="flex items-start gap-3 px-5 py-3">
                  <div className="mt-1.5 size-1.5 rounded-full bg-blue-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 leading-snug">{entry.description}</p>
                    {entry.userName && (
                      <p className="mt-0.5 text-xs text-slate-400">{entry.userName}</p>
                    )}
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
  )
}
