import { useState } from "react"
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom"
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
  const isFieldUser = role === "project_manager" || role === "crew_member"
  const isDrafter = role === "drafter"

  const primaryTabs: TabItem[] = isFieldUser
    ? [
        { label: "Home", to: "/dashboard", icon: Home },
        { label: "My Jobs", to: "/jobs", icon: Briefcase },
        { label: "Logs", to: "/daily-logs/mine", icon: ClipboardList },
      ]
    : [
        { label: "Home", to: "/dashboard", icon: Home },
        ...(hasRoleAccess(role, ROLE_GATES.clients)
          ? [{ label: "Clients", to: "/clients", icon: Users, matchPrefixes: ["/jobs"] }]
          : []),
        ...(hasRoleAccess(role, ROLE_GATES.myJobs)
          ? [{ label: "Jobs", to: "/jobs", icon: Briefcase }]
          : []),
        ...(hasRoleAccess(role, ROLE_GATES.schedule)
          ? [{ label: "Schedule", to: "/schedule", icon: Calendar }]
          : []),
      ]

  const moreItems: MoreItem[] = [
    { label: "Resources", to: "/resources", icon: FileText, hidden: isDrafter },
    {
      label: "Daily Logs",
      to: "/daily-logs",
      icon: ClipboardList,
      allow: ROLE_GATES.dailyLogs,
    },
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
            hidden: isDrafter,
          },
        ]),
    { label: "Settings", to: "/settings", icon: Settings },
  ]

  const visibleMoreItems = moreItems.filter(
    (item) => !item.hidden && (!item.allow || hasRoleAccess(role, item.allow)),
  )

  if (!user) return null

  // The "Schedule" tab navigates to a query-param URL; router matching
  // ignores query strings, so derive the active state ourselves from
  // `location.pathname` + `location.search`.
  const fullPath = `${location.pathname}${location.search}`

  return (
    <>
      <nav
        data-print-hide="true"
        aria-label="Primary mobile navigation"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 md:hidden"
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
                {/* Plain Link so our query- and segment-aware state is the
                    aria-current that actually renders. */}
                <Link
                  to={tab.to}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center gap-1 text-[11px] transition-colors",
                    active
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground hover:text-foreground",
                  )}
                  aria-label={tab.label}
                  aria-current={active ? "page" : undefined}
                >
                  <span
                    className={cn(
                      "flex h-7 w-14 items-center justify-center rounded-full transition-colors",
                      active && "bg-accent text-primary",
                    )}
                  >
                    <tab.icon className="size-5" aria-hidden="true" />
                  </span>
                  <span>{tab.label}</span>
                </Link>
              </li>
            )
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn(
                "flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground",
                moreOpen && "text-foreground",
              )}
              aria-label="More navigation options"
              aria-expanded={moreOpen}
            >
              <span
                className={cn(
                  "flex h-7 w-14 items-center justify-center rounded-full transition-colors",
                  moreOpen && "bg-accent text-primary",
                )}
              >
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </span>
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl p-0"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" />
          <SheetHeader className="px-5 pb-2 pt-3 text-left">
            <SheetTitle className="text-base">More</SheetTitle>
          </SheetHeader>
          <nav aria-label="More navigation" className="flex flex-col gap-0.5 px-3 pb-4">
            {visibleMoreItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-12 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-muted",
                  )
                }
              >
                <item.icon className="size-5 text-muted-foreground" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={async () => {
                setMoreOpen(false)
                await logoutSession()
                navigate("/login", { replace: true })
              }}
              className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-foreground hover:bg-muted"
            >
              <LogOut className="size-5 text-muted-foreground" aria-hidden="true" />
              Log out
            </button>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  )
}
