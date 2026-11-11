'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, BookOpen, Check, ChevronDown, ChevronRight, Link2, LoaderCircle, RefreshCw, UserRound } from 'lucide-react'
import { apiJson } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

type Draft = { itemId: string; title: string; chapterNumber: number | null; wordCount: number; updatedAt?: string | null }
type Chapter = { itemId: string; title: string; chapterNumber: number; wordCount?: number | null; publishedAt?: string | null }
type FanqieWork = {
  accountId: string; bookId: string; title: string; status?: string | null; chapterCount?: number | null
  latestChapterNumber?: number | null; draftCount: number; draftScanStatus: string; draftScanError?: string | null; drafts: Draft[]
}
type FanqieAccount = {
  accountId: string; name: string; linked: boolean; scanStatus: string; scannedAt?: string | null
  scanErrors?: Array<{ bookId: string; title: string; error: string }>; works: FanqieWork[]; workCount: number; refreshing?: boolean
}
type ApiResult<T> = { code: number; data: T }
type CachedList<T> = { items: T[]; cachedAt: string | null; refreshing: boolean }

const encode = (value: string) => encodeURIComponent(value)

export default function FanqieCatalog() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { token, authReady } = useAuthStore()
  const [accounts, setAccounts] = useState<FanqieAccount[]>([])
  const [accountId, setAccountId] = useState('')
  const [workId, setWorkId] = useState('')
  const [accountLabel, setAccountLabel] = useState('')
  const [linkingId, setLinkingId] = useState('')
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loadingChapters, setLoadingChapters] = useState(false)
  const [chaptersRefreshing, setChaptersRefreshing] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const account = accounts.find((item) => item.accountId === accountId) ?? null
  const work = account?.works.find((item) => item.bookId === workId) ?? null
  const sortedWorks = useMemo(() => [...(account?.works ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans')), [account])

  const loadAccounts = useCallback(async (preferredId?: string, preferredWork?: string) => {
    const result = await apiJson<ApiResult<FanqieAccount[]>>('/api/v1/fanqie/accounts')
    setAccounts(result.data)
    const requested = preferredId ?? searchParams.get('accountId') ?? undefined
    const nextId = requested && result.data.some((item) => item.accountId === requested)
      ? requested : result.data.find((item) => item.linked)?.accountId ?? result.data[0]?.accountId ?? ''
    setAccountId(nextId)
    const selected = result.data.find((item) => item.accountId === nextId)
    const wantedWork = preferredWork ?? searchParams.get('bookId') ?? undefined
    setWorkId(wantedWork && selected?.works.some((item) => item.bookId === wantedWork) ? wantedWork : '')
  }, [searchParams])

  useEffect(() => {
    if (!authReady || !token) return
    loadAccounts().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载账号失败'))
  }, [authReady, loadAccounts, token])

  useEffect(() => {
    if (!account || !work) { setChapters([]); return }
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setChapters([])
    setLoadingChapters(true)
    const load = async () => {
      try {
        const result = await apiJson<ApiResult<CachedList<Chapter>>>(`/api/v1/fanqie/accounts/${encode(account.accountId)}/works/${encode(work.bookId)}/chapters`)
        if (!active) return
        setChapters(result.data.items)
        setChaptersRefreshing(result.data.refreshing)
        if (result.data.refreshing) timer = setTimeout(load, 2000)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : '读取已发布章节失败')
      } finally {
        if (active) setLoadingChapters(false)
      }
    }
    void load()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [account?.accountId, work?.bookId])

  useEffect(() => {
    if (!account?.refreshing) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await apiJson<ApiResult<FanqieAccount[]>>('/api/v1/fanqie/accounts')
        if (!active) return
        setAccounts(result.data)
        if (result.data.some((item) => item.accountId === account.accountId && item.refreshing)) timer = setTimeout(poll, 2000)
      } catch { }
    }
    timer = setTimeout(poll, 2000)
    return () => { active = false; clearTimeout(timer) }
  }, [account?.accountId, account?.refreshing])

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label); setError(''); setNotice('')
    try { await action() }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : '操作失败') }
    finally { setBusy('') }
  }

  const connectAccount = () => run('discover', async () => {
    const result = await apiJson<ApiResult<FanqieAccount>>('/api/v1/fanqie/accounts/discover', { method: 'POST' })
    await loadAccounts(result.data.accountId)
    setNotice(`已关联番茄账号「${result.data.name}」`)
  })

  const linkAccount = (id: string) => run('link', async () => {
    const result = await apiJson<ApiResult<FanqieAccount>>(`/api/v1/fanqie/accounts/${encode(id)}/link`, {
      method: 'POST', body: { displayName: accountLabel },
    })
    setLinkingId('')
    await loadAccounts(id, workId)
    setNotice(`已关联番茄账号「${result.data.name}」`)
  })

  const scanAccount = () => {
    if (!account) return
    void run('scan', async () => {
      const result = await apiJson<ApiResult<FanqieAccount>>(`/api/v1/fanqie/accounts/${encode(account.accountId)}/scan`, { method: 'POST' })
      setAccounts((current) => current.map((item) => item.accountId === result.data.accountId ? { ...result.data, linked: true } : item))
      setNotice(`已刷新「${result.data.name}」的作品和草稿目录`)
    })
  }

  const openItem = (type: 'draft' | 'chapter', itemId: string) => {
    if (!account || !work) return
    const base = `/library/fanqie/${encode(account.accountId)}/${encode(work.bookId)}/${type}/${encode(itemId)}`
    router.push(`${base}?accountId=${encode(account.accountId)}&bookId=${encode(work.bookId)}`)
  }

  const openCollectionItem = (type: 'draft' | 'chapter', itemId: string) => {
    if (!account || !work) return
    router.push(`/library/fanqie/${encode(account.accountId)}/${encode(work.bookId)}/${type}/${encode(itemId)}?accountId=${encode(account.accountId)}&bookId=${encode(work.bookId)}`)
  }

  return (
    <section className="min-w-0 flex-1">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-zinc-400">
          <UserRound className="h-4 w-4" />
          <span>本地管理员</span><ChevronRight className="h-3.5 w-3.5" />
          <span>{account?.name ?? '平台账号'}</span>
          {work && <><ChevronRight className="h-3.5 w-3.5" /><span className="max-w-56 truncate text-gray-900 dark:text-zinc-100">{work.title}</span></>}
        </div>
        <div className="flex gap-2">
          {account?.linked && <button onClick={scanAccount} disabled={!!busy} title="刷新该账号的作品与草稿" aria-label="刷新目录" className="inline-flex h-9 w-9 items-center justify-center border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
            {busy === 'scan' || account.refreshing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>}
          <button onClick={connectAccount} disabled={!!busy} className="inline-flex h-9 items-center gap-2 bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
            {busy === 'discover' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}连接番茄账号
          </button>
        </div>
      </div>

      {error && <div role="alert" className="mb-4 flex items-start gap-2 border-l-2 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {notice && <p role="status" className="mb-4 flex items-center gap-2 border-l-2 border-emerald-600 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"><Check className="h-4 w-4" />{notice}</p>}

      {!authReady || !token ? <p className="py-16 text-center text-sm text-gray-500">正在加载本地用户...</p> : accounts.length === 0 ? (
        <div className="border-y border-gray-200 py-14 text-center dark:border-zinc-800">
          <p className="text-sm text-gray-600 dark:text-zinc-300">还没有关联的平台账号</p>
          <p className="mt-1 text-xs text-gray-500">连接账号后即可查看该账号下的平台作品</p>
        </div>
      ) : (
        <div className="grid min-h-[520px] grid-cols-1 border-y border-gray-200 dark:border-zinc-800 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="border-b border-gray-200 py-3 dark:border-zinc-800 lg:border-b-0 lg:border-r">
            <h2 className="px-3 pb-2 text-xs font-semibold text-gray-500 dark:text-zinc-400">已关联的平台账号</h2>
            <div className="space-y-1">
              {accounts.map((item) => <div key={item.accountId}>
                <button onClick={() => { setAccountId(item.accountId); setWorkId(''); setLinkingId('') }} className={`flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm ${accountId === item.accountId ? 'bg-gray-100 font-medium text-gray-950 dark:bg-zinc-800 dark:text-white' : 'text-gray-700 hover:bg-gray-50 dark:text-zinc-300 dark:hover:bg-zinc-900'}`}>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span><span className="text-xs text-gray-500">{item.workCount}</span><ChevronDown className="h-3.5 w-3.5" />
                </button>
                {accountId === item.accountId && !item.linked && <button onClick={() => { setLinkingId(item.accountId); setAccountLabel(item.name) }} className="ml-3 mt-1 inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-700 dark:text-blue-300"><Link2 className="h-3.5 w-3.5" />关联到本地用户</button>}
              </div>)}
            </div>
            {linkingId && account && <div className="mx-3 mt-3 border-t border-gray-200 pt-3 dark:border-zinc-800">
              <label className="grid gap-1 text-xs text-gray-500">账号显示名称<input value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} className="h-9 border border-gray-300 bg-white px-2 text-sm text-gray-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" /></label>
              <button onClick={() => linkAccount(linkingId)} disabled={!!busy || !accountLabel.trim()} className="mt-2 h-8 w-full bg-blue-700 text-xs font-medium text-white disabled:opacity-50">关联账号</button>
            </div>}
          </aside>

          <div className="min-w-0 py-3">
            {!account ? <p className="px-4 py-10 text-sm text-gray-500">选择一个平台账号</p> : !account.linked ? <div className="px-4 py-10 text-sm text-gray-500">先将此平台账号关联到本地用户，再查看和操作该账号的作品。</div> : <>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3">
                <div><h2 className="text-base font-semibold text-gray-950 dark:text-zinc-100">{account.name}</h2><p className="mt-1 text-xs text-gray-500">{account.workCount} 本作品 · {account.scannedAt ? `目录更新于 ${new Date(account.scannedAt).toLocaleString()}` : '目录尚未扫描'}</p></div>
              </div>
              {(account.scanStatus === 'needs_login' || account.scanStatus === 'failed' || account.scanStatus === 'partial') && <p className="mx-4 mb-3 flex gap-2 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"><AlertCircle className="h-4 w-4 shrink-0" />{account.scanStatus === 'needs_login' ? '平台登录状态需要更新。' : account.scanStatus === 'partial' ? '部分作品扫描失败，保留了上次成功的目录。' : '最近一次目录扫描失败。'} {account.scanErrors?.[0]?.error}</p>}
              {sortedWorks.length === 0 ? <p className="mx-4 border-y border-gray-200 py-8 text-sm text-gray-500 dark:border-zinc-800">账号下还没有扫描到作品。</p> : <div className="divide-y divide-gray-200 dark:divide-zinc-800">
                {sortedWorks.map((item) => <article key={`${item.accountId}:${item.bookId}`} className="min-w-0">
                  <button onClick={() => { setWorkId(workId === item.bookId ? '' : item.bookId); setError('') }} aria-expanded={workId === item.bookId} className={`flex min-h-[68px] w-full items-center gap-3 px-4 text-left hover:bg-gray-50 dark:hover:bg-zinc-900 ${workId === item.bookId ? 'bg-gray-50 dark:bg-zinc-900' : ''}`}>
                    <BookOpen className="h-4 w-4 shrink-0 text-gray-500" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-gray-950 dark:text-zinc-100">{item.title}</span><span className="mt-1 block text-xs text-gray-500">{item.chapterCount ?? chapters.length} 章 · {item.draftCount} 条草稿</span></span>
                    {item.status && <span className="text-xs text-gray-500">{item.status}</span>}
                    {workId === item.bookId ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />}
                  </button>
                  {workId === item.bookId && <div className="grid gap-6 border-t border-gray-200 bg-gray-50/60 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-950/50 xl:grid-cols-2">
                    <section className="min-w-0">
                      <h3 className="mb-2 text-xs font-semibold text-gray-600 dark:text-zinc-300">已发布章节 <span className="font-normal text-gray-500">{loadingChapters ? '正在读取...' : `${chapters.length}${chaptersRefreshing ? ' · 后台刷新中' : ''}`}</span></h3>
                      {loadingChapters ? <p className="py-4 text-sm text-gray-500">正在读取章节目录...</p> : chapters.length ? <div className="divide-y divide-gray-200 border-y border-gray-200 dark:divide-zinc-800 dark:border-zinc-800">{chapters.map((chapter) => <button key={chapter.itemId} onClick={() => openCollectionItem('chapter', chapter.itemId)} className="flex min-h-12 w-full items-center gap-3 px-2 py-2 text-left hover:bg-white dark:hover:bg-zinc-900"><span className="w-16 shrink-0 text-xs text-gray-500">第 {chapter.chapterNumber} 章</span><span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-zinc-100">{chapter.title}</span><span className="text-xs text-gray-500">{chapter.wordCount ?? 0} 字</span></button>)}</div> : <p className="border-y border-gray-200 py-4 text-sm text-gray-500 dark:border-zinc-800">没有已发布章节</p>}
                    </section>
                    <section className="min-w-0">
                      <h3 className="mb-2 text-xs font-semibold text-gray-600 dark:text-zinc-300">草稿箱 <span className="font-normal text-gray-500">{item.draftCount}</span></h3>
                      {item.draftScanStatus === 'failed' ? <p className="border-y border-amber-300 py-4 text-sm text-amber-700 dark:border-amber-900 dark:text-amber-300">草稿扫描失败：{item.draftScanError}</p> : item.drafts.length ? <div className="divide-y divide-gray-200 border-y border-gray-200 dark:divide-zinc-800 dark:border-zinc-800">{item.drafts.map((draft) => <button key={draft.itemId} onClick={() => openCollectionItem('draft', draft.itemId)} className="flex min-h-12 w-full items-center gap-3 px-2 py-2 text-left hover:bg-white dark:hover:bg-zinc-900"><span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-zinc-100">{draft.title}</span><span className="shrink-0 text-xs text-gray-500">{draft.chapterNumber ? `第 ${draft.chapterNumber} 章 · ` : ''}{draft.wordCount} 字</span></button>)}</div> : <p className="border-y border-gray-200 py-4 text-sm text-gray-500 dark:border-zinc-800">这本作品当前没有草稿</p>}
                    </section>
                  </div>}
                </article>)}
              </div>}
            </>}
          </div>
        </div>
      )}
    </section>
  )
}
