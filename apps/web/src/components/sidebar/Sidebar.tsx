'use client'

import { useEditorStore } from '@/stores/editor'
import ChapterTree from '@/components/editor/ChapterTree'
import { apiJson } from '@/lib/api'
import { useState } from 'react'

export default function Sidebar() {
  const { works, currentWork, setCurrentWork, setWorks, setCurrentChapter, setChapters, setError } = useEditorStore()
  const [creating, setCreating] = useState(false)

  const createWork = async () => {
    setCreating(true)
    setError(null)
    try {
      const res = await apiJson<{ code: number; data: any }>('/api/v1/library/create-work', {
        method: 'POST',
        body: { title: `未命名作品 ${works.length + 1}`, status: 'draft' },
      })
      const nextWorks = [res.data, ...works]
      setWorks(nextWorks)
      setCurrentWork(res.data)
      setCurrentChapter(null)
      setChapters([])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '新建作品失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 px-4 py-3 dark:border-zinc-700">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-zinc-200">我的作品</h2>
      </div>
      <div className="overflow-y-auto px-2 py-2">
        {works.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-gray-400 dark:text-zinc-500">
            暂无作品
          </p>
        )}
        {works.map((work) => (
          <button
            key={work.id}
            onClick={() => setCurrentWork(work)}
            className={`mb-1 w-full rounded px-3 py-2 text-left text-sm transition ${
              currentWork?.id === work.id
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                : 'text-gray-700 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {work.title}
          </button>
        ))}
      </div>
      <div className="flex-1 border-t border-gray-200 dark:border-zinc-700">
        <ChapterTree />
      </div>
      <div className="border-t border-gray-200 p-3 dark:border-zinc-700">
        <button onClick={createWork} disabled={creating} className="w-full rounded bg-blue-600 px-3 py-2 text-sm text-white transition hover:bg-blue-700 disabled:opacity-50">
          {creating ? '创建中...' : '新建作品'}
        </button>
      </div>
    </div>
  )
}
