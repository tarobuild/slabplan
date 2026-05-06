import { useReportsGetReportsJobsByStage } from "@workspace/api-client-react"
import {
  EmptyState,
  LoadingCard,
  ReportSection,
  SnapshotToolbar,
  csvDownloadHref,
} from "./shared"

// Jobs by Stage is a current-state snapshot, not time-windowed —
// see ar-aging.tsx for the same pattern.
const SNAPSHOT_RANGE = { range: "last_30" as const, from: "", to: "" }

type Row = {
  clientId: string | null
  clientName: string
  open: number
  closed: number
  archived: number
  total: number
}

const SEGMENTS = [
  { key: "open" as const, label: "Open", color: "#ea580c" },
  { key: "closed" as const, label: "Closed", color: "#15803d" },
  { key: "archived" as const, label: "Archived", color: "#94a3b8" },
]

export default function JobsByStageReport() {
  const q = useReportsGetReportsJobsByStage({ range: SNAPSHOT_RANGE.range })
  const rows = q.data?.rows ?? []
  const max = Math.max(1, ...rows.map((r) => r.total))

  return (
    <>
      <SnapshotToolbar
        csvHref={csvDownloadHref("jobs-by-stage", SNAPSHOT_RANGE)}
        csvFilename="jobs-by-stage.csv"
        note="Snapshot — current job stages across all clients"
      />
      <ReportSection title="Jobs by Stage (per client)">
        {q.isLoading ? (
          <LoadingCard />
        ) : q.isError ? (
          <EmptyState title="Couldn't load jobs by stage" />
        ) : !rows.length ? (
          <EmptyState title="No jobs yet" hint="Jobs grouped by stage will appear here." />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 text-xs text-slate-600">
              {SEGMENTS.map((s) => (
                <span key={s.key} className="flex items-center gap-1">
                  <span className="inline-block size-3 rounded" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.clientId ?? r.clientName} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium text-slate-800">{r.clientName}</span>
                    <span className="text-xs text-slate-500">
                      {r.open} open · {r.closed} closed · {r.archived} archived ({r.total} total)
                    </span>
                  </div>
                  <div
                    className="mt-1 flex h-5 overflow-hidden rounded bg-slate-100"
                    style={{ width: `${Math.max(8, (r.total / max) * 100)}%` }}
                    role="img"
                    aria-label={`${r.clientName}: open ${r.open}, closed ${r.closed}, archived ${r.archived}`}
                  >
                    {SEGMENTS.map((s) => {
                      const v = r[s.key]
                      if (v === 0) return null
                      const pct = (v / r.total) * 100
                      return (
                        <div
                          key={s.key}
                          style={{ width: `${pct}%`, background: s.color }}
                          title={`${s.label}: ${v}`}
                        />
                      )
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ReportSection>
    </>
  )
}
