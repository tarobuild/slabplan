import { useState } from "react"
import { ChevronRight, AlertCircle, Wrench, CheckCircle2 } from "lucide-react"
import type { AgentMessage, AgentToolCall } from "@/lib/agent-api"
import CitationChip from "./Citation"
import { cn } from "@/lib/utils"

export type ChatMessageProps = {
  message: AgentMessage
  onCitationNavigate?: () => void
}

function ToolCallRow({ call }: { call: AgentToolCall }) {
  const [open, setOpen] = useState(false)
  const ok = call.status === "ok"
  return (
    <div
      className={cn(
        "rounded-md border text-xs",
        ok
          ? "border-slate-200 bg-slate-50"
          : "border-red-200 bg-red-50",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        {ok ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
        ) : (
          <AlertCircle className="size-3.5 shrink-0 text-red-600" />
        )}
        <Wrench className="size-3.5 shrink-0 text-slate-400" />
        <span className="font-mono text-[11px] font-medium text-slate-700">
          {call.name}
        </span>
        {call.durationMs != null ? (
          <span className="ml-auto text-[10px] text-slate-400">
            {call.durationMs}ms
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
        <div className="border-t border-slate-200 px-2 py-1.5 text-[11px] text-slate-600 space-y-1">
          <div>
            <span className="font-semibold text-slate-500">Input:</span>{" "}
            <code className="break-all">{JSON.stringify(call.input)}</code>
          </div>
          {call.resultSummary ? (
            <div>
              <span className="font-semibold text-slate-500">Result:</span>{" "}
              {call.resultSummary}
            </div>
          ) : null}
          {call.errorMessage ? (
            <div className="text-red-700">
              <span className="font-semibold">Error:</span> {call.errorMessage}
            </div>
          ) : null}
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
        <details className="w-full">
          <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700">
            {message.toolCalls.length} tool call{message.toolCalls.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-1 space-y-1">
            {message.toolCalls.map((call) => (
              <ToolCallRow key={call.id} call={call} />
            ))}
          </div>
        </details>
      ) : null}

      {isAssistant && message.stoppedReason && message.stoppedReason !== "end_turn" ? (
        <div className="text-[10px] uppercase tracking-wide text-slate-400">
          stopped: {message.stoppedReason}
        </div>
      ) : null}
    </div>
  )
}
