import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"

export type RangePreset = "last_30" | "last_90" | "ytd" | "custom"

export type ReportRange = {
  range: RangePreset
  from?: string
  to?: string
}

export const RANGE_LABELS: Record<RangePreset, string> = {
  last_30: "Last 30 days",
  last_90: "Last 90 days",
  ytd: "Year to date",
  custom: "Custom",
}

export function rangeToParams(r: ReportRange): Record<string, string> {
  const params: Record<string, string> = { range: r.range }
  if (r.range === "custom" && r.from && r.to) {
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
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-[#E5E7EB] bg-white p-3">
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
        <Spinner className="size-4 text-orange-600" /> Loading…
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

export function useReport<T>(path: string, range: ReportRange) {
  const params = useMemo(() => rangeToParams(range), [range])
  return useQuery<T>({
    queryKey: ["report", path, params],
    queryFn: async () => {
      const { data } = await api.get<T>(`/reports/${path}`, { params })
      return data
    },
  })
}

export function csvDownloadHref(path: string, range: ReportRange): string {
  const params = new URLSearchParams({ ...rangeToParams(range), format: "csv" })
  return `/api/reports/${path}?${params.toString()}`
}

// Tiny SVG bar chart so we don't pull in a chart lib.
export function BarChart({
  data,
  height = 160,
}: {
  data: Array<{ label: string; value: number; color?: string }>
  height?: number
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((d, i) => {
          const h = Math.round((d.value / max) * (height - 24))
          return (
            <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
              <div className="text-[10px] text-slate-500">
                {d.value.toLocaleString()}
              </div>
              <div
                className="w-full rounded-t"
                style={{ height: Math.max(2, h), background: d.color ?? "#ea580c" }}
                title={`${d.label}: ${d.value}`}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-2">
        {data.map((d, i) => (
          <div key={i} className="flex-1 truncate text-center text-[10px] text-slate-500">
            {d.label}
          </div>
        ))}
      </div>
    </div>
  )
}

export function GroupedBarChart({
  data,
  series,
  height = 200,
}: {
  data: Array<{ label: string; values: number[] }>
  series: Array<{ name: string; color: string }>
  height?: number
}) {
  const max = Math.max(1, ...data.flatMap((d) => d.values))
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} className="flex flex-1 items-end gap-0.5">
            {d.values.map((v, j) => {
              const h = Math.round((v / max) * (height - 30))
              return (
                <div
                  key={j}
                  className="flex-1 rounded-t"
                  style={{ height: Math.max(2, h), background: series[j].color }}
                  title={`${d.label} • ${series[j].name}: ${v}`}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        {data.map((d, i) => (
          <div key={i} className="flex-1 truncate text-center text-[10px] text-slate-500">
            {d.label}
          </div>
        ))}
      </div>
      <div className="flex gap-3 text-xs text-slate-600">
        {series.map((s) => (
          <div key={s.name} className="flex items-center gap-1">
            <span className="inline-block size-3 rounded" style={{ background: s.color }} />
            {s.name}
          </div>
        ))}
      </div>
    </div>
  )
}
