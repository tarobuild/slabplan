import { Link } from "react-router-dom"
import {
  Briefcase,
  ClipboardList,
  File as FileIcon,
  Folder as FolderIcon,
  Building2,
  CalendarDays,
  TrendingUp,
  User as UserIcon,
  Activity as ActivityIcon,
} from "lucide-react"
import type { AgentCitation } from "@/lib/agent-api"
import { cn } from "@/lib/utils"

const ICONS: Record<AgentCitation["kind"], React.ComponentType<{ className?: string }>> = {
  job: Briefcase,
  lead: TrendingUp,
  client: Building2,
  file: FileIcon,
  folder: FolderIcon,
  daily_log: ClipboardList,
  schedule_item: CalendarDays,
  user: UserIcon,
  activity: ActivityIcon,
}

const LABELS: Record<AgentCitation["kind"], string> = {
  job: "Job",
  lead: "Lead",
  client: "Client",
  file: "File",
  folder: "Folder",
  daily_log: "Daily log",
  schedule_item: "Schedule item",
  user: "User",
  activity: "Activity",
}

function hrefFor(citation: AgentCitation): string | null {
  switch (citation.kind) {
    case "job":
      return `/jobs/${citation.id}`
    case "lead":
      return `/sales/leads?lead=${citation.id}`
    case "client":
      return `/clients?client=${citation.id}`
    case "folder":
      return citation.jobId
        ? `/jobs/${citation.jobId}/files/documents?folder=${citation.id}`
        : null
    case "file":
      return citation.jobId
        ? `/jobs/${citation.jobId}/files/documents?file=${citation.id}`
        : null
    case "daily_log":
      return citation.jobId
        ? `/jobs/${citation.jobId}/daily-logs?log=${citation.id}`
        : `/daily-logs/mine?log=${citation.id}`
    case "schedule_item":
      return citation.jobId
        ? `/jobs/${citation.jobId}/schedule?item=${citation.id}`
        : null
    case "user":
      return `/settings/team?user=${citation.id}`
    case "activity":
      return null
    default:
      return null
  }
}

export type CitationChipProps = {
  citation: AgentCitation
  onNavigate?: () => void
  className?: string
}

export default function CitationChip({
  citation,
  onNavigate,
  className,
}: CitationChipProps) {
  const Icon = ICONS[citation.kind] ?? FileIcon
  const label = citation.label?.trim() || `${LABELS[citation.kind]} ${citation.id.slice(0, 8)}`
  const href = hrefFor(citation)
  const body = (
    <>
      <Icon className="size-3.5 shrink-0 text-slate-500" />
      <span className="truncate">{label}</span>
      <span className="shrink-0 rounded bg-slate-200 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-600">
        {LABELS[citation.kind]}
      </span>
    </>
  )

  const baseClasses = cn(
    "inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs",
    href ? "hover:border-orange-400 hover:bg-orange-50" : "cursor-default opacity-80",
    className,
  )

  if (!href) {
    return <span className={baseClasses}>{body}</span>
  }

  return (
    <Link to={href} className={baseClasses} onClick={onNavigate}>
      {body}
    </Link>
  )
}
