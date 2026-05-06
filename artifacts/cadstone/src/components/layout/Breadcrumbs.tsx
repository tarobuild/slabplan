import { useMemo } from "react"
import { Link, useLocation, useParams } from "react-router-dom"
import { ChevronRight, Home } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  useBreadcrumbsOverride,
  type BreadcrumbItem,
} from "@/hooks/use-breadcrumbs"

// Routes that should NOT render breadcrumbs (auth-style or terminal pages).
const HIDE_ON_PREFIXES = ["/login", "/accept-invite", "/register"]
const HIDE_EXACT = new Set(["/", "/dashboard", "/403"])

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Home",
  clients: "Clients",
  jobs: "Jobs",
  sales: "Sales",
  leads: "Leads",
  reports: "Reports",
  resources: "Resources",
  settings: "Settings",
  users: "Users",
  files: "Files",
  documents: "Documents",
  photos: "Photos",
  videos: "Videos",
  schedule: "Schedule",
  financials: "Financials",
  summary: "Summary",
  "daily-logs": "Daily Logs",
  mine: "Mine",
}

function toLabel(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment]
  // UUID-ish or numeric — show a generic placeholder; pages should override.
  if (/^[0-9a-f-]{8,}$/i.test(segment)) return "Detail"
  return segment.replace(/(^|-)([a-z])/g, (_, sep, c) => (sep ? " " : "") + c.toUpperCase())
}

function deriveFromPath(pathname: string): BreadcrumbItem[] {
  const parts = pathname.split("/").filter(Boolean)
  if (parts.length === 0) return []
  const items: BreadcrumbItem[] = []
  let acc = ""
  for (let i = 0; i < parts.length; i += 1) {
    acc += `/${parts[i]}`
    items.push({
      label: toLabel(parts[i]),
      to: i < parts.length - 1 ? acc : undefined,
    })
  }
  return items
}

export default function Breadcrumbs() {
  const location = useLocation()
  const override = useBreadcrumbsOverride()
  const params = useParams()

  const items = useMemo<BreadcrumbItem[]>(() => {
    if (override && override.length > 0) return override
    return deriveFromPath(location.pathname)
  }, [override, location.pathname, params])

  const path = location.pathname

  if (HIDE_EXACT.has(path)) return null
  if (HIDE_ON_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return null
  }
  if (items.length === 0) return null

  return (
    <nav
      aria-label="breadcrumb"
      data-print-hide="true"
      className="border-b border-slate-200 bg-white px-3 py-2 lg:px-5"
    >
      <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
        <li className="inline-flex items-center">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Home"
          >
            <Home className="size-3.5" />
            <span className="hidden sm:inline">Home</span>
          </Link>
        </li>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1
          return (
            <li key={`${item.label}-${idx}`} className="inline-flex items-center gap-1">
              <ChevronRight aria-hidden="true" className="size-3 text-slate-300" />
              {item.to && !isLast ? (
                <Link
                  to={item.to}
                  className="rounded px-1.5 py-0.5 hover:bg-slate-100 hover:text-slate-800"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={cn(
                    "px-1.5 py-0.5",
                    isLast ? "font-medium text-slate-800" : "text-slate-500",
                  )}
                >
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
