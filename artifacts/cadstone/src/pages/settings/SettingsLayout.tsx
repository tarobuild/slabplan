import { useEffect, useMemo, useRef } from "react"
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom"
import {
  Activity,
  Building2,
  Bell,
  KeyRound,
  Lock,
  ShieldCheck,
  Plug,
  CreditCard,
  User,
  Users as UsersIcon,
} from "lucide-react"
import { useAuthStore } from "@/store/auth"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { cn } from "@/lib/utils"
import PageHeader from "@/components/layout/PageHeader"
import { revealOnFocus } from "@/lib/reveal-on-focus"

type NavItem = {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: "/settings/profile", label: "Profile", icon: User },
  { to: "/settings/password", label: "Password", icon: Lock },
  { to: "/settings/security", label: "Security", icon: ShieldCheck },
  { to: "/settings/notifications", label: "Notifications", icon: Bell },
  { to: "/settings/tokens", label: "API Tokens", icon: KeyRound },
  { to: "/settings/team", label: "Team", icon: UsersIcon, adminOnly: true },
  { to: "/settings/company", label: "Company", icon: Building2, adminOnly: true },
  { to: "/settings/billing", label: "Billing", icon: CreditCard, adminOnly: true },
  { to: "/settings/integrations", label: "Integrations", icon: Plug, adminOnly: true },
  { to: "/settings/diagnostics", label: "Diagnostics", icon: Activity, adminOnly: true },
]

export default function SettingsLayout() {
  useDocumentTitle("Settings")
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "admin"
  const location = useLocation()
  const navigate = useNavigate()
  const railRef = useRef<HTMLElement | null>(null)

  const items = useMemo(
    () => NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin),
    [isAdmin],
  )

  // If a non-admin lands on an admin-only sub-route (e.g. via stale URL),
  // bounce them to Profile rather than rendering an empty content area.
  useEffect(() => {
    const match = NAV_ITEMS.find((item) =>
      location.pathname.startsWith(item.to),
    )
    if (match?.adminOnly && !isAdmin) {
      navigate("/settings/profile", { replace: true })
    }
  }, [location.pathname, isAdmin, navigate])

  // Keyboard nav: arrow keys move focus between rail items, looping.
  const onRailKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") {
      return
    }
    const root = railRef.current
    if (!root) return
    const links = Array.from(
      root.querySelectorAll<HTMLAnchorElement>("a[data-settings-rail-item]"),
    )
    if (links.length === 0) return
    const active = document.activeElement as HTMLElement | null
    const currentIndex = links.findIndex((link) => link === active)
    const forward = e.key === "ArrowDown" || e.key === "ArrowRight"
    const next = forward
      ? (currentIndex + 1 + links.length) % links.length
      : (currentIndex - 1 + links.length) % links.length
    e.preventDefault()
    links[next]?.focus()
  }

  const accountItems = items.filter((item) => !item.adminOnly)
  const workspaceItems = items.filter((item) => item.adminOnly)
  const railGroups = [
    { label: "Your account", items: accountItems },
    { label: "Workspace", items: workspaceItems },
  ].filter((group) => group.items.length > 0)

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="grid gap-6 md:grid-cols-[208px_minmax(0,1fr)] lg:gap-10">
        {/* Mobile chip row (< md). The list carries the padding (so it is part
            of the scrollable width) and scroll-padding keeps a focused chip's
            ring clear of the edge when the browser scrolls it into view. */}
        <nav
          aria-label="Settings sections"
          className="scrollbar-none -mx-4 scroll-px-4 overflow-x-auto md:hidden"
        >
          <ul className="flex w-max gap-2 px-4 py-1.5">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  data-settings-chip
                  onFocus={revealOnFocus}
                  className={({ isActive }) =>
                    cn(
                      "inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "border-transparent bg-accent text-accent-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )
                  }
                >
                  <item.icon className="size-4" aria-hidden="true" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Desktop left rail (>= md) */}
        <aside
          ref={(el) => {
            railRef.current = el
          }}
          aria-label="Settings sections"
          onKeyDown={onRailKeyDown}
          className="hidden md:block"
        >
          <div className="sticky top-4 space-y-5">
            {railGroups.map((group) => (
              <div key={group.label}>
                {railGroups.length > 1 ? (
                  <p className="px-3 pb-1.5 text-xs font-medium text-muted-foreground">{group.label}</p>
                ) : null}
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        data-settings-rail-item
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-2.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors outline-none",
                            "focus-visible:ring-[3px] focus-visible:ring-ring/40",
                            isActive
                              ? "bg-accent text-accent-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )
                        }
                      >
                        <item.icon className="size-4" aria-hidden="true" />
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </aside>

        <section className="min-w-0 max-w-4xl">
          <Outlet />
        </section>
      </div>
    </div>
  )
}
