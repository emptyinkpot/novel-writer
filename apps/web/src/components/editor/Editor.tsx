'use client'

import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useEditorStore } from '@/stores/editor'
import { useAuthStore } from '@/stores/auth'
import { useEffect, useRef, useCallback, useState } from 'react'
import { Wand2, Sparkles, PenLine, RefreshCw } from 'lucide-react'

function useDebounce(fn: (...args: any[]) => void, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback((...args: any[]) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => fn(...args), ms)
  }, [fn, ms])
}

async function streamAI(
  token: string,
  prompt: string,
  onDelta: (text: string) => void,
  onDone: () => void,
) {
  const base = process.env.NEXT_PUBLIC_API_URL || ''
  const res = await fetch(`${base}/api/v1/chat/chat/v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      model: 'gpt-4o',
      stream: true,
    }),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') { onDone(); return }
      try {
        const json = JSON.parse(data)
        const content = json.choices?.[0]?.delta?.content || ''
        if (content) onDelta(content)
      } catch {}
    }
  }
  onDone()
}

export default function Editor() {
  const { currentChapter, updateChapterContent, setSaving, setAiWriting, aiWriting, saving } = useEditorStore()
  const token = useAuthStore((s) => s.token)
  const [wordCount, setWordCount] = useState(0)
  const abortRef = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: '开始写作...' }),
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-lg dark:prose-invert max-w-none font-serif min-h-full px-12 py-8 focus:outline-none',
      },
    },
    onUpdate: ({ editor: e }) => {
      const text = e.getText()
      setWordCount(text.length)
      updateChapterContent(e.getHTML())
      debouncedSave(e.getHTML())
    },
  })

  const saveToServer = useCallback(async (html: string) => {
    const chapter = useEditorStore.getState().currentChapter
    if (!chapter) return
    setSaving(true)
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || ''
      const tk = useAuthStore.getState().token
      await fetch(`${base}/api/v1/chapter/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
        body: JSON.stringify({ id: chapter.id, workId: chapter.workId, content: html }),
      })
    } finally {
      setSaving(false)
    }
  }, [setSaving])

  const debouncedSave = useDebounce(saveToServer, 3000)

  useEffect(() => {
    if (!editor) return
    if (currentChapter) {
      editor.commands.setContent(currentChapter.content || '')
      setWordCount(editor.getText().length)
    } else {
      editor.commands.clearContent()
      setWordCount(0)
    }
  }, [currentChapter?.id, editor])

  const handleAIContinue = useCallback(async () => {
    if (!editor || !token || aiWriting) return
    const text = editor.getText()
    const last500 = text.slice(-500)
    const prompt = `你是一位小说写作助手。请根据以下已有内容，自然地续写约200字，保持风格一致：\n\n${last500}`
    setAiWriting(true)
    abortRef.current = false
    editor.commands.focus('end')
    await streamAI(token, prompt, (delta) => {
      if (abortRef.current) return
      editor.chain().focus().insertContent(delta).run()
    }, () => setAiWriting(false)).catch(() => setAiWriting(false))
  }, [editor, token, aiWriting, setAiWriting])

  const handleBubbleAction = useCallback(async (action: string) => {
    if (!editor || !token || aiWriting) return
    const { from, to } = editor.state.selection
    const selected = editor.state.doc.textBetween(from, to)
    if (!selected) return
    const prompts: Record<string, string> = {
      expand: `扩写以下文本，使其更加丰富细腻（约增加一倍篇幅）：\n\n${selected}`,
      polish: `润色以下文本，保持原意但使表达更加优美流畅：\n\n${selected}`,
      rewrite: `改写以下文本，保持核心意思但换一种表达方式：\n\n${selected}`,
      continue: `续写以下文本，自然延续约100字：\n\n${selected}`,
    }
    setAiWriting(true)
    abortRef.current = false
    editor.chain().focus().deleteSelection().run()
    await streamAI(token, prompts[action], (delta) => {
      if (abortRef.current) return
      editor.chain().focus().insertContent(delta).run()
    }, () => setAiWriting(false)).catch(() => setAiWriting(false))
  }, [editor, token, aiWriting, setAiWriting])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleAIContinue()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleAIContinue])

  return (
    <div className="relative flex h-full flex-col">
      {editor && (
        <BubbleMenu editor={editor} tippyOptions={{ duration: 150 }}>
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            <button onClick={() => handleBubbleAction('expand')} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-zinc-700">
              <Sparkles className="h-3 w-3" />扩写
            </button>
            <button onClick={() => handleBubbleAction('polish')} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-zinc-700">
              <PenLine className="h-3 w-3" />润色
            </button>
            <button onClick={() => handleBubbleAction('rewrite')} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-zinc-700">
              <RefreshCw className="h-3 w-3" />改写
            </button>
            <button onClick={() => handleBubbleAction('continue')} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-zinc-700">
              <Wand2 className="h-3 w-3" />续写
            </button>
          </div>
        </BubbleMenu>
      )}

      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-zinc-400">{wordCount} 字</span>
          {saving && (
            <span className="text-xs text-gray-400 dark:text-zinc-500">保存中...</span>
          )}
        </div>
        <button
          onClick={handleAIContinue}
          disabled={aiWriting || !currentChapter}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white transition ${
            aiWriting
              ? 'animate-pulse bg-blue-500'
              : 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400'
          }`}
        >
          <Wand2 className="h-3.5 w-3.5" />
          {aiWriting ? 'AI 写作中...' : 'AI 续写'}
        </button>
      </div>
    </div>
  )
}
