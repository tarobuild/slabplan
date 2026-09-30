import { Link } from "react-router-dom"
import { ArrowUpRight, Briefcase, CircleDollarSign, FileWarning, TrendingUp, Users2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import PageHeader from "@/components/layout/PageHeader"
import { MobileDrillTile } from "./MobileDrillTile"
import { HomeSection, HomeListRow, EmptyHint } from "./HomeSection"
import { type AdminHome, formatCents } from "./types"

export default function AdminHomePage({ data }: { data: AdminHome }) {
  const { kpis, topClients, jobsByStage, recentLeads, pastDueInvoices, today } = data
  const maxStageTotal = Math.max(0, ...jobsByStage.map((r) => r.total)) || 1

  return (
    <div data-testid="home-admin">
      <PageHeader
        eyebrow={prettyDate(today)}
        title="Business Pulse"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={<CircleDollarSign className="size-4 text-emerald-700" />}
          label="A/R outstanding"
          value={formatCents(kpis.arOutstandingCents)}
          sub="Balance left on open contracts"
          to="/clients"
          data-testid="home-admin-kpi-ar"
        />
        <Kpi
          icon={<TrendingUp className="size-4 text-primary" />}
          label="New contract value (MTD)"
          value={formatCents(kpis.newContractValueThisMonthCents)}
          sub={`${kpis.newJobsThisMonth} new job${kpis.newJobsThisMonth === 1 ? "" : "s"} this month`}
          to="/clients"
        />
        <MobileDrillTile
          icon={<Briefcase className="size-4 text-foreground/70" />}
          label="Active jobs"
          value={String(kpis.activeJobs)}
          to="/clients"
          drillTitle="Active jobs"
          drillKind="active-jobs"
          testId="home-admin-kpi-active-jobs"
        />
        <MobileDrillTile
          icon={<Users2 className="size-4 text-sky-700" />}
          label="Open leads"
          value={String(kpis.openLeads)}
          to="/sales/leads"
          drillTitle="Open leads"
          drillKind="open-leads"
          testId="home-admin-kpi-open-leads"
        />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <HomeSection
            title="Top clients by open balance"
            action={
              <Link to="/clients" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                All clients
                <ArrowUpRight className="size-3.5" />
              </Link>
            }
          >
            {topClients.length === 0 ? (
              <EmptyHint>No outstanding balances right now.</EmptyHint>
            ) : (
              topClients.map((c, index) => (
                <HomeListRow
                  key={c.clientId ?? "none"}
                  to={c.clientId ? `/clients/${c.clientId}` : "/clients"}
                  data-testid="home-admin-top-client"
                  leading={
                    <span className="flex w-5 shrink-0 justify-center text-sm font-semibold tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                  }
                  title={c.clientName}
                  trailing={
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {formatCents(c.openBalanceCents)}
                    </span>
                  }
                />
              ))
            )}
          </HomeSection>

          <HomeSection
            title="Recent leads"
            action={
              <Link to="/sales" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Sales pipeline
                <ArrowUpRight className="size-3.5" />
              </Link>
            }
          >
            {recentLeads.length === 0 ? (
              <EmptyHint>No leads recorded yet.</EmptyHint>
            ) : (
              recentLeads.map((lead) => (
                <HomeListRow
                  key={lead.id}
                  to={`/sales/leads?lead=${encodeURIComponent(lead.id)}`}
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
                        {lead.confidence}% confidence
                      </Badge>
                    ) : null
                  }
                />
              ))
            )}
          </HomeSection>
        </div>

        <div className="space-y-8">
          <HomeSection
            title={
              <span className="flex items-center gap-2">
                <FileWarning className="size-4 text-amber-600" />
                Past-due invoices
              </span>
            }
            action={
              <Badge variant={kpis.pastDueInvoiceCount > 0 ? "warning" : "secondary"} className="tabular-nums">
                {kpis.pastDueInvoiceCount}
              </Badge>
            }
          >
            {pastDueInvoices.length === 0 ? (
              <EmptyHint>Nothing past due.</EmptyHint>
            ) : (
              pastDueInvoices.map((inv) => {
                const remaining = Math.max(0, inv.totalCents - inv.paidCents)
                return (
                  <HomeListRow
                    key={inv.id}
                    to={`/jobs/${inv.jobId}/financials`}
                    title={`${inv.invoiceNumber || "(no #)"} · ${inv.clientName ?? inv.jobTitle ?? "Unknown"}`}
                    subtitle={`Invoice date ${inv.invoiceDate ?? "not set"}`}
                    trailing={
                      <span className="text-sm font-semibold tabular-nums text-amber-800">
                        {formatCents(remaining)}
                      </span>
                    }
                  />
                )
              })
            )}
          </HomeSection>

          <HomeSection title="Jobs by stage">
            {jobsByStage.length === 0 ? (
              <EmptyHint>No jobs yet.</EmptyHint>
            ) : (
              <div className="space-y-3.5 pt-4">
                {jobsByStage.map((row) => {
                  const pct = Math.round((row.total / maxStageTotal) * 100)
                  return (
                    <div key={row.stage}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="capitalize text-foreground">{row.stage}</span>
                        <span className="font-medium tabular-nums text-muted-foreground">{row.total}</span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </HomeSection>
        </div>
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
      className="block rounded-lg border border-card-border bg-card p-5 shadow-sm transition hover:border-foreground/15 hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className="flex size-8 shrink-0 items-center justify-center">{icon}</span>
      </div>
      <p className="mt-2 text-[28px] font-semibold leading-9 tabular-nums text-foreground">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
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
