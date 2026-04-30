import { create } from "zustand"

type AgentPanelState = {
  open: boolean
  activeConversationId: string | null
  setOpen: (open: boolean) => void
  toggle: () => void
  setActiveConversation: (id: string | null) => void
}

export const useAgentPanelStore = create<AgentPanelState>((set) => ({
  open: false,
  activeConversationId: null,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
  setActiveConversation: (id) => set({ activeConversationId: id }),
}))
