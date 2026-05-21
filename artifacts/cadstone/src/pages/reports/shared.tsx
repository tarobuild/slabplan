import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"

type RangePreset = "last_30" | "last_90" | "ytd" | "custom"

type ReportRange = {
  range: RangePreset
  from?: string
  to?: string
}

type ReportQueryParams =
  | {
      range: Exclude<RangePreset, "custom">
      from?: string
      to?: string
    }
  | {
      range: "custom"
      from: string
      to: string
    }

const RANGE_LABELS: Record<RangePreset, string> = {
  last_30: "Last 30 days",
  last_90: "Last 90 days",
  ytd: "Year to date",
  custom: "Custom",
}

function rangeToParams(r: ReportRange): Record<string, string> {
  const effectiveRange = r.range === "custom" && (!r.from || !r.to) ? "last_90" : r.range
  const params: Record<string, string> = { range: effectiveRange }
  if (effectiveRange === "custom" && r.from && r.to) {
    params.from = r.from
    params.to = r.to
  }
  return params
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
  csvHref: string
  csvFilename: string
}) {
  const [from, setFrom] = useState(value.from ?? "")
  const [to, setTo] = useState(value.to ?? "")

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-white p-3">
      <label className="flex flex-col text-xs text-slate-600">
        Date range
        <select
          className="mt-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
          value={value.range}
          onChange={(e) => {
            const next = e.target.value as RangePreset
            onChange({ range: next, from: next === "custom" ? from : undefined, to: next === "custom" ? to : undefined })
          }}
        >
          {(Object.keys(RANGE_LABELS) as RangePreset[]).map((k) => (
            <option key={k} value={k}>
              {RANGE_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      {value.range === "custom" && (
        <>
          <label className="flex flex-col text-xs text-slate-600">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value)
                onChange({ range: "custom", from: e.target.value, to })
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
                setTo(e.target.value)
                onChange({ range: "custom", from, to: e.target.value })
              }}
              className="mt-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>
        </>
      )}
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
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-white p-3">
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
export function rangeToReportParams(range: ReportRange): ReportQueryParams {
  if (range.range === "custom" && range.from && range.to) {
    return { range: "custom", from: range.from, to: range.to }
  }
  return { range: range.range === "custom" ? "last_90" : range.range }
}

export function csvDownloadHref(path: string, range: ReportRange): string {
  const params = new URLSearchParams({ ...rangeToParams(range), format: "csv" })
  return `/api/reports/${path}?${params.toString()}`
}
