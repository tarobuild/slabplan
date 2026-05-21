import { type Dispatch, type SetStateAction } from "react"
import { Download, Filter, MoreHorizontal, Plus, Settings2 } from "lucide-react"
import {
  fmtDate,
  fmtDateTime,
  type ScheduleBaselineRecord,
} from "@/lib/schedule"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { EmptyState } from "../components"

interface BaselineTabProps {
  baseline: ScheduleBaselineRecord | null
  scheduleOffline: boolean
  // Admin may set/reset baseline; crew gets read-only.
  canWrite: boolean
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setFilterOpen: Dispatch<SetStateAction<boolean>>
  enterDraftMode: () => void
  handleDiscardDraft: () => void
  handleResetBaseline: () => Promise<void> | void
  handleSetBaseline: () => Promise<void> | void
  handleExport: (kind: "baseline" | "exceptions" | "schedule") => void
}

export function BaselineTab(props: BaselineTabProps) {
  const {
    baseline,
    scheduleOffline,
    canWrite,
    setSettingsOpen,
    setFilterOpen,
    enterDraftMode,
    handleDiscardDraft,
    handleResetBaseline,
    handleSetBaseline,
    handleExport,
  } = props

  return (
    <div className="space-y-4">
      <div data-print-hide="true" className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2" />

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {canWrite ? (
              <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white" onClick={() => setSettingsOpen(true)}>
                <Settings2 className="size-4" />
              </Button>
            ) : null}
            {canWrite ? (
              <div className="flex h-10 items-center gap-3 rounded-lg border border-[#E5E7EB] px-3">
                <span className="text-sm font-medium text-slate-700">Schedule Offline</span>
                <Switch checked={scheduleOffline} onCheckedChange={(checked) => (checked ? enterDraftMode() : handleDiscardDraft())} />
              </div>
            ) : null}
            {canWrite ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white">
                    <MoreHorizontal className="size-4" />
                    More Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem disabled={!baseline} onClick={() => void handleResetBaseline()}>
                    Reset Baseline
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white">
                  <Download className="size-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport("baseline")}>Export PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white" onClick={() => setFilterOpen(true)}>
              <Filter className="size-4" />
              Filter
            </Button>
            {canWrite ? (
              <Button type="button" size="sm" onClick={() => void handleSetBaseline()}>
                <Plus className="size-4" />
                Set Baseline
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {!baseline ? (
        <EmptyState
          title="Perfect your schedule with baseline"
          description="Take a snapshot of your ideal project schedule and compare to timeline changes to improve planning of future projects."
          actionLabel={canWrite ? "Set Baseline" : undefined}
          onAction={canWrite ? () => void handleSetBaseline() : undefined}
        />
      ) : (
        <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] px-6 py-5">
            <p className="text-sm font-semibold text-slate-900">Baseline comparison</p>
            <p className="mt-1 text-sm text-slate-500">
              Captured {fmtDateTime(baseline.capturedAt)} by {baseline.capturedByName || "System"}
            </p>
          </div>
          <div className="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Title</TableHead>
                  <TableHead>Baseline Start</TableHead>
                  <TableHead>Baseline End</TableHead>
                  <TableHead>Current Start</TableHead>
                  <TableHead>Current End</TableHead>
                  <TableHead>Shift</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {baseline.items.map((item) => (
                  <TableRow key={item.scheduleItemId}>
                    <TableCell className="font-medium text-slate-900">{item.title}</TableCell>
                    <TableCell>{fmtDate(item.baselineStartDate)}</TableCell>
                    <TableCell>{fmtDate(item.baselineEndDate)}</TableCell>
                    <TableCell>{fmtDate(item.currentStartDate)}</TableCell>
                    <TableCell>{fmtDate(item.currentEndDate)}</TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          "border-0",
                          item.shiftDays === 0 && "bg-emerald-100 text-emerald-700",
                          item.shiftDays > 0 && "bg-rose-100 text-rose-700",
                          item.shiftDays < 0 && "bg-amber-100 text-amber-700",
                        )}
                      >
                        {item.shiftDays === 0
                          ? "On track"
                          : `${item.shiftDays > 0 ? "+" : ""}${item.shiftDays} day${Math.abs(item.shiftDays) === 1 ? "" : "s"}`}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
