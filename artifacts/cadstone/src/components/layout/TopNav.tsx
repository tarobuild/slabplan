import { useEffect, useRef, useState } from "react"
import {
  Briefcase,
  ChevronDown,
  ClipboardList,
  LogOut,
  Plus,
  Search,
  Settings,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import Breadcrumbs from "./Breadcrumbs"
import GlobalSearch from "./GlobalSearch"
import NotificationBell from "./NotificationBell"
import { api, logoutSession } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useAgentPanelStore } from "@/store/agent"
import { APP_NAME, APP_SHORT_NAME, APP_STORAGE_NAMESPACE } from "@/lib/brand"

function initials(name: string) {
  // Ignore separators such as "-" so "TEST - Admin" reads "TA", not "T-".
  return name
    .split(/\s+/)
    .filter((p) => /^[\p{L}\p{N}]/u.test(p))
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  project_manager: "Project manager",
  crew_member: "Crew member",
  drafter: "Drafter",
}

/**
 * Context bar above every page: where you are (breadcrumb trail), a way to
 * find anything (search), a way to start something (Create, for admins),
 * the Assistant, notifications and your account. Primary destinations live
 * in the navigation column, not here.
 */
export default function TopNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const toggleAgent = useAgentPanelStore((s) => s.toggle)
  const [searchOpen, setSearchOpen] = useState(false)
  const [canUseAssistant, setCanUseAssistant] = useState(false)
  const assistantAccessRequestSeq = useRef(0)

  const role = user?.role
  const isAdmin = role === "admin"
  const isDrafter = role === "drafter"
  const accountLabel = user?.fullName?.split(" ")[0] ?? "Account"
  const currentJobId = location.pathname.match(/^\/jobs\/([^/]+)/)?.[1] ?? null

  useEffect(() => {
    setSearchOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!user) {
      setCanUseAssistant(false)
      return
    }

    let cancelled = false
    const requestSeq = assistantAccessRequestSeq.current + 1
    assistantAccessRequestSeq.current = requestSeq
    setCanUseAssistant(false)
    const path = currentJobId
      ? `/agent/access?jobId=${encodeURIComponent(currentJobId)}`
      : "/agent/access"
    api
      .get<{ canUseAssistant: boolean }>(path, { suppressForbiddenRedirect: true })
      .then((response) => {
        if (!cancelled && assistantAccessRequestSeq.current === requestSeq) {
          setCanUseAssistant(response.data.canUseAssistant)
        }
      })
      .catch(() => {
        if (!cancelled && assistantAccessRequestSeq.current === requestSeq) {
          setCanUseAssistant(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentJobId, user?.id])

  // Wire the `/` global keyboard shortcut to either focus the desktop
  // search input directly or open the search sheet (where the
  // input is auto-focused on mount).
  useEffect(() => {
    function handleFocusSearch() {
      const desktopInput = document.querySelector<HTMLInputElement>(
        '#slabplan-topbar-search input[type="search"]',
      )
      if (desktopInput && desktopInput.offsetParent !== null) {
        desktopInput.focus()
        desktopInput.select?.()
        return
      }
      setSearchOpen(true)
    }
    window.addEventListener(`${APP_STORAGE_NAMESPACE}:focus-global-search`, handleFocusSearch)
    return () =>
      window.removeEventListener(
        `${APP_STORAGE_NAMESPACE}:focus-global-search`,
        handleFocusSearch,
      )
  }, [])

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75">
      <div className="flex h-14 items-center gap-1.5 px-3 sm:px-5 lg:px-8">
        {/* Phones have no navigation column, so the brand lives here. */}
        <Link
          to="/dashboard"
          className="flex shrink-0 items-center gap-2 rounded-lg md:hidden"
          aria-label={`${APP_NAME} home`}
        >
          <img src="/favicon.svg" alt="" className="size-8 rounded-lg" />
          <span className="text-base font-bold text-foreground">{APP_NAME}</span>
        </Link>

        {/* Where am I — the page's trail, replacing the old breadcrumb row. */}
        <div className="hidden min-w-0 flex-1 md:block">
          <Breadcrumbs variant="inline" />
        </div>
        <div className="flex-1 md:hidden" />

        {/* Search — inline field on wide screens. */}
        <div id="slabplan-topbar-search" className="mr-1 hidden w-72 xl:block 2xl:w-80">
          <GlobalSearch />
        </div>

        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground xl:hidden"
          onClick={() => setSearchOpen(true)}
          aria-label="Open search"
          title="Search"
        >
          <Search className="size-[18px]" />
        </button>

        {isAdmin ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="ml-1 hidden h-9 gap-1.5 px-3 sm:inline-flex">
                <Plus className="size-4" />
                New
                <ChevronDown aria-hidden="true" className="size-3.5 opacity-80" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Create</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => navigate("/jobs", { state: { openCreate: true } })}>
                <Briefcase className="size-4" />
                Job
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/clients", { state: { openCreate: true } })}>
                <Users className="size-4" />
                Client
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/sales/leads", { state: { openCreate: true } })}>
                <TrendingUp className="size-4" />
                Lead
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {canUseAssistant ? (
          <button
            type="button"
            onClick={toggleAgent}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:px-3.5"
            aria-label="Open assistant"
            title="Assistant"
          >
            <Sparkles className="size-[18px] text-brand" />
            <span className="hidden text-sm font-medium text-foreground lg:block">Assistant</span>
          </button>
        ) : null}

        {user ? <NotificationBell /> : null}

        {/* Account */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Open account menu for ${accountLabel}`}
              className="ml-0.5 flex items-center gap-2 rounded-full p-0.5 outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/30 sm:py-1 sm:pl-1 sm:pr-2.5"
            >
              <Avatar className="size-8">
                <AvatarFallback className="bg-foreground text-[11px] font-semibold text-background">
                  {user ? initials(user.fullName) : APP_SHORT_NAME}
                </AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[9rem] truncate text-sm font-medium text-foreground lg:block">
                {accountLabel}
              </span>
              <ChevronDown aria-hidden="true" className="hidden size-3.5 text-muted-foreground lg:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="mt-1 w-60">
            <div className="flex items-center gap-3 px-2 py-2">
              <Avatar className="size-9">
                <AvatarFallback className="bg-foreground text-xs font-semibold text-background">
                  {user ? initials(user.fullName) : APP_SHORT_NAME}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {user?.fullName ?? "Signed out"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {role ? ROLE_LABELS[role] ?? role.replaceAll("_", " ") : ""}
                </p>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <Settings className="size-4" />
              Settings
            </DropdownMenuItem>
            {!isDrafter ? (
              <DropdownMenuItem onClick={() => navigate("/daily-logs/mine")}>
                <ClipboardList className="size-4" />
                My Daily Logs
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await logoutSession()
                navigate("/login", { replace: true })
              }}
            >
              <LogOut className="size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Search sheet for phones, tablets and narrow desktop windows */}
      <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
        <SheetContent
          side="top"
          className="flex h-[85vh] max-h-[85vh] flex-col gap-0 p-0"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
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
