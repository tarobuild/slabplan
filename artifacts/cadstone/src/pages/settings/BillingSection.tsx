import { useEffect } from "react"
import {
  CheckCircle2,
  CreditCard,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import {
  BillingGetStatus200PlansItem,
  useBillingGetStatus,
  useBillingPostCheckoutSessions,
  useBillingPostCustomerPortalSessions,
} from "@workspace/api-client-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { toastApiError } from "@/lib/api-errors"
import { cn } from "@/lib/utils"

function formatPlanStatus(value: string | null) {
  if (!value) return "Not subscribed"
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function PlanCard({
  plan,
  active,
  disabled,
  busy,
  onSelect,
}: {
  plan: BillingGetStatus200PlansItem
  active: boolean
  disabled: boolean
  busy: boolean
  onSelect: () => void
}) {
  return (
    <section
      className={cn(
        "flex min-h-[360px] flex-col rounded-lg border bg-white p-5 shadow-sm",
        active ? "border-orange-300 ring-1 ring-orange-200" : "border-slate-200",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{plan.name}</h3>
          <p className="mt-1 text-sm text-slate-500">Up to {plan.maxUsers} users</p>
        </div>
        {active ? (
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">
            Current
          </Badge>
        ) : null}
      </div>

      <div className="mt-5 flex items-end gap-1">
        <span className="text-3xl font-semibold text-slate-950">
          ${plan.monthlyUsd}
        </span>
        <span className="pb-1 text-sm text-slate-500">/mo</span>
      </div>

      <ul className="mt-5 flex-1 space-y-3">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-2 text-sm text-slate-700">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        className="mt-6 w-full"
        variant={active ? "outline" : "default"}
        disabled={disabled || active || busy || !plan.configured}
        onClick={onSelect}
      >
        {busy ? "Opening Stripe..." : active ? "Selected" : "Choose plan"}
      </Button>
    </section>
  )
}

export default function BillingSection() {
  useDocumentTitle("Billing · Settings")
  const statusQuery = useBillingGetStatus()
  const checkoutMutation = useBillingPostCheckoutSessions({
    mutation: {
      onSuccess: ({ url }) => {
        window.location.assign(url)
      },
      onError: (error) => {
        toastApiError(error, "Could not open Stripe Checkout.")
      },
    },
  })
  const portalMutation = useBillingPostCustomerPortalSessions({
    mutation: {
      onSuccess: ({ url }) => {
        window.location.assign(url)
      },
      onError: (error) => {
        toastApiError(error, "Could not open the billing portal.")
      },
    },
  })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const checkout = params.get("checkout")
    if (checkout === "success") {
      toast.success("Stripe checkout completed")
      window.history.replaceState(null, "", "/settings/billing")
      void statusQuery.refetch()
    } else if (checkout === "cancelled") {
      toast.info("Stripe checkout cancelled")
      window.history.replaceState(null, "", "/settings/billing")
    }
  }, [statusQuery])

  const data = statusQuery.data
  const currentPlan = data?.organization.planKey ?? null
  const hasStripeCustomer = Boolean(data?.organization.hasStripeCustomer)
  const mutationBusy = checkoutMutation.isPending || portalMutation.isPending

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] px-6 py-5">
          <div className="flex items-center gap-2.5">
            <CreditCard className="size-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-800">Billing</h2>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void statusQuery.refetch()}
            disabled={statusQuery.isFetching}
          >
            <RefreshCw
              className={cn("size-4", statusQuery.isFetching && "animate-spin")}
            />
            Refresh
          </Button>
        </div>

        <div className="space-y-6 px-6 py-6">
          {statusQuery.isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <div className="grid gap-3 lg:grid-cols-3">
                <Skeleton className="h-80" />
                <Skeleton className="h-80" />
                <Skeleton className="h-80" />
              </div>
            </div>
          ) : statusQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Billing unavailable</AlertTitle>
              <AlertDescription>
                Refresh the page or try again after the API is healthy.
              </AlertDescription>
            </Alert>
          ) : data ? (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Workspace
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {data.organization.name}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Subscription
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {formatPlanStatus(data.organization.subscriptionStatus)}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Billing email
                  </p>
                  <p className="mt-2 truncate text-sm font-semibold text-slate-900">
                    {data.organization.billingEmail ?? "Not set"}
                  </p>
                </div>
              </div>

              {!data.billingConfigured ? (
                <Alert>
                  <ShieldCheck className="size-4" />
                  <AlertTitle>Stripe is not configured</AlertTitle>
                  <AlertDescription>
                    Plan selection is disabled until Stripe keys and price IDs are
                    installed in this environment.
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-3">
                {data.plans.map((plan) => (
                  <PlanCard
                    key={plan.key}
                    plan={plan}
                    active={currentPlan === plan.key}
                    disabled={!data.billingConfigured}
                    busy={checkoutMutation.isPending}
                    onSelect={() =>
                      checkoutMutation.mutate({ data: { planKey: plan.key } })
                    }
                  />
                ))}
              </div>

              <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3">
                  <Users className="mt-0.5 size-4 shrink-0 text-slate-500" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      Manage invoices, payment method, and subscription
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Opens Stripe customer portal for this workspace.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!hasStripeCustomer || mutationBusy}
                  onClick={() => portalMutation.mutate()}
                >
                  <ExternalLink className="size-4" />
                  Open portal
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
