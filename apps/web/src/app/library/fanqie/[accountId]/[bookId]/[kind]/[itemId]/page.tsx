'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, LoaderCircle, Save, Send } from 'lucide-react'
import Header from '@/components/layout/Header'
import { apiJson } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

type ApiResult<T> = { code: number; data: T }
type ItemDetail = { title: string; contentText: string; chapterNumber: number | null; wordCount?: number | null }
type CachedDetail = { detail: ItemDetail | null; cachedAt: string | null; refreshing: boolean }
type Account = { accountId: string; name: string; works: Array<{ bookId: string; title: string }> }

export default function FanqieItemPage() {
  const params = useParams<{ accountId: string; bookId: string; kind: string; itemId: string }>()
  const query = useSearchParams()
  const router = useRouter()
  const { authReady, token, hydrate } = useAuthStore()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [detail, setDetail] = useState<ItemDetail | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [chapterNumber, setChapterNumber] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmPublish, setConfirmPublish] = useState(false)
  const dirty = useRef(false)

  const kind = params.kind === 'draft' ? 'draft' : 'chapter'
  const ids = useMemo(() => ({ accountId: decodeURIComponent(params.accountId), bookId: decodeURIComponent(params.bookId), itemId: decodeURIComponent(params.itemId) }), [params.accountId, params.bookId, params.itemId])
  const account = accounts.find((item) => item.accountId === ids.accountId)
  const work = account?.works.find((item) => item.bookId === ids.bookId)
  const collectionUrl = `/library?accountId=${encodeURIComponent(query.get('accountId') || ids.accountId)}&bookId=${encodeURIComponent(query.get('bookId') || ids.bookId)}`
  const endpoint = `/api/v1/fanqie/accounts/${encodeURIComponent(ids.accountId)}/works/${encodeURIComponent(ids.bookId)}/${kind === 'draft' ? 'drafts' : 'chapters'}/${encodeURIComponent(ids.itemId)}`

  useEffect(() => { hydrate() }, [hydrate])

  useEffect(() => {
    if (!authReady || !token) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    dirty.current = false
    setLoading(true)
    const loadDetail = async () => {
      try {
        const result = await apiJson<ApiResult<CachedDetail>>(endpoint)
        if (!active) return
        const item = result.data.detail
        setCachedAt(result.data.cachedAt)
        setRefreshing(result.data.refreshing)
        if (item) {
          setDetail(item)
          if (!dirty.current) {
            setTitle(item.title)
            setContent(item.contentText)
            setChapterNumber(String(item.chapterNumber ?? ''))
          }
          setLoading(false)
        }
        if (result.data.refreshing) timer = setTimeout(loadDetail, 2000)
        else setLoading(false)
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : '读取内容失败')
          setLoading(false)
        }
      }
    }
    Promise.all([
      apiJson<ApiResult<Account[]>>('/api/v1/fanqie/accounts'),
      loadDetail(),
    ]).then(([accountResult]) => { if (active) setAccounts(accountResult.data) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '读取内容失败') })
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [authReady, endpoint, token])

  const save = async () => {
    setBusy('save'); setError(''); setNotice('')
    try {
      if (kind === 'draft') await apiJson<ApiResult<unknown>>(endpoint, { method: 'POST', body: { title, content } })
      else await apiJson<ApiResult<unknown>>(endpoint, { method: 'POST', body: { title, contentText: content } })
      dirty.current = false
      setNotice('内容已保存到番茄草稿箱')
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : '保存失败') }
    finally { setBusy('') }
  }

  const publish = async () => {
    const number = Number(chapterNumber)
    if (!Number.isInteger(number) || number < 1) { setError('请输入有效的章节号'); return }
    setBusy('publish'); setError(''); setNotice(''); setConfirmPublish(false)
    try {
      const result = await apiJson<ApiResult<{ confirmed?: boolean }>>(`${endpoint}/publish`, { method: 'POST', body: { chapterNumber: number } })
      setNotice(result.data.confirmed ? `第 ${number} 章已发布并回读确认` : `发布请求已完成，请核对番茄章节状态`)
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : '发布失败') }
    finally { setBusy('') }
  }

  return <div className="flex h-screen-dynamic flex-col bg-white dark:bg-zinc-950">
    <Header />
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-5 py-5 md:px-8">
        <Link href={collectionUrl} className="inline-flex h-9 items-center gap-2 text-sm text-gray-600 hover:text-gray-950 dark:text-zinc-300 dark:hover:text-white"><ArrowLeft className="h-4 w-4" />返回作品</Link>
        <div className="mt-4 border-b border-gray-200 pb-4 dark:border-zinc-800">
          <p className="truncate text-xs text-gray-500">{account?.name ?? '番茄账号'} / {work?.title ?? '平台作品'}</p>
          <h1 className="mt-1 text-xl font-semibold text-gray-950 dark:text-zinc-100">{kind === 'draft' ? '草稿详情' : '已发布章节'}</h1>
        </div>
        {error && <p role="alert" className="mt-4 border-l-2 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        {notice && <p role="status" className="mt-4 flex items-center gap-2 border-l-2 border-emerald-600 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"><Check className="h-4 w-4" />{notice}</p>}
        {refreshing && detail && <p role="status" className="mt-3 text-xs text-gray-500">{cachedAt ? `已显示缓存（${new Date(cachedAt).toLocaleString()}），正在后台核对最新内容…` : '正在后台核对最新内容…'}</p>}
        {loading ? <p className="py-14 text-center text-sm text-gray-500">正在读取平台内容...</p> : detail && <div className="mt-5 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-zinc-400">标题<input value={title} onChange={(event) => { dirty.current = true; setTitle(event.target.value) }} readOnly={kind === 'chapter'} className="h-10 border border-gray-300 bg-white px-3 text-sm text-gray-950 read-only:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:read-only:bg-zinc-900" /></label>
            <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-zinc-400">章节号<input type="number" min={1} value={chapterNumber} onChange={(event) => { dirty.current = true; setChapterNumber(event.target.value) }} readOnly={kind === 'chapter'} className="h-10 border border-gray-300 bg-white px-3 text-sm text-gray-950 read-only:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:read-only:bg-zinc-900" /></label>
          </div>
          <label className="grid gap-1 text-xs font-medium text-gray-600 dark:text-zinc-400">正文<textarea value={content} onChange={(event) => { dirty.current = true; setContent(event.target.value) }} readOnly={kind === 'chapter'} className="min-h-[55vh] resize-y border border-gray-300 bg-white p-4 text-sm leading-7 text-gray-950 read-only:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:read-only:bg-zinc-900" /></label>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4 dark:border-zinc-800">
            <span className="text-xs text-gray-500">{detail.wordCount ?? content.length} 字</span>
            {kind === 'draft' && <div className="flex gap-2">
              <button onClick={() => setConfirmPublish(true)} disabled={!!busy} className="inline-flex h-9 items-center gap-2 border border-red-300 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"><Send className="h-4 w-4" />发布章节</button>
              <button onClick={save} disabled={!!busy} className="inline-flex h-9 items-center gap-2 bg-blue-700 px-3 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50">{busy === 'save' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存草稿</button>
            </div>}
          </div>
        </div>}
      </div>
    </main>
    {confirmPublish && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="alertdialog" aria-modal="true" aria-label="确认发布章节"><div className="w-full max-w-md bg-white p-5 shadow-xl dark:bg-zinc-900"><h2 className="text-base font-semibold text-gray-950 dark:text-zinc-100">确认发布章节</h2><p className="mt-3 text-sm text-gray-600 dark:text-zinc-300">{account?.name} / {work?.title} / 第 {chapterNumber || '未填写'} 章 · {title}</p><div className="mt-6 flex justify-end gap-2"><button onClick={() => setConfirmPublish(false)} className="h-9 border border-gray-300 px-3 text-sm text-gray-700 dark:border-zinc-700 dark:text-zinc-200">返回编辑</button><button onClick={publish} disabled={!!busy} className="h-9 bg-red-700 px-3 text-sm font-medium text-white disabled:opacity-50">确认发布</button></div></div></div>}
  </div>
}
