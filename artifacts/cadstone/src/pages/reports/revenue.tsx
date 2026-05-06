import { useState } from "react"
import {
  EmptyState,
  LoadingCard,
  ReportSection,
  ReportToolbar,
  csvDownloadHref,
  formatMoney,
  useReport,
  useReportRange,
} from "./shared"

type Month = {
  month: string
  billedCents: number
  collectedCents: number
  topJobs: Array<{ jobId: string; jobTitle: string; amountCents: number }>
}

type Mode = "billed" | "collected"

export default function RevenueReport() {
  const [range, setRange] = useReportRange()
  const [mode, setMode] = useState<Mode>("billed")
  const q = useReport<{ months: Month[] }>("revenue", range)

  const months = q.data?.months ?? []
  const allZero = months.every((m) => m.billedCents === 0 && m.collectedCents === 0)

  return (
    <>
      <ReportToolbar
        value={range}
        onChange={setRange}
        csvHref={csvDownloadHref("revenue", range)}
        csvFilename="revenue-by-month.csv"
      />
      <ReportSection title="Revenue by Month">
        {q.isLoading ? (
          <LoadingCard />
        ) : q.isError ? (
          <EmptyState title="Couldn't load revenue" />
        ) : allZero ? (
          <EmptyState
            title="No revenue in this range"
            hint="Billed and collected totals will populate as invoices and payments are recorded."
          />
        ) : (
          <div className="space-y-4">
            <div role="tablist" aria-label="Revenue mode" className="inline-flex rounded border border-slate-300 text-sm">
              <ToggleBtn active={mode === "billed"} onClick={() => setMode("billed")}>
                Billed
              </ToggleBtn>
              <ToggleBtn active={mode === "collected"} onClick={() => setMode("collected")}>
                Collected
              </ToggleBtn>
            </div>

            <RevenueChart months={months} mode={mode} />
          </div>
        )}
      </ReportSection>
    </>
  )
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1.5 ${active ? "bg-orange-50 font-medium text-orange-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}
    >
      {children}
    </button>
  )
}

function RevenueChart({ months, mode }: { months: Month[]; mode: Mode }) {
  const max =
    Math.max(
      1,
      ...months.map((m) => (mode === "billed" ? m.billedCents : m.collectedCents)),
    ) || 1
  const height = 220
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2" style={{ height }}>
        {months.map((m) => {
          const value = mode === "billed" ? m.billedCents : m.collectedCents
          const h = Math.round((value / max) * (height - 30))
          const tooltip = [
            `${m.month}`,
            `Billed: ${formatMoney(m.billedCents)}`,
            `Collected: ${formatMoney(m.collectedCents)}`,
            ...(m.topJobs.length
              ? ["Top jobs:", ...m.topJobs.map((j) => `• ${j.jobTitle} — ${formatMoney(j.amountCents)}`)]
              : []),
          ].join("\n")
          return (
            <div key={m.month} className="group relative flex flex-1 flex-col items-center justify-end gap-1">
              <div className="text-[10px] text-slate-500">{formatMoney(value)}</div>
              <div
                className="w-full rounded-t bg-orange-600 transition-colors group-hover:bg-orange-700"
                style={{ height: Math.max(2, h) }}
                title={tooltip}
                role="img"
                aria-label={tooltip}
              />
              {m.topJobs.length > 0 && (
                <div
                  className="pointer-events-none absolute bottom-full z-10 mb-2 hidden w-56 rounded-md border border-slate-200 bg-white p-2 text-xs shadow-md group-hover:block"
                  role="tooltip"
                >
                  <div className="font-medium text-slate-700">{m.month} top jobs</div>
                  <ul className="mt-1 space-y-0.5 text-slate-600">
                    {m.topJobs.map((j) => (
                      <li key={j.jobId} className="truncate">
                        {j.jobTitle} — {formatMoney(j.amountCents)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex gap-2">
        {months.map((m) => (
          <div key={m.month} className="flex-1 truncate text-center text-[10px] text-slate-500">
            {m.month}
          </div>
        ))}
      </div>
    </div>
  )
}
