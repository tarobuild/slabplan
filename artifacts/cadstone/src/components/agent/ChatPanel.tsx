import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUp,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Pin,
  PinOff,
  Sparkles,
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
import { APP_NAME } from "@/lib/brand"
import { cn } from "@/lib/utils"
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

export default function ChatPanel() {
  const { open, setOpen, activeConversationId, setActiveConversation } =
    useAgentPanelStore()
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [usage, setUsage] = useState<AgentUsage | null>(null)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const streamRef = useRef<StreamHandle | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const messageLoadSeqRef = useRef(0)
  const localMessageSeqRef = useRef(0)

  // Scroll to bottom on new messages.
  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [messages, statusText, open])

  // Load conversations + usage when opening.
  const refreshConversations = useCallback(async (): Promise<
    AgentConversation[] | null
  > => {
    try {
      const list = await listConversations()
      setConversations(list)
      return list
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load conversations")
      return null
    }
  }, [])

  const refreshUsage = useCallback(async () => {
    try {
      setUsage(await getUsage())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refreshConversations()
    void refreshUsage()
  }, [open, refreshConversations, refreshUsage])

  // Start a conversation if none active.
  useEffect(() => {
    if (!open) return
    if (activeConversationId) return
    let cancelled = false
    void (async () => {
      const list = await refreshConversations()
      if (cancelled) return
      if (list === null) return
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
          toast.error(err instanceof Error ? err.message : "Failed to start conversation")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, activeConversationId, setActiveConversation, refreshConversations])

  // Load messages on conversation change.
  useEffect(() => {
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
                  ? { ...m, content: m.content || `(Error: ${event.message})` }
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
      },
    })
  }

  const usagePct = usage ? Math.min(100, Math.round((usage.totalTokens / usage.cap) * 100)) : 0

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="flex w-full max-w-md flex-col gap-0 p-0 sm:max-w-md [&>button.absolute]:hidden"
      >
        <SheetTitle className="sr-only">
          {activeConversation?.title ?? "Assistant"}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Read-only assistant for {APP_NAME}. Ask about jobs, leads, files, daily
          logs, schedule items, clients, or activity.
        </SheetDescription>
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Sparkles className="size-4 text-primary" />
          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="block w-full truncate text-left text-sm font-semibold text-slate-800 hover:text-slate-600"
              title={activeConversation?.title ?? "Assistant"}
            >
              {activeConversation?.title ?? "Assistant"}
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
            ) : null}
          </div>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
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
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
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
          <div className="max-h-60 overflow-y-auto border-b border-border bg-muted px-2 py-2">
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
                      ? "bg-accent text-primary"
                      : "text-foreground hover:bg-accent/60",
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
                    className="rounded p-0.5 opacity-0 hover:bg-slate-200 group-hover:opacity-100"
                    aria-label="Rename"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePin(c)}
                    className="rounded p-0.5 opacity-0 hover:bg-slate-200 group-hover:opacity-100"
                    aria-label={c.pinned ? "Unpin" : "Pin"}
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
                    className="rounded p-0.5 opacity-0 hover:bg-red-100 hover:text-red-700 group-hover:opacity-100"
                    aria-label="Delete"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-background px-3 py-3">
          {messages.length === 0 ? (
            <div className="mx-auto mt-8 max-w-xs space-y-3 text-center text-sm text-slate-500">
              <Sparkles className="mx-auto size-6 text-[hsl(var(--oxide))]" />
              <p className="font-semibold text-slate-700">
                Read-only assistant for {APP_NAME}
              </p>
              <p className="text-xs">
                Ask about your jobs, leads, files, daily logs, schedule items,
                clients, or activity. I can search and summarize, but I can't
                make changes.
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
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="size-3 animate-spin" />
              {statusText}
            </div>
          ) : null}
        </div>

        {/* Composer */}
        <div className="border-t border-border bg-white p-2">
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={
                usage?.exceeded
                  ? "Monthly limit reached"
                  : "Ask about jobs, leads, files…"
              }
              disabled={busy || usage?.exceeded === true}
              rows={2}
              className="min-h-0 resize-none text-sm"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={busy || !draft.trim() || usage?.exceeded === true}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md text-white transition-colors",
                "bg-primary hover:bg-primary/90 disabled:bg-slate-300",
              )}
              aria-label="Send"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
          </div>
          <p className="mt-1 px-1 text-[10px] text-slate-400">
            Read-only. Press Enter to send, Shift+Enter for newline.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
