import { useReportsGetReportsJobsByStage } from "@workspace/api-client-react"
import {
  EmptyState,
  LoadingCard,
  ReportSection,
  SnapshotToolbar,
  csvDownloadHref,
  isCsvReportData,
  jsonReportData,
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
  const data = jsonReportData(q.data)
  const unexpectedCsv = isCsvReportData(q.data)
  const rows = data?.rows ?? []
  const totals = rows.reduce(
    (acc, row) => ({
      open: acc.open + row.open,
      closed: acc.closed + row.closed,
      archived: acc.archived + row.archived,
      total: acc.total + row.total,
    }),
    { open: 0, closed: 0, archived: 0, total: 0 },
  )
  const sortedRows = [...rows].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    return a.clientName.localeCompare(b.clientName)
  })

  return (
    <>
      <SnapshotToolbar
        csvHref={csvDownloadHref("jobs-by-stage", SNAPSHOT_RANGE)!}
        csvFilename="jobs-by-stage.csv"
        note="Snapshot — current job stages across all clients"
      />
      <ReportSection title="Jobs by Stage (per client)">
        {q.isLoading ? (
          <LoadingCard />
        ) : q.isError || unexpectedCsv ? (
          <EmptyState title="Couldn't load jobs by stage" hint="The report returned CSV where JSON was expected." />
        ) : !rows.length ? (
          <EmptyState title="No jobs yet" hint="Jobs grouped by stage will appear here." />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-4">
              {SEGMENTS.map((s) => (
                <div key={s.key} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />
                    {s.label}
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
                    {totals[s.key]}
                  </div>
                </div>
              ))}
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <div className="text-xs font-medium text-slate-500">Total jobs</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
                  {totals.total}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="min-w-[620px] w-full table-fixed text-sm">
                <colgroup>
                  <col className="w-[38%]" />
                  <col className="w-[22%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Client</th>
                    <th className="px-3 py-2 text-center">Stage mix</th>
                    <th className="px-2 py-2 text-right">Open</th>
                    <th className="px-2 py-2 text-right">Closed</th>
                    <th className="px-2 py-2 text-right">Arch.</th>
                    <th className="px-2 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedRows.map((r) => (
                    <tr key={r.clientId ?? r.clientName}>
                      <td className="max-w-[280px] px-3 py-2">
                        <div className="truncate font-medium text-slate-900" title={r.clientName}>
                          {r.clientName}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div
                          className="mx-auto flex h-2.5 w-full max-w-32 overflow-hidden rounded-full bg-slate-100"
                          role="img"
                          aria-label={`${r.clientName}: open ${r.open}, closed ${r.closed}, archived ${r.archived}`}
                        >
                          {SEGMENTS.map((s) => {
                            const v = r[s.key]
                            if (v === 0 || r.total === 0) return null
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
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-700">{r.open}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-700">{r.closed}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-700">{r.archived}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-900">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </ReportSection>
    </>
  )
}
