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

// Drill-down list for the PM Home "Pending change orders" at-risk tile.
// Renders sampled rows from /dashboard/home and warns clearly when the
// aggregate pending-change-order count exceeds the rendered sample.
export default function PendingChangeOrdersAtRiskPage() {
  useDocumentTitle("Pending change orders — At-risk")
  const { data: payload, isLoading: loading, error } = useDashboardGetDashboardHome()
  const data = payload && payload.role === "pm" ? (payload as PmHome) : null
  const notPm = !!payload && payload.role !== "pm"
  const loadFailed = !!error && !payload

  useEffect(() => {
    if (error) toastApiError(error, "Failed to load at-risk list")
  }, [error])

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
          ) : loadFailed ? (
            <p className="rounded-md border border-dashed border-red-200 bg-red-50 p-4 text-center text-sm text-red-700">
              Could not load this at-risk list. Please retry from Home.
            </p>
          ) : notPm ? (
            <p className="rounded-md border border-dashed border-[#E5E7EB] p-4 text-center text-sm text-slate-500">
              This list is only available to project managers.
            </p>
          ) : !data || data.atRisk.samples.pendingChangeOrders.length === 0 ? (
            <p className="rounded-md border border-dashed border-[#E5E7EB] p-4 text-center text-sm text-slate-500">
              No pending change orders.
            </p>
          ) : (
            <>
              {data.atRisk.pendingChangeOrders > data.atRisk.samples.pendingChangeOrders.length ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Showing {data.atRisk.samples.pendingChangeOrders.length} sampled change orders out of {data.atRisk.pendingChangeOrders}. Open the job financials report for the full list.
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
