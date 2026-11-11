'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Sun, Moon } from 'lucide-react'
import { useState } from 'react'
import { useAuthStore } from '@/stores/auth'

const navItems = [
  { label: '首页', href: '/' },
  { label: '作品', href: '/library' },
  { label: '工具箱', href: '/generator' },
  { label: '工作流', href: '/workflow' },
  { label: '价格', href: '/pricing' },
  { label: '教程', href: '/tutorials', badge: '推荐' },
]

export default function Header() {
  const pathname = usePathname()
  const [dark, setDark] = useState(false)
  const { user, isLoggedIn } = useAuthStore()

  const toggleTheme = () => {
    setDark(!dark)
    document.documentElement.classList.toggle('dark')
  }

  return (
    <header className="border-b border-gray-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-10">
          <Link href="/" className="flex flex-row items-center gap-2">
            <Image src="/logo-nobg.png" alt="咕嘎写作" width={36} height={36} className="rounded-xl" />
            <span className="text-lg font-bold text-gray-900 dark:text-zinc-100">咕嘎写作</span>
          </Link>
          <nav className="hidden items-center gap-6 sm:flex">
            {navItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative font-medium transition-colors ${
                    isActive
                      ? 'text-blue-600'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  {item.label}
                  {item.badge && (
                    <sup className="ml-[-2px] text-[10px] font-bold text-red-500">{item.badge}</sup>
                  )}
                </Link>
              )
            })}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-md text-gray-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          <button className="flex h-8 items-center justify-center gap-1 rounded-md px-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
            充值
          </button>
          <button className="flex h-8 items-center justify-center gap-1 rounded-md px-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
            领字数
          </button>
          <button className="flex h-8 items-center justify-center gap-1 rounded-md px-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
            返现
          </button>
          {isLoggedIn ? (
            <span className="max-w-36 truncate px-2 text-sm text-zinc-600 dark:text-zinc-300">{user?.name || user?.email || '已登录'}</span>
          ) : (
            <Link
              href="/login"
              className="rounded-md bg-blue-500 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              登录
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
