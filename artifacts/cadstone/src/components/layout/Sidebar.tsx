import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  FileText,
  FolderKanban,
  ImageIcon,
  LayoutDashboard,
  Settings,
  Users,
  Video,
} from "lucide-react"
import { Link, NavLink, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

type NavItem = {
  label: string
  to: string
  end?: boolean
  icon: typeof LayoutDashboard
}

function navButtonClass(isActive: boolean) {
  return cn(
    "h-10 w-full justify-start rounded-md px-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900",
    isActive && "bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700",
  )
}

function SidebarLink({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to} end={item.end}>
      {({ isActive }) => (
        <Button variant="ghost" className={navButtonClass(isActive)}>
          <item.icon className="size-4" />
          {item.label}
        </Button>
      )}
    </NavLink>
  )
}

export default function Sidebar({ mobile = false }: { mobile?: boolean }) {
  const location = useLocation()
  const match = location.pathname.match(/^\/jobs\/([^/]+)/)
  const jobId = match?.[1] ?? null

  const globalNav: NavItem[] = [
    { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
    { label: "Jobs", to: "/jobs", icon: BriefcaseBusiness, end: true },
    { label: "Sales", to: "/sales/leads", icon: Users },
    { label: "Settings", to: "/settings", icon: Settings },
  ]

  const jobNav: NavItem[] = jobId
    ? [
        { label: "Summary", to: `/jobs/${jobId}/summary`, icon: LayoutDashboard },
        { label: "Documents", to: `/jobs/${jobId}/files/documents`, icon: FolderKanban },
        { label: "Photos", to: `/jobs/${jobId}/files/photos`, icon: ImageIcon },
        { label: "Videos", to: `/jobs/${jobId}/files/videos`, icon: Video },
        { label: "Schedule", to: `/jobs/${jobId}/schedule`, icon: CalendarDays },
        { label: "Daily Logs", to: `/jobs/${jobId}/daily-logs`, icon: FileText },
      ]
    : []

  const content = (
    <div className="flex h-full flex-col border-r border-[#E5E7EB] bg-white">
      {jobId ? (
        <>
          <div className="border-b border-[#E5E7EB] px-3 py-3">
            <Button variant="ghost" className="h-10 w-full justify-start rounded-md px-3 text-slate-600" asChild>
              <Link to="/jobs">
                <ArrowLeft className="size-4" />
                Back to Jobs
              </Link>
            </Button>
          </div>
          <div className="space-y-1 px-3 py-3">
            {jobNav.map((item) => (
              <SidebarLink key={item.to} item={item} />
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-1 px-3 py-3">
          {globalNav.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </div>
      )}
    </div>
  )

  if (!mobile) {
    return content
  }

  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm">
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  )
}
