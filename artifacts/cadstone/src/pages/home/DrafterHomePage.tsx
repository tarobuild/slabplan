import { Link } from "react-router-dom"
import { ArrowUpRight, CalendarRange, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import PageHeader from "@/components/layout/PageHeader"
import { EmptyHint, HomeListRow, HomeSection } from "./HomeSection"
import type { DrafterHome } from "./types"

export default function DrafterHomePage({ data }: { data: DrafterHome }) {
  const { today, summary, recentLeads, schedule } = data

  return (
    <div data-testid="home-drafter">
      <PageHeader
        eyebrow={prettyDate(today)}
        title="Drafter Workspace"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SummaryTile
          icon={<Sparkles className="size-4 text-sky-700" />}
          label="Open leads"
          value={summary.openLeads}
          to="/sales/leads"
          testId="home-drafter-open-leads"
        />
        <SummaryTile
          icon={<CalendarRange className="size-4 text-primary" />}
          label="Open schedule items"
          value={summary.openScheduleItems}
          to="/schedule"
          testId="home-drafter-open-schedule"
        />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-5">
        <HomeSection
          className="lg:col-span-3"
          title={
            <span className="flex items-center gap-2">
              <CalendarRange className="size-4 text-muted-foreground" />
              Schedule
            </span>
          }
          action={
            <Link to="/schedule" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Full schedule
              <ArrowUpRight className="size-3.5" />
            </Link>
          }
        >
          {schedule.items.length === 0 ? (
            <EmptyHint>No assigned or created schedule items in the next two weeks.</EmptyHint>
          ) : (
            schedule.items.map((item) => (
              <HomeListRow
                key={item.id}
                to={`/schedule?from=${item.startDate}&to=${item.endDate}`}
                leading={
                  <span
                    aria-hidden="true"
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: item.displayColor || "#94a3b8" }}
                  />
                }
                title={item.title}
                subtitle={item.jobTitle ?? undefined}
                trailing={
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {shortDate(item.startDate)}
                  </span>
                }
              />
            ))
          )}
        </HomeSection>

        <HomeSection
          className="lg:col-span-2"
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="size-4 text-muted-foreground" />
              Recent leads
            </span>
          }
          action={<span className="text-sm tabular-nums text-muted-foreground">{recentLeads.length}</span>}
        >
          {recentLeads.length === 0 ? (
            <EmptyHint>No leads recorded yet.</EmptyHint>
          ) : (
            recentLeads.map((lead) => (
              <HomeListRow
                key={lead.id}
                to={`/sales/leads?lead=${lead.id}`}
                title={lead.title}
                subtitle={
                  <>
                    {[lead.city, lead.state].filter(Boolean).join(", ") || "No location"} ·{" "}
                    <span className="capitalize">{lead.status.replaceAll("_", " ")}</span>
                  </>
                }
                trailing={
                  lead.confidence !== null ? (
                    <Badge variant="secondary" className="tabular-nums">
                      {lead.confidence}%
                    </Badge>
                  ) : null
                }
              />
            ))
          )}
        </HomeSection>
      </div>
    </div>
  )
}

function SummaryTile({
  icon,
  label,
  value,
  to,
  testId,
}: {
  icon: React.ReactNode
  label: string
  value: number
  to: string
  testId: string
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="block rounded-lg border border-card-border bg-card p-5 shadow-sm transition hover:border-foreground/15 hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className="flex size-8 shrink-0 items-center justify-center">{icon}</span>
      </div>
      <p className="mt-2 text-[28px] font-semibold leading-9 tabular-nums text-foreground">{value}</p>
    </Link>
  )
}

function prettyDate(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

function shortDate(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}
