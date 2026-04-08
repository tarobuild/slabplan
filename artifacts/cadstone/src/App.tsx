import { useEffect, useState } from "react"
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom"
import { Toaster } from "sonner"
import AppLayout from "@/components/layout/AppLayout"
import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { bootstrapAuthSession } from "@/lib/api"
import ClientsPage from "@/pages/clients"
import DashboardPage from "@/pages/dashboard"
import FilesDocumentsPage from "@/pages/files-documents"
import FilesPhotosPage from "@/pages/files-photos"
import FilesVideosPage from "@/pages/files-videos"
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
import RegisterPage from "@/pages/register"
import SettingsPage from "@/pages/settings"
import { useAuthStore } from "@/store/auth"

function RouteLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] p-4">
      <Card className="w-full max-w-md border-[#E5E7EB] shadow-sm">
        <CardContent className="flex items-center justify-center gap-3 py-10">
          <Spinner className="size-5 text-blue-600" />
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

function AppRoutes({ ready }: { ready: boolean }) {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute ready={ready} />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute ready={ready} />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/daily-logs/mine" element={<MyDailyLogsPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/files/documents" element={<FilesDocumentsPage />} />
          <Route path="/files/photos" element={<FilesPhotosPage />} />
          <Route path="/files/videos" element={<FilesVideosPage />} />
          <Route path="/jobs/:jobId" element={<JobDetailPage />}>
            <Route index element={<Navigate to="schedule" replace />} />
            <Route path="summary" element={<JobSummaryPage />} />
            <Route path="files/documents" element={<JobFilesDocumentsPage />} />
            <Route path="files/photos" element={<JobFilesPhotosPage />} />
            <Route path="files/videos" element={<JobFilesVideosPage />} />
            <Route path="schedule" element={<JobSchedulePage />} />
            <Route path="daily-logs" element={<JobDailyLogsPage />} />
          </Route>
          <Route path="/sales/leads" element={<LeadsPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
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

  return (
    <BrowserRouter basename={basename}>
      <AppRoutes ready={ready} />
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
    </BrowserRouter>
  )
}

export default App
