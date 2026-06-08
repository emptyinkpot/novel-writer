'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, LayoutGrid, List, Plus, FileText } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import { apiJson } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { useEditorStore, type Work } from '@/stores/editor'

const sortOptions = ['最近更新', '创建时间', '书名', '字数']
const tabs = ['作品(0)', '回收站(0)', '未分组(0)']

export default function LibraryPage() {
  const router = useRouter()
  const { token, hydrate } = useAuthStore()
  const { setWorks, setCurrentWork } = useEditorStore()
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [activeTab, setActiveTab] = useState(0)
  const [sort, setSort] = useState(sortOptions[0])
  const [search, setSearch] = useState('')
  const [works, setLocalWorks] = useState<Work[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    apiJson<{ code: number; data: Work[] }>('/api/v1/library/work-list')
      .then((res) => {
        setLocalWorks(res.data)
        setWorks(res.data)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '加载作品失败'))
      .finally(() => setLoading(false))
  }, [token, setWorks])

  const filteredWorks = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const result = keyword
      ? works.filter((work) => work.title.toLowerCase().includes(keyword))
      : works
    return [...result].sort((a, b) => {
      if (sort === '书名') return a.title.localeCompare(b.title, 'zh-Hans')
      if (sort === '创建时间') return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
    })
  }, [search, sort, works])

  const tabLabels = [`作品(${works.length})`, '回收站(0)', '未分组(0)']

  const openWork = (work: Work) => {
    setCurrentWork(work)
    router.push('/editor')
  }

  const createWork = async () => {
    if (!token) {
      router.push('/login')
      return
    }
    setCreating(true)
    setError('')
    try {
      const title = `未命名作品 ${works.length + 1}`
      const res = await apiJson<{ code: number; data: Work }>('/api/v1/library/create-work', {
        method: 'POST',
        body: { title, status: 'draft' },
      })
      const nextWorks = [res.data, ...works]
      setLocalWorks(nextWorks)
      setWorks(nextWorks)
      setCurrentWork(res.data)
      router.push('/editor')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '新建作品失败')
    } finally {
      setCreating(false)
    }
  }

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
                {tabLabels.map((tab, i) => (
                  <button key={tab} onClick={() => setActiveTab(i)} className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition ${activeTab === i ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-zinc-800 dark:text-zinc-300'}`}>{tab}</button>
                ))}
                <button className="flex items-center gap-1 whitespace-nowrap rounded-full bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-zinc-800 dark:text-zinc-300"><Plus className="h-3.5 w-3.5" /> 新建分组</button>
              </div>
            </div>
            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            )}
            {!token ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <h3 className="mb-2 text-xl font-semibold text-gray-900 dark:text-slate-100">登录后管理作品</h3>
                <button onClick={() => router.push('/login')} className="mt-6 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">去登录</button>
              </div>
            ) : loading ? (
              <div className="py-20 text-center text-sm text-gray-500 dark:text-zinc-500">加载作品中...</div>
            ) : filteredWorks.length > 0 ? (
              <div className={view === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-3'}>
                <button
                  onClick={createWork}
                  disabled={creating}
                  className={`flex min-h-[132px] w-full flex-col items-center justify-center border border-dashed border-blue-300 bg-blue-50/60 p-4 text-center text-blue-700 transition hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300 ${
                    view === 'grid' ? 'rounded-xl' : 'rounded-lg'
                  }`}
                >
                  <Plus className="mb-2 h-6 w-6" />
                  <span className="text-sm font-semibold">{creating ? '创建中...' : '新建作品'}</span>
                </button>
                {filteredWorks.map((work) => (
                  <button
                    key={work.id}
                    onClick={() => openWork(work)}
                    className={`group w-full border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950 ${
                      view === 'grid' ? 'rounded-xl' : 'flex items-center gap-4 rounded-lg'
                    }`}
                  >
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-gray-900 group-hover:text-blue-600 dark:text-zinc-100">{work.title}</h3>
                      <p className="mt-1 text-xs text-gray-500 dark:text-zinc-500">
                        更新于 {work.updatedAt ? new Date(work.updatedAt).toLocaleString() : '未知时间'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-800"><LayoutGrid className="h-8 w-8 text-gray-400" /></div>
                <h3 className="mb-2 text-xl font-semibold text-gray-900 dark:text-slate-100">未找到作品</h3>
                <p className="text-sm text-gray-500 dark:text-zinc-500">尝试不同的搜索条件或创建新作品</p>
                <button onClick={createWork} disabled={creating} className="mt-6 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><Plus className="mr-1 inline h-4 w-4" /> {creating ? '创建中...' : '新建作品'}</button>
              </div>
            )}
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
