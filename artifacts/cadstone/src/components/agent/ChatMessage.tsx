import { useState } from "react"
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
            ? "border-orange-200 bg-orange-50"
            : "border-slate-200 bg-slate-50",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        {isPending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-orange-500" />
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
          <span className="ml-auto text-[10px] italic text-orange-600">
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
          <Loader2 className="size-3.5 shrink-0 animate-spin text-orange-500" />
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

export default function ChatMessage({ message, onCitationNavigate }: ChatMessageProps) {
  const isUser = message.role === "user"
  const isAssistant = message.role === "assistant"

  return (
    <div className={cn("flex w-full flex-col gap-2", isUser && "items-end")}>
      <div
        className={cn(
          "max-w-[92%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
          isUser
            ? "bg-[#1D1D1D] text-white"
            : "bg-white text-slate-800 border border-slate-200",
        )}
      >
        {message.content || (isAssistant ? <em className="text-slate-400">…</em> : "")}
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

      {isAssistant && message.stoppedReason && message.stoppedReason !== "end_turn" ? (
        <div className="text-[10px] uppercase tracking-wide text-slate-400">
          stopped: {message.stoppedReason}
        </div>
      ) : null}
    </div>
  )
}
