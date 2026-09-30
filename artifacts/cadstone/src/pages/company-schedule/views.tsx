import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Check, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { buildMonthGroups, buildScaleUnits, colorWithAlpha, diffInDays, parseDate } from "../job-schedule/calendar-utils"
import { DAY_WIDTH_BY_SCALE } from "../job-schedule/constants"
import type { GanttScale } from "../job-schedule/types"
import {
  buildLanes,
  deriveStatus,
  formatSpan,
  ganttSpan,
  groupRowsByJob,
  itemHref,
  rowColor,
  rowsOnDay,
  type CalendarViewMode,
  type ScheduleRow,
  type ViewWindow,
} from "./layout"

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" })
const WEEKDAY_LONG = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" })
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

function dayNumber(day: string) {
  return Number(day.slice(8, 10))
}

function itemLabel(row: ScheduleRow, today: string) {
  const job = [row.clientName, row.jobTitle].filter(Boolean).join(" · ")
  return `${row.title}${job ? `, ${job}` : ""}, ${formatSpan(row)}, ${deriveStatus(row, today).label}`
}

function tint(row: ScheduleRow, alpha: number) {
  return colorWithAlpha(rowColor(row), alpha)
}

/**
 * A schedule item that opens its job's schedule, or plain content for roles
 * that cannot open jobs (drafters). Focus rings are inset so scrolling
 * containers never clip them.
 */
function ItemTarget({
  row,
  canOpenJobs,
  className,
  style,
  label,
  children,
  mouseOnly = false,
}: {
  row: ScheduleRow
  canOpenJobs: boolean
  className?: string
  style?: CSSProperties
  label: string
  children: ReactNode
  /** A duplicate click target for pointer users; keyboard users use the row label. */
  mouseOnly?: boolean
}) {
  if (!canOpenJobs) {
    return (
      <div className={className} style={style} title={label} aria-hidden={mouseOnly || undefined}>
        {children}
      </div>
    )
  }
  return (
    <Link
      to={itemHref(row)}
      className={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
      style={style}
      title={label}
      aria-label={mouseOnly ? undefined : label}
      aria-hidden={mouseOnly || undefined}
      tabIndex={mouseOnly ? -1 : undefined}
    >
      {children}
    </Link>
  )
}

export function PeriodNavigator({
  mode,
  label,
  onPrevious,
  onNext,
  onToday,
}: {
  mode: CalendarViewMode
  label: string
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
}) {
  const unit = mode === "week" ? "week" : mode === "month" ? "month" : "period"
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="schedule-period-nav">
      <Button variant="outline" size="icon" className="size-9" onClick={onPrevious} aria-label={`Previous ${unit}`}>
        <ChevronLeft />
      </Button>
      <Button variant="outline" size="sm" className="min-h-9 px-4" onClick={onToday}>
        Today
      </Button>
      <Button variant="outline" size="icon" className="size-9" onClick={onNext} aria-label={`Next ${unit}`}>
        <ChevronRight />
      </Button>
      <h2 className="ml-1 text-base font-semibold text-foreground" data-testid="schedule-period-label" aria-live="polite">
        {label}
      </h2>
    </div>
  )
}

function EmptyPeriod() {
  return (
    <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing scheduled in this period.</p>
  )
}

// ---------------------------------------------------------------- Gantt

export function CompanyGanttView({
  rows,
  window,
  scale,
  today,
  canOpenJobs,
}: {
  rows: ScheduleRow[]
  window: ViewWindow
  scale: GanttScale
  today: string
  canOpenJobs: boolean
}) {
  const groups = groupRowsByJob(rows)
  const dayCount = window.days.length
  const todayIndex = window.days.indexOf(today)
  const dayWidth = DAY_WIDTH_BY_SCALE[scale]
  const timelineWidth = dayCount * dayWidth
  const start = parseDate(window.start)
  const end = parseDate(window.end)
  const monthGroups = buildMonthGroups(start, end, dayWidth)
  const headingGroups = scale === "month" || scale === "year"
    ? buildScaleUnits("year", start, end, dayWidth)
    : monthGroups
  const units = buildScaleUnits(scale === "year" ? "month" : scale, start, end, dayWidth)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || todayIndex < 0) return
    const revealToday = () => {
      const labelWidth = labelRef.current?.offsetWidth ?? 0
      const renderedDayWidth = (scroller.scrollWidth - labelWidth) / dayCount
      const visibleTimeline = scroller.clientWidth - labelWidth
      scroller.scrollLeft = Math.max(0, (todayIndex + 0.5) * renderedDayWidth - visibleTimeline / 2)
    }
    revealToday()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(revealToday)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [dayCount, scale, todayIndex, window.start])
  const columns: CSSProperties = {
    gridTemplateColumns: "var(--gantt-label) minmax(0, 1fr)",
  }

  return (
    <div
      ref={scrollerRef}
      className="overflow-x-auto rounded-lg border border-card-border bg-card shadow-sm [--gantt-label:9.5rem] md:[--gantt-label:15rem]"
      data-testid="schedule-gantt"
      data-scale={scale}
    >
      <div className="relative" style={{ minWidth: `calc(var(--gantt-label) + ${timelineWidth}px)` }}>
        <div className="sticky top-0 z-20 border-b border-border bg-card">
          <div className="grid" style={columns}>
            <div ref={labelRef} className="sticky left-0 z-10 flex items-end border-r border-border bg-card px-3 pb-2 text-xs font-medium text-muted-foreground">
              Job / task
            </div>
            <div className="min-w-0">
              <div className="flex h-8 border-b border-border">
                {headingGroups.map((group) => (
                  <div key={group.key} className="flex min-w-0 shrink-0 items-center border-r border-border px-2 text-xs font-semibold" style={{ width: `${group.width / timelineWidth * 100}%` }} title={group.label}>
                    <span className="sticky left-[calc(var(--gantt-label)+0.5rem)] max-w-full truncate">{group.label}</span>
                  </div>
                ))}
              </div>
              <div className="flex h-10" data-testid="gantt-scale-headings">
                {units.map((unit) => {
                  const isToday = todayIndex >= 0 && todayIndex >= diffInDays(start, unit.start) && todayIndex <= diffInDays(start, unit.end)
                  return (
                    <div key={unit.key} className={cn("flex min-w-0 shrink-0 items-center justify-center overflow-hidden border-r border-border/60 px-1 text-xs tabular-nums text-muted-foreground", isToday && "bg-accent font-semibold text-primary")} style={{ width: `${unit.width / timelineWidth * 100}%` }} title={unit.label}>
                      {scale === "day" ? (
                        <span className="flex flex-col items-center leading-4">
                          <span className="text-[10px]">{WEEKDAY.format(unit.start)}</span>
                          <span>{unit.start.getDate()}</span>
                        </span>
                      ) : <span className="truncate">{unit.label}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="relative">
          {/* Scale boundaries share the exact timeline geometry with the bars. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid" style={columns}>
            <div />
            <div className="relative flex min-w-0">
              {units.map((unit) => (
                <div key={unit.key} className="shrink-0 border-r border-border/60" style={{ width: `${unit.width / timelineWidth * 100}%` }} />
              ))}
            </div>
          </div>
          {todayIndex >= 0 ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 z-[1] w-0.5 -translate-x-1/2 bg-brand"
              style={{
                left: `calc(var(--gantt-label) + (100% - var(--gantt-label)) * ${(todayIndex + 0.5) / dayCount})`,
              }}
            />
          ) : null}

          {groups.length === 0 ? <EmptyPeriod /> : null}
          <ul className="relative" aria-label="Scheduled work by job">
            {groups.map((group) => (
              <li key={group.key}>
                <div className="grid border-b border-border bg-card/80" style={columns}>
                  <div className="sticky left-0 z-10 min-w-0 border-r border-border bg-card px-3 py-2">
                    {canOpenJobs && group.jobId ? (
                      <Link
                        to={`/jobs/${group.jobId}/schedule`}
                        title={group.jobTitle}
                        className="line-clamp-2 rounded-sm text-xs font-semibold text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:line-clamp-none md:block md:truncate md:text-sm"
                      >
                        {group.jobTitle}
                      </Link>
                    ) : (
                      <p className="line-clamp-2 text-xs font-semibold text-foreground md:line-clamp-none md:truncate md:text-sm" title={group.jobTitle}>{group.jobTitle}</p>
                    )}
                    {group.clientName ? (
                      <p className="truncate text-xs text-muted-foreground">{group.clientName}</p>
                    ) : null}
                  </div>
                  <div />
                </div>
                <ul aria-label={`${group.jobTitle} tasks`}>
                  {group.rows.map((row) => {
                    const span = ganttSpan(row, window)
                    const status = deriveStatus(row, today)
                    const label = itemLabel(row, today)
                    const progress = row.isComplete ? 100 : Math.max(0, Math.min(100, row.progress ?? 0))
                    return (
                      <li key={row.id} className="grid h-10 items-center border-b border-border/60" style={columns} data-testid="gantt-row">
                        <ItemTarget
                          row={row}
                          canOpenJobs={canOpenJobs}
                          label={label}
                          className="sticky left-0 z-10 flex h-full min-w-0 items-center gap-2 border-r border-border bg-card px-3 text-[13px] text-foreground hover:text-primary"
                        >
                          <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: rowColor(row) }} />
                          <span className={cn("min-w-0 line-clamp-2 text-xs leading-4 md:line-clamp-none md:truncate md:text-[13px]", row.isComplete && "text-muted-foreground line-through")}>
                            {row.title}
                          </span>
                          {status.label === "Overdue" ? (
                            <span className="ml-auto shrink-0 text-[11px] font-medium text-rose-700">Overdue</span>
                          ) : null}
                        </ItemTarget>
                        <div className="relative h-full min-w-0">
                        {span ? (
                          <ItemTarget
                            row={row}
                            canOpenJobs={canOpenJobs}
                            label={label}
                            mouseOnly
                            className={cn(
                              "absolute top-2 z-[2] flex h-6 min-w-0 items-center overflow-hidden rounded-md text-[11px] font-medium text-foreground",
                              span.continuesBefore ? "rounded-l-none" : "border-l-[3px]",
                              span.continuesAfter && "rounded-r-none",
                              row.isComplete && "opacity-60",
                            )}
                            style={{
                              left: `${span.startIndex / dayCount * 100}%`,
                              width: `${(span.endIndex - span.startIndex + 1) / dayCount * 100}%`,
                              backgroundColor: tint(row, 0.16),
                              borderLeftColor: rowColor(row),
                            }}
                          >
                            <span
                              aria-hidden="true"
                              className="absolute inset-y-0 left-0"
                              style={{ width: `${progress}%`, backgroundColor: tint(row, 0.28) }}
                            />
                            <span className="relative flex min-w-0 items-center gap-1 px-1.5">
                              {row.isComplete ? <Check className="size-3 shrink-0" /> : null}
                              {(span.endIndex - span.startIndex + 1) * dayWidth >= 80 ? (
                                <span className="truncate">{formatSpan(row)}</span>
                              ) : null}
                            </span>
                          </ItemTarget>
                        ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Week

function AgendaItem({ row, today, canOpenJobs }: { row: ScheduleRow; today: string; canOpenJobs: boolean }) {
  const status = deriveStatus(row, today)
  return (
    <ItemTarget
      row={row}
      canOpenJobs={canOpenJobs}
      label={itemLabel(row, today)}
      className="flex min-w-0 items-start gap-3 rounded-lg border-l-[3px] px-3 py-2.5"
      style={{ backgroundColor: tint(row, 0.1), borderLeftColor: rowColor(row) }}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium text-foreground", row.isComplete && "text-muted-foreground line-through")}>
          {row.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {[row.jobTitle, formatSpan(row)].filter(Boolean).join(" · ")}
        </p>
      </div>
      {status.label === "Overdue" ? (
        <span className="shrink-0 text-[11px] font-medium text-rose-700">Overdue</span>
      ) : null}
    </ItemTarget>
  )
}

function LaneChip({
  row,
  today,
  canOpenJobs,
  continuesBefore,
  continuesAfter,
  compact,
  style,
}: {
  row: ScheduleRow
  today: string
  canOpenJobs: boolean
  continuesBefore: boolean
  continuesAfter: boolean
  compact?: boolean
  style: CSSProperties
}) {
  return (
    <ItemTarget
      row={row}
      canOpenJobs={canOpenJobs}
      label={itemLabel(row, today)}
      className={cn(
        "mx-0.5 flex min-w-0 flex-col justify-center rounded-md px-2 text-left hover:brightness-95",
        compact ? "h-[26px]" : "py-1.5",
        continuesBefore ? "rounded-l-none" : "border-l-[3px]",
        continuesAfter && "rounded-r-none",
        row.isComplete && "opacity-60",
      )}
      style={{ ...style, backgroundColor: tint(row, 0.14), borderLeftColor: rowColor(row) }}
    >
      <span className={cn("truncate font-medium text-foreground", compact ? "text-[12px]" : "text-[13px]", row.isComplete && "line-through")}>
        {row.title}
      </span>
      {!compact && row.jobTitle ? (
        <span className="truncate text-[11px] text-muted-foreground">{row.jobTitle}</span>
      ) : null}
    </ItemTarget>
  )
}

function DayHeader({ day, today }: { day: string; today: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <span className="text-xs font-medium text-muted-foreground">{WEEKDAY.format(parseDate(day))}</span>
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
          day === today ? "bg-primary text-primary-foreground" : "text-foreground",
        )}
      >
        {dayNumber(day)}
      </span>
    </div>
  )
}

export function CompanyWeekView({
  rows,
  window,
  today,
  canOpenJobs,
}: {
  rows: ScheduleRow[]
  window: ViewWindow
  today: string
  canOpenJobs: boolean
}) {
  const segments = buildLanes(window.days, rows)
  return (
    <div data-testid="schedule-week">
      {/* Desktop and tablet: a seven-day lane calendar. */}
      <div className="hidden overflow-hidden rounded-lg border border-card-border bg-card shadow-sm md:block" data-testid="schedule-week-grid">
        <div className="grid grid-cols-7 border-b border-border">
          {window.days.map((day) => (
            <DayHeader key={day} day={day} today={today} />
          ))}
        </div>
        <div className="relative min-h-[320px]">
          <div aria-hidden="true" className="absolute inset-0 grid grid-cols-7">
            {window.days.map((day, index) => (
              <div key={day} className={cn(index > 0 && "border-l border-border", day === today && "bg-accent/50")} />
            ))}
          </div>
          <ul className="relative grid grid-cols-7 gap-y-1.5 p-1.5" aria-label={`Scheduled work, ${window.label}`}>
            {segments.map((segment) => (
              <li
                key={segment.row.id}
                className="contents"
              >
                <LaneChip
                  row={segment.row}
                  today={today}
                  canOpenJobs={canOpenJobs}
                  continuesBefore={segment.continuesBefore}
                  continuesAfter={segment.continuesAfter}
                  style={{ gridColumn: `${segment.startIndex + 1} / ${segment.endIndex + 2}`, gridRow: segment.lane + 1 }}
                />
              </li>
            ))}
          </ul>
          {segments.length === 0 ? <div className="relative"><EmptyPeriod /></div> : null}
        </div>
      </div>

      {/* Phones: the same week as a day-by-day agenda. */}
      <ol className="space-y-5 md:hidden" data-testid="schedule-week-agenda">
        {window.days.map((day) => {
          const dayRows = rowsOnDay(day, rows)
          return (
            <li key={day}>
              <h3 className="flex items-center gap-2 border-b border-border pb-1.5 text-sm font-semibold text-foreground">
                {WEEKDAY_LONG.format(parseDate(day))}
                {day === today ? (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">Today</span>
                ) : null}
              </h3>
              {dayRows.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">Nothing scheduled</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {dayRows.map((row) => (
                    <li key={row.id}>
                      <AgendaItem row={row} today={today} canOpenJobs={canOpenJobs} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------- Month

const MONTH_MAX_LANES = 3

export function CompanyMonthView({
  rows,
  window,
  anchor,
  today,
  canOpenJobs,
  onOpenWeek,
}: {
  rows: ScheduleRow[]
  window: ViewWindow
  anchor: string
  today: string
  canOpenJobs: boolean
  onOpenWeek: (day: string) => void
}) {
  const month = anchor.slice(0, 7)
  const weeks = Array.from({ length: window.days.length / 7 }, (_, index) => window.days.slice(index * 7, index * 7 + 7))
  const defaultDay = today.startsWith(month) ? today : `${month}-01`
  const [selectedDay, setSelectedDay] = useState(defaultDay)
  useEffect(() => setSelectedDay(defaultDay), [defaultDay])
  const selectedRows = rowsOnDay(selectedDay, rows)

  return (
    <div data-testid="schedule-month">
      {/* Desktop and tablet: month calendar with lanes and "+N more". */}
      <div className="hidden overflow-hidden rounded-lg border border-card-border bg-card shadow-sm md:block" data-testid="schedule-month-grid">
        <div className="grid grid-cols-7 border-b border-border">
          {weeks[0].map((day) => (
            <div key={day} className="py-2 text-center text-xs font-medium text-muted-foreground">
              {WEEKDAY.format(parseDate(day))}
            </div>
          ))}
        </div>
        {weeks.map((week) => {
          const segments = buildLanes(week, rows)
          const visible = segments.filter((segment) => segment.lane < MONTH_MAX_LANES)
          const hiddenByDay = week.map(
            (_, dayIndex) =>
              segments.filter(
                (segment) =>
                  segment.lane >= MONTH_MAX_LANES && segment.startIndex <= dayIndex && segment.endIndex >= dayIndex,
              ).length,
          )
          return (
            <div key={week[0]} className="relative min-h-[118px] border-b border-border last:border-b-0">
              <div aria-hidden="true" className="absolute inset-0 grid grid-cols-7">
                {week.map((day, index) => (
                  <div
                    key={day}
                    className={cn(
                      "px-2 pt-1.5",
                      index > 0 && "border-l border-border",
                      !day.startsWith(month) && "bg-muted/40",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                        day === today
                          ? "bg-primary text-primary-foreground"
                          : day.startsWith(month)
                            ? "text-foreground"
                            : "text-muted-foreground/60",
                      )}
                    >
                      {dayNumber(day)}
                    </span>
                  </div>
                ))}
              </div>
              <ul className="relative grid grid-cols-7 gap-y-1 px-0.5 pb-2 pt-9" aria-label={`Week of ${MONTH_DAY.format(parseDate(week[0]))}`}>
                {visible.map((segment) => (
                  <li key={segment.row.id} className="contents">
                    <LaneChip
                      row={segment.row}
                      today={today}
                      canOpenJobs={canOpenJobs}
                      continuesBefore={segment.continuesBefore}
                      continuesAfter={segment.continuesAfter}
                      compact
                      style={{ gridColumn: `${segment.startIndex + 1} / ${segment.endIndex + 2}`, gridRow: segment.lane + 1 }}
                    />
                  </li>
                ))}
                {hiddenByDay.map((count, dayIndex) =>
                  count > 0 ? (
                    <li key={`more-${week[dayIndex]}`} className="contents">
                      <button
                        type="button"
                        onClick={() => onOpenWeek(week[dayIndex])}
                        className="mx-1 justify-self-start rounded-full px-1.5 text-[11px] font-semibold text-primary outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        style={{ gridColumn: `${dayIndex + 1} / ${dayIndex + 2}`, gridRow: MONTH_MAX_LANES + 1 }}
                        aria-label={`${count} more on ${MONTH_DAY.format(parseDate(week[dayIndex]))}, open week`}
                      >
                        +{count} more
                      </button>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          )
        })}
      </div>

      {/* Phones: a compact month with activity dots, then the chosen day. */}
      <div className="space-y-4 md:hidden" data-testid="schedule-month-compact">
        <div className="rounded-lg border border-card-border bg-card p-2 shadow-sm">
          <div className="grid grid-cols-7">
            {weeks[0].map((day) => (
              <div key={day} className="py-1 text-center text-[11px] font-medium text-muted-foreground">
                {WEEKDAY.format(parseDate(day)).slice(0, 1)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1">
            {window.days.map((day) => {
              const dayRows = rowsOnDay(day, rows)
              const selected = day === selectedDay
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  aria-pressed={selected}
                  aria-label={`${WEEKDAY_LONG.format(parseDate(day))}, ${dayRows.length} ${dayRows.length === 1 ? "item" : "items"}`}
                  className={cn(
                    "mx-auto flex h-11 w-full max-w-11 flex-col items-center justify-center gap-0.5 rounded-full text-sm tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "bg-accent font-semibold text-accent-foreground" : "hover:bg-muted",
                    !day.startsWith(month) && !selected && "text-muted-foreground/60",
                  )}
                >
                  <span className={cn(day === today && !selected && "font-bold text-primary")}>{dayNumber(day)}</span>
                  <span aria-hidden="true" className="flex h-1.5 gap-0.5">
                    {dayRows.slice(0, 3).map((row) => (
                      <span key={row.id} className="size-1.5 rounded-full" style={{ backgroundColor: rowColor(row) }} />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <section aria-live="polite">
          <h3 className="border-b border-border pb-1.5 text-sm font-semibold text-foreground">
            {WEEKDAY_LONG.format(parseDate(selectedDay))}
          </h3>
          {selectedRows.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">Nothing scheduled</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {selectedRows.map((row) => (
                <li key={row.id}>
                  <AgendaItem row={row} today={today} canOpenJobs={canOpenJobs} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
