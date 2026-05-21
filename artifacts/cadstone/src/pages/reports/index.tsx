import { NavLink, Outlet } from "react-router-dom"

const TABS = [
  { to: "ar-aging", label: "A/R Aging" },
  { to: "revenue", label: "Revenue by Month" },
  { to: "pipeline", label: "Pipeline & Win Rate" },
  { to: "days-to-payment", label: "Days to Payment" },
  { to: "jobs-by-stage", label: "Jobs by Stage" },
]

export default function ReportsLayout() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 lg:flex-row">
      <aside className="lg:w-56">
        <h1 className="mb-3 text-lg font-semibold text-foreground">Reports</h1>
        <nav className="flex flex-row gap-1 overflow-x-auto lg:flex-col">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded px-3 py-2 text-sm ${
                  isActive
                    ? "bg-accent font-medium text-primary"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 space-y-4">
        <Outlet />
      </main>
    </div>
  )
}
