'use client'

import { useEffect } from 'react'
import Header from '@/components/layout/Header'
import FanqieCatalog from '@/components/library/FanqieCatalog'
import { useAuthStore } from '@/stores/auth'

export default function LibraryPage() {
  const { authReady, hydrate } = useAuthStore()

  useEffect(() => {
    hydrate()
  }, [hydrate])

  return (
    <div className="flex h-screen-dynamic flex-col bg-white dark:bg-zinc-950">
      <Header />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-5 py-6 md:px-8">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 pb-5 dark:border-zinc-800">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-zinc-400">账号与内容</p>
              <h1 className="mt-1 text-2xl font-semibold text-gray-950 dark:text-zinc-100">作品</h1>
            </div>
          </header>
          {authReady ? <FanqieCatalog /> : <p className="py-16 text-center text-sm text-gray-500">正在加载账号...</p>}
        </div>
      </main>
    </div>
  )
}
