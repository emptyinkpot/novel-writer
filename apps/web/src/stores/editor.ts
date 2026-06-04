import { create } from 'zustand'

interface Work {
  id: string
  title: string
  updatedAt: string
}

interface EditorState {
  currentWork: Work | null
  works: Work[]
  setCurrentWork: (work: Work | null) => void
  setWorks: (works: Work[]) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  currentWork: null,
  works: [],
  setCurrentWork: (currentWork) => set({ currentWork }),
  setWorks: (works) => set({ works }),
}))
