import { create } from 'zustand'

interface Work {
  id: number
  title: string
  updatedAt: string
}

interface Chapter {
  id: number
  workId: number
  title: string
  content: string
  sortOrder: number
}

interface EditorState {
  currentWork: Work | null
  works: Work[]
  chapters: Chapter[]
  currentChapter: Chapter | null
  saving: boolean
  aiWriting: boolean
  setCurrentWork: (work: Work | null) => void
  setWorks: (works: Work[]) => void
  setChapters: (chapters: Chapter[]) => void
  setCurrentChapter: (chapter: Chapter | null) => void
  updateChapterContent: (content: string) => void
  setSaving: (v: boolean) => void
  setAiWriting: (v: boolean) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  currentWork: null,
  works: [],
  chapters: [],
  currentChapter: null,
  saving: false,
  aiWriting: false,
  setCurrentWork: (currentWork) => set({ currentWork }),
  setWorks: (works) => set({ works }),
  setChapters: (chapters) => set({ chapters }),
  setCurrentChapter: (currentChapter) => set({ currentChapter }),
  updateChapterContent: (content) =>
    set((s) => s.currentChapter ? { currentChapter: { ...s.currentChapter, content } } : {}),
  setSaving: (saving) => set({ saving }),
  setAiWriting: (aiWriting) => set({ aiWriting }),
}))
