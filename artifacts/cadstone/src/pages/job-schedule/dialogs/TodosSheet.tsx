import { Edit3, ListChecks } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { api } from "@/lib/api"
import { toastApiError } from "@/lib/api-errors"
import { fmtClockRange, fmtDate, type ScheduleItemRecord, todayStr } from "@/lib/schedule"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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

type TodosSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string | undefined
  myTodos: ScheduleItemRecord[]
  currentUserId: string | null | undefined
  onRefresh: () => Promise<void>
  onOpenItem: (itemId: string) => void
}

export function TodosSheet({
  open,
  onOpenChange,
  jobId,
  myTodos,
  currentUserId,
  onRefresh,
  onOpenItem,
}: TodosSheetProps) {
  const [todoTitle, setTodoTitle] = useState("")
  const [todoDueDate, setTodoDueDate] = useState("")
  const [todoScheduleMode, setTodoScheduleMode] = useState<"preset" | "specific">("preset")
  const [todoTimeOfDay, setTodoTimeOfDay] = useState("")
  const [todoSpecificTime, setTodoSpecificTime] = useState("")
  const [todoSaving, setTodoSaving] = useState(false)

  function resetTodoForm() {
    setTodoTitle("")
    setTodoDueDate("")
    setTodoScheduleMode("preset")
    setTodoTimeOfDay("")
    setTodoSpecificTime("")
  }

  async function handleAddPersonalTodo() {
    if (!todoTitle.trim() || !jobId || todoSaving) return
    setTodoSaving(true)
    try {
      const presetMap: Record<string, { start: string; end: string }> = {
        "First thing in the morning": { start: "07:00", end: "09:00" },
        "Midday": { start: "11:00", end: "13:00" },
        "End of day": { start: "15:00", end: "17:00" },
      }
      let startTime: string | null = null
      let endTime: string | null = null
      let isHourly = false

      const resolvedTime = todoScheduleMode === "specific" && todoSpecificTime
        ? `Specific: ${todoSpecificTime}`
        : todoTimeOfDay || undefined

      if (resolvedTime?.startsWith("Specific: ")) {
        const raw = resolvedTime.replace("Specific: ", "")
        startTime = raw.length === 5 ? raw : raw.substring(0, 5)
        const hour = parseInt(startTime.split(":")[0], 10)
        endTime = `${String(Math.min(hour + 1, 23)).padStart(2, "0")}:${startTime.split(":")[1]}`
        isHourly = true
      } else if (resolvedTime && presetMap[resolvedTime]) {
        startTime = presetMap[resolvedTime].start
        endTime = presetMap[resolvedTime].end
        isHourly = true
      }

      await api.post(`/jobs/${jobId}/schedule`, {
        title: todoTitle.trim(),
        startDate: todoDueDate || todayStr(),
        workDays: 1,
        isHourly,
        startTime,
        endTime,
        isPersonalTodo: true,
        assigneeIds: currentUserId ? [currentUserId] : [],
        showOnGantt: false,
      })
      resetTodoForm()
      await onRefresh()
      toast.success("Personal to-do added")
    } catch (err) {
      toastApiError(err, "Failed to add to-do")
    } finally {
      setTodoSaving(false)
    }
  }

  async function handleTogglePersonalTodo(item: ScheduleItemRecord) {
    try {
      await api.post(`/schedule-items/${item.id}/complete`, {
        isComplete: !item.isComplete,
        progress: item.isComplete ? 0 : 100,
      })
      await onRefresh()
    } catch (err) {
      toastApiError(err, "Failed to update to-do")
    }
  }

  const sortedTodos = useMemo(() => {
    return [...myTodos].sort((a, b) => {
      if (!!a.isComplete !== !!b.isComplete) return a.isComplete ? 1 : -1
      return a.startDate.localeCompare(b.startDate)
    })
  }, [myTodos])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-xl border-[#E5E7EB] bg-white p-0 sm:max-w-xl">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-[#E5E7EB] px-6 py-5">
            <SheetTitle>My To-Do&apos;s</SheetTitle>
            <SheetDescription>Personal to-do items for this job. Only visible to you.</SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1">
            <div className="space-y-5 p-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-600">What needs to be done?</label>
                  <Input
                    value={todoTitle}
                    onChange={(e) => setTodoTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleAddPersonalTodo() }}
                    placeholder="e.g. Pick up materials from supplier"
                    className="h-10"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">Due date</label>
                    <Input
                      type="date"
                      value={todoDueDate}
                      onChange={(e) => setTodoDueDate(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">When</label>
                    <Select
                      value={todoScheduleMode === "specific" ? "_specific" : (todoTimeOfDay || "_none")}
                      onValueChange={(v) => {
                        if (v === "_specific") {
                          setTodoScheduleMode("specific")
                          setTodoTimeOfDay("")
                        } else {
                          setTodoScheduleMode("preset")
                          setTodoSpecificTime("")
                          setTodoTimeOfDay(v === "_none" ? "" : v)
                        }
                      }}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Anytime" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">Anytime</SelectItem>
                        <SelectItem value="First thing in the morning">Morning (7 - 9 AM)</SelectItem>
                        <SelectItem value="Midday">Midday (11 AM - 1 PM)</SelectItem>
                        <SelectItem value="End of day">End of day (3 - 5 PM)</SelectItem>
                        <SelectItem value="_specific">Pick a specific time...</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {todoScheduleMode === "specific" && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">Specific time</label>
                    <Input
                      type="time"
                      value={todoSpecificTime}
                      onChange={(e) => setTodoSpecificTime(e.target.value)}
                      className="h-9 w-36 text-sm"
                    />
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button size="sm" variant="ghost" onClick={resetTodoForm} disabled={todoSaving}>
                    Clear
                  </Button>
                  <Button size="sm" onClick={() => void handleAddPersonalTodo()} disabled={!todoTitle.trim() || todoSaving}>
                    {todoSaving ? "Saving..." : "Add To-Do"}
                  </Button>
                </div>
              </div>

              {myTodos.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  <ListChecks className="mx-auto mb-2 size-6 text-slate-400" />
                  No personal to-do&apos;s yet. Add one above.
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedTodos.map((todo) => (
                    <label
                      key={todo.id}
                      className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <Checkbox
                        checked={!!todo.isComplete}
                        onCheckedChange={() => void handleTogglePersonalTodo(todo)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className={cn("text-sm font-medium text-slate-900", todo.isComplete && "line-through text-slate-400")}>
                          {todo.title}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                          <span>{fmtDate(todo.startDate)}</span>
                          {todo.isHourly && todo.startTime ? (
                            <span>{fmtClockRange(todo.startTime, todo.endTime)}</span>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onOpenItem(todo.id)
                          onOpenChange(false)
                        }}
                      >
                        <Edit3 className="size-3.5" />
                      </button>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  )
}
