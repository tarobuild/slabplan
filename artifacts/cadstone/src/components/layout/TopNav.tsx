import {
  ChevronDown,
  FileImage,
  FileText,
  Film,
  LogOut,
  Settings,
  UserCircle2,
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

const FILES_LINKS = [
  { label: "Documents", to: "/files/documents", icon: FileText },
  { label: "Photos", to: "/files/photos", icon: FileImage },
  { label: "Videos", to: "/files/videos", icon: Film },
]

export default function TopNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)

  return (
    <header className="sticky top-0 z-30 bg-orange-600 shadow-md">
      <div className="flex h-12 items-center gap-1 px-3">
        {/* Logo */}
        <Link
          to="/dashboard"
          className="flex items-center gap-2 shrink-0 mr-2"
        >
          <div className="flex size-7 items-center justify-center rounded bg-white/20 text-[10px] font-black text-white leading-none select-none">
            CS
          </div>
          <span className="hidden text-sm font-bold text-white sm:block tracking-wide">
            CAD STONE
          </span>
        </Link>

        {/* Primary nav */}
        <nav className="flex items-center gap-0.5">
          {/* Jobs */}
          <NavLink
            to="/jobs"
            className={({ isActive }) =>
              cn(
                "px-3 py-1.5 text-sm rounded text-white/85 hover:text-white hover:bg-white/15 transition-colors whitespace-nowrap",
                isActive && "bg-white/20 text-white font-medium",
              )
            }
          >
            Jobs
          </NavLink>

          {/* Files dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex items-center gap-1 px-3 py-1.5 text-sm rounded text-white/85 hover:text-white hover:bg-white/15 transition-colors whitespace-nowrap outline-none",
                  location.pathname.startsWith("/files") &&
                    "bg-white/20 text-white font-medium",
                )}
              >
                Files
                <ChevronDown className="size-3.5 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-44 border-[#E5E7EB] shadow-lg mt-1"
            >
              {FILES_LINKS.map((item) => (
                <DropdownMenuItem key={item.to} asChild>
                  <Link
                    to={item.to}
                    className="flex items-center gap-2.5 cursor-pointer"
                  >
                    <item.icon className="size-4 text-slate-500" />
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sales */}
          <NavLink
            to="/sales/leads"
            className={({ isActive }) =>
              cn(
                "px-3 py-1.5 text-sm rounded text-white/85 hover:text-white hover:bg-white/15 transition-colors whitespace-nowrap",
                isActive && "bg-white/20 text-white font-medium",
              )
            }
          >
            Sales
          </NavLink>
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex items-center gap-1.5 rounded-full px-1 py-0.5 text-white/85 hover:text-white hover:bg-white/15 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/50">
              <Avatar className="size-7 border-2 border-white/30 cursor-pointer">
                <AvatarFallback className="bg-orange-800 text-white text-[10px] font-semibold">
                  {user ? initials(user.fullName) : "CS"}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium sm:block">
                {user?.fullName?.split(" ")[0] ?? "Account"}
              </span>
              <ChevronDown className="size-3.5 opacity-70" />
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
    </header>
  )
}
