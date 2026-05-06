import { useEffect, useState } from "react"
import { dashboardGetDashboardHome } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { toastApiError } from "@/lib/api-errors"
import { useAuthStore } from "@/store/auth"
import { useDocumentTitle } from "@/hooks/use-document-title"
import AdminHomePage from "./AdminHomePage"
import MyDayPage from "./MyDayPage"
import PMHomePage from "./PMHomePage"
import type { AdminHome, CrewHome, HomePayload, PmHome } from "./types"

// One endpoint, three layouts. The backend already discriminates the
// payload by role (`crew | pm | admin`); this component just dispatches to
// the matching React tree. Falling back to MyDayPage for unknown shapes
// keeps the page from blanking if the user role and payload role somehow
// disagree (e.g. mid-deploy).
export default function HomePage() {
  const user = useAuthStore((state) => state.user)
  const [data, setData] = useState<HomePayload | null>(null)
  const [loading, setLoading] = useState(true)

  useDocumentTitle("Home — CAD Stone Networks")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(dashboardGetDashboardHome() as Promise<HomePayload>)
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch((err: unknown) => {
        if (!cancelled) toastApiError(err, "Failed to load Home")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  if (loading || !data) {
    return (
      <div className="space-y-4" data-testid="home-loading">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Card className="border-[#E5E7EB]">
          <CardContent className="space-y-2 py-6">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (data.role === "admin") return <AdminHomePage data={data as AdminHome} />
  if (data.role === "pm") return <PMHomePage data={data as PmHome} />
  return <MyDayPage data={data as CrewHome} />
}
