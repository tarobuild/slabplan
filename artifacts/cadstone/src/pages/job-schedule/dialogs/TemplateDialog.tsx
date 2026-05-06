import { type Dispatch, type SetStateAction } from "react"
import { Loader2, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { SCHEDULE_TEMPLATES } from "../constants"
import type { ScheduleTemplate } from "../types"

interface TemplateDialogProps {
  open: boolean
  onOpenChange: Dispatch<SetStateAction<boolean>>
  templateApplyingId: string | null
  onApplyTemplate: (template: ScheduleTemplate) => Promise<void> | void
}

export function TemplateDialog({
  open,
  onOpenChange,
  templateApplyingId,
  onApplyTemplate,
}: TemplateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-[#E5E7EB] bg-white">
        <DialogHeader>
          <DialogTitle>Import From Templates</DialogTitle>
          <DialogDescription>
            Apply a pre-built schedule template to create the first pass of this job timeline.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          {SCHEDULE_TEMPLATES.map((template) => (
            <div key={template.id} className="rounded-2xl border border-[#E5E7EB] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{template.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">{template.description}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={templateApplyingId !== null}
                  onClick={() => void onApplyTemplate(template)}
                >
                  {templateApplyingId === template.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </Button>
              </div>
              <div className="mt-4 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                {template.items.length} schedule item{template.items.length === 1 ? "" : "s"}
              </div>
              <div className="mt-3 space-y-2">
                {template.items.map((item) => (
                  <div key={`${template.id}-${item.title}`} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    <span>{item.title}</span>
                    <span>{item.workDays} day{item.workDays === 1 ? "" : "s"}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
