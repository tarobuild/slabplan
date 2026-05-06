import { Link } from "react-router-dom"
import { AlertTriangle, CalendarRange, FileText, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { PmHome } from "./types"

export default function PMHomePage({ data }: { data: PmHome }) {
  const { week, atRisk, teamLogs, summary, today } = data

  return (
    <div className="space-y-5" data-testid="home-pm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">This Week</h1>
          <p className="mt-1 text-sm text-slate-500">
            {prettyRange(week.start, week.end)} · {prettyDate(today)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/jobs">
              <Plus className="mr-1.5 size-4" /> New Job
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/sales/leads">
              <Plus className="mr-1.5 size-4" /> New Lead
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/daily-logs/mine">
              <Plus className="mr-1.5 size-4" /> Daily Log
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryStat label="Active jobs" value={summary.activeJobs} to="/jobs" />
        <SummaryStat label="Open leads" value={summary.openLeads} to="/sales/leads" />
        <SummaryStat
          label="Open schedule items"
          value={summary.openScheduleItems}
          to="/dashboard"
        />
      </div>

      <Card className="border-[#E5E7EB]" data-testid="home-pm-at-risk">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-amber-600" />
            At-risk
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <AtRiskTile
            label="Overdue items"
            count={atRisk.overdueScheduleItems}
            to="/schedule?status=overdue&view=list"
            tooltip={atRisk.samples.overdue
              .map((i) => `${i.title} — ${i.jobTitle ?? "?"} (due ${i.endDate})`)
              .join("\n")}
            data-testid="home-pm-at-risk-overdue"
          />
          <AtRiskTile
            label="Jobs missing logs (3+ working days)"
            count={atRisk.jobsMissingLogs}
            to="/at-risk/missing-logs"
            tooltip={atRisk.samples.missingLogJobs.map((j) => j.title).join("\n")}
            data-testid="home-pm-at-risk-missing-logs"
          />
          <AtRiskTile
            label="Pending change orders"
            count={atRisk.pendingChangeOrders}
            to="/at-risk/pending-change-orders"
            tooltip={atRisk.samples.pendingChangeOrders
              .map((c) => `#${c.number} — ${c.jobTitle ?? "?"}`)
              .join("\n")}
            data-testid="home-pm-at-risk-cos"
          />
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="border-[#E5E7EB] lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarRange className="size-4 text-orange-600" />
              This week's schedule
            </CardTitle>
            <Badge variant="secondary">{week.items.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {week.items.length === 0 ? (
              <EmptyHint>Nothing scheduled this week.</EmptyHint>
            ) : (
              week.items.map((item) => (
                <Link
                  key={item.id}
                  to={`/jobs/${item.jobId}/schedule`}
                  className="flex items-center gap-2 rounded-md border border-[#E5E7EB] px-3 py-2 transition hover:border-orange-300 hover:bg-orange-50/40"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: item.displayColor }}
                  />
                  <span className="flex-1 truncate text-sm font-medium text-slate-900">
                    {item.title}
                  </span>
                  <span className="hidden text-xs text-slate-500 sm:inline">
                    {item.jobTitle}
                  </span>
                  <span className="text-xs text-slate-500">
                    {item.startDate}
                    {item.endDate !== item.startDate ? ` → ${item.endDate}` : ""}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-[#E5E7EB]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-orange-600" />
              Team logs (24h)
            </CardTitle>
            <Badge variant="secondary">{teamLogs.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {teamLogs.length === 0 ? (
              <EmptyHint>No new logs in the last 24 hours.</EmptyHint>
            ) : (
              teamLogs.slice(0, 8).map((log) => (
                <Link
                  key={log.id}
                  to={`/jobs/${log.jobId}/daily-logs`}
                  className="block rounded-md border border-[#E5E7EB] px-3 py-2 transition hover:border-orange-300 hover:bg-orange-50/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {log.title || log.jobTitle || "Daily log"}
                    </p>
                    <span className="shrink-0 text-xs text-slate-500">{log.logDate}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {log.createdByName ?? "Someone"} · {log.jobTitle}
                  </p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SummaryStat({ label, value, to }: { label: string; value: number; to: string }) {
  return (
    <Link
      to={to}
      className="rounded-lg border border-[#E5E7EB] bg-white p-4 transition hover:border-orange-300 hover:bg-orange-50/40"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </Link>
  )
}

function AtRiskTile({
  label,
  count,
  tooltip,
  to,
  ...rest
}: {
  label: string
  count: number
  tooltip: string
  to?: string
  "data-testid"?: string
}) {
  const danger = count > 0
  const clickable = danger && Boolean(to)
  const baseClass = `block rounded-lg border p-4 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 ${
    danger ? "border-amber-200 bg-amber-50" : "border-[#E5E7EB] bg-white"
  } ${clickable ? "cursor-pointer hover:border-amber-300 hover:bg-amber-100/60" : ""}`
  const inner = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          danger ? "text-amber-700" : "text-slate-900"
        }`}
      >
        {count}
      </p>
    </>
  )
  const ariaLabel = clickable
    ? `${label}: ${count}. View details.`
    : `${label}: ${count}`
  const tile = clickable ? (
    <Link {...rest} to={to!} aria-label={ariaLabel} className={baseClass}>
      {inner}
    </Link>
  ) : (
    <div {...rest} aria-label={ariaLabel} className={baseClass}>
      {inner}
    </div>
  )
  if (!tooltip || count === 0) return tile
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{tile}</TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-pre-line text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-[#E5E7EB] p-3 text-center text-xs text-slate-500">
      {children}
    </p>
  )
}

function prettyRange(start: string, end: string): string {
  return `${prettyShort(start)} – ${prettyShort(end)}`
}

function prettyShort(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}

function prettyDate(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
  } catch {
    return iso
  }
}
