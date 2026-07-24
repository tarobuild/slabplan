import React, { Fragment, useState, type ReactNode } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  ListChecks,
  Wrench,
} from "lucide-react"
import type { AgentMessage, AgentToolCall } from "@/lib/agent-api"
import CitationChip from "./Citation"
import { cn } from "@/lib/utils"

export type ChatMessageProps = {
  message: AgentMessage
  onCitationNavigate?: () => void
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
}

function formatInput(input: unknown): string {
  if (input == null) return "—"
  if (typeof input === "string") return input
  try {
    const json = JSON.stringify(input, null, 2)
    return json.length > 600 ? json.slice(0, 600) + "…" : json
  } catch {
    return String(input)
  }
}

function parseInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = []
  const matcher = /(\*\*([^*]+)\*\*|`([^`]+)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = matcher.exec(text)) != null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[2] != null) {
      parts.push(
        <strong
          key={`${keyPrefix}-b-${match.index}`}
          className="font-semibold text-slate-900"
        >
          {match[2]}
        </strong>,
      )
    } else if (match[3] != null) {
      parts.push(
        <code
          key={`${keyPrefix}-c-${match.index}`}
          className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-700"
        >
          {match[3]}
        </code>,
      )
    }

    lastIndex = matcher.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

function stripDecorativeHeadingPrefix(text: string): string {
  return text
    .replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]+/u, "")
    .trim()
}

function tableCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim())
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line)
  return (
    cells != null &&
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell))
  )
}

function MarkdownDataRows({
  headers,
  rows,
  blockKey,
}: {
  headers: string[]
  rows: string[][]
  blockKey: string
}) {
  return (
    <div className="space-y-1.5" data-message-table="true">
      {rows.map((row, rowIndex) => {
        const title = row[0]?.trim()
        const details = headers
          .map((header, index) => ({
            header: header.trim(),
            value: row[index]?.trim() ?? "",
          }))
          .filter((item, index) => index !== 0 && item.header && item.value)

        return (
          <div
            key={`${blockKey}-row-${rowIndex}`}
            className="rounded-md border border-slate-200 bg-slate-50/80 p-2"
          >
            {title ? (
              <div className="text-sm font-semibold leading-snug text-slate-900">
                {parseInlineMarkdown(
                  title,
                  `${blockKey}-row-${rowIndex}-title`,
                )}
              </div>
            ) : null}
            {details.length > 0 ? (
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs leading-snug">
                {details.map((item, detailIndex) => (
                  <Fragment key={`${blockKey}-row-${rowIndex}-${detailIndex}`}>
                    <dt className="font-medium text-slate-500">
                      {item.header}
                    </dt>
                    <dd className="min-w-0 break-words text-slate-800">
                      {parseInlineMarkdown(
                        item.value,
                        `${blockKey}-row-${rowIndex}-${detailIndex}-value`,
                      )}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function MarkdownMessageContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  const blocks: ReactNode[] = []
  let index = 0

  const pushParagraph = (paragraphLines: string[], blockIndex: number) => {
    const text = paragraphLines.join("\n").trim()
    if (!text) return
    blocks.push(
      <p
        key={`p-${blockIndex}`}
        className="whitespace-pre-line leading-relaxed"
      >
        {parseInlineMarkdown(text, `p-${blockIndex}`)}
      </p>,
    )
  }

  while (index < lines.length) {
    const line = lines[index] ?? ""
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed)
    if (headingMatch) {
      const heading = stripDecorativeHeadingPrefix(headingMatch[2] ?? "")
      blocks.push(
        <h3
          key={`h-${index}`}
          className="pt-1 text-[13px] font-semibold leading-snug text-slate-950 first:pt-0"
        >
          {parseInlineMarkdown(heading, `h-${index}`)}
        </h3>,
      )
      index += 1
      continue
    }

    if (/^-{3,}$/.test(trimmed)) {
      blocks.push(<div key={`hr-${index}`} className="h-px bg-slate-200" />)
      index += 1
      continue
    }

    const headerCells = tableCells(trimmed)
    if (headerCells && isTableDivider(lines[index + 1] ?? "")) {
      const rows: string[][] = []
      index += 2
      while (index < lines.length) {
        const cells = tableCells(lines[index] ?? "")
        if (!cells || isTableDivider(lines[index] ?? "")) break
        rows.push(cells)
        index += 1
      }

      if (rows.length > 0) {
        blocks.push(
          <MarkdownDataRows
            key={`table-${index}`}
            headers={headerCells}
            rows={rows}
            blockKey={`table-${index}`}
          />,
        )
      }
      continue
    }

    const bulletMatch = /^[-*]\s+(.+)$/.exec(trimmed)
    if (bulletMatch) {
      const items: string[] = []
      while (index < lines.length) {
        const itemMatch = /^[-*]\s+(.+)$/.exec((lines[index] ?? "").trim())
        if (!itemMatch) break
        items.push(itemMatch[1] ?? "")
        index += 1
      }

      blocks.push(
        <ul
          key={`ul-${index}`}
          className="list-disc space-y-1 pl-4 leading-relaxed"
        >
          {items.map((item, itemIndex) => (
            <li key={`ul-${index}-${itemIndex}`}>
              {parseInlineMarkdown(item, `ul-${index}-${itemIndex}`)}
            </li>
          ))}
        </ul>,
      )
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length) {
      const next = lines[index] ?? ""
      const nextTrimmed = next.trim()
      if (
        !nextTrimmed ||
        /^(#{1,4})\s+/.test(nextTrimmed) ||
        /^-{3,}$/.test(nextTrimmed) ||
        /^[-*]\s+/.test(nextTrimmed)
      ) {
        break
      }
      paragraphLines.push(next)
      index += 1
    }
    pushParagraph(paragraphLines, index)
  }

  return <div className="space-y-2">{blocks}</div>
}

function ToolCallRow({
  call,
  onCitationNavigate,
}: {
  call: AgentToolCall
  onCitationNavigate?: () => void
}) {
  const isPending = call.status === "pending"
  const isError = call.status === "error"
  const isOk = call.status === "ok"
  const [open, setOpen] = useState(false)

  return (
    <div
      className={cn(
        "rounded-md border text-xs",
        isError
          ? "border-red-200 bg-red-50"
          : isPending
            ? "border-primary/20 bg-primary/5"
            : "border-slate-200 bg-slate-50",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        {isPending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : isOk ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
        ) : (
          <AlertCircle className="size-3.5 shrink-0 text-red-600" />
        )}
        <Wrench className="size-3.5 shrink-0 text-slate-400" />
        <span className="font-mono text-[11px] font-medium text-slate-700">
          {call.name}
        </span>
        {isPending ? (
          <span className="ml-auto text-[10px] italic text-primary">
            running…
          </span>
        ) : call.durationMs != null ? (
          <span className="ml-auto text-[10px] text-slate-400">
            {formatDuration(call.durationMs)}
          </span>
        ) : null}
        <ChevronRight
          className={cn(
            "size-3.5 text-slate-400 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open ? (
        <div className="space-y-1.5 border-t border-slate-200 px-2 py-1.5 text-[11px] text-slate-600">
          <div>
            <div className="mb-0.5 font-semibold text-slate-500">Input</div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-1.5 font-mono text-[10px] text-slate-700">
              {formatInput(call.input)}
            </pre>
          </div>
          {call.resultSummary ? (
            <div>
              <div className="mb-0.5 font-semibold text-slate-500">Result</div>
              <div className="break-words text-slate-700">
                {call.resultSummary}
              </div>
            </div>
          ) : null}
          {call.errorMessage ? (
            <div className="text-red-700">
              <span className="font-semibold">Error:</span> {call.errorMessage}
            </div>
          ) : null}
          {call.citations && call.citations.length > 0 ? (
            <div>
              <div className="mb-0.5 font-semibold text-slate-500">
                References
              </div>
              <div className="flex flex-wrap gap-1">
                {call.citations.map((c) => (
                  <CitationChip
                    key={`${c.kind}:${c.id}`}
                    citation={c}
                    onNavigate={onCitationNavigate}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ActionsSection({
  calls,
  onCitationNavigate,
}: {
  calls: AgentToolCall[]
  onCitationNavigate?: () => void
}) {
  const pendingCount = calls.filter((c) => c.status === "pending").length
  const errorCount = calls.filter((c) => c.status === "error").length
  // Auto-expand while any step is still running so users can watch progress.
  const [open, setOpen] = useState(pendingCount > 0)
  // Keep it open while pending; collapse decision belongs to the user otherwise.
  const isOpen = pendingCount > 0 ? true : open

  return (
    <div className="w-full overflow-hidden rounded-md border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] text-slate-600 hover:bg-slate-50"
        aria-expanded={isOpen}
      >
        {pendingCount > 0 ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <ListChecks className="size-3.5 shrink-0 text-slate-400" />
        )}
        <span className="font-medium text-slate-700">Actions</span>
        <span className="text-slate-400">
          {pendingCount > 0
            ? `${calls.length - pendingCount} of ${calls.length} done`
            : `${calls.length} step${calls.length === 1 ? "" : "s"}`}
        </span>
        {errorCount > 0 ? (
          <span className="rounded bg-red-100 px-1 text-[10px] font-medium text-red-700">
            {errorCount} failed
          </span>
        ) : null}
        <ChevronRight
          className={cn(
            "ml-auto size-3.5 text-slate-400 transition-transform",
            isOpen && "rotate-90",
          )}
        />
      </button>
      {isOpen ? (
        <div className="space-y-1 border-t border-slate-200 bg-slate-50/50 p-1.5">
          {calls.map((call) => (
            <ToolCallRow
              key={call.id}
              call={call}
              onCitationNavigate={onCitationNavigate}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function ChatMessage({
  message,
  onCitationNavigate,
}: ChatMessageProps) {
  const isUser = message.role === "user"
  const isAssistant = message.role === "assistant"

  return (
    <div className={cn("flex w-full flex-col gap-2", isUser && "items-end")}>
      <div
        className={cn(
          "max-w-[92%] rounded-lg px-3 py-2 text-sm break-words",
          isUser
            ? "whitespace-pre-wrap bg-[#1D1D1D] text-white"
            : "bg-white text-slate-800 border border-slate-200",
        )}
      >
        {message.content ? (
          isAssistant ? (
            <MarkdownMessageContent content={message.content} />
          ) : (
            message.content
          )
        ) : isAssistant ? (
          <em className="text-slate-400">…</em>
        ) : (
          ""
        )}
      </div>

      {isAssistant && message.citations && message.citations.length > 0 ? (
        <div className="flex w-full flex-wrap gap-1.5">
          {message.citations.map((c) => (
            <CitationChip
              key={`${c.kind}:${c.id}`}
              citation={c}
              onNavigate={onCitationNavigate}
            />
          ))}
        </div>
      ) : null}

      {isAssistant && message.toolCalls && message.toolCalls.length > 0 ? (
        <ActionsSection
          calls={message.toolCalls}
          onCitationNavigate={onCitationNavigate}
        />
      ) : null}

      {isAssistant &&
      message.stoppedReason &&
      message.stoppedReason !== "end_turn" ? (
        <div className="text-[10px] uppercase tracking-wide text-slate-400">
          stopped: {message.stoppedReason}
        </div>
      ) : null}
    </div>
  )
}
