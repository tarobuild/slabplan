import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtDateTime } from "@/lib/schedule"

import { EmptyState } from "../components"
import { getActivityEntryChanges, titleCaseStatus } from "../filters"
import type { ActivityEntry } from "../types"

type HistorySheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  loading: boolean
  entries: ActivityEntry[]
}

export function HistorySheet({ open, onOpenChange, loading, entries }: HistorySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-xl border-[#E5E7EB] bg-white p-0 sm:max-w-xl">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-[#E5E7EB] px-6 py-5">
            <SheetTitle>Schedule history</SheetTitle>
            <SheetDescription>
              A chronological record of schedule changes for this job.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="space-y-3 p-6">
              {loading ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-20 w-full" />
                ))
              ) : entries.length === 0 ? (
                <EmptyState
                  title="No changes made."
                  description="You haven't made any changes to the schedule yet. When you do, you'll see a record of them here."
                />
              ) : (
                entries.map((entry) => {
                  const description = typeof entry.metadata?.description === "string"
                    ? entry.metadata.description
                    : titleCaseStatus(entry.action)
                  const changes = getActivityEntryChanges(entry.metadata)

                  return (
                    <div key={entry.id} className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">{description}</p>
                          <p className="mt-1 text-sm text-slate-500">
                            {entry.userName || "System"} • {fmtDateTime(entry.createdAt)}
                          </p>
                          {changes.length > 0 ? (
                            <div className="mt-3 space-y-2 rounded-lg bg-slate-50 px-3 py-3">
                              {changes.map((change) => (
                                <div key={`${entry.id}-${change.field}`} className="text-sm text-slate-600">
                                  <span className="font-medium text-slate-900">{change.label}:</span>{" "}
                                  <span className="text-slate-500">{change.from}</span>{" "}
                                  <span aria-hidden="true">→</span>{" "}
                                  <span className="text-slate-900">{change.to}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <Badge variant="outline" className="border-[#E5E7EB] bg-[#F8FAFC] text-slate-600">
                          {titleCaseStatus(entry.action)}
                        </Badge>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  )
}
