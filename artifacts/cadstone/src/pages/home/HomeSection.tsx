import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * An unframed content section: a heading over rows separated by hairlines,
 * sitting directly on the page instead of inside a card. Used by every
 * role's home page so the dashboards share one visual language.
 */
export function HomeSection({
  title,
  action,
  children,
  className,
  ...rest
}: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  "data-testid"?: string
}) {
  return (
    <section
      {...rest}
      className={cn("min-w-0", className)}
    >
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border pb-2">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="divide-y divide-border">{children}</div>
    </section>
  )
}

export function HomeListRow({
  to,
  title,
  subtitle,
  leading,
  trailing,
  className,
  ...rest
}: {
  to: string
  title: ReactNode
  subtitle?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  className?: string
  "data-testid"?: string
}) {
  return (
    <Link
      to={to}
      {...rest}
      className={cn(
        "group flex items-center gap-3 rounded-sm py-3 outline-offset-2",
        className,
      )}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">{title}</p>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {trailing}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
    </Link>
  )
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>
}
