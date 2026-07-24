import { useEffect } from "react"
import { Link } from "react-router-dom"
import { useDashboardGetDashboardHome } from "@workspace/api-client-react"
import { ArrowLeft, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { toastApiError } from "@/lib/api-errors"
import type { PmHome } from "../home/types"

type MissingLogsAtRiskContentProps = {
  payload: unknown
  loading: boolean
  error: unknown
  onRetry?: () => void
}

// Drill-down list for the PM Home "Jobs missing logs (3+ working days)"
// at-risk tile. The /dashboard/home payload already returns the full set
// of missing-log jobs in `atRisk.samples.missingLogJobs` (capped well
// above any realistic at-risk cohort), so this page renders directly
// from that payload rather than hitting a dedicated list endpoint.
export default function MissingLogsAtRiskPage() {
  useDocumentTitle("Jobs missing logs — At-risk")
  const { data: payload, isLoading: loading, error, refetch } = useDashboardGetDashboardHome()

  useEffect(() => {
    if (error) toastApiError(error, "Failed to load at-risk list")
  }, [error])

  return (
    <MissingLogsAtRiskContent
      payload={payload}
      loading={loading}
      error={error}
      onRetry={() => void refetch()}
    />
  )
}

export function MissingLogsAtRiskContent({
  payload,
  loading,
  error,
  onRetry,
}: MissingLogsAtRiskContentProps) {
  const data = payload && typeof payload === "object" && "role" in payload && payload.role === "pm"
    ? (payload as PmHome)
    : null
  const notPm = !!payload && typeof payload === "object" && "role" in payload && payload.role !== "pm"
  const failedWithoutPayload = !!error && !payload

  return (
    <div className="space-y-4" data-testid="at-risk-missing-logs">
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link to="/" aria-label="Back to Home">
            <ArrowLeft className="mr-1.5 size-4" /> Home
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Jobs missing daily logs
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Open jobs whose latest daily log is more than 3 working days old.
        </p>
      </div>

      <Card className="border-[#E5E7EB]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 text-amber-600" />
            {loading
              ? "Loading…"
              : `${data?.atRisk.jobsMissingLogs ?? 0} jobs need attention`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <>
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </>
          ) : notPm ? (
            <p className="rounded-md border border-dashed border-[#E5E7EB] p-4 text-center text-sm text-slate-500">
              This list is only available to project managers.
            </p>
          ) : failedWithoutPayload ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700">
              <p>We couldn't load this at-risk list.</p>
              {onRetry ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={onRetry}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : !data || data.atRisk.samples.missingLogJobs.length === 0 ? (
            <p className="rounded-md border border-dashed border-[#E5E7EB] p-4 text-center text-sm text-slate-500">
              All open jobs have a recent daily log. Nice work.
            </p>
          ) : (
            <>
              {data.atRisk.jobsMissingLogs >
              data.atRisk.samples.missingLogJobs.length ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Showing {data.atRisk.samples.missingLogJobs.length} sampled
                  jobs out of {data.atRisk.jobsMissingLogs}. Return to Home or
                  reports for the full cohort.
                </p>
              ) : null}
              {data.atRisk.samples.missingLogJobs.map((job) => (
                <Link
                  key={job.id}
                  to={`/jobs/${job.id}/daily-logs`}
                  className="flex items-center justify-between gap-3 rounded-md border border-[#E5E7EB] px-3 py-2.5 transition hover:border-amber-300 hover:bg-amber-50/40"
                  data-testid="at-risk-missing-logs-row"
                >
                  <span className="truncate text-sm font-medium text-slate-900">
                    {job.title}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    Open daily logs →
                  </span>
                </Link>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
