import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuthStore } from "@/store/auth"
import { APP_NAME, APP_STORAGE_NAMESPACE } from "@/lib/brand"
import { cn } from "@/lib/utils"
import Sidebar from "./Sidebar"
import {
  getPrimaryDestinations,
  isDestinationActive,
  NAV_GROUP_LABELS,
  type NavDestination,
} from "./navigation"

const COLLAPSED_STORAGE_KEY = `${APP_STORAGE_NAMESPACE}:shell:navCollapsed`

function readStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

function useIsWide() {
  const query = "(min-width: 1024px)"
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setWide(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])
  return wide
}

/**
 * Primary navigation. One place for every destination:
 * - desktop (≥1024px): labelled sidebar with the job navigator underneath;
 *   people can collapse it to an icon rail and the choice is remembered;
 * - tablet (768–1023px): icon rail with tooltips;
 * - phone: hidden, replaced by the bottom tab bar.
 */
export default function AppNavigation() {
  const location = useLocation()
  const role = useAuthStore((s) => s.user?.role)
  const isWide = useIsWide()
  const [collapsedPreference, setCollapsedPreference] = useState(readStoredCollapsed)
  const expanded = isWide && !collapsedPreference

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsedPreference ? "true" : "false")
    } catch {
      // Storage can be unavailable (private mode); the preference just won't persist.
    }
  }, [collapsedPreference])

  const destinations = getPrimaryDestinations(role)
  const groups = (["workspace", "business", "library"] as const)
    .map((group) => ({ group, items: destinations.filter((d) => d.group === group) }))
    .filter((g) => g.items.length > 0)
  const showGroupLabels = expanded && groups.length > 1
  const settingsActive = location.pathname === "/settings" || location.pathname.startsWith("/settings/")

  return (
    <nav
      aria-label="Primary"
      data-print-hide="true"
      className={cn(
        "hidden h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex",
        expanded ? "w-64" : "w-[72px]",
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center", expanded ? "justify-between px-4" : "justify-center")}>
        <Link
          to="/dashboard"
          className="flex items-center gap-2.5 rounded-lg outline-offset-4"
          aria-label={`${APP_NAME} home`}
        >
          <img src="/favicon.svg" alt="" className="size-8 rounded-lg" />
          {expanded ? (
            <span className="text-[17px] font-bold text-foreground">{APP_NAME}</span>
          ) : null}
        </Link>
        {expanded ? (
          <button
            type="button"
            onClick={() => setCollapsedPreference(true)}
            className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            aria-label="Collapse navigation"
            title="Collapse navigation"
          >
            <PanelLeftClose className="size-4" />
          </button>
        ) : null}
      </div>

      <div className={cn("shrink-0 space-y-4 pb-3 pt-2", expanded ? "px-3" : "px-3")}>
        {groups.map(({ group, items }) => (
          <div key={group}>
            {showGroupLabels ? (
              <p className="px-2.5 pb-1.5 text-[11px] font-medium text-muted-foreground">
                {NAV_GROUP_LABELS[group]}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavItem
                    item={item}
                    active={isDestinationActive(location.pathname, item)}
                    expanded={expanded}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {expanded ? (
        <div className="flex min-h-0 flex-1 flex-col border-t border-sidebar-border">
          <Sidebar />
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className={cn("shrink-0 border-t border-sidebar-border py-2", expanded ? "px-3" : "px-3")}>
        <NavItem
          item={{ label: "Settings", to: "/settings", icon: Settings, group: "library" }}
          active={settingsActive}
          expanded={expanded}
        />
        {isWide && !expanded ? (
          <RailButton label="Expand navigation" onClick={() => setCollapsedPreference(false)}>
            <PanelLeftOpen className="size-[18px]" />
          </RailButton>
        ) : null}
      </div>
    </nav>
  )
}

function NavItem({
  item,
  active,
  expanded,
}: {
  item: NavDestination
  active: boolean
  expanded: boolean
}) {
  const Icon = item.icon
  // Plain Link (not NavLink): NavLink recomputes aria-current from `to`
  // alone, which would drop the segment-aware state (e.g. Clients is the
  // current destination on /jobs/:id for admins).
  const link = (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center rounded-full text-sm font-medium transition-colors",
        expanded ? "h-10 gap-3 px-3.5" : "mx-auto h-11 w-11 justify-center",
        active
          ? "bg-accent text-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-[18px] shrink-0",
          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      {expanded ? <span className="truncate">{item.label}</span> : <span className="sr-only">{item.label}</span>}
    </Link>
  )

  if (expanded) return link
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

function RailButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="mx-auto mt-1 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
