import {
  BarChart3,
  Briefcase,
  CalendarDays,
  ClipboardList,
  FolderOpen,
  Home,
  type LucideIcon,
  TrendingUp,
  Users,
} from "lucide-react"
import { hasRoleAccess, ROLE_GATES, type AppRole } from "@/lib/role-access"
import { isFeatureEnabled } from "@/lib/features"

// Single source of truth for the app's primary destinations. The desktop
// navigation rail and the mobile "More" sheet both read from here so every
// role sees the same set of places everywhere. Visibility mirrors the
// frontend role gates exactly; the routes themselves keep their own guards.
export type NavDestination = {
  label: string
  to: string
  icon: LucideIcon
  /** Extra path prefixes that should light this destination up. */
  match?: string[]
  /** Match only the exact path (plus `match` prefixes). */
  exact?: boolean
  group: "workspace" | "business" | "library"
}

export function getPrimaryDestinations(role: AppRole | string | null | undefined): NavDestination[] {
  const isFieldUser = role === "project_manager" || role === "crew_member"
  const isDrafter = role === "drafter"

  const items: Array<NavDestination & { allow?: ReadonlyArray<AppRole>; hidden?: boolean }> = isFieldUser
    ? [
        { label: "Home", to: "/dashboard", icon: Home, exact: true, group: "workspace" },
        { label: "My Jobs", to: "/jobs", icon: Briefcase, match: ["/jobs"], group: "workspace" },
        { label: "My Daily Logs", to: "/daily-logs/mine", icon: ClipboardList, exact: true, group: "workspace" },
        { label: "Resources", to: "/resources", icon: FolderOpen, group: "library" },
      ]
    : [
        { label: "Home", to: "/dashboard", icon: Home, exact: true, group: "workspace" },
        {
          label: "Clients",
          to: "/clients",
          icon: Users,
          allow: ROLE_GATES.clients,
          match: ["/clients", "/jobs"],
          group: "workspace",
        },
        {
          label: "My Jobs",
          to: "/jobs",
          icon: Briefcase,
          allow: ROLE_GATES.myJobs,
          match: ["/jobs"],
          group: "workspace",
        },
        { label: "Schedule", to: "/schedule", icon: CalendarDays, allow: ROLE_GATES.schedule, group: "workspace" },
        {
          label: "Daily Logs",
          to: "/daily-logs",
          icon: ClipboardList,
          allow: ROLE_GATES.dailyLogs,
          exact: true,
          group: "workspace",
        },
        { label: "Sales", to: "/sales", icon: TrendingUp, allow: ROLE_GATES.sales, group: "business" },
        {
          label: "Reports",
          to: "/reports",
          icon: BarChart3,
          allow: ROLE_GATES.reports,
          hidden: !isFeatureEnabled("reports"),
          group: "business",
        },
        { label: "Resources", to: "/resources", icon: FolderOpen, hidden: isDrafter, group: "library" },
      ]

  return items
    .filter((item) => !item.hidden && (!item.allow || hasRoleAccess(role, item.allow)))
    .map(({ allow: _allow, hidden: _hidden, ...item }) => item)
}

export function isDestinationActive(pathname: string, item: NavDestination): boolean {
  if (item.exact) return pathname === item.to
  const prefixes = [item.to, ...(item.match ?? [])]
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export const NAV_GROUP_LABELS: Record<NavDestination["group"], string> = {
  workspace: "Workspace",
  business: "Business",
  library: "Library",
}
