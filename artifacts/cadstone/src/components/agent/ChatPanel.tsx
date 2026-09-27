import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Pencil,
  Pin,
  PinOff,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  createConversation,
  deleteConversation,
  getUsage,
  listConversations,
  listMessages,
  patchConversation,
  streamSendMessage,
  type AgentConversation,
  type AgentMessage,
  type AgentToolCall,
  type AgentUsage,
  type StreamHandle,
} from "@/lib/agent-api"
import { useAgentPanelStore } from "@/store/agent"
import { cn } from "@/lib/utils"
import { APP_NAME } from "@/lib/brand"
import { toast } from "sonner"
import ChatMessage from "./ChatMessage"
import { reconcileFailedSendMessages } from "./chat-message-reconciliation"

function newAssistantPlaceholder(conversationId: string): AgentMessage {
  return {
    id: `pending-${Date.now()}`,
    conversationId,
    role: "assistant",
    content: "",
    toolCalls: [],
    citations: [],
    inputTokens: null,
    outputTokens: null,
    stoppedReason: null,
    createdAt: new Date().toISOString(),
  }
}

function agentErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export default function ChatPanel() {
  const { open, setOpen, activeConversationId, setActiveConversation } =
    useAgentPanelStore()
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [usage, setUsage] = useState<AgentUsage | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showLatest, setShowLatest] = useState(false)
  const followLatestRef = useRef(true)
  const streamRef = useRef<StreamHandle | null>(null)
  const streamConversationIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const messageLoadSeqRef = useRef(0)
  const localMessageSeqRef = useRef(0)

  // Streaming must not pull readers away from earlier answers.
  useEffect(() => {
    if (!open || !followLatestRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "instant" })
  }, [messages, statusText, open])

  useEffect(() => {
    followLatestRef.current = true
    setShowLatest(false)
    const el = scrollRef.current
    if (open && el) el.scrollTo({ top: el.scrollHeight, behavior: "instant" })
  }, [activeConversationId, open])

  // Load conversations + usage when opening.
  const refreshConversations = useCallback(async (toastOnError = false) => {
    try {
      const list = await listConversations()
      setConversations(list)
      return list
    } catch (err) {
      if (toastOnError) {
        toast.error(agentErrorMessage(err, "Failed to load conversations"))
      }
      throw err
    }
  }, [])

  const refreshUsage = useCallback(async () => {
    setUsageLoading(true)
    setUsageError(null)
    try {
      setUsage(await getUsage())
    } catch (err) {
      setUsage(null)
      setUsageError(agentErrorMessage(err, "Assistant usage could not be loaded."))
      toast.error(agentErrorMessage(err, "Assistant usage could not be loaded."))
    } finally {
      setUsageLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    if (activeConversationId) {
      void refreshConversations(true).catch(() => undefined)
    }
    void refreshUsage()
  }, [open, activeConversationId, refreshConversations, refreshUsage])

  // Start a conversation if none active.
  useEffect(() => {
    if (!open) return
    if (activeConversationId) return
    let cancelled = false
    void (async () => {
      let list: AgentConversation[]
      try {
        list = await refreshConversations(true)
      } catch {
        return
      }
      if (cancelled) return
      const pinnedFirst = list[0]
      if (pinnedFirst) {
        setActiveConversation(pinnedFirst.id)
      } else {
        try {
          const created = await createConversation()
          if (cancelled) return
          setConversations((prev) => [created, ...prev])
          setActiveConversation(created.id)
        } catch (err) {
          toast.error(agentErrorMessage(err, "Failed to start conversation"))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, activeConversationId, setActiveConversation, refreshConversations])

  // Load messages on conversation change.
  useEffect(() => {
    if (
      streamRef.current &&
      streamConversationIdRef.current &&
      streamConversationIdRef.current !== activeConversationId
    ) {
      streamRef.current.abort()
    }
    if (!activeConversationId) {
      messageLoadSeqRef.current += 1
      setMessages([])
      return
    }
    const requestSeq = ++messageLoadSeqRef.current
    const localSeqAtStart = localMessageSeqRef.current
    let cancelled = false
    void (async () => {
      try {
        const msgs = await listMessages(activeConversationId)
        if (
          !cancelled &&
          requestSeq === messageLoadSeqRef.current &&
          localSeqAtStart === localMessageSeqRef.current
        ) {
          setMessages(msgs)
        }
      } catch (err) {
        if (!cancelled)
          toast.error(err instanceof Error ? err.message : "Failed to load messages")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeConversationId])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.abort()
    }
  }, [])

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  )

  async function handleNewChat() {
    streamRef.current?.abort()
    streamConversationIdRef.current = null
    try {
      const created = await createConversation()
      setConversations((prev) => [created, ...prev])
      setActiveConversation(created.id)
      setMessages([])
      setShowHistory(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create conversation")
    }
  }

  async function handleDeleteConversation(id: string) {
    try {
      await deleteConversation(id)
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (activeConversationId === id) {
        setActiveConversation(null)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete")
    }
  }

  async function handleRenameConversation(c: AgentConversation) {
    const next = window.prompt("Rename conversation", c.title)
    if (next === null) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === c.title) return
    try {
      const updated = await patchConversation(c.id, { title: trimmed.slice(0, 255) })
      setConversations((prev) => prev.map((x) => (x.id === c.id ? updated : x)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename")
    }
  }

  async function togglePin(c: AgentConversation) {
    try {
      const updated = await patchConversation(c.id, { pinned: !c.pinned })
      setConversations((prev) =>
        prev
          .map((x) => (x.id === c.id ? updated : x))
          .sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
            return b.lastMessageAt.localeCompare(a.lastMessageAt)
          }),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update")
    }
  }

  function handleSend() {
    const trimmed = draft.trim()
    if (!trimmed || busy || !activeConversationId) return
    followLatestRef.current = true
    setShowLatest(false)
    if (usageLoading || usageError || !usage) {
      toast.error("Assistant usage is unavailable. Reload usage before sending.")
      return
    }
    if (usage?.exceeded) {
      toast.error(
        `You've reached your monthly assistant usage limit (${usage.cap.toLocaleString()} tokens). It resets on the 1st.`,
      )
      return
    }

    const conversationId = activeConversationId
    localMessageSeqRef.current += 1
    setDraft("")
    setBusy(true)
    setStatusText("Sending…")

    // Optimistic user message + empty assistant placeholder.
    const optimisticUser: AgentMessage = {
      id: `pending-user-${Date.now()}`,
      conversationId,
      role: "user",
      content: trimmed,
      toolCalls: null,
      citations: null,
      inputTokens: null,
      outputTokens: null,
      stoppedReason: null,
      createdAt: new Date().toISOString(),
    }
    const placeholder = newAssistantPlaceholder(conversationId)
    setMessages((prev) => [...prev, optimisticUser, placeholder])

    let assistantText = ""
    let hasPersistedUserMessage = false
    const toolCalls: AgentToolCall[] = []

    streamRef.current = streamSendMessage(conversationId, trimmed, {
      onEvent: (event) => {
        switch (event.type) {
          case "user_message":
            // Replace optimistic user with persisted one (for accurate id/timestamp).
            hasPersistedUserMessage = true
            setMessages((prev) =>
              prev.map((m) => (m.id === optimisticUser.id ? event.message : m)),
            )
            break
          case "status":
            setStatusText(event.text)
            break
          case "tool_call":
            toolCalls.push({
              id: event.id,
              name: event.name,
              input: event.input,
              status: "pending",
            })
            setStatusText(`Calling ${event.name}…`)
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholder.id ? { ...m, toolCalls: [...toolCalls] } : m,
              ),
            )
            break
          case "tool_result": {
            const idx = toolCalls.findIndex((c) => c.id === event.id)
            if (idx !== -1) {
              toolCalls[idx] = {
                ...toolCalls[idx]!,
                status: event.ok ? "ok" : "error",
                resultSummary: event.summary,
                durationMs: event.durationMs,
                citations: event.citations,
                errorMessage: event.errorMessage,
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === placeholder.id ? { ...m, toolCalls: [...toolCalls] } : m,
                ),
              )
            }
            setStatusText("Thinking…")
            break
          }
          case "delta":
            assistantText += (assistantText ? "\n\n" : "") + event.text
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholder.id ? { ...m, content: assistantText } : m,
              ),
            )
            setStatusText(null)
            break
          case "done":
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholder.id
                  ? {
                      ...m,
                      id: event.messageId,
                      citations: event.citations.length > 0 ? event.citations : null,
                      toolCalls: toolCalls.length > 0 ? toolCalls : null,
                      stoppedReason: event.stoppedReason ?? null,
                      inputTokens: event.usage.inputTokens,
                      outputTokens: event.usage.outputTokens,
                    }
                  : m,
              ),
            )
            void refreshUsage()
            void refreshConversations()
            break
          case "error":
            toast.error(event.message)
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholder.id
                  ? {
                      ...m,
                      content: m.content || `(Error: ${event.message})`,
                      toolCalls:
                        toolCalls.length > 0
                          ? toolCalls.map((call) =>
                              call.status === "pending"
                                ? { ...call, status: "error", errorMessage: event.message }
                                : call,
                            )
                          : m.toolCalls,
                    }
                  : m,
              ),
            )
            break
        }
      },
      onDone: () => {
        setBusy(false)
        setStatusText(null)
        streamRef.current = null
        streamConversationIdRef.current = null
      },
      onError: (message) => {
        toast.error(message)
        setMessages((prev) =>
          reconcileFailedSendMessages(prev, {
            optimisticUserId: optimisticUser.id,
            placeholderId: placeholder.id,
            message,
            hasPersistedUserMessage,
          }),
        )
        setBusy(false)
        setStatusText(null)
        streamRef.current = null
        streamConversationIdRef.current = null
      },
    })
    streamConversationIdRef.current = conversationId
  }

  const usagePct = usage ? Math.min(100, Math.round((usage.totalTokens / usage.cap) * 100)) : 0
  const usageUnavailable = usageLoading || Boolean(usageError) || !usage
  const composerDisabled = busy || usageUnavailable || usage?.exceeded === true

  function handleStop() {
    streamRef.current?.abort()
    setMessages((previous) => previous.map((message) => message.id.startsWith("pending-") ? {
      ...message, stoppedReason: "aborted",
      toolCalls: message.toolCalls?.map((call) => call.status === "pending" ? { ...call, status: "error", errorMessage: "Response stopped" } : call) ?? null,
    } : message))
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className={cn(
          "flex h-dvh w-full max-w-full flex-col gap-0 overflow-hidden p-0 [&>button.absolute]:hidden",
          expanded ? "sm:max-w-full" : "sm:max-w-[760px]",
        )}
      >
        <SheetTitle className="sr-only">
          {activeConversation?.title ?? "Assistant"}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Read-only assistant for {APP_NAME}. Ask about jobs, leads, files, daily
          logs, schedule items, clients, or activity.
        </SheetDescription>
        {/* Header */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-3 sm:gap-2 sm:px-5">
          <Sparkles className="size-4 text-primary" />
          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              aria-controls="assistant-history"
              className="flex w-full items-center gap-1 text-left text-sm font-semibold text-slate-800 hover:text-slate-600"
              title={activeConversation?.title ?? "Assistant"}
            >
              <span className="truncate">{activeConversation?.title ?? "Assistant"}</span>
              <ChevronDown className="size-4 shrink-0" />
            </button>
            {usage ? (
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                <div className="h-1 w-16 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={cn(
                      "h-full",
                      usage.exceeded ? "bg-red-500" : "bg-primary",
                    )}
                    style={{ width: `${usagePct}%` }}
                  />
                </div>
                <span>
                  {usage.totalTokens.toLocaleString()} / {usage.cap.toLocaleString()}
                </span>
              </div>
            ) : usageLoading ? (
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                <Loader2 className="size-3 animate-spin" />
                Loading usage…
              </div>
            ) : usageError ? (
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-red-600">
                <span>Usage unavailable.</span>
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => void refreshUsage()}
                >
                  Retry
                </button>
              </div>
            ) : null}
          </div>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={() => setExpanded((value) => !value)} className="hidden size-10 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 sm:flex" aria-label={expanded ? "Restore panel" : "Expand assistant"}>
                  {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{expanded ? "Restore panel" : "Expand assistant"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="flex size-10 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  aria-label="New chat"
                >
                  <MessageSquarePlus className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>New chat</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex size-10 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* History dropdown */}
        {showHistory ? (
          <div id="assistant-history" className="max-h-60 shrink-0 overflow-y-auto border-b border-slate-200 bg-slate-50 px-2 py-2">
            {conversations.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-slate-500">
                No previous conversations.
              </p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-1 rounded px-2 py-1.5 text-xs",
                    c.id === activeConversationId
                      ? "bg-primary/10 text-primary"
                      : "text-slate-700 hover:bg-slate-100",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveConversation(c.id)
                      setShowHistory(false)
                    }}
                    className="flex-1 truncate text-left"
                    title={c.title}
                  >
                    {c.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRenameConversation(c)}
                    className="flex size-8 shrink-0 items-center justify-center rounded hover:bg-slate-200"
                    aria-label="Rename"
                    title="Rename conversation"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePin(c)}
                    className="flex size-8 shrink-0 items-center justify-center rounded hover:bg-slate-200"
                    aria-label={c.pinned ? "Unpin" : "Pin"}
                    title={c.pinned ? "Unpin conversation" : "Pin conversation"}
                  >
                    {c.pinned ? (
                      <PinOff className="size-3" />
                    ) : (
                      <Pin className="size-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteConversation(c.id)}
                    className="flex size-8 shrink-0 items-center justify-center rounded hover:bg-red-100 hover:text-red-700"
                    aria-label="Delete"
                    title="Delete conversation"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}

        {/* Messages */}
        <div ref={scrollRef} onScroll={(event) => {
          const el = event.currentTarget
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          followLatestRef.current = nearBottom
          setShowLatest(!nearBottom)
        }} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-background px-4 py-6 sm:px-7">
          <div className="mx-auto w-full max-w-4xl space-y-7">
          {messages.length === 0 ? (
            <div className="mx-auto mt-8 max-w-xs space-y-3 text-center text-sm text-slate-500">
              <Sparkles className="mx-auto size-6 text-primary" />
              <p className="font-semibold text-slate-700">
                What needs your attention today?
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <ChatMessage
                key={m.id}
                message={m}
                onCitationNavigate={() => setOpen(false)}
              />
            ))
          )}
          {statusText ? (
            <div role="status" className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="size-3 animate-spin" />
              {statusText}
            </div>
          ) : null}
          </div>
        </div>

        {showLatest ? <div className="flex justify-center border-t border-border bg-background py-1"><button type="button" title="Latest message" aria-label="Latest message" className="flex size-9 items-center justify-center rounded hover:bg-muted" onClick={() => {
          followLatestRef.current = true
          setShowLatest(false)
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
        }}><ArrowDown className="size-4" /></button></div> : null}

        {/* Composer */}
        <div className="shrink-0 border-t border-border bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7">
          <div className="mx-auto flex max-w-4xl items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={
                usageError
                  ? "Usage unavailable"
                  : usageLoading || !usage
                    ? "Loading usage…"
                    : usage?.exceeded
                  ? "Monthly limit reached"
                  : "Ask about jobs, leads, files…"
              }
              disabled={composerDisabled}
              aria-label="Message the assistant"
              rows={2}
              className="min-h-20 max-h-48 resize-y text-sm leading-6"
            />
            {busy ? <button type="button" onClick={handleStop} className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted" aria-label="Stop response" title="Stop response"><Square className="size-4" /></button> : (
            <button
              type="button"
              onClick={handleSend}
              disabled={composerDisabled || !draft.trim()}
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-md text-white transition-colors",
                "bg-primary hover:bg-primary/90 disabled:bg-slate-300",
              )}
              aria-label="Send"
              title="Send message"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
