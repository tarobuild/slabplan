import { Link, useLocation } from "wouter";
import { LayoutDashboard, Briefcase, Users, Settings, ChevronLeft, FolderOpen, Calendar, FileText, Image, Video } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const globalNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Jobs", href: "/jobs", icon: Briefcase },
  { label: "Sales", href: "/sales/leads", icon: Users },
  { label: "Settings", href: "/settings", icon: Settings },
];

function NavLink({ item, exact = false }: { item: NavItem; exact?: boolean }) {
  const [location] = useLocation();
  const isActive = exact
    ? location === item.href
    : location.startsWith(item.href);
  const Icon = item.icon;

  return (
    <Link href={item.href}>
      <a
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {item.label}
      </a>
    </Link>
  );
}

export default function Sidebar() {
  const [location] = useLocation();
  const jobMatch = location.match(/^\/jobs\/([^/]+)/);
  const jobId = jobMatch ? jobMatch[1] : null;

  if (jobId) {
    const jobNav: NavItem[] = [
      { label: "Summary", href: `/jobs/${jobId}`, icon: Briefcase },
      { label: "Documents", href: `/jobs/${jobId}/files/documents`, icon: FolderOpen },
      { label: "Photos", href: `/jobs/${jobId}/files/photos`, icon: Image },
      { label: "Videos", href: `/jobs/${jobId}/files/videos`, icon: Video },
      { label: "Schedule", href: `/jobs/${jobId}/schedule`, icon: Calendar },
      { label: "Daily Logs", href: `/jobs/${jobId}/daily-logs`, icon: FileText },
    ];

    return (
      <aside className="w-56 border-r border-border bg-sidebar flex flex-col shrink-0 overflow-y-auto">
        <div className="p-3 border-b border-border">
          <Link href="/jobs">
            <a className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="h-4 w-4" />
              Back to Jobs
            </a>
          </Link>
        </div>
        <nav className="p-3 flex flex-col gap-0.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 mb-1 mt-1">
            Files
          </p>
          {jobNav.map((item) => (
            <NavLink key={item.href} item={item} exact={item.href === `/jobs/${jobId}`} />
          ))}
        </nav>
      </aside>
    );
  }

  return (
    <aside className="w-56 border-r border-border bg-sidebar flex flex-col shrink-0 overflow-y-auto">
      <nav className="p-3 flex flex-col gap-0.5 mt-2">
        {globalNav.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>
    </aside>
  );
}
