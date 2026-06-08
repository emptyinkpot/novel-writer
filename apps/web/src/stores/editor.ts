import { create } from 'zustand'

export interface Work {
  id: number
  title: string
  createdAt?: string
  updatedAt: string
}

export interface Chapter {
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
  error: string | null
  setCurrentWork: (work: Work | null) => void
  setWorks: (works: Work[]) => void
  setChapters: (chapters: Chapter[]) => void
  setCurrentChapter: (chapter: Chapter | null) => void
  updateChapterContent: (content: string) => void
  setSaving: (v: boolean) => void
  setAiWriting: (v: boolean) => void
  setError: (message: string | null) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  currentWork: null,
  works: [],
  chapters: [],
  currentChapter: null,
  saving: false,
  aiWriting: false,
  error: null,
  setCurrentWork: (currentWork) => set({ currentWork }),
  setWorks: (works) => set({ works }),
  setChapters: (chapters) => set({ chapters }),
  setCurrentChapter: (currentChapter) => set({ currentChapter }),
  updateChapterContent: (content) =>
    set((s) => s.currentChapter ? {
      currentChapter: { ...s.currentChapter, content },
      chapters: s.chapters.map((chapter) =>
        chapter.id === s.currentChapter?.id ? { ...chapter, content } : chapter
      ),
    } : {}),
  setSaving: (saving) => set({ saving }),
  setAiWriting: (aiWriting) => set({ aiWriting }),
  setError: (error) => set({ error }),
}))
