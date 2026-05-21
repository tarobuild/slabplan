import { useMemo, useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type WorkerOption = {
  id: string
  fullName: string
  email: string
  role: string
  avatarUrl: string | null
  canViewFinancials?: boolean
  access?: {
    financials: boolean
  }
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export default function WorkerAssignmentPicker({
  options,
  selectedIds,
  onChange,
  placeholder = "Search workers",
  className,
}: {
  options: WorkerOption[]
  selectedIds: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  className?: string
}) {
  const [query, setQuery] = useState("")
  const [focused, setFocused] = useState(false)

  const selectedWorkers = useMemo(
    () => options.filter((option) => selectedIds.includes(option.id)),
    [options, selectedIds],
  )

  const availableWorkers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return options.filter((option) => {
      if (selectedIds.includes(option.id)) {
        return false
      }

      if (!normalizedQuery) {
        return true
      }

      return [option.fullName, option.email, option.role]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    })
  }, [options, query, selectedIds])

  function addWorker(userId: string) {
    onChange(selectedIds.includes(userId) ? selectedIds : [...selectedIds, userId])
    setQuery("")
    setFocused(false)
  }

  function removeWorker(userId: string) {
    onChange(selectedIds.filter((candidate) => candidate !== userId))
  }

  return (
    <div
      className={cn("rounded-md border border-[#E5E7EB] px-3 py-2", className)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
          return
        }
        setFocused(false)
      }}
    >
      {selectedWorkers.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {selectedWorkers.map((worker) => (
            <button
              key={worker.id}
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
              onClick={() => removeWorker(worker.id)}
            >
              <span>{worker.fullName}</span>
              <span className="text-slate-400">×</span>
            </button>
          ))}
        </div>
      ) : null}

      <Input
        value={query}
        placeholder={placeholder}
        className="border-0 px-0 shadow-none focus-visible:ring-0"
        onChange={(event) => setQuery(event.target.value)}
      />

      {(query.trim() || focused) && availableWorkers.length > 0 ? (
        <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-[#E5E7EB] bg-white">
          {availableWorkers.map((worker) => (
            <button
              key={worker.id}
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
              onClick={() => addWorker(worker.id)}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar className="size-8">
                  <AvatarImage src={worker.avatarUrl || undefined} alt={worker.fullName} />
                  <AvatarFallback className="bg-slate-100 text-[10px] font-semibold text-slate-700">
                    {initials(worker.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {worker.fullName}
                  </p>
                  <p className="truncate text-xs text-slate-500">{worker.email}</p>
                </div>
              </div>
              <span className="shrink-0 text-xs capitalize text-slate-400">
                {worker.role.replaceAll("_", " ")}
              </span>
            </button>
          ))}
        </div>
      ) : query.trim() ? (
        <p className="mt-2 text-xs text-slate-400">No matching workers.</p>
      ) : null}
    </div>
  )
}
