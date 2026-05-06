import { useState } from "react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import {
  Briefcase,
  ClipboardList,
  Home,
  LogOut,
  type LucideIcon,
  MoreHorizontal,
  Settings,
  Sparkles,
  Users,
  Calendar,
  FileText,
  BarChart3,
} from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useAuthStore } from "@/store/auth"
import { logoutSession } from "@/lib/api"
import {
  hasRoleAccess,
  ROLE_GATES,
  type AppRole,
} from "@/lib/role-access"
import { isFeatureEnabled } from "@/lib/features"
import { cn } from "@/lib/utils"

type TabItem = {
  label: string
  to: string
  icon: LucideIcon
  matchPrefixes?: string[]
}

type MoreItem = {
  label: string
  to: string
  icon: LucideIcon
  allow?: ReadonlyArray<AppRole>
  hidden?: boolean
}

function isPathActive(path: string, item: TabItem): boolean {
  if (path === item.to) return true
  if (item.matchPrefixes?.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return true
  }
  return path.startsWith(`${item.to}/`)
}

export default function MobileBottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const [moreOpen, setMoreOpen] = useState(false)
  const role = user?.role
  const isCrew = role === "crew_member"

  const primaryTabs: TabItem[] = isCrew
    ? [
        { label: "Home", to: "/dashboard", icon: Home },
        { label: "My Jobs", to: "/jobs", icon: Briefcase },
        { label: "Logs", to: "/daily-logs/mine", icon: ClipboardList },
      ]
    : [
        { label: "Home", to: "/dashboard", icon: Home },
        ...(hasRoleAccess(role, ROLE_GATES.clients)
          ? [{ label: "Clients", to: "/clients", icon: Users }]
          : []),
        // Schedule deep-links to dashboard calendar view until a dedicated
        // schedule page exists. Marks active when on /dashboard with the
        // calendar query param.
        {
          label: "Schedule",
          to: "/dashboard?view=calendar",
          icon: Calendar,
          matchPrefixes: [],
        },
      ]

  const moreItems: MoreItem[] = [
    { label: "Resources", to: "/resources", icon: FileText },
    {
      label: "Sales",
      to: "/sales",
      icon: Sparkles,
      allow: ROLE_GATES.sales,
    },
    {
      label: "Reports",
      to: "/reports",
      icon: BarChart3,
      allow: ROLE_GATES.sales,
      hidden: !isFeatureEnabled("reports"),
    },
    ...(isCrew
      ? []
      : [
          {
            label: "My Daily Logs",
            to: "/daily-logs/mine",
            icon: ClipboardList,
          },
        ]),
    { label: "Settings", to: "/settings", icon: Settings },
  ]

  const visibleMoreItems = moreItems.filter(
    (item) => !item.hidden && (!item.allow || hasRoleAccess(role, item.allow)),
  )

  if (!user) return null

  // The "Schedule" tab navigates to a query-param URL; NavLink doesn't
  // match against query strings, so derive the active state ourselves
  // from `location.pathname` + `location.search`.
  const fullPath = `${location.pathname}${location.search}`

  return (
    <>
      <nav
        data-print-hide="true"
        aria-label="Primary mobile navigation"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white shadow-[0_-1px_2px_rgba(0,0,0,0.04)] md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid grid-cols-4">
          {primaryTabs.map((tab) => {
            const active =
              tab.to.includes("?")
                ? fullPath.startsWith(tab.to)
                : isPathActive(location.pathname, tab)
            return (
              <li key={tab.label}>
                <NavLink
                  to={tab.to}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                    active
                      ? "text-orange-600"
                      : "text-slate-500 hover:text-slate-800",
                  )}
                  aria-label={tab.label}
                  aria-current={active ? "page" : undefined}
                >
                  <tab.icon className="size-5" aria-hidden="true" />
                  <span>{tab.label}</span>
                </NavLink>
              </li>
            )
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn(
                "flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-800",
                moreOpen && "text-orange-600",
              )}
              aria-label="More navigation options"
              aria-expanded={moreOpen}
            >
              <MoreHorizontal className="size-5" aria-hidden="true" />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-xl p-0"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <SheetHeader className="border-b border-slate-100 px-4 py-3 text-left">
            <SheetTitle className="text-base">More</SheetTitle>
          </SheetHeader>
          <nav aria-label="More navigation" className="flex flex-col gap-0.5 p-2">
            {visibleMoreItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-orange-50 text-orange-700"
                      : "text-slate-700 hover:bg-slate-100",
                  )
                }
              >
                <item.icon className="size-4 text-slate-400" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={async () => {
                setMoreOpen(false)
                await logoutSession()
                navigate("/login", { replace: true })
              }}
              className="mt-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <LogOut className="size-4 text-slate-400" aria-hidden="true" />
              Logout
            </button>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  )
}
