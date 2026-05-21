import { Link } from "react-router-dom"
import { Briefcase, DollarSign, FileWarning, TrendingUp, Users2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MobileDrillTile } from "./MobileDrillTile"
import { type AdminHome, formatCents } from "./types"

export default function AdminHomePage({ data }: { data: AdminHome }) {
  const { kpis, topClients, jobsByStage, recentLeads, pastDueInvoices, today } = data

  return (
    <div className="space-y-5" data-testid="home-admin">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Business Pulse</h1>
        <p className="mt-1 text-sm text-muted-foreground">{prettyDate(today)}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={<DollarSign className="size-4 text-emerald-600" />}
          label="A/R outstanding"
          value={formatCents(kpis.arOutstandingCents)}
          to="/clients"
          data-testid="home-admin-kpi-ar"
        />
        <Kpi
          icon={<TrendingUp className="size-4 text-[hsl(var(--oxide))]" />}
          label="New contract value (MTD)"
          value={formatCents(kpis.newContractValueThisMonthCents)}
          sub={`${kpis.newJobsThisMonth} new job${kpis.newJobsThisMonth === 1 ? "" : "s"}`}
          to="/clients"
        />
        <MobileDrillTile
          icon={<Briefcase className="size-4 text-stone-600" />}
          label="Active jobs"
          value={String(kpis.activeJobs)}
          to="/clients"
          drillTitle="Active jobs"
          drillKind="active-jobs"
          testId="home-admin-kpi-active-jobs"
        />
        <MobileDrillTile
          icon={<Users2 className="size-4 text-primary" />}
          label="Open leads"
          value={String(kpis.openLeads)}
          to="/sales/leads"
          drillTitle="Open leads"
          drillKind="open-leads"
          testId="home-admin-kpi-open-leads"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="border-border lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top clients by open balance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {topClients.length === 0 ? (
              <EmptyHint>No outstanding balances right now.</EmptyHint>
            ) : (
              topClients.map((c) => (
                <Link
                  key={c.clientId ?? "none"}
                  to={c.clientId ? `/clients/${c.clientId}` : "/clients"}
                  data-testid="home-admin-top-client"
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 transition hover:border-primary/35 hover:bg-accent/40"
                >
                  <span className="truncate text-sm font-medium text-slate-900">
                    {c.clientName}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-slate-700">
                    {formatCents(c.openBalanceCents)}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Jobs by stage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {jobsByStage.length === 0 ? (
              <EmptyHint>No jobs yet.</EmptyHint>
            ) : (
              jobsByStage.map((row) => {
                const max = Math.max(...jobsByStage.map((r) => r.total)) || 1
                const pct = Math.round((row.total / max) * 100)
                return (
                  <div key={row.stage}>
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span className="capitalize">{row.stage}</span>
                      <span className="tabular-nums">{row.total}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileWarning className="size-4 text-amber-600" />
              Past-due invoices
            </CardTitle>
            <Badge variant="secondary">{kpis.pastDueInvoiceCount}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {pastDueInvoices.length === 0 ? (
              <EmptyHint>No past-due invoices.</EmptyHint>
            ) : (
              pastDueInvoices.map((inv) => {
                const remaining = Math.max(0, inv.totalCents - inv.paidCents)
                return (
                  <Link
                    key={inv.id}
                    to={`/jobs/${inv.jobId}/financials`}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 transition hover:border-primary/35 hover:bg-accent/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {inv.invoiceNumber || "(no #)"} — {inv.clientName ?? inv.jobTitle ?? "Unknown"}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Invoice date: {inv.invoiceDate ?? "—"}
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-amber-700">
                      {formatCents(remaining)}
                    </span>
                  </Link>
                )
              })
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent leads</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentLeads.length === 0 ? (
              <EmptyHint>No leads recorded yet.</EmptyHint>
            ) : (
              recentLeads.map((lead) => (
                <Link
                  key={lead.id}
                  to={`/sales/leads?lead=${encodeURIComponent(lead.id)}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 transition hover:border-primary/35 hover:bg-accent/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{lead.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[lead.city, lead.state].filter(Boolean).join(", ") || "—"} ·{" "}
                      <span className="capitalize">{lead.status.replaceAll("_", " ")}</span>
                    </p>
                  </div>
                  {lead.confidence !== null ? (
                    <span className="text-xs font-medium text-slate-500">
                      {lead.confidence}%
                    </span>
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

function Kpi({
  icon,
  label,
  value,
  sub,
  to,
  ...rest
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  to: string
  "data-testid"?: string
}) {
  return (
    <Link
      to={to}
      {...rest}
      className="rounded-lg border border-border bg-white p-4 transition hover:border-primary/35 hover:bg-accent/40"
    >
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </Link>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
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
