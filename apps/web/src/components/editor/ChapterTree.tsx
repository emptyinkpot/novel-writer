'use client'

import { useEffect } from 'react'
import { useEditorStore } from '@/stores/editor'
import { apiJson } from '@/lib/api'
import { Plus, FileText } from 'lucide-react'

export default function ChapterTree() {
  const { currentWork, chapters, currentChapter, setChapters, setCurrentChapter } = useEditorStore()

  useEffect(() => {
    if (!currentWork) {
      setChapters([])
      return
    }
    apiJson<{ data: any[] }>(`/api/v1/chapter/list?workId=${currentWork.id}`)
      .then((res) => setChapters(res.data))
      .catch(() => {})
  }, [currentWork])

  const handleNewChapter = async () => {
    if (!currentWork) return
    const res = await apiJson<{ data: any }>('/api/v1/chapter/save', {
      method: 'POST',
      body: { workId: currentWork.id, title: `第${chapters.length + 1}章`, content: '' },
    })
    setChapters([...chapters, res.data])
    setCurrentChapter(res.data)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-zinc-700">
        <span className="text-xs font-medium text-gray-500 dark:text-zinc-400">章节</span>
        <button
          onClick={handleNewChapter}
          disabled={!currentWork}
          className="rounded p-1 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-zinc-700"
        >
          <Plus className="h-3.5 w-3.5 text-gray-600 dark:text-zinc-300" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {chapters.map((ch) => (
          <button
            key={ch.id}
            onClick={() => setCurrentChapter(ch)}
            className={`mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ${
              currentChapter?.id === ch.id
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                : 'text-gray-700 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{ch.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
