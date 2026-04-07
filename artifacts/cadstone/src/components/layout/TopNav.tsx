import { LogOut, Search, Settings, UserCircle2 } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
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

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export default function TopNav() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)

  return (
    <header className="sticky top-0 z-30 border-b border-[#E5E7EB] bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-4 px-4 lg:px-6">
        <Button
          variant="ghost"
          className="h-auto px-0 text-base font-semibold text-slate-950 hover:bg-transparent hover:text-blue-700"
          asChild
        >
          <Link to="/dashboard">CAD Stone Networks</Link>
        </Button>

        <div className="hidden flex-1 md:flex">
          <div className="relative w-full max-w-2xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="search"
              placeholder="Global search placeholder"
              className="h-10 border-[#E5E7EB] bg-[#F9FAFB] pl-9 text-sm shadow-none"
            />
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="ml-auto h-10 gap-3 rounded-full px-2 hover:bg-slate-100">
              <Avatar className="size-8 border border-[#E5E7EB]">
                <AvatarFallback className="bg-blue-50 text-blue-700">
                  {user ? initials(user.fullName) : "CS"}
                </AvatarFallback>
              </Avatar>
              <div className="hidden text-left sm:block">
                <div className="text-sm font-medium text-slate-900">
                  {user?.fullName || "Signed out"}
                </div>
                <div className="text-xs capitalize text-slate-500">
                  {user?.role?.replaceAll("_", " ") || "anonymous"}
                </div>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 border-[#E5E7EB]">
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
