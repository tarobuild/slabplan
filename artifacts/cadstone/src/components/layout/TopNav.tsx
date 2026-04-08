import {
  Bell,
  HelpCircle,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  Settings,
  UserCircle2,
} from "lucide-react"
import { Link, NavLink, useNavigate } from "react-router-dom"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { logoutSession } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { cn } from "@/lib/utils"

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

const NAV_LINKS = [
  { label: "Jobs", to: "/jobs" },
  { label: "Files", to: "/files/documents" },
  { label: "Sales", to: "/sales/leads" },
  { label: "Reports", to: "/reports" },
]

export default function TopNav() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  return (
    <header className="sticky top-0 z-30 bg-orange-600 shadow-md">
      <div className="flex h-12 items-center gap-3 px-3">
        <Link
          to="/dashboard"
          className="flex items-center gap-2 shrink-0 mr-1"
        >
          <div className="flex size-7 items-center justify-center rounded bg-white/20 text-[10px] font-black text-white leading-none">
            CS
          </div>
          <span className="hidden text-sm font-bold text-white sm:block">
            CAD STONE
          </span>
        </Link>

        <nav className="flex items-center">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  "px-3 py-1.5 text-sm rounded text-white/80 hover:text-white hover:bg-white/15 transition-colors whitespace-nowrap",
                  isActive && "bg-white/20 text-white font-medium",
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="mx-2 hidden flex-1 md:block">
          <div className="relative max-w-lg">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/50" />
            <Input
              type="search"
              placeholder="Search…"
              className="h-8 border-white/20 bg-white/10 pl-8 text-sm text-white placeholder:text-white/50 focus-visible:bg-white/20 focus-visible:ring-white/30"
            />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-white/80 hover:bg-white/15 hover:text-white"
          >
            <Plus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-white/80 hover:bg-white/15 hover:text-white"
          >
            <Bell className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-white/80 hover:bg-white/15 hover:text-white"
          >
            <MessageSquare className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-white/80 hover:bg-white/15 hover:text-white"
          >
            <HelpCircle className="size-4" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-1 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                <Avatar className="size-7 border-2 border-white/40 cursor-pointer">
                  <AvatarFallback className="bg-orange-800 text-white text-[10px] font-semibold">
                    {user ? initials(user.fullName) : "CS"}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 border-[#E5E7EB]">
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
                <UserCircle2 className="size-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/settings")}>
                <Settings className="size-4" />
                Settings
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
      </div>
    </header>
  )
}
