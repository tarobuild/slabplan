import { useEffect } from "react"
import { useDashboardGetDashboardHome } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { toastApiError } from "@/lib/api-errors"
import { useAuthStore } from "@/store/auth"
import { useDocumentTitle } from "@/hooks/use-document-title"
import AdminHomePage from "./AdminHomePage"
import DrafterHomePage from "./DrafterHomePage"
import MyDayPage from "./MyDayPage"
import PMHomePage from "./PMHomePage"
import type { AdminHome, CrewHome, DrafterHome, PmHome } from "./types"

// One endpoint, three layouts. The backend already discriminates the
// payload by role (`crew | pm | drafter | admin`); this component dispatches to
// the matching React tree. Falling back to MyDayPage for unknown shapes
// keeps the page from blanking if the user role and payload role somehow
// disagree (e.g. mid-deploy).
export default function HomePage() {
  const user = useAuthStore((state) => state.user)
  const { data, isLoading, error } = useDashboardGetDashboardHome({
    query: { queryKey: ["dashboard-home", user?.id ?? "anon"] },
  })

  useDocumentTitle("Home")

  useEffect(() => {
    if (error) toastApiError(error, "Failed to load Home")
  }, [error])

  if (error && !data) {
    return (
      <Card className="border-red-200 bg-red-50" role="alert">
        <CardContent className="py-6 text-sm text-red-800">
          Home could not be loaded. Please refresh the page or try again in a moment.
        </CardContent>
      </Card>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6" data-testid="home-loading" aria-busy="true" aria-label="Loading Home">
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-56" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-[116px] rounded-lg" />
          <Skeleton className="h-[116px] rounded-lg" />
          <Skeleton className="h-[116px] rounded-lg" />
          <Skeleton className="hidden h-[116px] rounded-lg xl:block" />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardContent className="space-y-3 py-6">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-5/6" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 py-6">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (data.role === "admin") return <AdminHomePage data={data as AdminHome} />
  if (data.role === "pm") return <PMHomePage data={data as PmHome} />
  if (data.role === "drafter") return <DrafterHomePage data={data as DrafterHome} />
  return <MyDayPage data={data as CrewHome} />
}
