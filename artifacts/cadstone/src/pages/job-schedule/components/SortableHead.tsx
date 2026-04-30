import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { TableHead } from "@/components/ui/table"
import type { SortDirection, SortKey } from "../types"

export function SortableHead({
  label,
  sortKey,
  activeSortKey,
  direction,
  onSort,
  className,
}: {
  label: string
  sortKey: SortKey
  activeSortKey: SortKey
  direction: SortDirection
  onSort: (key: SortKey) => void
  className?: string
}) {
  const isActive = activeSortKey === sortKey

  return (
    <TableHead className={className}>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500",
          isActive && "text-slate-900",
        )}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            isActive && direction === "asc" && "rotate-180",
            !isActive && "text-slate-300",
          )}
        />
      </button>
    </TableHead>
  )
}
