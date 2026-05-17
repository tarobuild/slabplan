import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  useNavigate,
} from "react-router-dom"
import { Toaster } from "sonner"
import { QueryClientProvider } from "@tanstack/react-query"
import AdminRoute from "@/components/AdminRoute"
import AppLayout from "@/components/layout/AppLayout"
import RoleGate from "@/components/auth/RoleGate"
import ErrorBoundary from "@/components/ErrorBoundary"
import { ROLE_GATES } from "@/lib/role-access"
import { FilePreviewProvider } from "@/components/files/file-preview-context"
import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { bootstrapAuthSession, FORBIDDEN_EVENT } from "@/lib/api"
import { configureApiClient, getQueryClient } from "@/lib/query-client"
import { useAuthStore } from "@/store/auth"

// Wire the generated react-query client (auth token getter, data-refresh
// bridge) before any components mount so the first query already has the
// configuration in place.
configureApiClient()
const queryClient = getQueryClient()

const ClientsPage = lazy(() => import("@/pages/clients"))
const ClientDetailPage = lazy(() => import("@/pages/client-detail"))
const HomePage = lazy(() => import("@/pages/home"))
const MissingLogsAtRiskPage = lazy(() => import("@/pages/at-risk/MissingLogsPage"))
const PendingChangeOrdersAtRiskPage = lazy(
  () => import("@/pages/at-risk/PendingChangeOrdersPage"),
)
const ForbiddenPage = lazy(() => import("@/pages/forbidden"))
const JobDailyLogsPage = lazy(() => import("@/pages/job-daily-logs"))
const JobDetailPage = lazy(() => import("@/pages/job-detail"))
const JobFilesDocumentsPage = lazy(() => import("@/pages/job-files-documents"))
const JobFilesPhotosPage = lazy(() => import("@/pages/job-files-photos"))
const JobFilesVideosPage = lazy(() => import("@/pages/job-files-videos"))
const JobSchedulePage = lazy(() => import("@/pages/job-schedule"))
const JobSummaryPage = lazy(() => import("@/pages/job-summary"))
const JobFinancialsPage = lazy(() => import("@/pages/job-financials"))
const JobsPage = lazy(() => import("@/pages/jobs"))
const LeadsPage = lazy(() => import("@/pages/leads"))
const LoginPage = lazy(() => import("@/pages/login"))
const RegisterPage = lazy(() => import("@/pages/register"))
const MyDailyLogsPage = lazy(() => import("@/pages/my-daily-logs"))
const CompanySchedulePage = lazy(() => import("@/pages/schedule"))
const CompanyDailyLogsPage = lazy(() => import("@/pages/daily-logs"))
const NotFoundPage = lazy(() => import("@/pages/not-found"))
const ResourcesPage = lazy(() => import("@/pages/resources"))
const ReportsLayout = lazy(() => import("@/pages/reports"))
const ReportsArAging = lazy(() => import("@/pages/reports/ar-aging"))
const ReportsRevenue = lazy(() => import("@/pages/reports/revenue"))
const ReportsPipeline = lazy(() => import("@/pages/reports/pipeline"))
const ReportsDaysToPayment = lazy(() => import("@/pages/reports/days-to-payment"))
const ReportsJobsByStage = lazy(() => import("@/pages/reports/jobs-by-stage"))
const SettingsLayout = lazy(() => import("@/pages/settings/SettingsLayout"))
const ProfileSection = lazy(() => import("@/pages/settings/ProfileSection"))
const PasswordSection = lazy(() => import("@/pages/settings/PasswordSection"))
const TokensSection = lazy(() => import("@/pages/settings/TokensSection"))
const NotificationsSection = lazy(() => import("@/pages/settings/NotificationsSection"))
const CompanySection = lazy(() => import("@/pages/settings/CompanySection"))
const BillingSection = lazy(() => import("@/pages/settings/BillingSection"))
const IntegrationsSection = lazy(() => import("@/pages/settings/IntegrationsSection"))
const DiagnosticsSection = lazy(() => import("@/pages/settings/DiagnosticsSection"))
const UsersPage = lazy(() => import("@/pages/users"))
const AcceptInvitePage = lazy(() => import("@/pages/accept-invite"))

function RouteLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] p-4">
      <Card className="w-full max-w-md border-[#E5E7EB] shadow-sm">
        <CardContent className="flex items-center justify-center gap-3 py-10">
          <Spinner className="size-5 text-orange-600" />
          <p className="text-sm text-slate-600">Restoring your session…</p>
        </CardContent>
      </Card>
    </div>
  )
}

function ProtectedRoute({ ready }: { ready: boolean }) {
  const user = useAuthStore((state) => state.user)

  if (!ready) {
    return <RouteLoadingScreen />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

function FilesRedirect() {
  const user = useAuthStore((state) => state.user)
  const target =
    user?.role === "admin" ? "/clients" : "/jobs"
  return <Navigate to={target} replace />
}

function ForbiddenListener() {
  const navigate = useNavigate()

  useEffect(() => {
    function handleForbidden() {
      navigate("/403", { replace: true })
    }

    window.addEventListener(FORBIDDEN_EVENT, handleForbidden)
    return () => {
      window.removeEventListener(FORBIDDEN_EVENT, handleForbidden)
    }
  }, [navigate])

  return null
}

function RootShell() {
  return (
    <FilePreviewProvider>
      <ForbiddenListener />
      <Suspense fallback={<RouteLoadingScreen />}>
        <Outlet />
      </Suspense>
    </FilePreviewProvider>
  )
}

function PublicOnlyRoute({ ready }: { ready: boolean }) {
  const user = useAuthStore((state) => state.user)

  if (!ready) {
    return <RouteLoadingScreen />
  }

  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

function buildRouter(ready: boolean, basename: string | undefined) {
  return createBrowserRouter(
    createRoutesFromElements(
      <Route element={<RootShell />}>
        <Route element={<PublicOnlyRoute ready={ready} />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
        </Route>

        <Route element={<ProtectedRoute ready={ready} />}>
          <Route element={<AppLayout />}>
            {/*
              Home is role-aware (Task #321): crew gets "My Day", PM gets
              "This Week", admin gets "Business Pulse". Both `/` and
              `/dashboard` render it.
            */}
            <Route path="/" element={<HomePage />} />
            <Route path="/dashboard" element={<HomePage />} />
            <Route path="/daily-logs/mine" element={<MyDailyLogsPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route element={<RoleGate allow={ROLE_GATES.companyViews} redirectTo="/403" />}>
              <Route
                path="/at-risk/missing-logs"
                element={<MissingLogsAtRiskPage />}
              />
              <Route
                path="/at-risk/pending-change-orders"
                element={<PendingChangeOrdersAtRiskPage />}
              />
            </Route>
            <Route path="/resources" element={<ResourcesPage />} />
            {/*
              Top-level Files routes were removed in #318. Files are now
              accessed per-job (see /jobs/:jobId/files/*). Redirect any
              lingering links so bookmarks don't 404 — admins land on
              /clients, field users land on /jobs.
            */}
            <Route path="/files" element={<FilesRedirect />} />
            <Route path="/files/documents" element={<FilesRedirect />} />
            <Route path="/files/photos" element={<FilesRedirect />} />
            <Route path="/files/videos" element={<FilesRedirect />} />
            <Route path="/jobs/:jobId" element={<JobDetailPage />}>
              <Route index element={<Navigate to="daily-logs" replace />} />
              <Route path="summary" element={<JobSummaryPage />} />
              <Route path="files/documents" element={<JobFilesDocumentsPage />} />
              <Route path="files/photos" element={<JobFilesPhotosPage />} />
              <Route path="files/videos" element={<JobFilesVideosPage />} />
              <Route path="schedule" element={<JobSchedulePage />} />
              <Route path="daily-logs" element={<JobDailyLogsPage />} />
              <Route path="financials" element={<JobFinancialsPage />} />
            </Route>
            <Route element={<RoleGate allow={ROLE_GATES.sales} />}>
              <Route path="/sales" element={<LeadsPage />} />
              <Route path="/sales/leads" element={<LeadsPage />} />
            </Route>
            <Route element={<RoleGate allow={ROLE_GATES.clients} />}>
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/clients/:clientId" element={<ClientDetailPage />} />
            </Route>
            <Route element={<RoleGate allow={ROLE_GATES.reports} redirectTo="/403" />}>
              <Route path="/reports" element={<ReportsLayout />}>
                <Route index element={<Navigate to="ar-aging" replace />} />
                <Route path="ar-aging" element={<ReportsArAging />} />
                <Route path="revenue" element={<ReportsRevenue />} />
                <Route path="pipeline" element={<ReportsPipeline />} />
                <Route path="days-to-payment" element={<ReportsDaysToPayment />} />
                <Route path="jobs-by-stage" element={<ReportsJobsByStage />} />
              </Route>
            </Route>
            <Route element={<RoleGate allow={ROLE_GATES.companyViews} redirectTo="/403" />}>
              <Route path="/schedule" element={<CompanySchedulePage />} />
              <Route path="/daily-logs" element={<CompanyDailyLogsPage />} />
            </Route>
            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="/settings/profile" replace />} />
              <Route path="profile" element={<ProfileSection />} />
              <Route path="password" element={<PasswordSection />} />
              <Route path="notifications" element={<NotificationsSection />} />
              <Route path="tokens" element={<TokensSection />} />
              <Route element={<AdminRoute />}>
                <Route path="team" element={<UsersPage />} />
                <Route path="company" element={<CompanySection />} />
                <Route path="billing" element={<BillingSection />} />
                <Route path="integrations" element={<IntegrationsSection />} />
                <Route path="diagnostics" element={<DiagnosticsSection />} />
              </Route>
            </Route>
            <Route path="/billing" element={<Navigate to="/settings/billing" replace />} />
            <Route path="/billing/success" element={<Navigate to="/settings/billing" replace />} />
            {/* Backward-compat redirect: the standalone /settings/users
                route was moved into the new Settings shell as
                /settings/team. Keep the old URL working for bookmarks
                and any external links that still point at it. */}
            <Route
              path="/settings/users"
              element={<Navigate to="/settings/team" replace />}
            />
            <Route path="/403" element={<ForbiddenPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Route>,
    ),
    { basename },
  )
}

function App() {
  const [ready, setReady] = useState(false)
  const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined

  useEffect(() => {
    let active = true

    void bootstrapAuthSession().finally(() => {
      if (active) {
        setReady(true)
      }
    })

    return () => {
      active = false
    }
  }, [])

  // The router is rebuilt when `ready` flips so the route guards see the
  // latest auth state. `basename` is stable for the app lifetime.
  const router = useMemo(() => buildRouter(ready, basename), [ready, basename])

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster
          position="top-right"
          duration={4000}
          richColors
          closeButton
          toastOptions={{
            classNames: {
              toast: "border border-[#E5E7EB] bg-white text-slate-900 shadow-lg",
              description: "text-slate-500",
            },
          }}
        />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
