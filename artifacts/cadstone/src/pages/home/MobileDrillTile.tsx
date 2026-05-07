import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { api } from "@/lib/api"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

const UNASSIGNED_KEY = "__unassigned__"

type TileProps = {
  label: string
  value: string | number
  to: string
  sub?: string
  icon?: ReactNode
  drillTitle: string
  drillKind: "active-jobs" | "open-leads" | "open-schedule"
  testId?: string
}

/**
 * Home-page summary tile that on mobile (< md) opens a bottom sheet
 * drill-down listing items by name. On md+ it behaves exactly like
 * the previous Link-based tile so desktop is untouched (#364).
 */
export function MobileDrillTile({
  label,
  value,
  to,
  sub,
  icon,
  drillTitle,
  drillKind,
  testId,
}: TileProps) {
  const [open, setOpen] = useState(false)
  const tileBody = (
    <>
      {icon ? (
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {label}
          </p>
        </div>
      ) : (
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
      )}
      <p
        className={`text-2xl font-semibold tabular-nums text-slate-900 ${
          icon ? "mt-2" : "mt-1"
        }`}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </>
  )
  const cls =
    "block w-full rounded-lg border border-[#E5E7EB] bg-white p-4 text-left transition hover:border-orange-300 hover:bg-orange-50/40"
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`md:hidden ${cls}`}
        data-testid={testId}
        aria-label={`${label}: ${value}. View list.`}
      >
        {tileBody}
      </button>
      <Link
        to={to}
        className={`hidden md:block ${cls}`}
        data-testid={testId}
      >
        {tileBody}
      </Link>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] overflow-y-auto rounded-t-xl"
        >
          <SheetHeader>
            <SheetTitle>{drillTitle}</SheetTitle>
          </SheetHeader>
          {open ? (
            <div className="mt-3">
              <DrillContent kind={drillKind} onNavigate={() => setOpen(false)} />
            </div>
          ) : null}
          <div className="mt-4 border-t border-[#E5E7EB] pt-3">
            <Link
              to={to}
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-orange-600 hover:text-orange-700"
            >
              View full page →
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function DrillContent({
  kind,
  onNavigate,
}: {
  kind: TileProps["drillKind"]
  onNavigate: () => void
}) {
  if (kind === "active-jobs") return <ActiveJobsDrill onNavigate={onNavigate} />
  if (kind === "open-leads") return <OpenLeadsDrill onNavigate={onNavigate} />
  return <OpenScheduleDrill onNavigate={onNavigate} />
}

function DrillStatus({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-slate-400">
      {children}
    </div>
  )
}

// -------------------- Active jobs (grouped by client) --------------------
type DrillJob = {
  id: string
  title: string
  status: "open" | "closed" | "archived"
  clientId: string | null
  clientName: string | null
}

function ActiveJobsDrill({ onNavigate }: { onNavigate: () => void }) {
  const [jobs, setJobs] = useState<DrillJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    api
      .get("/jobs?pageSize=200")
      .then((r) => {
        if (!active) return
        const list = (r.data.jobs ?? r.data ?? []) as DrillJob[]
        setJobs(list)
      })
      .catch(() => {
        if (active) setError("Couldn't load jobs.")
      })
    return () => {
      active = false
    }
  }, [])

  const groups = useMemo(() => {
    if (!jobs) return []
    const open = jobs.filter((j) => j.status === "open")
    const map = new Map<
      string,
      { key: string; clientId: string | null; clientName: string; jobs: DrillJob[] }
    >()
    for (const j of open) {
      const key = j.clientId ?? UNASSIGNED_KEY
      const name = j.clientId
        ? j.clientName ?? "(Unnamed client)"
        : "Unassigned"
      if (!map.has(key)) {
        map.set(key, { key, clientId: j.clientId, clientName: name, jobs: [] })
      }
      map.get(key)!.jobs.push(j)
    }
    const arr = Array.from(map.values())
    for (const g of arr) g.jobs.sort((a, b) => a.title.localeCompare(b.title))
    arr.sort((a, b) => {
      if (a.clientId === null && b.clientId !== null) return 1
      if (b.clientId === null && a.clientId !== null) return -1
      return a.clientName.localeCompare(b.clientName)
    })
    return arr
  }, [jobs])

  if (error) return <DrillStatus>{error}</DrillStatus>
  if (!jobs)
    return (
      <DrillStatus>
        <Loader2 className="size-4 animate-spin" /> Loading…
      </DrillStatus>
    )
  if (groups.length === 0)
    return <DrillStatus>No open jobs.</DrillStatus>

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.key} className="overflow-hidden rounded-lg border border-[#E5E7EB]">
          {g.clientId ? (
            <Link
              to={`/clients/${g.clientId}`}
              onClick={onNavigate}
              className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 hover:text-orange-700"
            >
              <span className="truncate">{g.clientName}</span>
              <span className="shrink-0 text-[10px] text-slate-400">
                {g.jobs.length}
              </span>
            </Link>
          ) : (
            <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span className="truncate">{g.clientName}</span>
              <span className="shrink-0 text-[10px] text-slate-400">
                {g.jobs.length}
              </span>
            </div>
          )}
          <ul>
            {g.jobs.map((j) => (
              <li key={j.id} className="border-t border-slate-100 first:border-t-0">
                <Link
                  to={`/jobs/${j.id}`}
                  onClick={onNavigate}
                  className="block min-h-[44px] px-3 py-2.5 text-sm font-medium text-slate-800 hover:bg-orange-50/40"
                >
                  {j.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

// -------------------- Open leads --------------------
type DrillLead = {
  id: string
  title: string
  status: string
  city: string | null
  state: string | null
}

const OPEN_LEAD_STATUSES = new Set(["open", "qualified", "in_negotiation"])

function OpenLeadsDrill({ onNavigate }: { onNavigate: () => void }) {
  const [leads, setLeads] = useState<DrillLead[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    api
      .get("/leads?pageSize=200")
      .then((r) => {
        if (!active) return
        const list = (r.data.leads ?? r.data ?? []) as DrillLead[]
        setLeads(list)
      })
      .catch(() => {
        if (active) setError("Couldn't load leads.")
      })
    return () => {
      active = false
    }
  }, [])

  if (error) return <DrillStatus>{error}</DrillStatus>
  if (!leads)
    return (
      <DrillStatus>
        <Loader2 className="size-4 animate-spin" /> Loading…
      </DrillStatus>
    )
  const open = leads.filter((l) => OPEN_LEAD_STATUSES.has(l.status))
  if (open.length === 0) return <DrillStatus>No open leads.</DrillStatus>

  return (
    <ul className="overflow-hidden rounded-lg border border-[#E5E7EB]">
      {open.map((l) => {
        const loc = [l.city, l.state].filter(Boolean).join(", ")
        return (
          <li key={l.id} className="border-t border-slate-100 first:border-t-0">
            <Link
              to={`/sales/leads?lead=${l.id}`}
              onClick={onNavigate}
              className="flex min-h-[44px] flex-col justify-center px-3 py-2.5 hover:bg-orange-50/40"
            >
              <span className="truncate text-sm font-medium text-slate-800">
                {l.title}
              </span>
              {loc ? (
                <span className="text-xs text-slate-500">{loc}</span>
              ) : null}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

// -------------------- Open schedule items --------------------
type DrillScheduleItem = {
  id: string
  title: string
  startDate: string | null
  endDate: string | null
  isComplete: boolean | null
  jobId: string
  jobTitle?: string | null
  clientName?: string | null
}

function OpenScheduleDrill({ onNavigate }: { onNavigate: () => void }) {
  const [items, setItems] = useState<DrillScheduleItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    api
      .get("/schedule", { params: { limit: 100 } })
      .then((r) => {
        if (!active) return
        const list = (r.data.data ?? r.data.items ?? []) as DrillScheduleItem[]
        setItems(list)
      })
      .catch(() => {
        if (active) setError("Couldn't load schedule.")
      })
    return () => {
      active = false
    }
  }, [])

  if (error) return <DrillStatus>{error}</DrillStatus>
  if (!items)
    return (
      <DrillStatus>
        <Loader2 className="size-4 animate-spin" /> Loading…
      </DrillStatus>
    )
  const open = items.filter((i) => !i.isComplete)
  if (open.length === 0)
    return <DrillStatus>No open schedule items.</DrillStatus>

  return (
    <ul className="overflow-hidden rounded-lg border border-[#E5E7EB]">
      {open.map((i) => {
        const range = i.startDate
          ? i.endDate && i.endDate !== i.startDate
            ? `${i.startDate} → ${i.endDate}`
            : i.startDate
          : ""
        return (
          <li key={i.id} className="border-t border-slate-100 first:border-t-0">
            <Link
              to={`/jobs/${i.jobId}/schedule`}
              onClick={onNavigate}
              className="flex min-h-[44px] flex-col justify-center px-3 py-2.5 hover:bg-orange-50/40"
            >
              <span className="truncate text-sm font-medium text-slate-800">
                {i.title}
              </span>
              <span className="truncate text-xs text-slate-500">
                {[i.jobTitle, range].filter(Boolean).join(" · ")}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
