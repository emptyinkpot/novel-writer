'use client'

import Sidebar from '@/components/sidebar/Sidebar'
import Editor from '@/components/editor/Editor'
import ChatPanel from '@/components/chat/ChatPanel'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sun, Moon, ChevronDown } from 'lucide-react'
import { useState } from 'react'

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
  const [dark, setDark] = useState(false)

  const toggleTheme = () => {
    setDark(!dark)
    document.documentElement.classList.toggle('dark')
  }

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
    </div>
  )
}
