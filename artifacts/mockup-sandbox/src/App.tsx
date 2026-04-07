import { useEffect } from "react"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import { Toaster } from "sonner"
import {
  DashboardPage,
  DailyLogsPage,
  LoginPage,
  NotFoundPage,
  RegisterPage,
  RootRedirect,
  SalesLeadsPage,
  SchedulePage,
  SettingsPage,
  routeElements,
} from "@/pages"
import {
  FilesDocumentsPage,
  FilesPhotosPage,
  FilesVideosPage,
  JobSummaryPage,
  JobsPage,
} from "@/job-pages"
import { bootstrapAuth } from "@/store/auth"

function SessionBootstrapper() {
  useEffect(() => {
    void bootstrapAuth()
  }, [])

  return null
}

function App() {
  return (
    <BrowserRouter>
      <SessionBootstrapper />

      <Routes>
        <Route element={<routeElements.PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route element={<routeElements.RequireAuth />}>
          <Route element={<routeElements.GlobalShell />}>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/sales/leads" element={<SalesLeadsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          <Route path="/jobs/:jobId" element={<routeElements.JobShell />}>
            <Route index element={<JobSummaryPage />} />
            <Route path="files/documents" element={<FilesDocumentsPage />} />
            <Route path="files/photos" element={<FilesPhotosPage />} />
            <Route path="files/videos" element={<FilesVideosPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="daily-logs" element={<DailyLogsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>

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
