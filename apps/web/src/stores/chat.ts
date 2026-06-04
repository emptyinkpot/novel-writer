import { create } from 'zustand'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

interface ChatState {
  messages: Message[]
  currentSession: string | null
  model: string
  isGenerating: boolean
  addMessage: (msg: Message) => void
  setModel: (model: string) => void
  setGenerating: (v: boolean) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  currentSession: null,
  model: 'claude-sonnet-4-20250514',
  isGenerating: false,
  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),
  setModel: (model) => set({ model }),
  setGenerating: (isGenerating) => set({ isGenerating }),
  clearMessages: () => set({ messages: [], currentSession: null }),
}))
