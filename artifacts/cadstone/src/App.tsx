import { useEffect, useMemo, useState } from "react"
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
import AppLayout from "@/components/layout/AppLayout"
import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { bootstrapAuthSession, FORBIDDEN_EVENT } from "@/lib/api"
import ClientsPage from "@/pages/clients"
import DashboardPage from "@/pages/dashboard"
import FilesDocumentsPage from "@/pages/files-documents"
import FilesPhotosPage from "@/pages/files-photos"
import FilesVideosPage from "@/pages/files-videos"
import ForbiddenPage from "@/pages/forbidden"
import JobDailyLogsPage from "@/pages/job-daily-logs"
import JobDetailPage from "@/pages/job-detail"
import JobFilesDocumentsPage from "@/pages/job-files-documents"
import JobFilesPhotosPage from "@/pages/job-files-photos"
import JobFilesVideosPage from "@/pages/job-files-videos"
import JobSchedulePage from "@/pages/job-schedule"
import JobSummaryPage from "@/pages/job-summary"
import JobsPage from "@/pages/jobs"
import LeadsPage from "@/pages/leads"
import LoginPage from "@/pages/login"
import MyDailyLogsPage from "@/pages/my-daily-logs"
import NotFoundPage from "@/pages/not-found"
import ResourcesPage from "@/pages/resources"
import SettingsPage from "@/pages/settings"
import { useAuthStore } from "@/store/auth"

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
    <>
      <ForbiddenListener />
      <Outlet />
    </>
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
            <Route path="/sales" element={<LeadsPage />} />
            <Route path="/sales/leads" element={<LeadsPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
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
    <>
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
    </>
  )
}

export default App
