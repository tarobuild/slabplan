import type { Dispatch, MutableRefObject, Ref, SetStateAction, PointerEvent as ReactPointerEvent } from "react"
import { CalendarDays, ChevronLeft, ChevronRight, Filter, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  classifyWorkday,
  dateKey,
  DEFAULT_SCHEDULE_COLOR,
  fmtClockRange,
  fmtDate,
  itemEndDate,
  itemOverlapsDateRange,
  type ScheduleItemRecord,
  type ScheduleWorkdayException,
} from "@/lib/schedule"
import type { SchedulePreview } from "@/components/schedule/ScheduleItemDialog"

import { CALENDAR_PERIODS, DAYS_OF_WEEK } from "../constants"
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  DRAG_SNAP_MINUTES,
  HOUR_HEIGHT,
  type BlockDrag,
  type DragSelection,
  minutesToTimeString,
} from "../drag"
import {
  addDays,
  buildDayTimelineSegments,
  buildWeekSegments,
  colorWithAlpha,
  formatHourLabel,
  formatLongDate,
  parseDate,
  previewBoundsForDay,
  previewSegmentForWeek,
  startOfWeek,
} from "../calendar-utils"
import { buildFilterPreset, titleCaseStatus } from "../filters"
import type { CalendarPeriod, FilterState } from "../types"

interface CalendarViewProps {
  loading: boolean
  jobId: string | undefined
  calendarPeriod: CalendarPeriod
  setCalendarPeriod: Dispatch<SetStateAction<CalendarPeriod>>
  calendarExpanded: boolean
  setCalendarExpanded: Dispatch<SetStateAction<boolean>>
  calendarHintDismissed: boolean
  setCalendarHintDismissed: Dispatch<SetStateAction<boolean>>
  calendarAnchorDate: Date
  setCalendarAnchorDate: Dispatch<SetStateAction<Date>>
  monthPickerRef: Ref<HTMLInputElement>
  currentRangeLabel: string
  jumpToToday: () => void
  navigateCalendar: (direction: -1 | 1) => void
  openDatePicker: () => void
  monthWeeks: string[][]
  items: ScheduleItemRecord[]
  filteredItems: ScheduleItemRecord[]
  activeItems: ScheduleItemRecord[]
  activeConflictIds: Set<string>
  todayIso: string
  workdayExceptions: ScheduleWorkdayException[]
  schedulePreview: SchedulePreview | null
  blockDrag: BlockDrag | null
  dragSelection: DragSelection | null
  blockClickSuppressRef: MutableRefObject<string | null>
  isBlockDraggable: (item: ScheduleItemRecord) => boolean
  handleBlockPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    item: ScheduleItemRecord,
    dayKey: string,
    mode: "move" | "resize-start" | "resize-end",
  ) => void
  handleTimedColumnPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    dayKey: string,
  ) => void
  openExistingItem: (id: string) => void
  openQuickCreate: (day: string) => void
  setAppliedFilters: Dispatch<SetStateAction<FilterState>>
  setDraftFilters: Dispatch<SetStateAction<FilterState>>
}

export function CalendarView({
  loading,
  jobId,
  calendarPeriod,
  setCalendarPeriod,
  calendarExpanded,
  setCalendarExpanded,
  calendarHintDismissed,
  setCalendarHintDismissed,
  calendarAnchorDate,
  setCalendarAnchorDate,
  monthPickerRef,
  currentRangeLabel,
  jumpToToday,
  navigateCalendar,
  openDatePicker,
  monthWeeks,
  items,
  filteredItems,
  activeItems,
  activeConflictIds,
  todayIso,
  workdayExceptions,
  schedulePreview,
  blockDrag,
  dragSelection,
  blockClickSuppressRef,
  isBlockDraggable,
  handleBlockPointerDown,
  handleTimedColumnPointerDown,
  openExistingItem,
  openQuickCreate,
  setAppliedFilters,
  setDraftFilters,
}: CalendarViewProps) {
  return (
      <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
        <div data-print-hide="true" className="flex flex-col gap-3 border-b border-[#E5E7EB] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={calendarPeriod}
              onValueChange={(value) => {
                setCalendarPeriod(value as CalendarPeriod)
                setCalendarExpanded(false)
              }}
            >
              <SelectTrigger
                className="h-10 w-[150px] border-[#E5E7EB]"
                data-testid="calendar-period-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALENDAR_PERIODS.map((period) => (
                  <SelectItem key={period.value} value={period.value}>
                    {period.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" className="h-10 border-[#E5E7EB]" onClick={jumpToToday}>
              Today
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-[#E5E7EB] p-2 text-slate-500 transition hover:bg-slate-50"
              onClick={() => navigateCalendar(-1)}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              className="rounded-lg border border-[#E5E7EB] px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
              onClick={openDatePicker}
            >
              {currentRangeLabel}
            </button>
            <button
              type="button"
              className="rounded-lg border border-[#E5E7EB] p-2 text-slate-500 transition hover:bg-slate-50"
              onClick={() => navigateCalendar(1)}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <Button
            type="button"
            variant="outline"
            className="h-10 border-[#E5E7EB]"
            disabled={calendarExpanded}
            onClick={() => setCalendarExpanded(true)}
          >
            Expand All
          </Button>
        </div>

        <input
          ref={monthPickerRef}
          type="date"
          className="sr-only"
          value={dateKey(calendarAnchorDate)}
          onChange={(event) => {
            if (event.target.value) {
              setCalendarAnchorDate(parseDate(event.target.value))
            }
          }}
        />

        <div className="p-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-28 w-full" />
              ))}
            </div>
          ) : (
          <div className="space-y-3">
          {activeItems.length === 0 && !calendarHintDismissed ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-sm text-blue-900">
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-blue-600" />
                <span>Click any day to add a schedule item.</span>
              </div>
              <button
                type="button"
                aria-label="Dismiss hint"
                className="rounded p-0.5 text-blue-700/70 hover:bg-blue-100 hover:text-blue-900"
                onClick={() => {
                  setCalendarHintDismissed(true)
                  if (typeof window !== "undefined" && jobId) {
                    try {
                      window.sessionStorage.setItem(`cadstone:job-schedule:hint-dismissed:${jobId}`, "1")
                    } catch {
                      /* ignore storage errors */
                    }
                  }
                }}
              >
                <X className="size-4" />
              </button>
            </div>
          ) : null}
          {activeItems.length > 0 && filteredItems.length === 0 ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2 text-sm text-amber-900">
              <div className="flex items-center gap-2">
                <Filter className="size-4 text-amber-600" />
                <span>
                  0 of {activeItems.length} item{activeItems.length === 1 ? "" : "s"} match your filter
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 border-amber-200 bg-white text-amber-900 hover:bg-amber-50"
                onClick={() => {
                  const reset = buildFilterPreset("all")
                  setAppliedFilters(reset)
                  setDraftFilters(reset)
                }}
              >
                Clear Filters
              </Button>
            </div>
          ) : null}
          {calendarPeriod === "month" ? (
            <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
              <div className="grid grid-cols-7 border-b border-[#E5E7EB] bg-[#F8FAFC]">
                {DAYS_OF_WEEK.map((day, index) => (
                  <div key={day} className="px-3 py-3 text-center">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{day}</p>
                    {index === 0 || index === 6 ? (
                      <p className="mt-1 text-[11px] text-slate-400">Default non-workday</p>
                    ) : null}
                  </div>
                ))}
              </div>

              <div>
                {monthWeeks.map((week) => {
                  const segments = buildWeekSegments(week, filteredItems)
                  const visibleSegments = calendarExpanded
                    ? segments
                    : segments.filter((segment) => segment.lane < 4)
                  const hiddenCount = segments.length - visibleSegments.length
                  const maxLane = visibleSegments.reduce((max, segment) => Math.max(max, segment.lane), -1)
                  const laneCount = Math.max(maxLane + 1, 1)
                  const previewInWeek =
                    schedulePreview && previewSegmentForWeek(week, schedulePreview) ? 1 : 0
                  const rowHeight = 88 + (laneCount + previewInWeek) * 30 + (hiddenCount > 0 ? 18 : 0)
                  const currentMonthPrefix = `${calendarAnchorDate.getFullYear()}-${String(calendarAnchorDate.getMonth() + 1).padStart(2, "0")}`

                  return (
                    <div
                      key={week[0]}
                      className="relative grid grid-cols-7 border-b border-[#E5E7EB] last:border-b-0"
                      style={{ minHeight: `${rowHeight}px` }}
                    >
                      {week.map((day) => {
                        const isCurrentMonth = day.startsWith(currentMonthPrefix)
                        const isToday = day === todayIso
                        const parsedDay = parseDate(day)
                        const workday = classifyWorkday(parsedDay, workdayExceptions)

                        return (
                          <div
                            key={day}
                            className={cn(
                              "border-r border-[#E5E7EB] p-2 last:border-r-0 cursor-pointer group/cell relative hover:bg-blue-50/40 transition-colors",
                              workday.isWorkday
                                ? isCurrentMonth
                                  ? "bg-white"
                                  : "bg-slate-50/70"
                                : "bg-amber-50/70",
                            )}
                            onClick={() => openQuickCreate(day)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span
                                className={cn(
                                  "flex size-7 items-center justify-center rounded-full text-xs font-medium",
                                  isToday
                                    ? "bg-orange-600 text-white"
                                    : isCurrentMonth
                                    ? "text-slate-700"
                                    : "text-slate-300",
                                )}
                              >
                                {parsedDay.getDate()}
                              </span>
                              {!workday.isWorkday || workday.type === "extra_workday" ? (
                                <span className={cn("text-[11px]", workday.isWorkday ? "text-emerald-600" : "text-amber-600")}>
                                  {workday.label}
                                </span>
                              ) : null}
                            </div>
                            <span className="absolute bottom-1 right-1.5 text-slate-300 text-lg leading-none opacity-0 group-hover/cell:opacity-100 transition-opacity">+</span>
                          </div>
                        )
                      })}

                      <div className="pointer-events-none absolute inset-x-0 top-10 bottom-2">
                        {visibleSegments.map((segment) => (
                          <button
                            key={`${segment.item.id}-${segment.startIndex}-${segment.endIndex}-${segment.lane}`}
                            type="button"
                            className={cn(
                              "pointer-events-auto absolute flex h-7 items-center overflow-hidden rounded-full px-3 text-left text-xs font-medium shadow-sm transition hover:opacity-95",
                              segment.item.isPersonalTodo
                                ? "border-2 border-dashed text-slate-700"
                                : "text-white",
                              activeConflictIds.has(segment.item.id) && "ring-2 ring-rose-200",
                            )}
                            style={{
                              backgroundColor: segment.item.isPersonalTodo
                                ? colorWithAlpha(segment.item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                                : segment.item.displayColor || DEFAULT_SCHEDULE_COLOR,
                              borderColor: segment.item.isPersonalTodo
                                ? (segment.item.displayColor || DEFAULT_SCHEDULE_COLOR)
                                : undefined,
                              left: `calc(${(segment.startIndex / 7) * 100}% + 4px)`,
                              width: `calc(${((segment.endIndex - segment.startIndex + 1) / 7) * 100}% - 8px)`,
                              top: `${segment.lane * 30}px`,
                            }}
                            onClick={() => openExistingItem(segment.item.id)}
                          >
                            <span className="truncate">
                              {segment.item.isPersonalTodo ? (segment.item.isComplete ? "☑ " : "☐ ") : segment.item.isComplete ? "✓ " : ""}
                              {segment.item.title}
                            </span>
                          </button>
                        ))}

                        {hiddenCount > 0 ? (
                          <button
                            type="button"
                            className="pointer-events-auto absolute bottom-0 right-3 text-[11px] font-medium text-orange-600 hover:text-orange-700 cursor-pointer"
                            onClick={() => {
                              let bestDay = week[0]
                              let bestCount = 0
                              for (const day of week) {
                                const dayItemCount = filteredItems.filter((item) => itemOverlapsDateRange(item, day, day)).length
                                if (dayItemCount > bestCount) {
                                  bestCount = dayItemCount
                                  bestDay = day
                                }
                              }
                              setCalendarPeriod("day")
                              setCalendarAnchorDate(parseDate(bestDay))
                            }}
                          >
                            +{hiddenCount} more item{hiddenCount === 1 ? "" : "s"}
                          </button>
                        ) : null}

                        {(() => {
                          if (!schedulePreview) {
                            return null
                          }
                          const previewSegment = previewSegmentForWeek(week, schedulePreview)
                          if (!previewSegment) {
                            return null
                          }
                          const previewLane = laneCount
                          return (
                            <div
                              key="schedule-preview"
                              className="pointer-events-none absolute flex h-7 items-center overflow-hidden rounded-full border-2 border-dashed px-3 text-left text-xs font-medium shadow-sm animate-in fade-in"
                              style={{
                                backgroundColor: colorWithAlpha(schedulePreview.displayColor, 0.18),
                                borderColor: schedulePreview.displayColor,
                                color: schedulePreview.displayColor,
                                left: `calc(${(previewSegment.startIndex / 7) * 100}% + 4px)`,
                                width: `calc(${((previewSegment.endIndex - previewSegment.startIndex + 1) / 7) * 100}% - 8px)`,
                                top: `${previewLane * 30}px`,
                              }}
                            >
                              <span className="truncate">
                                {schedulePreview.title}
                                {schedulePreview.isHourly && schedulePreview.startTime && schedulePreview.endTime
                                  ? ` · ${fmtClockRange(schedulePreview.startTime, schedulePreview.endTime)}`
                                  : ""}
                              </span>
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : calendarPeriod === "week" ? (
            <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
              <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-[#E5E7EB] bg-[#F8FAFC]">
                <div className="border-r border-[#E5E7EB] p-3" />
                {Array.from({ length: 7 }).map((_, index) => {
                  const day = addDays(startOfWeek(calendarAnchorDate), index)
                  const dayKey = dateKey(day)
                  const isToday = dayKey === todayIso
                  const workday = classifyWorkday(day, workdayExceptions)

                  return (
                    <div key={dayKey} className="border-r border-[#E5E7EB] p-3 last:border-r-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-900">
                          {new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(day)}
                        </p>
                        <span
                          className={cn(
                            "flex size-7 items-center justify-center rounded-full text-xs font-medium",
                            isToday ? "bg-orange-600 text-white" : "text-slate-600",
                          )}
                        >
                          {day.getDate()}
                        </span>
                      </div>
                      {!workday.isWorkday || workday.type === "extra_workday" ? (
                        <p className={cn("mt-1 text-[11px]", workday.isWorkday ? "text-emerald-600" : "text-amber-600")}>
                          {workday.label}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>

              {/* All-day items row */}
              {(() => {
                const weekStart = startOfWeek(calendarAnchorDate)
                const weekDayKeys = Array.from({ length: 7 }, (_, index) =>
                  dateKey(addDays(weekStart, index)),
                )
                const weekAllDayItems = weekDayKeys.map((dk) => ({
                  dayKey: dk,
                  items: filteredItems.filter((item) => !item.isHourly && itemOverlapsDateRange(item, dk, dk)),
                }))
                const hasAnyAllDay = weekAllDayItems.some((d) => d.items.length > 0)
                const previewSegment =
                  schedulePreview && !schedulePreview.isHourly
                    ? previewSegmentForWeek(weekDayKeys, schedulePreview)
                    : null
                if (!hasAnyAllDay && !previewSegment) {
                  return null
                }
                return (
                  <div className="relative grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-[#E5E7EB]">
                    <div className="border-r border-[#E5E7EB] bg-[#F8FAFC] px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 flex items-start justify-end">
                      All Day
                    </div>
                    {weekAllDayItems.map(({ dayKey: dk, items: dayItems }) => (
                      <div key={dk} className="border-r border-[#E5E7EB] last:border-r-0 px-1 py-1.5 space-y-1 min-h-[28px]">
                        {dayItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={cn(
                              "flex w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm hover:opacity-90 transition-opacity truncate",
                              item.isPersonalTodo ? "border-dashed text-slate-700" : "text-white",
                            )}
                            style={{
                              backgroundColor: item.isPersonalTodo
                                ? colorWithAlpha(item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                                : item.displayColor || DEFAULT_SCHEDULE_COLOR,
                              borderColor: item.isPersonalTodo
                                ? (item.displayColor || DEFAULT_SCHEDULE_COLOR)
                                : colorWithAlpha(item.displayColor, 0.75),
                            }}
                            onClick={() => openExistingItem(item.id)}
                          >
                            <span className="truncate">
                              {item.isPersonalTodo ? (item.isComplete ? "☑ " : "☐ ") : ""}
                              {item.title}
                            </span>
                          </button>
                        ))}
                        {previewSegment &&
                        weekDayKeys.indexOf(dk) === previewSegment.startIndex ? (
                          <div
                            className="pointer-events-none absolute z-10 flex items-center overflow-hidden rounded-full border-2 border-dashed px-2 py-0.5 text-[10px] font-medium shadow-sm animate-in fade-in"
                            style={{
                              backgroundColor: colorWithAlpha(schedulePreview!.displayColor, 0.18),
                              borderColor: schedulePreview!.displayColor,
                              color: schedulePreview!.displayColor,
                              left: `calc(72px + ((100% - 72px) * ${previewSegment.startIndex / 7}) + 4px)`,
                              width: `calc(((100% - 72px) * ${(previewSegment.endIndex - previewSegment.startIndex + 1) / 7}) - 8px)`,
                              top: 6,
                            }}
                          >
                            <span className="truncate">{schedulePreview!.title}</span>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )
              })()}

              <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))]">
                <div className="border-r border-[#E5E7EB] bg-[#F8FAFC]">
                  {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }).map((_, index) => {
                    const hour = DAY_START_HOUR + index

                    return (
                      <div
                        key={hour}
                        className="flex h-14 items-start justify-end border-b border-[#E5E7EB] px-2 py-1 text-[11px] text-slate-400 last:border-b-0"
                      >
                        {formatHourLabel(hour)}
                      </div>
                    )
                  })}
                </div>

                {Array.from({ length: 7 }).map((_, index) => {
                  const day = addDays(startOfWeek(calendarAnchorDate), index)
                  const dk = dateKey(day)
                  const segments = buildDayTimelineSegments(dk, filteredItems.filter((item) => item.isHourly))
                  const workday = classifyWorkday(day, workdayExceptions)
                  const isBlockDropTarget =
                    !!blockDrag
                    && blockDrag.mode === "move"
                    && blockDrag.dayKey === dk
                    && blockDrag.origDayKey !== dk

                  return (
                    <div
                      key={dk}
                      data-timed-day={dk}
                      data-week-day-column={dk}
                      data-drop-target={isBlockDropTarget ? "true" : undefined}
                      className={cn(
                        "relative border-r border-[#E5E7EB] last:border-r-0 select-none touch-pan-y transition-colors",
                        isBlockDropTarget && "bg-orange-100/60 ring-2 ring-inset ring-orange-300",
                      )}
                      style={{ height: `${(DAY_END_HOUR - DAY_START_HOUR + 1) * HOUR_HEIGHT}px` }}
                      onPointerDown={(event) => handleTimedColumnPointerDown(event, dk)}
                    >
                      {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }).map((_, hourIndex) => (
                        <div
                          key={hourIndex}
                          className={cn(
                            "pointer-events-none h-14 border-b border-[#E5E7EB] last:border-b-0 transition-colors",
                            !workday.isWorkday && "bg-amber-50/50",
                          )}
                        />
                      ))}

                      {segments.map((segment) => {
                        const isDragged = !!blockDrag && blockDrag.itemId === segment.item.id
                        if (isDragged && blockDrag!.dayKey !== dk) {
                          return null
                        }
                        const draggable = isBlockDraggable(segment.item)
                        const top = isDragged
                          ? (blockDrag!.startMinutes / 60) * HOUR_HEIGHT + 4
                          : (segment.startHour - DAY_START_HOUR) * HOUR_HEIGHT + 4
                        const height = isDragged
                          ? Math.max(((blockDrag!.endMinutes - blockDrag!.startMinutes) / 60) * HOUR_HEIGHT - 8, 18)
                          : Math.max((segment.endHour - segment.startHour) * HOUR_HEIGHT - 8, 32)
                        const width = isDragged
                          ? "calc(100% - 8px)"
                          : `calc(${100 / segment.laneCount}% - 8px)`
                        const left = isDragged
                          ? "4px"
                          : `calc(${segment.lane * (100 / segment.laneCount)}% + 4px)`
                        const displayStartTime = isDragged
                          ? minutesToTimeString(blockDrag!.startMinutes)
                          : segment.item.startTime
                        const displayEndTime = isDragged
                          ? minutesToTimeString(blockDrag!.endMinutes)
                          : segment.item.endTime

                        return (
                          <button
                            key={`${segment.item.id}-${segment.lane}`}
                            type="button"
                            className={cn(
                              "group absolute overflow-hidden rounded-xl border px-2 py-1 text-left text-xs font-medium shadow-sm",
                              segment.item.isPersonalTodo
                                ? "border-dashed text-slate-700"
                                : "text-white",
                              activeConflictIds.has(segment.item.id) && "ring-2 ring-rose-200",
                              draggable && "cursor-grab active:cursor-grabbing",
                              isDragged && "z-20 cursor-grabbing ring-2 ring-orange-300 shadow-lg",
                            )}
                            style={{
                              top,
                              height,
                              width,
                              left,
                              backgroundColor: segment.item.isPersonalTodo
                                ? colorWithAlpha(segment.item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                                : segment.item.displayColor || DEFAULT_SCHEDULE_COLOR,
                              borderColor: segment.item.isPersonalTodo
                                ? (segment.item.displayColor || DEFAULT_SCHEDULE_COLOR)
                                : colorWithAlpha(segment.item.displayColor, 0.75),
                            }}
                            onPointerDown={(event) => handleBlockPointerDown(event, segment.item, dk, "move")}
                            onClick={() => {
                              if (blockClickSuppressRef.current === segment.item.id) {
                                blockClickSuppressRef.current = null
                                return
                              }
                              openExistingItem(segment.item.id)
                            }}
                          >
                            <span className="block truncate">
                              {segment.item.isPersonalTodo ? (segment.item.isComplete ? "☑ " : "☐ ") : ""}
                              {segment.item.title}
                            </span>
                            <span className={cn("block truncate text-[10px]", segment.item.isPersonalTodo ? "text-slate-500" : "text-white/80")}>
                              {segment.item.isHourly && displayStartTime
                                ? fmtClockRange(displayStartTime, displayEndTime)
                                : `${segment.item.workDays} workday${segment.item.workDays === 1 ? "" : "s"}`}
                            </span>
                            {draggable ? (
                              <>
                                <span
                                  aria-hidden
                                  className={cn(
                                    "pointer-events-auto absolute inset-x-0 top-0 h-1.5 cursor-ns-resize transition-opacity",
                                    isDragged ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                    segment.item.isPersonalTodo ? "bg-slate-400/60" : "bg-white/40",
                                  )}
                                  onPointerDown={(event) => handleBlockPointerDown(event, segment.item, dk, "resize-start")}
                                />
                                <span
                                  aria-hidden
                                  className={cn(
                                    "pointer-events-auto absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize transition-opacity",
                                    isDragged ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                    segment.item.isPersonalTodo ? "bg-slate-400/60" : "bg-white/40",
                                  )}
                                  onPointerDown={(event) => handleBlockPointerDown(event, segment.item, dk, "resize-end")}
                                />
                              </>
                            ) : null}
                          </button>
                        )
                      })}

                      {blockDrag && blockDrag.dayKey === dk && blockDrag.origDayKey !== dk
                        && !segments.some((segment) => segment.item.id === blockDrag.itemId)
                        ? (() => {
                            const item = items.find((entry) => entry.id === blockDrag.itemId)
                            if (!item) {
                              return null
                            }
                            const top = (blockDrag.startMinutes / 60) * HOUR_HEIGHT + 4
                            const height = Math.max(((blockDrag.endMinutes - blockDrag.startMinutes) / 60) * HOUR_HEIGHT - 8, 18)
                            return (
                              <div
                                className="pointer-events-none absolute left-1 right-1 z-20 overflow-hidden rounded-xl border px-2 py-1 text-left text-xs font-medium shadow-lg ring-2 ring-orange-300"
                                style={{
                                  top,
                                  height,
                                  backgroundColor: item.isPersonalTodo
                                    ? colorWithAlpha(item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                                    : item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                  borderColor: item.isPersonalTodo
                                    ? (item.displayColor || DEFAULT_SCHEDULE_COLOR)
                                    : colorWithAlpha(item.displayColor, 0.75),
                                  color: item.isPersonalTodo ? "#1f2937" : "#ffffff",
                                }}
                              >
                                <span className="block truncate">{item.title}</span>
                                <span className={cn("block truncate text-[10px]", item.isPersonalTodo ? "text-slate-500" : "text-white/80")}>
                                  {fmtClockRange(minutesToTimeString(blockDrag.startMinutes), minutesToTimeString(blockDrag.endMinutes))}
                                </span>
                              </div>
                            )
                          })()
                        : null}

                      {dragSelection && dragSelection.dayKey === dk ? (() => {
                        const start = dragSelection.startMinutes
                        const end = Math.max(dragSelection.endMinutes, start + DRAG_SNAP_MINUTES)
                        const top = (start / 60) * HOUR_HEIGHT + 4
                        const height = Math.max(((end - start) / 60) * HOUR_HEIGHT - 8, 18)
                        return (
                          <div
                            className="pointer-events-none absolute inset-x-1 overflow-hidden rounded-xl border-2 border-dashed border-orange-500 bg-orange-500/15 px-2 py-1 text-[11px] font-semibold text-orange-700 shadow-sm"
                            style={{ top, height }}
                          >
                            {fmtClockRange(minutesToTimeString(start), minutesToTimeString(end))}
                          </div>
                        )
                      })() : null}

                      {(() => {
                        if (!schedulePreview || !schedulePreview.isHourly) {
                          return null
                        }
                        if (dragSelection && dragSelection.dayKey === dk) {
                          return null
                        }
                        const bounds = previewBoundsForDay(dk, schedulePreview)
                        if (!bounds) {
                          return null
                        }
                        const top = (bounds.startHour - DAY_START_HOUR) * HOUR_HEIGHT + 4
                        const height = Math.max((bounds.endHour - bounds.startHour) * HOUR_HEIGHT - 8, 28)
                        return (
                          <div
                            className="pointer-events-none absolute inset-x-1 overflow-hidden rounded-xl border-2 border-dashed px-2 py-1 text-left text-xs font-medium shadow-sm animate-in fade-in"
                            style={{
                              top,
                              height,
                              backgroundColor: colorWithAlpha(schedulePreview.displayColor, 0.18),
                              borderColor: schedulePreview.displayColor,
                              color: schedulePreview.displayColor,
                            }}
                          >
                            <span className="block truncate">{schedulePreview.title}</span>
                            {schedulePreview.startTime && schedulePreview.endTime ? (
                              <span className="block truncate text-[10px] opacity-80">
                                {fmtClockRange(schedulePreview.startTime, schedulePreview.endTime)}
                              </span>
                            ) : null}
                          </div>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : calendarPeriod === "day" ? (
            <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
              <div className="border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{formatLongDate(calendarAnchorDate)}</p>
                    {(() => {
                      const workday = classifyWorkday(calendarAnchorDate, workdayExceptions)
                      return !workday.isWorkday || workday.type === "extra_workday" ? (
                        <p className={cn("text-[11px]", workday.isWorkday ? "text-emerald-600" : "text-amber-600")}>
                          {workday.label}
                        </p>
                      ) : null
                    })()}
                  </div>
                  {dateKey(calendarAnchorDate) === todayIso ? (
                    <span className="flex size-8 items-center justify-center rounded-full bg-orange-600 text-xs font-semibold text-white">
                      {calendarAnchorDate.getDate()}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* All-day items bar */}
              {(() => {
                const anchorKey = dateKey(calendarAnchorDate)
                const dayAllDayItems = filteredItems.filter((item) => !item.isHourly && itemOverlapsDateRange(item, anchorKey, anchorKey))
                const showPreview =
                  schedulePreview &&
                  !schedulePreview.isHourly &&
                  schedulePreview.startDate <= anchorKey &&
                  schedulePreview.endDate >= anchorKey
                if (dayAllDayItems.length === 0 && !showPreview) {
                  return null
                }
                return (
                  <div className="border-b border-[#E5E7EB] bg-slate-50/50 px-4 py-2">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">All Day</p>
                    <div className="flex flex-wrap gap-1.5">
                      {dayAllDayItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium shadow-sm hover:opacity-90 transition-opacity",
                            item.isPersonalTodo ? "border-dashed text-slate-700" : "text-white",
                          )}
                          style={{
                            backgroundColor: item.isPersonalTodo
                              ? colorWithAlpha(item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                              : item.displayColor || DEFAULT_SCHEDULE_COLOR,
                            borderColor: item.isPersonalTodo
                              ? (item.displayColor || DEFAULT_SCHEDULE_COLOR)
                              : colorWithAlpha(item.displayColor, 0.75),
                          }}
                          onClick={() => openExistingItem(item.id)}
                        >
                          <span className="truncate max-w-[200px]">
                            {item.isPersonalTodo ? (item.isComplete ? "☑ " : "☐ ") : ""}
                            {item.title}
                          </span>
                          <span className={cn(item.isPersonalTodo ? "text-slate-500" : "text-white/70")}>({item.workDays}d)</span>
                        </button>
                      ))}
                      {showPreview ? (
                        <div
                          className="pointer-events-none flex items-center gap-1.5 rounded-full border-2 border-dashed px-3 py-1 text-xs font-medium shadow-sm animate-in fade-in"
                          style={{
                            backgroundColor: colorWithAlpha(schedulePreview!.displayColor, 0.18),
                            borderColor: schedulePreview!.displayColor,
                            color: schedulePreview!.displayColor,
                          }}
                        >
                          <span className="truncate max-w-[240px]">{schedulePreview!.title}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })()}

              <div className="grid grid-cols-[88px_minmax(0,1fr)]">
                <div className="border-r border-[#E5E7EB] bg-[#F8FAFC]">
                  {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }).map((_, index) => {
                    const hour = DAY_START_HOUR + index

                    return (
                      <div
                        key={hour}
                        className="flex h-14 items-start justify-end border-b border-[#E5E7EB] px-3 py-1 text-[11px] text-slate-400 last:border-b-0"
                      >
                        {formatHourLabel(hour)}
                      </div>
                    )
                  })}
                </div>

                {(() => {
                  const dk = dateKey(calendarAnchorDate)
                  const isBlockDropTarget =
                    !!blockDrag && blockDrag.dayKey === dk && blockDrag.moved
                  return (
                <div
                  data-timed-day={dk}
                  data-drop-target={isBlockDropTarget ? "true" : undefined}
                  className={cn(
                    "relative select-none touch-pan-y",
                    !classifyWorkday(calendarAnchorDate, workdayExceptions).isWorkday && "bg-amber-50/50",
                  )}
                  style={{ height: `${(DAY_END_HOUR - DAY_START_HOUR + 1) * HOUR_HEIGHT}px` }}
                  onPointerDown={(event) => handleTimedColumnPointerDown(event, dk)}
                >
                  {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }).map((_, hourIndex) => (
                    <div
                      key={hourIndex}
                      className="pointer-events-none h-14 border-b border-[#E5E7EB] last:border-b-0 transition-colors"
                    />
                  ))}

                  {buildDayTimelineSegments(dateKey(calendarAnchorDate), filteredItems.filter((item) => item.isHourly)).map((segment) => {
                    const dayDk = dateKey(calendarAnchorDate)
                    const isDragged = !!blockDrag && blockDrag.itemId === segment.item.id
                    const draggable = isBlockDraggable(segment.item)
                    const top = isDragged
                      ? (blockDrag!.startMinutes / 60) * HOUR_HEIGHT + 6
                      : (segment.startHour - DAY_START_HOUR) * HOUR_HEIGHT + 6
                    const height = isDragged
                      ? Math.max(((blockDrag!.endMinutes - blockDrag!.startMinutes) / 60) * HOUR_HEIGHT - 10, 24)
                      : Math.max((segment.endHour - segment.startHour) * HOUR_HEIGHT - 10, 34)
                    const width = isDragged
                      ? "calc(100% - 12px)"
                      : `calc(${100 / segment.laneCount}% - 12px)`
                    const left = isDragged
                      ? "6px"
                      : `calc(${segment.lane * (100 / segment.laneCount)}% + 6px)`
                    const displayStartTime = isDragged
                      ? minutesToTimeString(blockDrag!.startMinutes)
                      : segment.item.startTime
                    const displayEndTime = isDragged
                      ? minutesToTimeString(blockDrag!.endMinutes)
                      : segment.item.endTime

                    return (
                      <button
                        key={`${segment.item.id}-${segment.lane}`}
                        type="button"
                        className={cn(
                          "group absolute overflow-hidden rounded-xl border px-3 py-2 text-left text-sm font-medium shadow-sm",
                          segment.item.isPersonalTodo
                            ? "border-dashed text-slate-700"
                            : "text-white",
                          activeConflictIds.has(segment.item.id) && "ring-2 ring-rose-200",
                          draggable && "cursor-grab active:cursor-grabbing",
                          isDragged && "z-20 cursor-grabbing ring-2 ring-orange-300 shadow-lg",
                        )}
                        style={{
                          top,
                          height,
                          width,
                          left,
                          backgroundColor: segment.item.isPersonalTodo
                            ? colorWithAlpha(segment.item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                            : segment.item.displayColor || DEFAULT_SCHEDULE_COLOR,
                          borderColor: segment.item.isPersonalTodo
                            ? (segment.item.displayColor || DEFAULT_SCHEDULE_COLOR)
                            : colorWithAlpha(segment.item.displayColor, 0.75),
                        }}
                        onPointerDown={(event) => handleBlockPointerDown(event, segment.item, dayDk, "move")}
                        onClick={() => {
                          if (blockClickSuppressRef.current === segment.item.id) {
                            blockClickSuppressRef.current = null
                            return
                          }
                          openExistingItem(segment.item.id)
                        }}
                      >
                        <span className="block truncate">
                          {segment.item.isPersonalTodo ? (segment.item.isComplete ? "☑ " : "☐ ") : ""}
                          {segment.item.title}
                        </span>
                        <span className={cn("mt-1 block text-xs", segment.item.isPersonalTodo ? "text-slate-500" : "text-white/80")}>
                          {segment.item.isHourly && displayStartTime
                            ? fmtClockRange(displayStartTime, displayEndTime)
                            : `${segment.item.workDays} workday${segment.item.workDays === 1 ? "" : "s"}`}
                        </span>
                        {draggable ? (
                          <>
                            <span
                              aria-hidden
                              className={cn(
                                "pointer-events-auto absolute inset-x-0 top-0 h-2 cursor-ns-resize transition-opacity",
                                isDragged ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                segment.item.isPersonalTodo ? "bg-slate-400/60" : "bg-white/40",
                              )}
                              onPointerDown={(event) => handleBlockPointerDown(event, segment.item, dayDk, "resize-start")}
                            />
                            <span
                              aria-hidden
                              className={cn(
                                "pointer-events-auto absolute inset-x-0 bottom-0 h-2 cursor-ns-resize transition-opacity",
                                isDragged ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                segment.item.isPersonalTodo ? "bg-slate-400/60" : "bg-white/40",
                              )}
                              onPointerDown={(event) => handleBlockPointerDown(event, segment.item, dayDk, "resize-end")}
                            />
                          </>
                        ) : null}
                      </button>
                    )
                  })}

                  {dragSelection && dragSelection.dayKey === dateKey(calendarAnchorDate) ? (() => {
                    const start = dragSelection.startMinutes
                    const end = Math.max(dragSelection.endMinutes, start + DRAG_SNAP_MINUTES)
                    const top = (start / 60) * HOUR_HEIGHT + 6
                    const height = Math.max(((end - start) / 60) * HOUR_HEIGHT - 10, 24)
                    return (
                      <div
                        className="pointer-events-none absolute inset-x-1.5 overflow-hidden rounded-xl border-2 border-dashed border-orange-500 bg-orange-500/15 px-3 py-2 text-left text-xs font-semibold text-orange-700 shadow-sm"
                        style={{ top, height }}
                      >
                        {fmtClockRange(minutesToTimeString(start), minutesToTimeString(end))}
                      </div>
                    )
                  })() : null}

                  {(() => {
                    if (!schedulePreview || !schedulePreview.isHourly) {
                      return null
                    }
                    if (dragSelection && dragSelection.dayKey === dateKey(calendarAnchorDate)) {
                      return null
                    }
                    const bounds = previewBoundsForDay(dateKey(calendarAnchorDate), schedulePreview)
                    if (!bounds) {
                      return null
                    }
                    const top = (bounds.startHour - DAY_START_HOUR) * HOUR_HEIGHT + 6
                    const height = Math.max((bounds.endHour - bounds.startHour) * HOUR_HEIGHT - 10, 34)
                    return (
                      <div
                        className="pointer-events-none absolute inset-x-1.5 overflow-hidden rounded-xl border-2 border-dashed px-3 py-2 text-left text-sm font-medium shadow-sm animate-in fade-in"
                        style={{
                          top,
                          height,
                          backgroundColor: colorWithAlpha(schedulePreview.displayColor, 0.18),
                          borderColor: schedulePreview.displayColor,
                          color: schedulePreview.displayColor,
                        }}
                      >
                        <span className="block truncate">{schedulePreview.title}</span>
                        {schedulePreview.startTime && schedulePreview.endTime ? (
                          <span className="mt-1 block text-xs opacity-80">
                            {fmtClockRange(schedulePreview.startTime, schedulePreview.endTime)}
                          </span>
                        ) : null}
                      </div>
                    )
                  })()}

                  {isBlockDropTarget ? (() => {
                    const startMin = Math.min(blockDrag!.startMinutes, blockDrag!.endMinutes)
                    const endMin = Math.max(blockDrag!.endMinutes, blockDrag!.startMinutes + DRAG_SNAP_MINUTES)
                    const baseTop = (startMin / 60) * HOUR_HEIGHT
                    const baseHeight = ((endMin - startMin) / 60) * HOUR_HEIGHT
                    const top = Math.max(baseTop - 2, 0)
                    const height = baseHeight + 4
                    return (
                      <>
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-x-0 z-10 rounded-2xl bg-orange-100/70 ring-2 ring-inset ring-orange-300 transition-[top,height] duration-75"
                          style={{ top, height }}
                        />
                        <div
                          aria-hidden
                          className="pointer-events-none absolute right-2 z-30 rounded-md bg-orange-500/95 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm"
                          style={{ top: Math.max(baseTop - 18, 2) }}
                        >
                          {fmtClockRange(minutesToTimeString(startMin), minutesToTimeString(endMin))}
                        </div>
                      </>
                    )
                  })() : null}
                </div>
                  )
                })()}
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
              <div className="grid grid-cols-[140px_minmax(0,1fr)_120px_120px_120px] border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                <div>Date</div>
                <div>Title</div>
                <div>Phase</div>
                <div>Assigned To</div>
                <div>Status</div>
              </div>
              <div className="divide-y divide-[#E5E7EB]">
                {filteredItems
                  .filter((item) => itemEndDate(item) >= dateKey(calendarAnchorDate))
                  .sort((left, right) => left.startDate.localeCompare(right.startDate))
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="grid w-full grid-cols-[140px_minmax(0,1fr)_120px_120px_120px] items-start gap-4 px-4 py-4 text-left transition hover:bg-slate-50"
                      onClick={() => openExistingItem(item.id)}
                    >
                      <div className="text-sm text-slate-500">{fmtDate(item.startDate)}</div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn("size-2.5 rounded-full", item.isPersonalTodo && "border border-dashed")}
                            style={{
                              backgroundColor: item.isPersonalTodo
                                ? colorWithAlpha(item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                                : item.displayColor || DEFAULT_SCHEDULE_COLOR,
                              borderColor: item.isPersonalTodo ? (item.displayColor || DEFAULT_SCHEDULE_COLOR) : undefined,
                            }}
                          />
                          <span className="truncate font-medium text-slate-900">
                            {item.isPersonalTodo ? (item.isComplete ? "☑ " : "☐ ") : ""}
                            {item.title}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.workDays} workday{item.workDays === 1 ? "" : "s"} • ends {fmtDate(itemEndDate(item))}
                        </p>
                      </div>
                      <div className="text-sm text-slate-500">{item.phaseName || "—"}</div>
                      <div className="text-sm text-slate-500">
                        {item.assignees.length > 0
                          ? item.assignees.map((assignee) => assignee.fullName || "Unknown").join(", ")
                          : "—"}
                      </div>
                      <div>
                        <Badge variant="outline" className="border-[#D8E0EA] bg-white text-slate-600">
                          {titleCaseStatus(item.status)}
                        </Badge>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          )}
          </div>
          )}
        </div>
      </div>
  )
}
