import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * The one page header used across the app: a clear title, an optional
 * one-line description, and the page's actions on the right (primary action
 * last). Keeps every screen's top edge consistent so people always know
 * where to look for "what is this" and "what can I do here".
 */
export default function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Small context label above the title (e.g. a parent record). Use sparingly. */
  eyebrow?: ReactNode
  className?: string
  /** Optional content under the title row (filters, tabs, stats). */
  children?: ReactNode
}) {
  return (
    <header className={cn("mb-6 space-y-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          {eyebrow ? (
            <div className="text-sm font-medium text-muted-foreground">{eyebrow}</div>
          ) : null}
          <h1 className="text-2xl font-semibold text-foreground [overflow-wrap:anywhere] sm:text-[28px] sm:leading-9">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-[15px]">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </header>
  )
}
