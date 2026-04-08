import {
  ChevronDown,
  ClipboardList,
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
    <header className="sticky top-0 z-30 shadow-md" style={{ backgroundColor: "#1D1D1D" }}>
      <div className="flex h-12 items-center gap-1 px-3">
        {/* Logo */}
        <Link
          to="/dashboard"
          className="flex items-center shrink-0 mr-3"
        >
          <div className="flex items-center bg-white rounded px-2 py-1">
            <img
              src="/cad-logo.png"
              alt="CAD Stone Networks"
              className="h-6 w-auto"
            />
          </div>
        </Link>

        {/* Primary nav */}
        <nav className="flex items-center gap-0.5">
          {/* Jobs */}
          <NavLink
            to="/jobs"
            className={({ isActive }) =>
              cn(
                "px-3 py-1.5 text-sm rounded transition-colors whitespace-nowrap font-medium",
                isActive
                  ? "text-[#E85D04] bg-white/10"
                  : "text-white/70 hover:text-white hover:bg-white/10",
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
                  "flex items-center gap-1 px-3 py-1.5 text-sm rounded transition-colors whitespace-nowrap outline-none font-medium",
                  location.pathname.startsWith("/files")
                    ? "text-[#E85D04] bg-white/10"
                    : "text-white/70 hover:text-white hover:bg-white/10",
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

          {/* Clients */}
          <NavLink
            to="/clients"
            className={({ isActive }) =>
              cn(
                "px-3 py-1.5 text-sm rounded transition-colors whitespace-nowrap font-medium",
                isActive
                  ? "text-[#E85D04] bg-white/10"
                  : "text-white/70 hover:text-white hover:bg-white/10",
              )
            }
          >
            Clients
          </NavLink>

          {/* Sales */}
          <NavLink
            to="/sales/leads"
            className={({ isActive }) =>
              cn(
                "px-3 py-1.5 text-sm rounded transition-colors whitespace-nowrap font-medium",
                isActive
                  ? "text-[#E85D04] bg-white/10"
                  : "text-white/70 hover:text-white hover:bg-white/10",
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
            <button className="ml-1 flex items-center gap-1.5 rounded px-2 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors outline-none">
              <Avatar className="size-7 border border-white/20 cursor-pointer">
                <AvatarFallback className="text-[10px] font-semibold text-white" style={{ backgroundColor: "#E85D04" }}>
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
    </header>
  )
}
