import { useEffect, useState } from "react"
import {
  ChevronDown,
  ClipboardList,
  LogOut,
  Search,
  Settings,
  Sparkles,
} from "lucide-react"
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import GlobalSearch from "./GlobalSearch"
import { api, logoutSession } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useAgentPanelStore } from "@/store/agent"
import { hasRoleAccess, ROLE_GATES, type AppRole } from "@/lib/role-access"
import { isFeatureEnabled } from "@/lib/features"
import { cn } from "@/lib/utils"

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

type TopNavLink = {
  label: string
  to: string
  allow?: ReadonlyArray<AppRole>
  hidden?: boolean
}

export default function TopNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const toggleAgent = useAgentPanelStore((s) => s.toggle)
  const [searchOpen, setSearchOpen] = useState(false)
  const [canUseAssistant, setCanUseAssistant] = useState(false)

  const role = user?.role
  const isFieldUser = role === "project_manager" || role === "crew_member"
  const accountLabel = user?.fullName?.split(" ")[0] ?? "Account"
  const currentJobId = location.pathname.match(/^\/jobs\/([^/]+)/)?.[1] ?? null

  // Role-based primary nav. Admins see the office workspace; PMs and crew
  // share the same field-user view. Reports stays hidden
  // until the route ships (FEATURES.reports).
  const navLinks: TopNavLink[] = isFieldUser
    ? [
        { label: "Home", to: "/dashboard" },
        { label: "My Jobs", to: "/jobs" },
        { label: "Resources", to: "/resources" },
      ]
    : [
        { label: "Home", to: "/dashboard" },
        { label: "Clients", to: "/clients", allow: ROLE_GATES.clients },
        { label: "Schedule", to: "/schedule", allow: ROLE_GATES.companyViews },
        { label: "Daily Logs", to: "/daily-logs", allow: ROLE_GATES.companyViews },
        { label: "Sales", to: "/sales", allow: ROLE_GATES.sales },
        {
          label: "Reports",
          to: "/reports",
          allow: ROLE_GATES.reports,
          hidden: !isFeatureEnabled("reports"),
        },
        { label: "Resources", to: "/resources" },
      ]

  const visibleLinks = navLinks.filter(
    (item) => !item.hidden && (!item.allow || hasRoleAccess(role, item.allow)),
  )

  useEffect(() => {
    setSearchOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!user) {
      setCanUseAssistant(false)
      return
    }

    let cancelled = false
    const path = currentJobId
      ? `/agent/access?jobId=${encodeURIComponent(currentJobId)}`
      : "/agent/access"
    api
      .get<{ canUseAssistant: boolean }>(path, { suppressForbiddenRedirect: true })
      .then((response) => {
        if (!cancelled) setCanUseAssistant(response.data.canUseAssistant)
      })
      .catch(() => {
        if (!cancelled) setCanUseAssistant(false)
      })

    return () => {
      cancelled = true
    }
  }, [currentJobId, user?.id])

  // Wire the `/` global keyboard shortcut to either focus the desktop
  // search input directly or open the mobile search sheet (where the
  // input is auto-focused on mount).
  useEffect(() => {
    function handleFocusSearch() {
      const desktopInput = document.querySelector<HTMLInputElement>(
        '#cadstone-topbar-search input[type="search"]',
      )
      if (desktopInput && desktopInput.offsetParent !== null) {
        desktopInput.focus()
        desktopInput.select?.()
        return
      }
      setSearchOpen(true)
    }
    window.addEventListener("cadstone:focus-global-search", handleFocusSearch)
    return () =>
      window.removeEventListener(
        "cadstone:focus-global-search",
        handleFocusSearch,
      )
  }, [])

  return (
    <header className="sticky top-0 z-30 shadow-md" style={{ backgroundColor: "#1D1D1D" }}>
      <div className="flex h-14 lg:h-12 items-center gap-1 px-3">
        {/* Logo */}
        <Link to="/dashboard" className="flex items-center shrink-0 mr-3">
          <div className="flex items-center bg-white rounded px-2 py-1">
            <img
              src="/cad-logo.png"
              alt="CAD Stone Networks"
              className="h-6 w-auto"
            />
          </div>
        </Link>

        {/* Primary nav — hidden on mobile (replaced by bottom-tab nav). */}
        <nav className="hidden md:flex items-center gap-0.5">
          {visibleLinks.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "px-3 py-1.5 text-sm rounded transition-colors whitespace-nowrap font-medium",
                  isActive
                    ? "text-[#E85D04] bg-white/10"
                    : "text-white/70 hover:text-white hover:bg-white/10",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex-1" />

        {/* Global search — desktop only */}
        <div id="cadstone-topbar-search" className="hidden md:block w-72 mr-1">
          <GlobalSearch />
        </div>

        {/* Search button — mobile only */}
        <button
          className="md:hidden flex items-center justify-center rounded p-2 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          onClick={() => setSearchOpen(true)}
          aria-label="Open search"
        >
          <Search className="size-5" />
        </button>

        {canUseAssistant ? (
          <button
            type="button"
            onClick={toggleAgent}
            className="ml-1 flex items-center justify-center gap-1.5 rounded p-2 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Open assistant"
            title="Assistant"
          >
            <Sparkles className="size-5" style={{ color: "#E85D04" }} />
            <span className="hidden text-sm font-medium md:block">Assistant</span>
          </button>
        ) : null}

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Open account menu for ${accountLabel}`}
              className="ml-1 flex items-center gap-1.5 rounded px-2 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors outline-none"
            >
              <Avatar className="size-7 border border-white/20 cursor-pointer">
                <AvatarFallback
                  className="text-[10px] font-semibold text-white"
                  style={{ backgroundColor: "#E85D04" }}
                >
                  {user ? initials(user.fullName) : "CS"}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium sm:block">
                {accountLabel}
              </span>
              <ChevronDown aria-hidden="true" className="size-3.5 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 border-[#E5E7EB] shadow-lg mt-1">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium text-slate-900">
                {user?.fullName ?? "Signed out"}
              </p>
              <p className="text-xs capitalize text-slate-500">
                {user?.role?.replaceAll("_", " ") ?? ""}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <Settings className="size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/daily-logs/mine")}>
              <ClipboardList className="size-4" />
              My Daily Logs
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await logoutSession()
                navigate("/login", { replace: true })
              }}
            >
              <LogOut className="size-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile search sheet */}
      <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
        <SheetContent
          side="top"
          className="flex h-[85vh] max-h-[85vh] flex-col gap-0 p-0"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <SheetTitle className="text-base">Search</SheetTitle>
            <span className="size-6" aria-hidden="true" />
          </div>
          <div className="flex flex-1 min-h-0 flex-col p-4">
            {searchOpen ? (
              <GlobalSearch
                variant="panel"
                autoFocus
                onResultSelected={() => setSearchOpen(false)}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </header>
  )
}
