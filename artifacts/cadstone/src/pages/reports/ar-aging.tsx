import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useReportsGetReportsArAging } from "@workspace/api-client-react"
import {
  EmptyState,
  LoadingCard,
  ReportSection,
  SnapshotToolbar,
  csvDownloadHref,
  formatMoney,
} from "./shared"

type ArRow = {
  clientId: string | null
  clientName: string
  current: number
  d1to30: number
  d31to60: number
  d61to90: number
  d90plus: number
  total: number
}

type SortKey = "clientName" | "current" | "d1to30" | "d31to60" | "d61to90" | "d90plus" | "total"

// A/R Aging is a point-in-time snapshot ("what's outstanding right
// now") so the date-range picker would be misleading. Use a
// SnapshotToolbar that just exposes CSV export. Range is fixed to
// last_30 server-side so the URL/CSV are stable.
const SNAPSHOT_RANGE = { range: "last_30" as const, from: "", to: "" }

export default function ArAgingReport() {
  const q = useReportsGetReportsArAging({ range: SNAPSHOT_RANGE.range })
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "total",
    dir: "desc",
  })

  const rows = useMemo(() => {
    const data = q.data?.rows ?? []
    const sorted = [...data].sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      if (typeof av === "string" && typeof bv === "string") {
        return sort.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sort.dir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av)
    })
    return sorted
  }, [q.data, sort])

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "clientName" ? "asc" : "desc" },
    )
  }

  function arrow(key: SortKey) {
    if (sort.key !== key) return null
    return <span aria-hidden className="ml-1 text-slate-400">{sort.dir === "asc" ? "▲" : "▼"}</span>
  }

  return (
    <>
      <SnapshotToolbar
        csvHref={csvDownloadHref("ar-aging", SNAPSHOT_RANGE)}
        csvFilename="ar-aging.csv"
        note="Snapshot — outstanding balances as of today"
      />
      <ReportSection title="A/R Aging by Client">
        {q.isLoading ? (
          <LoadingCard />
        ) : q.isError ? (
          <EmptyState title="Couldn't load A/R aging" hint="Try again in a moment." />
        ) : !rows.length ? (
          <EmptyState
            title="No outstanding invoices"
            hint="When clients have unpaid invoices they'll appear here, bucketed by age."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-500">
                  <SortableTh sortKey="clientName" toggleSort={toggleSort} arrow={arrow}>
                    Client
                  </SortableTh>
                  <SortableTh sortKey="current" align="right" toggleSort={toggleSort} arrow={arrow}>
                    Current
                  </SortableTh>
                  <SortableTh sortKey="d1to30" align="right" toggleSort={toggleSort} arrow={arrow}>
                    1–30
                  </SortableTh>
                  <SortableTh sortKey="d31to60" align="right" toggleSort={toggleSort} arrow={arrow}>
                    31–60
                  </SortableTh>
                  <SortableTh sortKey="d61to90" align="right" toggleSort={toggleSort} arrow={arrow}>
                    61–90
                  </SortableTh>
                  <SortableTh sortKey="d90plus" align="right" toggleSort={toggleSort} arrow={arrow}>
                    90+
                  </SortableTh>
                  <SortableTh sortKey="total" align="right" toggleSort={toggleSort} arrow={arrow}>
                    Total
                  </SortableTh>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const linkable = !!r.clientId
                  const Wrapper = ({ children }: { children: React.ReactNode }) =>
                    linkable ? (
                      <Link
                        to={`/clients/${r.clientId}`}
                        className="block w-full text-left hover:underline"
                      >
                        {children}
                      </Link>
                    ) : (
                      <span>{children}</span>
                    )
                  return (
                    <tr
                      key={r.clientId ?? r.clientName}
                      className={`border-b last:border-b-0 ${linkable ? "cursor-pointer hover:bg-slate-50" : ""}`}
                    >
                      <td className="px-3 py-2 font-medium text-slate-800">
                        <Wrapper>{r.clientName}</Wrapper>
                      </td>
                      <td className="px-3 py-2 text-right">{formatMoney(r.current)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(r.d1to30)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(r.d31to60)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(r.d61to90)}</td>
                      <td className="px-3 py-2 text-right text-red-700">{formatMoney(r.d90plus)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatMoney(r.total)}</td>
                    </tr>
                  )
                })}
              </tbody>
              {(() => {
                const t = rows.reduce(
                  (acc, r) => ({
                    current: acc.current + r.current,
                    d1to30: acc.d1to30 + r.d1to30,
                    d31to60: acc.d31to60 + r.d31to60,
                    d61to90: acc.d61to90 + r.d61to90,
                    d90plus: acc.d90plus + r.d90plus,
                    total: acc.total + r.total,
                  }),
                  { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0, total: 0 },
                )
                return (
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right">{formatMoney(t.current)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(t.d1to30)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(t.d31to60)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(t.d61to90)}</td>
                      <td className="px-3 py-2 text-right text-red-700">
                        {formatMoney(t.d90plus)}
                      </td>
                      <td className="px-3 py-2 text-right">{formatMoney(t.total)}</td>
                    </tr>
                  </tfoot>
                )
              })()}
            </table>
            <p className="mt-3 text-xs text-slate-500">
              Click a client row to open their detail page (Jobs &amp; Financials).
            </p>
          </div>
        )}
      </ReportSection>
    </>
  )
}

function SortableTh({
  sortKey,
  align,
  toggleSort,
  arrow,
  children,
}: {
  sortKey: SortKey
  align?: "right"
  toggleSort: (k: SortKey) => void
  arrow: (k: SortKey) => React.ReactNode
  children: React.ReactNode
}) {
  return (
    <th className={`px-3 py-2 ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className="inline-flex items-center text-xs uppercase text-slate-500 hover:text-slate-800"
      >
        {children}
        {arrow(sortKey)}
      </button>
    </th>
  )
}
