import React, { useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
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

function MarkdownMessageContent({ content }: { content: string }) {
  return (
    <div className="assistant-markdown min-w-0 space-y-3 text-sm leading-7 [overflow-wrap:anywhere]">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h1: ({ children }) => <h3 className="mt-5 text-base font-semibold first:mt-0">{children}</h3>,
          h2: ({ children }) => <h3 className="mt-5 text-base font-semibold first:mt-0">{children}</h3>,
          h3: ({ children }) => <h3 className="mt-4 text-sm font-semibold first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-4 text-sm font-semibold">{children}</h4>,
          h5: ({ children }) => <h4 className="mt-4 text-sm font-semibold">{children}</h4>,
          h6: ({ children }) => <h4 className="mt-4 text-sm font-semibold">{children}</h4>,
          p: ({ children }) => <p className="whitespace-pre-line">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children, start }) => <ol start={start} className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="[&>ul]:mt-1 [&>ol]:mt-1">{children}</li>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-3 text-muted-foreground">{children}</blockquote>,
          hr: () => <hr className="border-border" />,
          pre: ({ children }) => <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-6 [&>code]:bg-transparent [&>code]:p-0">{children}</pre>,
          code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
          table: ({ children }) => (
            <div data-message-table="true" role="region" aria-label="Response table" tabIndex={0} className="max-w-full overflow-x-auto rounded-md border border-border focus-visible:outline-2 focus-visible:outline-primary">
              <table className="w-full min-w-max border-collapse text-left text-sm leading-6">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/70">{children}</thead>,
          th: ({ children, style }) => <th scope="col" style={style} className="max-w-72 border-b border-border px-3 py-2 font-semibold whitespace-normal">{children}</th>,
          td: ({ children, style }) => <td style={style} className="max-w-72 border-b border-border px-3 py-2 align-top whitespace-normal">{children}</td>,
          a: ({ children, href }) => href ? <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2">{children}</a> : <span>{children}</span>,
          // Model output must not load tracking pixels or external image URLs.
          img: ({ alt }) => <span className="text-muted-foreground">{alt || "Image"}</span>,
        }}
      >
        {content}
      </Markdown>
    </div>
  )
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
    <div className="w-full min-w-0 border-t border-border pt-1">
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
        <div className="space-y-1 py-1.5">
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
    <div className={cn("flex w-full min-w-0 flex-col gap-3", isUser && "items-end")}>
      <div
        className={cn(
          "min-w-0 text-sm [overflow-wrap:anywhere]",
          isUser
            ? "max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-4 py-3 text-primary-foreground"
            : "w-full py-1 text-foreground",
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
        <div className="text-xs text-muted-foreground">
          Response stopped: {message.stoppedReason.replaceAll("_", " ")}
        </div>
      ) : null}
    </div>
  )
}
