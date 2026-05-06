import {
  useReportsGetReportsPipeline,
  type PipelineResponse,
} from "@workspace/api-client-react"
import {
  EmptyState,
  LoadingCard,
  ReportSection,
  ReportToolbar,
  csvDownloadHref,
  rangeToReportParams,
  useReportRange,
} from "./shared"

type PipelineData = PipelineResponse

// Funnel order goes top → bottom: New → Qualified → Proposal → Won + Lost.
// Won and Lost are siblings at the bottom because a deal terminates in one
// of the two; rendering them side-by-side keeps the funnel honest.
const FUNNEL_ORDER: Array<{ stage: string; label: string; color: string }> = [
  { stage: "open", label: "New", color: "#fb923c" },
  { stage: "qualified", label: "Qualified", color: "#f59e0b" },
  { stage: "in_negotiation", label: "Proposal", color: "#0ea5e9" },
]

export default function PipelineReport() {
  const [range, setRange] = useReportRange()
  const q = useReportsGetReportsPipeline(rangeToReportParams(range))

  return (
    <>
      <ReportToolbar
        value={range}
        onChange={setRange}
        csvHref={csvDownloadHref("pipeline", range)}
        csvFilename="pipeline.csv"
      />
      <ReportSection title="Sales Pipeline & Win Rate">
        {q.isLoading ? (
          <LoadingCard />
        ) : q.isError ? (
          <EmptyState title="Couldn't load pipeline" />
        ) : !q.data || q.data.funnel.every((f) => f.count === 0) ? (
          <EmptyState
            title="No leads yet"
            hint="Once leads are added in Sales they'll show up in the funnel here."
          />
        ) : (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Win rate" value={`${q.data.winRate}%`} />
              <Stat label="Closed (won / lost)" value={`${q.data.won} / ${q.data.lost}`} />
              <Stat label="Avg days to close" value={`${q.data.avgDaysToClose}`} />
            </div>
            <Funnel data={q.data} />
          </div>
        )}
      </ReportSection>
    </>
  )
}

function Funnel({ data }: { data: PipelineData }) {
  const counts = new Map(data.funnel.map((f) => [f.stage, f.count]))
  const stageRows = FUNNEL_ORDER.map((s) => ({ ...s, count: counts.get(s.stage) ?? 0 }))
  const wonCount = counts.get("won") ?? 0
  const lostCount = counts.get("lost") ?? 0
  // Width is proportional to the largest stage in view, so the funnel
  // visibly tapers from top to bottom.
  const max = Math.max(1, ...stageRows.map((r) => r.count), wonCount + lostCount)
  return (
    <div className="space-y-2" data-testid="pipeline-funnel">
      {stageRows.map((row) => {
        const pct = (row.count / max) * 100
        return (
          <div key={row.stage} className="flex items-center justify-center gap-3">
            <div
              className="flex h-10 items-center justify-center rounded text-xs font-semibold text-white"
              style={{
                width: `${Math.max(pct, 8)}%`,
                background: row.color,
              }}
            >
              {row.label} — {row.count}
            </div>
          </div>
        )
      })}
      <div className="flex items-center justify-center gap-2">
        <FunnelBottom
          label="Won"
          count={wonCount}
          color="#15803d"
          width={(wonCount / max) * 50}
        />
        <FunnelBottom
          label="Lost"
          count={lostCount}
          color="#b91c1c"
          width={(lostCount / max) * 50}
        />
      </div>
    </div>
  )
}

function FunnelBottom({
  label,
  count,
  color,
  width,
}: {
  label: string
  count: number
  color: string
  width: number
}) {
  return (
    <div
      className="flex h-10 items-center justify-center rounded text-xs font-semibold text-white"
      style={{ width: `${Math.max(width, 6)}%`, background: color }}
    >
      {label} — {count}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 p-3">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
    </div>
  )
}
