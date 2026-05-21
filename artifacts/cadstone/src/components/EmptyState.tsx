import type { ComponentType, ReactNode } from "react"
import { Link } from "react-router-dom"
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
  const renderAction = (
    item: EmptyStateAction,
    variant: "primary" | "secondary",
  ) => {
    const button = (
      <Button
        type="button"
        size="sm"
        variant={variant === "primary" ? undefined : "outline"}
        onClick={item.onClick}
        className={variant === "primary" ? "hover:opacity-90 transition-opacity" : undefined}
        asChild={Boolean(item.href)}
      >
        {item.href ? <Link to={item.href}>{item.label}</Link> : item.label}
      </Button>
    )
    return button
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-white px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-accent text-primary">
          <Icon className="size-6" />
        </div>
      ) : null}
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {(action || secondaryAction) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action ? (
            renderAction(action, "primary")
          ) : null}
          {secondaryAction ? (
            renderAction(secondaryAction, "secondary")
          ) : null}
        </div>
      )}
    </div>
  )
}
