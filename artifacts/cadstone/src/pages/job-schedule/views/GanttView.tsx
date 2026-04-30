import { Fragment, type Dispatch, type MutableRefObject, type PointerEvent, type SetStateAction } from "react"
import { Edit3, Maximize2, Minimize2, Plus } from "lucide-react"
import {
  calculateBusinessEndDate,
  DEFAULT_SCHEDULE_COLOR,
  fmtClockRange,
  fmtDate,
  itemEndDate,
  type ScheduleItemRecord,
  type ScheduleWorkdayException,
} from "@/lib/schedule"
import { cn } from "@/lib/utils"
import type { SchedulePreview } from "@/components/schedule/ScheduleItemDialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"

import { EmptyState } from "../components"
import { GANTT_SCALES } from "../constants"
import { colorWithAlpha, diffInDays, parseDate } from "../calendar-utils"
import type { GanttDrag, GanttDragMode } from "../drag"
import { buildFilterPreset } from "../filters"
import type {
  FilterState,
  GanttRow,
  GanttScale,
  TimelineHeaderUnit,
} from "../types"

export interface GanttDependencyLine {
  key: string
  path: string
  isConflict: boolean
  endX: number
  endY: number
}

export interface GanttPreviewBounds {
  left: number
  width: number
}

export interface GanttMonthGroup {
  key: string
  label: string
  width: number
}

export interface GanttRange {
  start: Date
  end: Date
}

export interface GanttViewProps {
  ganttFullscreen: boolean
  ganttScale: GanttScale
  ganttShowPhases: boolean
  ganttCriticalPath: boolean
  loading: boolean
  ganttItems: ScheduleItemRecord[]
  activeItems: ScheduleItemRecord[]
  ganttRows: GanttRow[]
  activeConflictIds: Set<string>
  ganttTimelineRef: MutableRefObject<HTMLDivElement | null>
  timelineWidth: number
  monthGroups: GanttMonthGroup[]
  scaleUnits: TimelineHeaderUnit[]
  todayOffsetPx: number
  schedulePreview: SchedulePreview | null
  ganttPreviewBounds: GanttPreviewBounds | null
  ganttDependencyLines: GanttDependencyLine[]
  ganttDrag: GanttDrag | null
  ganttClickSuppressRef: MutableRefObject<string | null>
  criticalPathIds: Set<string>
  ganttRange: GanttRange
  dayWidth: number
  workdayExceptions: ScheduleWorkdayException[]
  scheduleOffline: boolean
  setGanttScale: Dispatch<SetStateAction<GanttScale>>
  setGanttShowPhases: Dispatch<SetStateAction<boolean>>
  setGanttCriticalPath: Dispatch<SetStateAction<boolean>>
  setGanttFullscreen: Dispatch<SetStateAction<boolean>>
  setAppliedFilters: Dispatch<SetStateAction<FilterState>>
  setDraftFilters: Dispatch<SetStateAction<FilterState>>
  scrollGanttToToday: () => void
  openNewItem: () => void
  openExistingItem: (id: string) => void
  enterDraftMode: () => void
  handleGanttBarPointerDown: (
    event: PointerEvent<HTMLDivElement>,
    item: ScheduleItemRecord,
    mode: GanttDragMode,
  ) => void
  isGanttBarDraggable: (item: ScheduleItemRecord) => boolean
}

export function GanttView(props: GanttViewProps) {
  const {
    ganttFullscreen,
    ganttScale,
    ganttShowPhases,
    ganttCriticalPath,
    loading,
    ganttItems,
    activeItems,
    ganttRows,
    activeConflictIds,
    ganttTimelineRef,
    timelineWidth,
    monthGroups,
    scaleUnits,
    todayOffsetPx,
    schedulePreview,
    ganttPreviewBounds,
    ganttDependencyLines,
    ganttDrag,
    ganttClickSuppressRef,
    criticalPathIds,
    ganttRange,
    dayWidth,
    workdayExceptions,
    scheduleOffline,
    setGanttScale,
    setGanttShowPhases,
    setGanttCriticalPath,
    setGanttFullscreen,
    setAppliedFilters,
    setDraftFilters,
    scrollGanttToToday,
    openNewItem,
    openExistingItem,
    enterDraftMode,
    handleGanttBarPointerDown,
    isGanttBarDraggable,
  } = props

  return (
    <div
      className={cn(
        "rounded-xl border border-[#E5E7EB] bg-white shadow-sm",
        ganttFullscreen && "fixed inset-4 z-50 flex flex-col",
      )}
    >
      <div data-print-hide="true" className="flex flex-col gap-3 border-b border-[#E5E7EB] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={ganttScale} onValueChange={(value) => setGanttScale(value as GanttScale)}>
            <SelectTrigger className="h-10 w-[130px] border-[#E5E7EB]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GANTT_SCALES.map((scale) => (
                <SelectItem key={scale.value} value={scale.value}>
                  {scale.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" className="h-10 border-[#E5E7EB]" onClick={scrollGanttToToday}>
            Today
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>Phases</span>
            <Switch checked={ganttShowPhases} onCheckedChange={setGanttShowPhases} />
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>Critical Path</span>
            <Switch checked={ganttCriticalPath} onCheckedChange={setGanttCriticalPath} />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-10 border-[#E5E7EB] bg-white"
            onClick={() => setGanttFullscreen((current) => !current)}
          >
            {ganttFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        </div>
      </div>

      <div className={cn("p-4", ganttFullscreen && "flex-1 overflow-hidden")}>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : ganttItems.length === 0 ? (
          <EmptyState
            title={activeItems.length === 0 ? "No gantt items yet" : "No gantt items match this filter"}
            description={
              activeItems.length === 0
                ? "Create a schedule item with Show on Gantt enabled to build the job timeline."
                : "Adjust the current filters or enable Show on Gantt on more schedule items."
            }
            actionLabel={activeItems.length === 0 ? "New Schedule Item" : "Clear Filters"}
            onAction={
              activeItems.length === 0
                ? () => openNewItem()
                : () => {
                    const reset = buildFilterPreset("all")
                    setAppliedFilters(reset)
                    setDraftFilters(reset)
                  }
            }
          />
        ) : (
          <div className={cn("overflow-hidden rounded-xl border border-[#E5E7EB]", ganttFullscreen && "h-full")}>
            <div className={cn("flex", ganttFullscreen && "h-full flex-col")}>
              <div className={cn("flex", ganttFullscreen && "min-h-0 flex-1")}>
                <div className="w-[340px] shrink-0 border-r border-[#E5E7EB]">
                  <div className="grid grid-cols-[minmax(0,1fr)_108px_88px_72px_72px] border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    <div>Title</div>
                    <div>Start</div>
                    <div>Workdays</div>
                    <div />
                    <div />
                  </div>

                  <div className={cn("divide-y divide-[#E5E7EB]", ganttFullscreen && "max-h-full overflow-y-auto")}>
                    {ganttRows.map((row) =>
                      row.type === "phase" ? (
                        <div key={row.key} className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                          {row.label}
                        </div>
                      ) : (
                        <div
                          key={row.key}
                          className={cn(
                            "grid w-full grid-cols-[minmax(0,1fr)_108px_88px_72px_72px] items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50",
                            activeConflictIds.has(row.item.id) && "bg-rose-50/60",
                          )}
                          role="button"
                          tabIndex={0}
                          onClick={() => openExistingItem(row.item.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              openExistingItem(row.item.id)
                            }
                          }}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className="size-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: (ganttShowPhases ? row.item.phaseColor : null) || row.item.displayColor || DEFAULT_SCHEDULE_COLOR }}
                              />
                              <span className="truncate font-medium text-slate-900">{row.item.title}</span>
                            </div>
                          </div>
                          <div className="text-sm text-slate-500">{fmtDate(row.item.startDate)}</div>
                          <div className="text-sm text-slate-500">{row.item.workDays}</div>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] text-slate-500 transition hover:bg-white"
                            onClick={(event) => {
                              event.stopPropagation()
                              openExistingItem(row.item.id)
                            }}
                          >
                            <Edit3 className="size-4" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] text-slate-500 transition hover:bg-white"
                            onClick={(event) => {
                              event.stopPropagation()
                              openNewItem()
                            }}
                          >
                            <Plus className="size-4" />
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                </div>

                <div ref={ganttTimelineRef} className="min-w-0 flex-1 overflow-auto">
                  <div style={{ width: `${timelineWidth}px` }}>
                    <div className="sticky top-0 z-10 bg-white">
                      <div className="flex border-b border-[#E5E7EB] bg-[#F8FAFC]">
                        {monthGroups.map((group) => (
                          <div
                            key={group.key}
                            className="border-r border-[#E5E7EB] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 last:border-r-0"
                            style={{ width: `${group.width}px` }}
                          >
                            {group.label}
                          </div>
                        ))}
                      </div>
                      <div className="relative flex border-b border-[#E5E7EB] bg-white">
                        {scaleUnits.map((unit) => (
                          <div
                            key={unit.key}
                            className="border-r border-[#E5E7EB] px-2 py-2 text-center text-xs font-medium text-slate-500 last:border-r-0"
                            style={{ width: `${unit.width}px` }}
                          >
                            {unit.label}
                          </div>
                        ))}
                        <div
                          className="pointer-events-none absolute bottom-[-6px] z-20"
                          style={{ left: `${todayOffsetPx - 6}px` }}
                        >
                          <div className="size-3 rotate-45 bg-orange-600" />
                        </div>
                      </div>
                    </div>

                    <div className="relative">
                      <div
                        className="pointer-events-none absolute inset-y-0 z-10 w-px bg-orange-500/60"
                        style={{ left: `${todayOffsetPx}px` }}
                      />
                      {schedulePreview && ganttPreviewBounds ? (
                        <div
                          data-testid="gantt-schedule-preview"
                          className="pointer-events-none absolute inset-y-0 z-20 rounded-md border-2 border-dashed"
                          style={{
                            left: `${ganttPreviewBounds.left}px`,
                            width: `${ganttPreviewBounds.width}px`,
                            backgroundColor: colorWithAlpha(schedulePreview.displayColor, 0.18),
                            borderColor: schedulePreview.displayColor,
                          }}
                        >
                          <div
                            className="absolute left-1 right-1 top-1 truncate rounded px-2 py-0.5 text-[11px] font-semibold"
                            style={{
                              color: schedulePreview.displayColor,
                              backgroundColor: colorWithAlpha(schedulePreview.displayColor, 0.12),
                            }}
                          >
                            {schedulePreview.title}
                            {schedulePreview.isHourly && schedulePreview.startTime && schedulePreview.endTime
                              ? ` · ${fmtClockRange(schedulePreview.startTime, schedulePreview.endTime)}`
                              : ""}
                          </div>
                        </div>
                      ) : null}
                      <svg className="pointer-events-none absolute inset-0 z-10 overflow-visible">
                        {ganttDependencyLines.map((line) => (
                          <Fragment key={line.key}>
                            <path
                              d={line.path}
                              fill="none"
                              stroke={line.isConflict ? "#dc2626" : "#64748b"}
                              strokeWidth="2"
                              strokeDasharray={line.isConflict ? "4 4" : undefined}
                            />
                            <path
                              d={`M ${line.endX} ${line.endY} l -6 -4 l 0 8 z`}
                              fill={line.isConflict ? "#dc2626" : "#64748b"}
                            />
                          </Fragment>
                        ))}
                      </svg>

                      {ganttRows.map((row) => {
                        if (row.type === "phase") {
                          return <div key={row.key} className="h-[38px] border-b border-[#E5E7EB] bg-slate-50" />
                        }
                        const isDragged = !!ganttDrag && ganttDrag.itemId === row.item.id
                        const draggable = isGanttBarDraggable(row.item)
                        const barStartDate = isDragged ? ganttDrag!.startDate : row.item.startDate
                        const barWorkDays = isDragged ? ganttDrag!.workDays : Math.max(row.item.workDays, 1)
                        const barEndDate = isDragged
                          ? calculateBusinessEndDate(barStartDate, barWorkDays, workdayExceptions)
                          : itemEndDate(row.item)
                        return (
                          <button
                            key={row.key}
                            type="button"
                            className="relative block h-[54px] w-full border-b border-[#E5E7EB] text-left transition hover:bg-slate-50"
                            onClick={() => {
                              if (ganttClickSuppressRef.current === row.item.id) {
                                ganttClickSuppressRef.current = null
                                return
                              }
                              openExistingItem(row.item.id)
                            }}
                          >
                            {scaleUnits.map((unit) => (
                              <div
                                key={`${row.item.id}-${unit.key}`}
                                className="absolute inset-y-0 border-r border-[#EEF2F7] last:border-r-0"
                                style={{
                                  left: `${diffInDays(ganttRange.start, unit.start) * dayWidth}px`,
                                  width: `${unit.width}px`,
                                }}
                              />
                            ))}

                            <div
                              className={cn(
                                "absolute top-[12px] overflow-hidden rounded-full border shadow-sm",
                                ganttCriticalPath && criticalPathIds.has(row.item.id)
                                  ? "border-amber-500 ring-2 ring-amber-200"
                                  : "border-transparent",
                                activeConflictIds.has(row.item.id) && "border-rose-500 ring-2 ring-rose-200",
                                draggable && "cursor-grab active:cursor-grabbing",
                                isDragged && "z-20 cursor-grabbing ring-2 ring-orange-300",
                              )}
                              style={{
                                left: `${diffInDays(ganttRange.start, parseDate(barStartDate)) * dayWidth}px`,
                                width: `${(diffInDays(parseDate(barStartDate), parseDate(barEndDate)) + 1) * dayWidth}px`,
                                height: "28px",
                                backgroundColor: colorWithAlpha((ganttShowPhases ? row.item.phaseColor : null) || row.item.displayColor, 0.18),
                              }}
                              onPointerDown={(event) => handleGanttBarPointerDown(event, row.item, "move")}
                            >
                              <div
                                className="h-full"
                                style={{
                                  width: `${Math.max(0, Math.min(100, row.item.progress ?? 0))}%`,
                                  backgroundColor: (ganttShowPhases ? row.item.phaseColor : null) || row.item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                }}
                              />
                              <div className="pointer-events-none absolute inset-0 flex items-center px-3 text-xs font-medium text-slate-900">
                                <span className="truncate">{row.item.title}</span>
                              </div>
                              {draggable ? (
                                <div
                                  role="presentation"
                                  className="pointer-events-auto absolute inset-y-0 right-0 w-2 cursor-ew-resize"
                                  onPointerDown={(event) => handleGanttBarPointerDown(event, row.item, "resize-end")}
                                />
                              ) : null}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div data-print-hide="true" className="flex flex-col gap-3 border-t border-[#E5E7EB] bg-orange-50/70 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Try Draft mode. Make changes confidently with features like undo and redo.</p>
              </div>
              <Button
                type="button"
                className="sm:w-auto"
                disabled={scheduleOffline}
                onClick={enterDraftMode}
              >
                Switch to Draft mode
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
