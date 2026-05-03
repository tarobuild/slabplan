import {
  BarChart3,
  CalendarDays,
  Clock3,
  Filter,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  RotateCw,
  Settings2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

import type { ViewMode } from "../types"

type ScheduleToolbarProps = {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  setSettingsOpen: (open: boolean) => void
  setHistoryOpen: (open: boolean) => void
  setTodosPanelOpen: (open: boolean) => void
  setTemplateDialogOpen: (open: boolean) => void
  setFilterOpen: (open: boolean) => void
  incompleteTodoCount: number
  scheduleOffline: boolean
  draftPublishing: boolean
  draftPastLength: number
  draftFutureLength: number
  activeFilterCount: number
  hasActiveItems: boolean
  // Whether the current user may perform write actions (admin/PM).
  // Crew members get a read-only toolbar — write affordances are
  // hidden, never just disabled.
  canWrite: boolean
  enterDraftMode: () => void
  handleDiscardDraft: () => void
  handleDraftUndo: () => void
  handleDraftRedo: () => void
  handleTrackConflicts: () => void | Promise<void>
  handleNotifyAssignedUsers: () => void | Promise<void>
  handleDeleteAllItems: () => void | Promise<void>
  handleExport: (kind: "schedule" | "baseline" | "exceptions") => void | Promise<void>
  runSchedulePrint: () => void
  openNewItem: () => void
  handlePublishDraft: () => void | Promise<void>
}

export function ScheduleToolbar({
  viewMode,
  setViewMode,
  setSettingsOpen,
  setHistoryOpen,
  setTodosPanelOpen,
  setTemplateDialogOpen,
  setFilterOpen,
  incompleteTodoCount,
  scheduleOffline,
  draftPublishing,
  draftPastLength,
  draftFutureLength,
  activeFilterCount,
  hasActiveItems,
  canWrite,
  enterDraftMode,
  handleDiscardDraft,
  handleDraftUndo,
  handleDraftRedo,
  handleTrackConflicts,
  handleNotifyAssignedUsers,
  handleDeleteAllItems,
  handleExport,
  runSchedulePrint,
  openNewItem,
  handlePublishDraft,
}: ScheduleToolbarProps) {
  return (
    <div data-print-hide="true" className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-[#D8E0EA] bg-[#F8FAFC]">
            <button
              type="button"
              className={cn(
                "flex h-10 items-center gap-2 px-4 text-sm font-medium transition-colors",
                viewMode === "calendar"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-white",
              )}
              onClick={() => setViewMode("calendar")}
            >
              <CalendarDays className="size-4" />
              Calendar
            </button>
            <button
              type="button"
              className={cn(
                "flex h-10 items-center gap-2 border-l border-[#D8E0EA] px-4 text-sm font-medium transition-colors",
                viewMode === "list"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-white",
              )}
              onClick={() => setViewMode("list")}
            >
              <BarChart3 className="size-4" />
              List
            </button>
            <button
              type="button"
              className={cn(
                "flex h-10 items-center gap-2 border-l border-[#D8E0EA] px-4 text-sm font-medium transition-colors",
                viewMode === "gantt"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-white",
              )}
              onClick={() => setViewMode("gantt")}
            >
              <BarChart3 className="size-4" />
              Gantt
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          {canWrite ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-[#E5E7EB] bg-white"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="size-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-[#E5E7EB] bg-white"
            onClick={() => setHistoryOpen(true)}
          >
            <Clock3 className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-[#E5E7EB] bg-white"
            onClick={() => setTodosPanelOpen(true)}
          >
            <ListChecks className="size-4" />
            My To-Do&apos;s
            {incompleteTodoCount > 0 ? (
              <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
                {incompleteTodoCount}
              </Badge>
            ) : null}
          </Button>
          {canWrite ? (
            <div className="flex h-10 items-center gap-3 rounded-lg border border-[#E5E7EB] px-3">
              <span className="text-sm font-medium text-slate-700">Schedule Offline</span>
              <Switch checked={scheduleOffline} onCheckedChange={(checked) => (checked ? enterDraftMode() : handleDiscardDraft())} />
            </div>
          ) : null}
          {canWrite && scheduleOffline ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-[#E5E7EB] bg-white"
                disabled={draftPastLength === 0 || draftPublishing}
                onClick={handleDraftUndo}
              >
                <RotateCcw className="size-4" />
                Undo
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-[#E5E7EB] bg-white"
                disabled={draftFutureLength === 0 || draftPublishing}
                onClick={handleDraftRedo}
              >
                <RotateCw className="size-4" />
                Redo
              </Button>
            </>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-[#E5E7EB] bg-white"
              >
                <MoreHorizontal className="size-4" />
                More Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {canWrite ? (
                <DropdownMenuItem onClick={() => setTemplateDialogOpen(true)}>
                  Import From Templates
                </DropdownMenuItem>
              ) : null}
              {canWrite ? (
                <DropdownMenuItem onClick={() => void handleTrackConflicts()}>
                  Track Conflicts
                </DropdownMenuItem>
              ) : null}
              {canWrite ? (
                <DropdownMenuItem
                  disabled={!hasActiveItems}
                  onClick={() => void handleNotifyAssignedUsers()}
                >
                  Notify Assigned Users
                </DropdownMenuItem>
              ) : null}
              {canWrite ? (
                <DropdownMenuItem disabled={!hasActiveItems} onClick={() => void handleDeleteAllItems()}>
                  Delete All Items
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => handleExport("schedule")}>
                Export to PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={runSchedulePrint}>
                Print
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-[#E5E7EB] bg-white"
            onClick={() => setFilterOpen(true)}
          >
            <Filter className="size-4" />
            Filter
            {activeFilterCount > 0 ? (
              <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
                {activeFilterCount}
              </Badge>
            ) : null}
          </Button>
          {canWrite ? (
            <Button type="button" size="sm" onClick={openNewItem}>
              <Plus className="size-4" />
              New Schedule Item
            </Button>
          ) : null}
          {canWrite && scheduleOffline ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-[#E5E7EB] bg-white"
                disabled={draftPublishing}
                onClick={handleDiscardDraft}
              >
                Discard Draft
              </Button>
              <Button type="button" size="sm" disabled={draftPublishing} onClick={() => void handlePublishDraft()}>
                {draftPublishing ? <Loader2 className="size-4 animate-spin" /> : null}
                Publish Changes
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
