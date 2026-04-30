import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

import { AssigneeSelect, MultiSelectPopover } from "../components"
import { FILTER_PRESETS, STATUS_OPTIONS } from "../constants"
import { buildFilterPreset } from "../filters"
import type { AppUser, FilterState } from "../types"

type FilterSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  draftFilters: FilterState
  setDraftFilters: React.Dispatch<React.SetStateAction<FilterState>>
  setAppliedFilters: React.Dispatch<React.SetStateAction<FilterState>>
  setListPage: (page: number) => void
  draftPresetValue: string
  users: AppUser[]
  availableTagOptions: Array<{ id: string; name: string }>
  phaseOptions: Array<{ id: string; name: string }>
}

export function FilterSheet({
  open,
  onOpenChange,
  draftFilters,
  setDraftFilters,
  setAppliedFilters,
  setListPage,
  draftPresetValue,
  users,
  availableTagOptions,
  phaseOptions,
}: FilterSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-xl border-[#E5E7EB] bg-white p-0 sm:max-w-xl">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-[#E5E7EB] px-6 py-5">
            <SheetTitle>Filter Schedule</SheetTitle>
            <SheetDescription>
              Apply the same filters across Calendar, List, and Gantt.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="space-y-5 p-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">Standard Filter</label>
                <Select
                  value={draftPresetValue}
                  onValueChange={(value) => setDraftFilters(buildFilterPreset(value))}
                >
                  <SelectTrigger className="border-[#E5E7EB]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILTER_PRESETS.map((preset) => (
                      <SelectItem key={preset.value} value={preset.value}>
                        {preset.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom" disabled>
                      Custom Filter
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">Title</label>
                <Input
                  value={draftFilters.title}
                  className="border-[#E5E7EB]"
                  placeholder="Search by title or note"
                  onChange={(event) => setDraftFilters((current) => ({ ...current, preset: "custom", title: event.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">Assigned To</label>
                <AssigneeSelect
                  users={users}
                  value={draftFilters.assignedTo}
                  onChange={(value) => setDraftFilters((current) => ({ ...current, preset: "custom", assignedTo: value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">Status</label>
                <Select
                  value={draftFilters.status}
                  onValueChange={(value) => setDraftFilters((current) => ({ ...current, preset: "custom", status: value }))}
                >
                  <SelectTrigger className="border-[#E5E7EB]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">Tags</label>
                <MultiSelectPopover
                  placeholder="Select tags"
                  options={availableTagOptions}
                  selected={draftFilters.tags}
                  onChange={(next) => setDraftFilters((current) => ({ ...current, preset: "custom", tags: next }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">Phases</label>
                <MultiSelectPopover
                  placeholder="Select phases"
                  options={phaseOptions}
                  selected={draftFilters.phases}
                  onChange={(next) => setDraftFilters((current) => ({ ...current, preset: "custom", phases: next }))}
                />
              </div>
            </div>
          </ScrollArea>

          <div className="flex items-center justify-between gap-3 border-t border-[#E5E7EB] px-6 py-5">
            <Button
              type="button"
              variant="outline"
              className="border-[#E5E7EB]"
              onClick={() => {
                const reset = buildFilterPreset("all")
                setDraftFilters(reset)
                setAppliedFilters(reset)
                onOpenChange(false)
                setListPage(1)
              }}
            >
              Clear all
            </Button>
            <Button
              type="button"
              onClick={() => {
                setAppliedFilters(draftFilters)
                setListPage(1)
                onOpenChange(false)
              }}
            >
              Apply filter
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
