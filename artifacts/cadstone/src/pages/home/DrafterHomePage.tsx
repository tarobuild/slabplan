import { Link } from "react-router-dom"
import { CalendarRange, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DrafterHome } from "./types"

export default function DrafterHomePage({ data }: { data: DrafterHome }) {
  const { today, summary, recentLeads, schedule } = data

  return (
    <div className="space-y-5" data-testid="home-drafter">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Drafter Workspace</h1>
        <p className="mt-1 text-sm text-slate-500">{prettyDate(today)}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryTile
          icon={<Sparkles className="size-4 text-primary" />}
          label="Open leads"
          value={summary.openLeads}
          to="/sales/leads"
          testId="home-drafter-open-leads"
        />
        <SummaryTile
          icon={<CalendarRange className="size-4 text-sky-600" />}
          label="Open schedule items"
          value={summary.openScheduleItems}
          to="/schedule"
          testId="home-drafter-open-schedule"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="border-[#E5E7EB]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" />
              Recent leads
            </CardTitle>
            <Badge variant="secondary">{recentLeads.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentLeads.length === 0 ? (
              <EmptyHint>No leads recorded yet.</EmptyHint>
            ) : (
              recentLeads.map((lead) => (
                <Link
                  key={lead.id}
                  to={`/sales/leads?lead=${lead.id}`}
                  className="block rounded-md border border-[#E5E7EB] px-3 py-2 transition hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-medium text-slate-900">{lead.title}</p>
                    {lead.confidence !== null ? (
                      <span className="shrink-0 text-xs font-medium text-slate-500">
                        {lead.confidence}%
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {[lead.city, lead.state].filter(Boolean).join(", ") || "No location"} ·{" "}
                    <span className="capitalize">{lead.status.replaceAll("_", " ")}</span>
                  </p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-[#E5E7EB]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarRange className="size-4 text-sky-600" />
              Schedule
            </CardTitle>
            <Badge variant="secondary">{schedule.items.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {schedule.items.length === 0 ? (
              <EmptyHint>No assigned or created schedule items in the next two weeks.</EmptyHint>
            ) : (
              schedule.items.map((item) => (
                <Link
                  key={item.id}
                  to={`/schedule?from=${item.startDate}&to=${item.endDate}`}
                  className="block rounded-md border border-[#E5E7EB] px-3 py-2 transition hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: item.displayColor || "#94a3b8" }}
                    />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                      {item.title}
                    </p>
                    <span className="shrink-0 text-xs text-slate-500">
                      {shortDate(item.startDate)}
                    </span>
                  </div>
                  {item.jobTitle ? (
                    <p className="mt-0.5 truncate text-xs text-slate-500">{item.jobTitle}</p>
                  ) : null}
                </Link>
              ))
            )}
          </CardContent>
        </Card>
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
      className="rounded-lg border border-[#E5E7EB] bg-white p-4 transition hover:border-primary/40 hover:bg-primary/5"
    >
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
    </Link>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-[#E5E7EB] p-3 text-center text-xs text-slate-500">
      {children}
    </p>
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
