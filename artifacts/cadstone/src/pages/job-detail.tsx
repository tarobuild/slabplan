import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom"

export default function JobDetailPage() {
  const { jobId = "job-id" } = useParams()
  const location = useLocation()
  const currentTab = location.pathname.includes("/files/documents")
    ? "documents"
    : location.pathname.includes("/files/photos")
      ? "photos"
      : location.pathname.includes("/files/videos")
        ? "videos"
        : location.pathname.endsWith("/schedule")
          ? "schedule"
          : location.pathname.endsWith("/daily-logs")
            ? "daily-logs"
            : "summary"

  return (
    <div className="space-y-4">
      <Card className="border-[#E5E7EB] bg-white shadow-sm">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2">
            <div className="text-sm text-slate-500">
              <Link to="/jobs" className="text-blue-700 hover:text-blue-800">
                Jobs
              </Link>
              <span className="mx-2 text-slate-300">/</span>
              <span>Job Detail</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-slate-950">Job {jobId}</h1>
              <Badge variant="outline" className="border-[#E5E7EB] bg-[#F9FAFB] text-slate-600">
                Stub
              </Badge>
            </div>
            <p className="text-sm text-slate-500">
              Nested job routes are wired and ready for real Summary, Files, Schedule, and Daily Logs pages.
            </p>
          </div>

          <Tabs value={currentTab}>
            <TabsList className="h-auto w-full justify-start gap-1 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-1">
              <TabsTrigger value="summary" asChild>
                <NavLink to="summary">Summary</NavLink>
              </TabsTrigger>
              <TabsTrigger value="documents" asChild>
                <NavLink to="files/documents">Documents</NavLink>
              </TabsTrigger>
              <TabsTrigger value="photos" asChild>
                <NavLink to="files/photos">Photos</NavLink>
              </TabsTrigger>
              <TabsTrigger value="videos" asChild>
                <NavLink to="files/videos">Videos</NavLink>
              </TabsTrigger>
              <TabsTrigger value="schedule" asChild>
                <NavLink to="schedule">Schedule</NavLink>
              </TabsTrigger>
              <TabsTrigger value="daily-logs" asChild>
                <NavLink to="daily-logs">Daily Logs</NavLink>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      <Outlet />
    </div>
  )
}
