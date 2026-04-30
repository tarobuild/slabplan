import { type Dispatch, type SetStateAction } from "react"
import {
  ArrowLeft,
  Download,
  Edit3,
  Filter,
  Loader2,
  Plus,
  Settings2,
} from "lucide-react"
import {
  fmtDate,
  type ScheduleSettings,
  type ScheduleWorkdayException,
} from "@/lib/schedule"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

import { EmptyState, MultiSelectPopover } from "../components"
import { defaultExceptionForm } from "../filters"
import type { JobOption, WorkdayExceptionForm } from "../types"

export interface ExceptionsTabProps {
  jobId: string | undefined
  jobs: JobOption[]
  scheduleOffline: boolean
  workdayExceptions: ScheduleWorkdayException[]
  workdayEditorOpen: boolean
  workdayForm: WorkdayExceptionForm
  workdaySaving: boolean
  categoryEditorOpen: boolean
  categoryDraft: string
  editingCategories: Record<string, string>
  settings: ScheduleSettings
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setFilterOpen: Dispatch<SetStateAction<boolean>>
  setWorkdayEditorOpen: Dispatch<SetStateAction<boolean>>
  setWorkdayForm: Dispatch<SetStateAction<WorkdayExceptionForm>>
  setCategoryEditorOpen: Dispatch<SetStateAction<boolean>>
  setCategoryDraft: Dispatch<SetStateAction<string>>
  setEditingCategories: Dispatch<SetStateAction<Record<string, string>>>
  enterDraftMode: () => void
  handleDiscardDraft: () => void
  handleExport: (kind: "baseline" | "exceptions" | "schedule") => void
  openNewWorkdayException: () => void
  openExistingWorkdayException: (exception: ScheduleWorkdayException) => void
  handleSaveWorkdayException: () => Promise<void> | void
  handleDeleteWorkdayException: () => Promise<void> | void
  handleCreateCategory: () => Promise<void> | void
  handleSaveCategory: (categoryId: string) => Promise<void> | void
}

export function ExceptionsTab(props: ExceptionsTabProps) {
  const {
    jobId,
    jobs,
    scheduleOffline,
    workdayExceptions,
    workdayEditorOpen,
    workdayForm,
    workdaySaving,
    categoryEditorOpen,
    categoryDraft,
    editingCategories,
    settings,
    setSettingsOpen,
    setFilterOpen,
    setWorkdayEditorOpen,
    setWorkdayForm,
    setCategoryEditorOpen,
    setCategoryDraft,
    setEditingCategories,
    enterDraftMode,
    handleDiscardDraft,
    handleExport,
    openNewWorkdayException,
    openExistingWorkdayException,
    handleSaveWorkdayException,
    handleDeleteWorkdayException,
    handleCreateCategory,
    handleSaveCategory,
  } = props

  return (
    <div className="space-y-4">
      <div data-print-hide="true" className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2" />

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="size-4" />
            </Button>
            <div className="flex h-10 items-center gap-3 rounded-lg border border-[#E5E7EB] px-3">
              <span className="text-sm font-medium text-slate-700">Schedule Offline</span>
              <Switch checked={scheduleOffline} onCheckedChange={(checked) => (checked ? enterDraftMode() : handleDiscardDraft())} />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white">
                  <Download className="size-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport("exceptions")}>Export CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("exceptions")}>Export PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white" onClick={() => setFilterOpen(true)}>
              <Filter className="size-4" />
              Filter
            </Button>
            <Button type="button" size="sm" onClick={openNewWorkdayException}>
              <Plus className="size-4" />
              Workday Exception
            </Button>
          </div>
        </div>
      </div>

      {workdayEditorOpen ? (
        <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
          <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-6 py-5">
            <div>
              <button
                type="button"
                className="inline-flex items-center gap-2 text-sm font-medium text-orange-700 hover:underline"
                onClick={() => {
                  setWorkdayEditorOpen(false)
                  if (jobId) {
                    setWorkdayForm(defaultExceptionForm(jobId))
                  }
                }}
              >
                <ArrowLeft className="size-4" />
                Back to Workday Exceptions
              </button>
              <h2 className="mt-3 text-lg font-semibold text-slate-900">
                {workdayForm.id ? "Edit Workday Exception" : "Add Workday Exception"}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {workdayForm.id ? (
                <Button type="button" variant="outline" className="border-rose-200 text-rose-700" onClick={() => void handleDeleteWorkdayException()}>
                  Delete
                </Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={() => setWorkdayEditorOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={workdaySaving} onClick={() => void handleSaveWorkdayException()}>
                {workdaySaving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>

          <div className="space-y-6 px-6 py-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="workday-title">Title</Label>
                <Input
                  id="workday-title"
                  value={workdayForm.title}
                  placeholder="Company Holiday"
                  onChange={(event) => setWorkdayForm((current) => ({ ...current, title: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <RadioGroup
                  value={workdayForm.type}
                  onValueChange={(value) => setWorkdayForm((current) => ({ ...current, type: value as WorkdayExceptionForm["type"] }))}
                  className="grid gap-3 md:grid-cols-2"
                >
                  <label className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] px-3 py-3">
                    <RadioGroupItem value="non_workday" />
                    <span className="text-sm text-slate-700">Non workday</span>
                  </label>
                  <label className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] px-3 py-3">
                    <RadioGroupItem value="extra_workday" />
                    <span className="text-sm text-slate-700">Extra workday</span>
                  </label>
                </RadioGroup>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="workday-start">Start date</Label>
                <Input
                  id="workday-start"
                  type="date"
                  value={workdayForm.startDate}
                  onChange={(event) => setWorkdayForm((current) => ({ ...current, startDate: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="workday-end">End date</Label>
                <Input
                  id="workday-end"
                  type="date"
                  value={workdayForm.endDate}
                  onChange={(event) => setWorkdayForm((current) => ({ ...current, endDate: event.target.value }))}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">Same every year</p>
                <p className="text-xs text-slate-500">Repeat this exception annually on the same dates.</p>
              </div>
              <Switch
                checked={workdayForm.sameEveryYear}
                onCheckedChange={(checked) => setWorkdayForm((current) => ({ ...current, sameEveryYear: checked }))}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>Category</Label>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white" onClick={() => setCategoryEditorOpen((current) => !current)}>
                    <Plus className="size-4" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="border-[#E5E7EB] bg-white" onClick={() => setCategoryEditorOpen((current) => !current)}>
                    <Edit3 className="size-4" />
                  </Button>
                </div>
              </div>
              <Select
                value={workdayForm.categoryId || "__none__"}
                onValueChange={(value) => setWorkdayForm((current) => ({ ...current, categoryId: value === "__none__" ? null : value }))}
              >
                <SelectTrigger className="border-[#E5E7EB]">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No category</SelectItem>
                  {(settings.workdayExceptionCategories ?? []).map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {categoryEditorOpen ? (
                <div className="space-y-3 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-4">
                  <div className="flex gap-2">
                    <Input
                      value={categoryDraft}
                      placeholder="New category"
                      onChange={(event) => setCategoryDraft(event.target.value)}
                    />
                    <Button type="button" onClick={() => void handleCreateCategory()}>
                      Save
                    </Button>
                  </div>
                  {(settings.workdayExceptionCategories ?? []).map((category) => (
                    <div key={category.id} className="flex gap-2">
                      <Input
                        value={editingCategories[category.id] ?? category.name}
                        onChange={(event) =>
                          setEditingCategories((current) => ({
                            ...current,
                            [category.id]: event.target.value,
                          }))
                        }
                      />
                      <Button type="button" variant="outline" onClick={() => void handleSaveCategory(category.id)}>
                        Save
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              <Label>Apply exception to</Label>
              <RadioGroup
                value={workdayForm.appliesToAllJobs ? "all" : "specific"}
                onValueChange={(value) =>
                  setWorkdayForm((current) => ({
                    ...current,
                    appliesToAllJobs: value === "all",
                    jobIds: value === "all" ? [] : current.jobIds.length > 0 ? current.jobIds : jobId ? [jobId] : [],
                  }))
                }
                className="grid gap-3 md:grid-cols-2"
              >
                <label className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] px-3 py-3">
                  <RadioGroupItem value="all" />
                  <span className="text-sm text-slate-700">All jobs</span>
                </label>
                <label className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] px-3 py-3">
                  <RadioGroupItem value="specific" />
                  <span className="text-sm text-slate-700">Specific jobs</span>
                </label>
              </RadioGroup>
            </div>

            {!workdayForm.appliesToAllJobs ? (
              <div className="space-y-2">
                <Label>Jobs</Label>
                <MultiSelectPopover
                  placeholder="Select jobs"
                  options={jobs.map((job) => ({ id: job.id, name: job.title }))}
                  selected={workdayForm.jobIds}
                  onChange={(next) => setWorkdayForm((current) => ({ ...current, jobIds: next }))}
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="workday-notes">Notes</Label>
                <span className="text-xs text-slate-400">{workdayForm.notes.length}/500</span>
              </div>
              <Textarea
                id="workday-notes"
                rows={5}
                value={workdayForm.notes}
                onChange={(event) => setWorkdayForm((current) => ({ ...current, notes: event.target.value.slice(0, 500) }))}
              />
            </div>
          </div>
        </div>
      ) : workdayExceptions.length === 0 ? (
        <EmptyState
          title="Plan for any circumstance with workday exceptions"
          description="Schedule days off or plan for work outside of the usual weekdays to keep projects on time."
          actionLabel="Add a Workday Exception"
          onAction={openNewWorkdayException}
        />
      ) : (
        <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] px-6 py-5">
            <p className="text-sm font-semibold text-slate-900">Workday exceptions</p>
            <p className="mt-1 text-sm text-slate-500">Click an exception to edit its schedule impact and scope.</p>
          </div>
          <div className="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Applies To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workdayExceptions.map((exception) => (
                  <TableRow key={exception.id} className="cursor-pointer hover:bg-slate-50" onClick={() => openExistingWorkdayException(exception)}>
                    <TableCell className="font-medium text-orange-700">{exception.title}</TableCell>
                    <TableCell>{exception.type === "non_workday" ? "Non workday" : "Extra workday"}</TableCell>
                    <TableCell>{fmtDate(exception.startDate)}</TableCell>
                    <TableCell>{fmtDate(exception.endDate)}</TableCell>
                    <TableCell>{exception.categoryName || "—"}</TableCell>
                    <TableCell>
                      {exception.appliesToAllJobs
                        ? "All jobs"
                        : exception.jobIds
                            .map((scopeJobId) => jobs.find((job) => job.id === scopeJobId)?.title || "Unknown job")
                            .join(", ")}
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
