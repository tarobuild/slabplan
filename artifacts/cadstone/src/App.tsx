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
const DashboardPage = lazy(() => import("@/pages/dashboard"))
const FilesDocumentsPage = lazy(() => import("@/pages/files-documents"))
const FilesPhotosPage = lazy(() => import("@/pages/files-photos"))
const FilesVideosPage = lazy(() => import("@/pages/files-videos"))
const ForbiddenPage = lazy(() => import("@/pages/forbidden"))
const JobDailyLogsPage = lazy(() => import("@/pages/job-daily-logs"))
const JobDetailPage = lazy(() => import("@/pages/job-detail"))
const JobFilesDocumentsPage = lazy(() => import("@/pages/job-files-documents"))
const JobFilesPhotosPage = lazy(() => import("@/pages/job-files-photos"))
const JobFilesVideosPage = lazy(() => import("@/pages/job-files-videos"))
const JobSchedulePage = lazy(() => import("@/pages/job-schedule"))
const JobSummaryPage = lazy(() => import("@/pages/job-summary"))
const JobsPage = lazy(() => import("@/pages/jobs"))
const LeadsPage = lazy(() => import("@/pages/leads"))
const LoginPage = lazy(() => import("@/pages/login"))
const MyDailyLogsPage = lazy(() => import("@/pages/my-daily-logs"))
const NotFoundPage = lazy(() => import("@/pages/not-found"))
const ResourcesPage = lazy(() => import("@/pages/resources"))
const SettingsPage = lazy(() => import("@/pages/settings"))
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
          <Route path="/register" element={<Navigate to="/login" replace />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
        </Route>

        <Route element={<ProtectedRoute ready={ready} />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/daily-logs/mine" element={<MyDailyLogsPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/resources" element={<ResourcesPage />} />
            <Route path="/files/documents" element={<FilesDocumentsPage />} />
            <Route path="/files/photos" element={<FilesPhotosPage />} />
            <Route path="/files/videos" element={<FilesVideosPage />} />
            <Route path="/jobs/:jobId" element={<JobDetailPage />}>
              <Route index element={<Navigate to="daily-logs" replace />} />
              <Route path="summary" element={<JobSummaryPage />} />
              <Route path="files/documents" element={<JobFilesDocumentsPage />} />
              <Route path="files/photos" element={<JobFilesPhotosPage />} />
              <Route path="files/videos" element={<JobFilesVideosPage />} />
              <Route path="schedule" element={<JobSchedulePage />} />
              <Route path="daily-logs" element={<JobDailyLogsPage />} />
            </Route>
            <Route element={<RoleGate allow={ROLE_GATES.sales} />}>
              <Route path="/sales" element={<LeadsPage />} />
              <Route path="/sales/leads" element={<LeadsPage />} />
            </Route>
            <Route element={<RoleGate allow={ROLE_GATES.clients} />}>
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/clients/:clientId" element={<ClientDetailPage />} />
            </Route>
            <Route path="/settings" element={<SettingsPage />} />
            <Route element={<AdminRoute />}>
              <Route path="/settings/users" element={<UsersPage />} />
            </Route>
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
  )
}

export default App
