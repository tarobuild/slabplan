import { useReportsGetReportsDaysToPayment } from "@workspace/api-client-react"
import {
  EmptyState,
  LoadingCard,
  ReportSection,
  ReportToolbar,
  csvDownloadHref,
  rangeToReportParams,
  useReportRange,
} from "./shared"

type Bucket = {
  id: string
  label: string
  count: number
  avgDays: number
  p90Days: number
}

export default function DaysToPaymentReport() {
  const [range, setRange] = useReportRange()
  const q = useReportsGetReportsDaysToPayment(rangeToReportParams(range))
  const empty = q.data && q.data.byClient.length === 0 && q.data.byJobType.length === 0

  return (
    <>
      <ReportToolbar
        value={range}
        onChange={setRange}
        csvHref={csvDownloadHref("days-to-payment", range)}
        csvFilename="days-to-payment.csv"
      />
      {q.isLoading ? (
        <LoadingCard />
      ) : q.isError ? (
        <EmptyState title="Couldn't load days-to-payment" />
      ) : empty ? (
        <EmptyState
          title="No paid invoices in this range"
          hint="Apply payments to invoices to track how long collection takes."
        />
      ) : (
        <>
          <ReportSection title="By Client">
            <BucketTable buckets={q.data?.byClient ?? []} />
          </ReportSection>
          <ReportSection title="By Job Type">
            <BucketTable buckets={q.data?.byJobType ?? []} />
          </ReportSection>
        </>
      )}
    </>
  )
}

function BucketTable({ buckets }: { buckets: Bucket[] }) {
  if (!buckets.length) {
    return <div className="text-sm text-slate-500">No data.</div>
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b text-left text-xs uppercase text-slate-500">
          <th className="px-3 py-2">Label</th>
          <th className="px-3 py-2 text-right">Invoices</th>
          <th className="px-3 py-2 text-right">Avg days</th>
          <th className="px-3 py-2 text-right">p90 days</th>
        </tr>
      </thead>
      <tbody>
        {buckets.map((b) => (
          <tr key={b.id} className="border-b last:border-b-0">
            <td className="px-3 py-2 font-medium text-slate-800">{b.label}</td>
            <td className="px-3 py-2 text-right">{b.count}</td>
            <td className="px-3 py-2 text-right">{b.avgDays}</td>
            <td className="px-3 py-2 text-right">{b.p90Days}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
