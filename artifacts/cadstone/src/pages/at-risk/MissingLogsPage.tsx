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

// Drill-down list for the PM Home "Jobs missing logs (3+ working days)"
// at-risk tile. The /dashboard/home payload already returns the full set
// of missing-log jobs in `atRisk.samples.missingLogJobs` (capped well
// above any realistic at-risk cohort), so this page renders directly
// from that payload rather than hitting a dedicated list endpoint.
export default function MissingLogsAtRiskPage() {
  useDocumentTitle("Jobs missing logs — At-risk")
  const { data: payload, isLoading: loading, error } = useDashboardGetDashboardHome()
  const data = payload && payload.role === "pm" ? (payload as PmHome) : null
  const notPm = !!payload && payload.role !== "pm"

  useEffect(() => {
    if (error) toastApiError(error, "Failed to load at-risk list")
  }, [error])

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
          ) : !data || data.atRisk.samples.missingLogJobs.length === 0 ? (
            <p className="rounded-md border border-dashed border-[#E5E7EB] p-4 text-center text-sm text-slate-500">
              All open jobs have a recent daily log. Nice work.
            </p>
          ) : (
            data.atRisk.samples.missingLogJobs.map((job) => (
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
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
