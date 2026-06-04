'use client'

import { useState } from 'react'
import { Search, LayoutGrid, List, Plus } from 'lucide-react'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'

const sortOptions = ['最近更新', '创建时间', '书名', '字数']
const tabs = ['作品(0)', '回收站(0)', '未分组(0)']

export default function LibraryPage() {
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [activeTab, setActiveTab] = useState(0)
  const [sort, setSort] = useState(sortOptions[0])
  const [search, setSearch] = useState('')

  return (
    <div className="flex h-screen-dynamic flex-col">
      <Header />
      <div className="flex flex-1 flex-col overflow-auto bg-white dark:bg-zinc-900">
        <section className="px-6 py-8 md:px-12">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-4xl text-center">
              <h1 className="mb-3 text-4xl font-extrabold dark:text-slate-100">我的作品</h1>
              <p className="text-gray-600 dark:text-zinc-400">管理您的创作，继续编写您的故事，或开始一个全新的创作</p>
            </div>
            <div className="mx-auto mb-8 mt-6 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索作品..."
                  className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                />
              </div>
            </div>
            <div className="mb-6 flex items-center justify-between">
              <div className="rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
                <div className="inline-flex h-[38px] gap-2">
                  <button onClick={() => setView('grid')} className={`flex items-center gap-1.5 rounded-lg px-3 text-sm ${view === 'grid' ? 'bg-white shadow-sm dark:bg-zinc-700' : ''}`}>
                    <LayoutGrid className="h-4 w-4" /> 网格
                  </button>
                  <button onClick={() => setView('list')} className={`flex items-center gap-1.5 rounded-lg px-3 text-sm ${view === 'list' ? 'bg-white shadow-sm dark:bg-zinc-700' : ''}`}>
                    <List className="h-4 w-4" /> 列表
                  </button>
                </div>
              </div>
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                {sortOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </div>
            <div className="mb-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex items-center gap-2">
                {tabs.map((tab, i) => (
                  <button key={tab} onClick={() => setActiveTab(i)} className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition ${activeTab === i ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-zinc-800 dark:text-zinc-300'}`}>{tab}</button>
                ))}
                <button className="flex items-center gap-1 whitespace-nowrap rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-zinc-800 dark:text-zinc-300"><Plus className="h-3.5 w-3.5" /> 新建分组</button>
              </div>
            </div>
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-800"><LayoutGrid className="h-8 w-8 text-gray-400" /></div>
              <h3 className="mb-2 text-xl font-semibold text-gray-900 dark:text-slate-100">未找到作品</h3>
              <p className="text-sm text-gray-500 dark:text-zinc-500">尝试不同的搜索条件或创建新作品</p>
              <button className="mt-6 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"><Plus className="mr-1 inline h-4 w-4" /> 新建作品</button>
            </div>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
