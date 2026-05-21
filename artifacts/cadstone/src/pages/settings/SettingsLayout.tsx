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
  Plug,
  CreditCard,
  User,
  Users as UsersIcon,
} from "lucide-react"
import { useAuthStore } from "@/store/auth"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { cn } from "@/lib/utils"

type NavItem = {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: "/settings/profile", label: "Profile", icon: User },
  { to: "/settings/password", label: "Password", icon: Lock },
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your profile, security, team, and company defaults.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        {/* Mobile chip row (< md) */}
        <nav
          aria-label="Settings sections"
          className="md:hidden -mx-4 overflow-x-auto px-4"
        >
          <ul className="flex min-w-max gap-2">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  data-settings-chip
                  className={({ isActive }) =>
                    cn(
                      "inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "border-primary/35 bg-primary/10 text-primary"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
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
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  data-settings-rail-item
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none",
                      "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                    )
                  }
                >
                  <item.icon className="size-4" aria-hidden="true" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </aside>

        <section className="min-w-0">
          <Outlet />
        </section>
      </div>
    </div>
  )
}
