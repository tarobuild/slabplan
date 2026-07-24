import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"

type RangePreset = "last_30" | "last_90" | "ytd" | "custom"

type ReportRange = {
  range: RangePreset
  from?: string
  to?: string
}

type ReportParams =
  | { range?: Exclude<RangePreset, "custom"> }
  | { range: "custom"; from: string; to: string }

const RANGE_LABELS: Record<RangePreset, string> = {
  last_30: "Last 30 days",
  last_90: "Last 90 days",
  ytd: "Year to date",
  custom: "Custom",
}

function rangeToParams(r: ReportRange): Record<string, string> {
  const params: Record<string, string> = { range: r.range }
  if (r.range === "custom" && r.from && r.to) {
    params.from = r.from
    params.to = r.to
  }
  return params
}

export function isCompleteReportRange(range: ReportRange): boolean {
  return range.range !== "custom" || Boolean(range.from && range.to)
}

export function formatMoney(cents: number): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

export function ReportToolbar({
  value,
  onChange,
  csvHref,
  csvFilename,
}: {
  value: ReportRange
  onChange: (next: ReportRange) => void
  csvHref: string | null
  csvFilename: string
}) {
  const [selectedRange, setSelectedRange] = useState<RangePreset>(value.range)
  const [from, setFrom] = useState(value.from ?? "")
  const [to, setTo] = useState(value.to ?? "")

  useEffect(() => {
    setSelectedRange(value.range)
    if (value.range === "custom") {
      setFrom(value.from ?? "")
      setTo(value.to ?? "")
    }
  }, [value.from, value.range, value.to])

  function commitCustomRange(nextFrom: string, nextTo: string) {
    if (nextFrom && nextTo) {
      onChange({ range: "custom", from: nextFrom, to: nextTo })
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-[#E5E7EB] bg-white p-3">
      <label className="flex flex-col text-xs text-slate-600">
        Date range
        <select
          className="mt-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
          value={selectedRange}
          onChange={(e) => {
            const next = e.target.value as RangePreset
            setSelectedRange(next)
            if (next === "custom") {
              commitCustomRange(from, to)
            } else {
              onChange({ range: next })
            }
          }}
        >
          {(Object.keys(RANGE_LABELS) as RangePreset[]).map((k) => (
            <option key={k} value={k}>
              {RANGE_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      {selectedRange === "custom" && (
        <>
          <label className="flex flex-col text-xs text-slate-600">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => {
                const nextFrom = e.target.value
                setFrom(nextFrom)
                commitCustomRange(nextFrom, to)
              }}
              className="mt-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-600">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => {
                const nextTo = e.target.value
                setTo(nextTo)
                commitCustomRange(from, nextTo)
              }}
              className="mt-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>
        </>
      )}
      <div className="ml-auto">
        {csvHref ? (
          <a
            className="inline-flex items-center rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            href={csvHref}
            download={csvFilename}
          >
            Export CSV
          </a>
        ) : (
          <button
            type="button"
            className="inline-flex cursor-not-allowed items-center rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-400"
            disabled
          >
            Export CSV
          </button>
        )}
      </div>
    </div>
  )
}

// Snapshot reports (A/R Aging, Jobs by Stage) intentionally don't honor
// the date-range picker — they're always "as of right now". Render a
// lighter toolbar that just hosts the CSV export so the UI doesn't lie
// about a control that wouldn't change anything.
export function SnapshotToolbar({
  csvHref,
  csvFilename,
  note,
}: {
  csvHref: string
  csvFilename: string
  note?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#E5E7EB] bg-white p-3">
      <span className="text-xs text-slate-500">{note ?? "Snapshot — as of today"}</span>
      <div className="ml-auto">
        <a
          className="inline-flex items-center rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          href={csvHref}
          download={csvFilename}
        >
          Export CSV
        </a>
      </div>
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-10 text-center text-sm text-slate-500">
        <div className="font-medium text-slate-700">{title}</div>
        {hint ? <div className="mt-1 text-slate-500">{hint}</div> : null}
      </CardContent>
    </Card>
  )
}

export function LoadingCard() {
  return (
    <Card>
      <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
        <Spinner className="size-4 text-primary" /> Loading…
      </CardContent>
    </Card>
  )
}

export function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function useReportRange(): [ReportRange, (r: ReportRange) => void] {
  const [range, setRange] = useState<ReportRange>({ range: "last_90" })
  return [range, setRange]
}

// Adapter: turn the picker's `ReportRange` into the orval-generated query
// params shape. All five report endpoints share the same params shape, so
// we expose a single helper here rather than per-endpoint wrappers.
export function rangeToReportParams(range: ReportRange): ReportParams | undefined {
  if (range.range === "custom" && range.from && range.to) {
    return { range: "custom", from: range.from, to: range.to }
  }
  if (range.range === "custom") {
    return undefined
  }
  return { range: range.range }
}

export function isCsvReportData(data: unknown): data is string {
  return typeof data === "string"
}

export function jsonReportData<T>(data: T | string | undefined): T | undefined {
  return isCsvReportData(data) ? undefined : data
}

export function csvDownloadHref(path: string, range: ReportRange): string | null {
  if (!isCompleteReportRange(range)) return null
  const params = new URLSearchParams({ ...rangeToParams(range), format: "csv" })
  return `/api/reports/${path}?${params.toString()}`
}
