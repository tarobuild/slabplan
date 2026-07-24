import { useEffect } from "react"
import { Link } from "react-router-dom"
import { useDashboardGetDashboardHome } from "@workspace/api-client-react"
import { ArrowLeft, FileSignature } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { toastApiError } from "@/lib/api-errors"
import { formatCents, type PmHome } from "../home/types"

type PendingChangeOrdersAtRiskContentProps = {
  payload: unknown
  loading: boolean
  error: unknown
  onRetry?: () => void
}

// Drill-down list for the PM Home "Pending change orders" at-risk tile.
// Renders directly from /dashboard/home so we don't have to introduce a
// dedicated cross-job change-orders endpoint just for this page.
export default function PendingChangeOrdersAtRiskPage() {
  useDocumentTitle("Pending change orders — At-risk")
  const { data: payload, isLoading: loading, error, refetch } = useDashboardGetDashboardHome()

  useEffect(() => {
    if (error) toastApiError(error, "Failed to load at-risk list")
  }, [error])

  return (
    <PendingChangeOrdersAtRiskContent
      payload={payload}
      loading={loading}
      error={error}
      onRetry={() => void refetch()}
    />
  )
}

export function PendingChangeOrdersAtRiskContent({
  payload,
  loading,
  error,
  onRetry,
}: PendingChangeOrdersAtRiskContentProps) {
  const data = payload && typeof payload === "object" && "role" in payload && payload.role === "pm"
    ? (payload as PmHome)
    : null
  const notPm = !!payload && typeof payload === "object" && "role" in payload && payload.role !== "pm"
  const failedWithoutPayload = !!error && !payload

  return (
    <div className="space-y-4" data-testid="at-risk-pending-cos">
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link to="/" aria-label="Back to Home">
            <ArrowLeft className="mr-1.5 size-4" /> Home
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Pending change orders
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Change orders awaiting approval across all open jobs.
        </p>
      </div>

      <Card className="border-[#E5E7EB]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="size-4 text-amber-600" />
            {loading
              ? "Loading…"
              : `${data?.atRisk.pendingChangeOrders ?? 0} pending`}
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
          ) : !data || data.atRisk.samples.pendingChangeOrders.length === 0 ? (
            <p className="rounded-md border border-dashed border-[#E5E7EB] p-4 text-center text-sm text-slate-500">
              No pending change orders.
            </p>
          ) : (
            <>
              {data.atRisk.pendingChangeOrders >
              data.atRisk.samples.pendingChangeOrders.length ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Showing {data.atRisk.samples.pendingChangeOrders.length}{" "}
                  sampled change orders out of {data.atRisk.pendingChangeOrders}.
                  Open the job financials report for the full list.
                </p>
              ) : null}
              {data.atRisk.samples.pendingChangeOrders.map((co) => (
                <Link
                  key={co.id}
                  to={`/jobs/${co.jobId}/financials`}
                  className="flex items-center justify-between gap-3 rounded-md border border-[#E5E7EB] px-3 py-2.5 transition hover:border-amber-300 hover:bg-amber-50/40"
                  data-testid="at-risk-pending-co-row"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      #{co.number}
                      {co.jobTitle ? ` — ${co.jobTitle}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatCents(co.amountCents)}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">
                    Open financials →
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
