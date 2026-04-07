import { useEffect, type ReactNode } from "react"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import { Toaster } from "sonner"
import {
  DashboardPage,
  LoginPage,
  NotFoundPage,
  RegisterPage,
  RootRedirect,
  SettingsPage,
  routeElements,
} from "@/pages"
import { SalesLeadsPage } from "@/sales-pages"
import { SchedulePage } from "@/schedule-page"
import { DailyLogsPage } from "@/daily-log-pages"
import {
  FilesDocumentsPage,
  FilesPhotosPage,
  FilesVideosPage,
  JobSummaryPage,
  JobsPage,
} from "@/job-pages"
import { RouteErrorBoundary } from "@/components/route-error-boundary"
import { bootstrapAuth } from "@/store/auth"

function SessionBootstrapper() {
  useEffect(() => {
    void bootstrapAuth()
  }, [])

  return null
}

function App() {
  const withBoundary = (title: string, element: ReactNode) => (
    <RouteErrorBoundary title={title}>{element}</RouteErrorBoundary>
  )

  return (
    <BrowserRouter>
      <SessionBootstrapper />

      <Routes>
        <Route element={<routeElements.PublicOnlyRoute />}>
          <Route path="/login" element={withBoundary("Login", <LoginPage />)} />
          <Route path="/register" element={withBoundary("Register", <RegisterPage />)} />
        </Route>

        <Route element={<routeElements.RequireAuth />}>
          <Route element={withBoundary("App Shell", <routeElements.GlobalShell />)}>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/dashboard" element={withBoundary("Dashboard", <DashboardPage />)} />
            <Route path="/jobs" element={withBoundary("Jobs", <JobsPage />)} />
            <Route
              path="/sales/leads"
              element={withBoundary("Lead Opportunities", <SalesLeadsPage />)}
            />
            <Route path="/settings" element={withBoundary("Settings", <SettingsPage />)} />
          </Route>

          <Route path="/jobs/:jobId" element={withBoundary("Job", <routeElements.JobShell />)}>
            <Route index element={withBoundary("Job Summary", <JobSummaryPage />)} />
            <Route
              path="files/documents"
              element={withBoundary("Documents", <FilesDocumentsPage />)}
            />
            <Route path="files/photos" element={withBoundary("Photos", <FilesPhotosPage />)} />
            <Route path="files/videos" element={withBoundary("Videos", <FilesVideosPage />)} />
            <Route path="schedule" element={withBoundary("Schedule", <SchedulePage />)} />
            <Route
              path="daily-logs"
              element={withBoundary("Daily Logs", <DailyLogsPage />)}
            />
          </Route>
        </Route>

        <Route path="*" element={withBoundary("Not Found", <NotFoundPage />)} />
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
