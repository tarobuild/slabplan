import { Search, LogOut, Settings, User } from "lucide-react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/store/auth";
import api from "@/lib/api";
import { toast } from "sonner";

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function TopNav() {
  const { user, clearAuth } = useAuthStore();
  const [, navigate] = useLocation();

  const handleLogout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
    }
    clearAuth();
    navigate("/login");
    toast.success("Logged out successfully");
  };

  return (
    <header className="h-14 border-b border-border bg-white flex items-center px-4 gap-4 shrink-0">
      <a
        href="/dashboard"
        className="text-sm font-semibold text-gray-900 whitespace-nowrap hover:text-primary transition-colors"
      >
        CAD Stone Networks
      </a>

      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search jobs, leads, files..."
            className="pl-8 h-9 text-sm bg-muted/40 border-border"
          />
        </div>
      </div>

      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted transition-colors">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                  {user ? getInitials(user.fullName) : "?"}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium text-foreground hidden sm:block">
                {user?.fullName}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
