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

export function mobileNavColumnTemplate(primaryTabCount: number): string {
  return `repeat(${primaryTabCount + 1}, minmax(0, 1fr))`
}

export default function MobileBottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const [moreOpen, setMoreOpen] = useState(false)
  const role = user?.role
  const isFieldUser = role === "project_manager" || role === "crew_member"

  const primaryTabs: TabItem[] = isFieldUser
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
        ...(hasRoleAccess(role, ROLE_GATES.companyViews)
          ? [{ label: "Schedule", to: "/schedule", icon: Calendar }]
          : []),
        ...(hasRoleAccess(role, ROLE_GATES.companyViews)
          ? [{ label: "Logs", to: "/daily-logs", icon: ClipboardList }]
          : []),
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
      allow: ROLE_GATES.reports,
      hidden: !isFeatureEnabled("reports"),
    },
    ...(isFieldUser
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
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white shadow-[0_-1px_2px_rgba(0,0,0,0.04)] lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul
          className="grid"
          style={{ gridTemplateColumns: mobileNavColumnTemplate(primaryTabs.length) }}
        >
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
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
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
                moreOpen && "text-primary",
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
          <SheetHeader className="border-b border-border px-4 py-3 text-left">
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
                      ? "bg-accent text-primary"
                      : "text-foreground hover:bg-accent/60",
                  )
                }
              >
                <item.icon className="size-4 text-muted-foreground" aria-hidden="true" />
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
              className="mt-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent/60"
            >
              <LogOut className="size-4 text-muted-foreground" aria-hidden="true" />
              Logout
            </button>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  )
}
