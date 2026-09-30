import { Link } from "react-router-dom"
import { AlertTriangle, Briefcase, CalendarRange, CheckCircle2, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import PageHeader from "@/components/layout/PageHeader"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { MobileDrillTile } from "./MobileDrillTile"
import { EmptyHint, HomeListRow, HomeSection } from "./HomeSection"
import type { PmHome } from "./types"

export default function PMHomePage({ data }: { data: PmHome }) {
  const { week, atRisk, teamLogs, summary, today } = data
  const samples = Array.isArray(atRisk.samples)
    ? { overdue: [], missingLogJobs: [], pendingChangeOrders: [] }
    : atRisk.samples
  const atRiskTotal =
    atRisk.overdueScheduleItems + atRisk.jobsMissingLogs + atRisk.pendingChangeOrders

  return (
    <div data-testid="home-pm">
      <PageHeader
        eyebrow={prettyDate(today)}
        title="This Week"
        description={prettyRange(week.start, week.end)}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/jobs">
                <Briefcase /> My Jobs
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/daily-logs/mine">
                <FileText /> Daily Logs
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MobileDrillTile
          label="Active jobs"
          value={summary.activeJobs}
          to="/jobs"
          drillTitle="Active jobs"
          drillKind="active-jobs"
          testId="home-pm-summary-active-jobs"
        />
        <MobileDrillTile
          label="Open schedule items"
          value={summary.openScheduleItems}
          to="/dashboard"
          drillTitle="Open schedule items"
          drillKind="open-schedule"
          testId="home-pm-summary-open-schedule"
        />
        <Link
          to="/daily-logs/mine"
          className="block w-full rounded-lg border border-card-border bg-card p-5 text-left shadow-sm transition hover:border-foreground/15 hover:shadow-md"
          data-testid="home-pm-summary-team-logs"
        >
          <p className="text-sm font-medium text-muted-foreground">Team logs (24h)</p>
          <p className="mt-2 text-[28px] font-semibold leading-9 tabular-nums text-foreground">
            {teamLogs.length}
          </p>
        </Link>
      </div>

      <section className="mt-8" data-testid="home-pm-at-risk">
        <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border pb-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            {atRiskTotal > 0 ? (
              <AlertTriangle className="size-4 text-amber-600" />
            ) : (
              <CheckCircle2 className="size-4 text-emerald-600" />
            )}
            Needs attention
          </h2>
          <span className="text-sm text-muted-foreground">
            {atRiskTotal > 0 ? `${atRiskTotal} at risk` : "All clear"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <AtRiskTile
            label="Overdue items"
            count={atRisk.overdueScheduleItems}
            to="/schedule?status=overdue&view=list"
            tooltip={samples.overdue
              .map((i) => `${i.title} — ${i.jobTitle ?? "?"} (due ${i.endDate})`)
              .join("\n")}
            data-testid="home-pm-at-risk-overdue"
          />
          <AtRiskTile
            label="Jobs missing logs (3+ working days)"
            count={atRisk.jobsMissingLogs}
            to="/at-risk/missing-logs"
            tooltip={samples.missingLogJobs.map((j) => j.title).join("\n")}
            data-testid="home-pm-at-risk-missing-logs"
          />
          <AtRiskTile
            label="Pending change orders"
            count={atRisk.pendingChangeOrders}
            to="/at-risk/pending-change-orders"
            tooltip={samples.pendingChangeOrders
              .map((c) => `#${c.number} — ${c.jobTitle ?? "?"}`)
              .join("\n")}
            data-testid="home-pm-at-risk-cos"
          />
        </div>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <HomeSection
          className="lg:col-span-2"
          title={
            <span className="flex items-center gap-2">
              <CalendarRange className="size-4 text-muted-foreground" />
              This week's schedule
            </span>
          }
          action={<span className="text-sm tabular-nums text-muted-foreground">{week.items.length}</span>}
        >
          {week.items.length === 0 ? (
            <EmptyHint>Nothing scheduled this week.</EmptyHint>
          ) : (
            week.items.map((item) => (
              <HomeListRow
                key={item.id}
                to={`/jobs/${item.jobId}/schedule`}
                leading={
                  <span
                    aria-hidden="true"
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: item.displayColor }}
                  />
                }
                title={item.title}
                subtitle={item.jobTitle}
                trailing={
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {prettyShort(item.startDate)}
                    {item.endDate !== item.startDate ? ` – ${prettyShort(item.endDate)}` : ""}
                  </span>
                }
              />
            ))
          )}
        </HomeSection>

        <HomeSection
          title={
            <span className="flex items-center gap-2">
              <FileText className="size-4 text-muted-foreground" />
              Team logs (24h)
            </span>
          }
          action={<span className="text-sm tabular-nums text-muted-foreground">{teamLogs.length}</span>}
        >
          {teamLogs.length === 0 ? (
            <EmptyHint>No new logs in the last 24 hours.</EmptyHint>
          ) : (
            teamLogs.slice(0, 8).map((log) => (
              <HomeListRow
                key={log.id}
                to={`/jobs/${log.jobId}/daily-logs`}
                title={log.title || log.jobTitle || "Daily log"}
                subtitle={`${log.createdByName ?? "Someone"} · ${log.jobTitle}`}
                trailing={<span className="shrink-0 text-xs text-muted-foreground">{log.logDate}</span>}
              />
            ))
          )}
        </HomeSection>
      </div>
    </div>
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
    danger ? "border-amber-200 bg-amber-50" : "border-card-border bg-card"
  } ${clickable ? "cursor-pointer hover:border-amber-300 hover:bg-amber-100/60" : ""}`
  const inner = (
    <>
      <p className={`text-sm font-medium ${danger ? "text-amber-900" : "text-muted-foreground"}`}>{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          danger ? "text-amber-800" : "text-foreground"
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
