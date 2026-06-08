'use client'

import Sidebar from '@/components/sidebar/Sidebar'
import Editor from '@/components/editor/Editor'
import ChatPanel from '@/components/chat/ChatPanel'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiJson } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { useEditorStore, type Work } from '@/stores/editor'

const navItems = [
  { label: '首页', href: '/' },
  { label: '作品', href: '/library' },
  { label: '工具箱', href: '/generator' },
  { label: '工作流', href: '/workflow' },
  { label: '价格', href: '/pricing' },
  { label: '教程', href: '/tutorials' },
]

export default function EditorPage() {
  const pathname = usePathname()
  const router = useRouter()
  const [dark, setDark] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const { token, hydrate } = useAuthStore()
  const { works, currentWork, setWorks, setCurrentWork, setCurrentChapter, setChapters } = useEditorStore()

  const toggleTheme = () => {
    setDark(!dark)
    document.documentElement.classList.toggle('dark')
  }

  useEffect(() => {
    hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    apiJson<{ code: number; data: Work[] }>('/api/v1/library/work-list')
      .then((res) => {
        setWorks(res.data)
        if (!currentWork && res.data.length > 0) {
          setCurrentWork(res.data[0])
        }
        if (res.data.length === 0) {
          setCurrentWork(null)
          setCurrentChapter(null)
          setChapters([])
        }
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : '加载作品失败'))
      .finally(() => setLoading(false))
  }, [token, currentWork, setWorks, setCurrentWork, setCurrentChapter, setChapters])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo-nobg.png" alt="咕嘎写作" className="h-8 w-8 rounded-lg" />
            <span className="text-sm font-bold text-gray-900 dark:text-zinc-100">咕嘎写作</span>
          </Link>
          <nav className="hidden items-center gap-4 sm:flex">
            {navItems.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link key={item.href} href={item.href} className={`text-sm font-medium transition-colors ${isActive ? 'text-blue-600' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}>{item.label}</Link>
              )
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>
      {!token ? (
        <div className="flex flex-1 items-center justify-center bg-white dark:bg-zinc-950">
          <div className="text-center">
            <h1 className="mb-2 text-xl font-semibold text-gray-900 dark:text-zinc-100">登录后进入编辑器</h1>
            <button onClick={() => router.push('/login')} className="mt-4 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700">去登录</button>
          </div>
        </div>
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center bg-white text-sm text-gray-500 dark:bg-zinc-950 dark:text-zinc-400">加载作品中...</div>
      ) : loadError ? (
        <div className="flex flex-1 items-center justify-center bg-white dark:bg-zinc-950">
          <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{loadError}</div>
        </div>
      ) : (
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[15%] min-w-[200px] border-r border-gray-200 bg-gray-50 dark:border-zinc-800 dark:bg-zinc-900">
          <Sidebar />
        </aside>
        <main className="w-[55%] flex-1 overflow-y-auto bg-white dark:bg-zinc-950">
          <Editor />
        </main>
        <aside className="w-[30%] min-w-[320px] border-l border-gray-200 bg-gray-50 dark:border-zinc-800 dark:bg-zinc-900">
          <ChatPanel />
        </aside>
      </div>
      )}
    </div>
  )
}
