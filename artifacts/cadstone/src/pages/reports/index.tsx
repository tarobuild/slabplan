import { NavLink, Outlet } from "react-router-dom"
import PageHeader from "@/components/layout/PageHeader"
import { cn } from "@/lib/utils"
import { revealOnFocus } from "@/lib/reveal-on-focus"

const TABS = [
  { to: "ar-aging", label: "A/R Aging" },
  { to: "revenue", label: "Revenue by Month" },
  { to: "pipeline", label: "Pipeline & Win Rate" },
  { to: "days-to-payment", label: "Days to Payment" },
  { to: "jobs-by-stage", label: "Jobs by Stage" },
]

export default function ReportsLayout() {
  return (
    <div>
      <PageHeader title="Reports" />
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        {/* Padded scroller so the selected pill and keyboard focus ring are
            never clipped on narrow screens. */}
        <nav
          aria-label="Reports"
          className="scrollbar-none -mx-1.5 flex scroll-px-1.5 flex-row gap-1 overflow-x-auto p-1.5 lg:w-56 lg:shrink-0 lg:flex-col lg:overflow-visible"
        >
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              onFocus={revealOnFocus}
              className={({ isActive }) =>
                cn(
                  "whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isActive
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-4">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
