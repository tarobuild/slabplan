import type { AgentMessage } from "@/lib/agent-api"

export function reconcileFailedSendMessages(
  messages: AgentMessage[],
  options: {
    optimisticUserId: string
    placeholderId: string
    message: string
    hasPersistedUserMessage: boolean
  },
) {
  const withoutOptimisticUser = messages.filter(
    (m) => m.id !== options.optimisticUserId,
  )

  if (!options.hasPersistedUserMessage) {
    return withoutOptimisticUser.filter((m) => m.id !== options.placeholderId)
  }

  return withoutOptimisticUser.map((m) =>
    m.id === options.placeholderId
      ? { ...m, content: `(Message failed: ${options.message})` }
      : m,
  )
}
