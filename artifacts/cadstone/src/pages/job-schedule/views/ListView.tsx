import { Fragment, type Dispatch, type SetStateAction } from "react"
import { Check, CheckCircle2, ChevronDown, Circle } from "lucide-react"
import {
  DEFAULT_SCHEDULE_COLOR,
  fmtDate,
  itemEndDate,
  type ScheduleItemRecord,
} from "@/lib/schedule"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { EmptyState, SortableHead } from "../components"
import { colorWithAlpha } from "../calendar-utils"
import { buildFilterPreset, mergeUniqueIds } from "../filters"
import type {
  FilterState,
  ListDisplayMode,
  SortDirection,
  SortKey,
} from "../types"

interface ListViewProps {
  itemsTotal: number
  loading: boolean
  isEmpty: boolean
  activeItems: ScheduleItemRecord[]
  groupedListItems: Array<{ label: string; items: ScheduleItemRecord[] }>
  listDisplayMode: ListDisplayMode
  selectedListIds: string[]
  currentPageIds: string[]
  allCurrentPageSelected: boolean
  itemNumberById: Map<string, number>
  activeConflictIds: Set<string>
  sortKey: SortKey
  sortDirection: SortDirection
  listPage: number
  totalListPages: number
  listStart: number
  listEnd: number
  sortedListItemsLength: number
  canWrite: boolean
  setListDisplayMode: Dispatch<SetStateAction<ListDisplayMode>>
  setSelectedListIds: Dispatch<SetStateAction<string[]>>
  setAppliedFilters: Dispatch<SetStateAction<FilterState>>
  setDraftFilters: Dispatch<SetStateAction<FilterState>>
  setListPage: Dispatch<SetStateAction<number>>
  handleSort: (key: SortKey) => void
  openNewItem: () => void
  openExistingItem: (id: string) => void
}

export function ListView(props: ListViewProps) {
  const {
    itemsTotal,
    loading,
    isEmpty,
    activeItems,
    groupedListItems,
    listDisplayMode,
    selectedListIds,
    currentPageIds,
    allCurrentPageSelected,
    itemNumberById,
    activeConflictIds,
    sortKey,
    sortDirection,
    listPage,
    totalListPages,
    listStart,
    listEnd,
    sortedListItemsLength,
    canWrite,
    setListDisplayMode,
    setSelectedListIds,
    setAppliedFilters,
    setDraftFilters,
    setListPage,
    handleSort,
    openNewItem,
    openExistingItem,
  } = props

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
      <div data-print-hide="true" className="flex flex-col gap-3 border-b border-[#E5E7EB] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Schedule Items
            <span className="ml-2 text-xs font-normal text-slate-500">
              {itemsTotal} total
            </span>
          </h2>
          <p className="text-sm text-slate-500">The list view uses the same schedule items and filters as calendar and gantt.</p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="border-[#E5E7EB] bg-white">
              View
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => setListDisplayMode("phases")}>
              Phases
              {listDisplayMode === "phases" ? <Check className="ml-auto size-4" /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setListDisplayMode("notes")}>
              Notes
              {listDisplayMode === "notes" ? <Check className="ml-auto size-4" /> : null}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState
            title={activeItems.length === 0 ? "No schedule items yet" : "No schedule items match this filter"}
            description={
              activeItems.length === 0
                ? "Create the first schedule item to populate this table."
                : "Adjust the active filter to see matching schedule items here."
            }
            actionLabel={activeItems.length === 0 && !canWrite ? undefined : activeItems.length === 0 ? "New Schedule Item" : "Clear Filters"}
            onAction={
              activeItems.length === 0
                ? canWrite
                  ? () => openNewItem()
                  : undefined
                : () => {
                    const reset = buildFilterPreset("all")
                    setAppliedFilters(reset)
                    setDraftFilters(reset)
                  }
            }
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#F8FAFC] hover:bg-[#F8FAFC]">
                    <TableHead className="w-12">
                      <Checkbox
                        checked={allCurrentPageSelected}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedListIds((current) => mergeUniqueIds(current, currentPageIds))
                            return
                          }

                          setSelectedListIds((current) =>
                            current.filter((id) => !currentPageIds.includes(id)),
                          )
                        }}
                      />
                    </TableHead>
                    <SortableHead label="ID #" sortKey="idNumber" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableHead label="Title" sortKey="title" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableHead label="Complete" sortKey="complete" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableHead label="Phase" sortKey="phase" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableHead label="Duration" sortKey="duration" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableHead label="Start" sortKey="start" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableHead label="End" sortKey="end" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableHead label="Assigned To" sortKey="assigned" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableHead label="Files" sortKey="files" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedListItems.map((group) => (
                    <Fragment key={group.label}>
                      {listDisplayMode === "phases" ? (
                        <TableRow className="hover:bg-white">
                          <TableCell colSpan={10} className="bg-slate-50 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                            {group.label}
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {group.items.map((item) => (
                        <TableRow
                          key={item.id}
                          className={cn(
                            "hover:bg-slate-50",
                            activeConflictIds.has(item.id) && "bg-rose-50/60",
                          )}
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedListIds.includes(item.id)}
                              onCheckedChange={(checked) => {
                                setSelectedListIds((current) =>
                                  checked
                                    ? mergeUniqueIds(current, [item.id])
                                    : current.filter((value) => value !== item.id),
                                )
                              }}
                            />
                          </TableCell>
                          <TableCell className="text-sm text-slate-500">{itemNumberById.get(item.id) ?? "—"}</TableCell>
                          <TableCell className="max-w-[260px]">
                            <button
                              type="button"
                              className="flex max-w-full items-start gap-2 text-left"
                              onClick={() => openExistingItem(item.id)}
                            >
                              <span
                                className={cn("mt-1 size-2.5 shrink-0 rounded-full", item.isPersonalTodo && "border border-dashed")}
                                style={{
                                  backgroundColor: item.isPersonalTodo
                                    ? colorWithAlpha(item.displayColor || DEFAULT_SCHEDULE_COLOR, 0.18)
                                    : item.displayColor || DEFAULT_SCHEDULE_COLOR,
                                  borderColor: item.isPersonalTodo ? (item.displayColor || DEFAULT_SCHEDULE_COLOR) : undefined,
                                }}
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-primary hover:underline">
                                  {item.isPersonalTodo ? (item.isComplete ? "☑ " : "☐ ") : ""}
                                  {item.title}
                                </span>
                                {listDisplayMode === "notes" && (item.notes || item.notesStream?.[0]?.note) ? (
                                  <span className="mt-1 block truncate text-xs text-slate-500">
                                    {(item.notes || item.notesStream?.[0]?.note || "").replace(/\s+/g, " ")}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </TableCell>
                          <TableCell>
                            {item.isComplete ? (
                              <CheckCircle2 className="size-4 text-emerald-600" />
                            ) : (
                              <Circle className="size-4 text-slate-300" />
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-slate-500">{item.phaseName || "—"}</TableCell>
                          <TableCell className="text-sm text-slate-500">{item.workDays} days</TableCell>
                          <TableCell className="text-sm text-slate-500">{fmtDate(item.startDate)}</TableCell>
                          <TableCell className="text-sm text-slate-500">{fmtDate(itemEndDate(item))}</TableCell>
                          <TableCell className="text-sm text-slate-500">
                            {item.assignees.length > 0
                              ? item.assignees.map((assignee) => assignee.fullName || "Unknown").join(", ")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-slate-500">{item.attachments.length}</TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">
                {selectedListIds.length > 0 ? `${selectedListIds.length} selected` : "No rows selected"}
              </p>
              <div className="flex items-center gap-2 sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-[#E5E7EB] bg-white"
                  disabled={listPage === 1}
                  onClick={() => setListPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-[#E5E7EB] bg-white"
                  disabled={listPage === totalListPages}
                  onClick={() => setListPage((current) => Math.min(totalListPages, current + 1))}
                >
                  Next
                </Button>
                <span className="text-sm text-slate-500">
                  {listStart}–{listEnd} of {sortedListItemsLength} items
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
