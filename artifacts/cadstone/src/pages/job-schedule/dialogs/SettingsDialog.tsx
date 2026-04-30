import { type Dispatch, type SetStateAction } from "react"
import { Loader2, Plus } from "lucide-react"
import {
  DEFAULT_SCHEDULE_COLOR,
  SCHEDULE_COLOR_OPTIONS,
  SCHEDULE_DEFAULT_VIEW_OPTIONS,
  type ScheduleViewModeDefault,
} from "@/lib/schedule"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import type { ScheduleSettingsForm } from "../types"

export interface SettingsDialogProps {
  open: boolean
  onOpenChange: Dispatch<SetStateAction<boolean>>
  settingsForm: ScheduleSettingsForm
  setSettingsForm: Dispatch<SetStateAction<ScheduleSettingsForm>>
  settingsSaving: boolean
  onSave: () => Promise<void> | void
}

export function SettingsDialog({
  open,
  onOpenChange,
  settingsForm,
  setSettingsForm,
  settingsSaving,
  onSave,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl border-[#E5E7EB] bg-white">
        <DialogHeader>
          <DialogTitle>Schedule Settings</DialogTitle>
          <DialogDescription>
            Configure default schedule viewing and phase management for this job.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>Default view</Label>
              <Select
                value={settingsForm.defaultView}
                onValueChange={(value) =>
                  setSettingsForm((current) => ({
                    ...current,
                    defaultView: value as ScheduleViewModeDefault,
                  }))
                }
              >
                <SelectTrigger className="border-[#E5E7EB]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_DEFAULT_VIEW_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-[#E5E7EB] p-4">
            {[
              {
                key: "showTimesOnMonthView",
                label: "Show times for hourly items on Calendar - Month view",
              },
              {
                key: "showJobNameOnAllListedJobs",
                label: "Show job name on Calendar for All Listed Jobs",
              },
              {
                key: "automaticallyMarkItemsComplete",
                label: "Automatically mark items complete",
              },
              {
                key: "includeHeaderOnPdfExports",
                label: "Include header on schedule PDF exports",
              },
            ].map((option) => (
              <label key={option.key} className="flex items-center gap-3">
                <Checkbox
                  checked={settingsForm[option.key as keyof ScheduleSettingsForm] as boolean}
                  onCheckedChange={(checked) =>
                    setSettingsForm((current) => ({
                      ...current,
                      [option.key]: checked === true,
                    }))
                  }
                />
                <span className="text-sm text-slate-700">{option.label}</span>
              </label>
            ))}
          </div>

          <div className="space-y-4 rounded-xl border border-[#E5E7EB] p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Phases Management</h3>
                <p className="mt-1 text-sm text-slate-500">Phases appear in schedule items, filters, list grouping, and Gantt coloring.</p>
              </div>
              <Button
                type="button"
                onClick={() =>
                  setSettingsForm((current) => ({
                    ...current,
                    phases: [
                      ...current.phases,
                      {
                        id: `new-${Date.now()}`,
                        name: "",
                        color: SCHEDULE_COLOR_OPTIONS[3]?.value || DEFAULT_SCHEDULE_COLOR,
                        isNew: true,
                      },
                    ],
                  }))
                }
              >
                <Plus className="size-4" />
                Add Phase
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phase Name</TableHead>
                  <TableHead>Color</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settingsForm.phases.map((phase) => (
                  <TableRow key={phase.id}>
                    <TableCell>
                      <Input
                        value={phase.name}
                        onChange={(event) =>
                          setSettingsForm((current) => ({
                            ...current,
                            phases: current.phases.map((entry) =>
                              entry.id === phase.id
                                ? { ...entry, name: event.target.value }
                                : entry,
                            ),
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={phase.color}
                        onValueChange={(value) =>
                          setSettingsForm((current) => ({
                            ...current,
                            phases: current.phases.map((entry) =>
                              entry.id === phase.id
                                ? { ...entry, color: value }
                                : entry,
                            ),
                          }))
                        }
                      >
                        <SelectTrigger className="w-[220px] border-[#E5E7EB]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SCHEDULE_COLOR_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <div className="flex items-center gap-2">
                                <span className="size-3 rounded-full" style={{ backgroundColor: option.value }} />
                                {option.label}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-end">
            <Button type="button" disabled={settingsSaving} onClick={() => void onSave()}>
              {settingsSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
