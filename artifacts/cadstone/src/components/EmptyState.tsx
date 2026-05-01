import type { ComponentType, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type EmptyStateAction = {
  label: string
  onClick?: () => void
  href?: string
}

type EmptyStateProps = {
  icon?: LucideIcon | ComponentType<{ className?: string }>
  title: string
  description?: ReactNode
  action?: EmptyStateAction
  secondaryAction?: EmptyStateAction
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E5E7EB] bg-white px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-orange-50 text-orange-500">
          <Icon className="size-6" />
        </div>
      ) : null}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      ) : null}
      {(action || secondaryAction) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action ? (
            <Button
              type="button"
              size="sm"
              onClick={action.onClick}
              style={{ backgroundColor: "#E85D04", color: "#fff" }}
              className="hover:opacity-90 transition-opacity"
            >
              {action.label}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default EmptyState
