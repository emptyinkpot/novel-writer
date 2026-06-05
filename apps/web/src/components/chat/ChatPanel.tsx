'use client'

import { useState, useRef, useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useChatStore } from '@/stores/chat'
import { apiStream } from '@/lib/api'

export default function ChatPanel() {
  const {
    messages,
    model,
    isGenerating,
    addMessage,
    setModel,
    setGenerating,
    clearMessages,
  } = useChatStore()
  const [streaming, setStreaming] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const inputEditor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, bulletList: false, orderedList: false }),
      Placeholder.configure({ placeholder: '输入你的指令...' }),
    ],
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[60px] max-h-[200px] overflow-y-auto px-3 py-2 focus:outline-none',
      },
    },
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages, streaming])

  const handleSend = async () => {
    if (!inputEditor || isGenerating) return
    const text = inputEditor.getText().trim()
    if (!text) return

    inputEditor.commands.clearContent()

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user' as const,
      content: text,
      createdAt: Date.now(),
    }
    addMessage(userMsg)
    setGenerating(true)
    setStreaming('')

    let acc = ''
    try {
      await apiStream(
        '/api/v1/chat/chat/v2',
        {
          method: 'POST',
          body: {
            model,
            messages: [
              ...messages.map((m) => ({ role: m.role, content: m.content })),
              { role: 'user', content: text },
            ],
            stream: true,
          },
        },
        (chunk) => {
          const lines = chunk.split('\n')
          for (const line of lines) {
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (!data || data === '[DONE]') continue
            try {
              const json = JSON.parse(data)
              const delta =
                json.choices?.[0]?.delta?.content ||
                json.delta?.text ||
                ''
              if (delta) {
                acc += delta
                setStreaming(acc)
              }
            } catch {}
          }
        }
      )
      addMessage({
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: acc,
        createdAt: Date.now(),
      })
    } catch (err: any) {
      addMessage({
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: `错误: ${err.message}`,
        createdAt: Date.now(),
      })
    } finally {
      setStreaming('')
      setGenerating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-zinc-700">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
        >
          <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
          <option value="claude-opus-4-8">Claude Opus 4.8</option>
          <option value="gpt-4o">GPT-4o</option>
        </select>
        <button
          onClick={clearMessages}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          新建对话
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && !streaming && (
          <p className="mt-8 text-center text-sm text-gray-400 dark:text-zinc-500">
            开始与 AI 对话
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`mb-3 flex ${
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="mb-3 flex justify-start">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-sm text-gray-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100">
              {streaming}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 p-3 dark:border-zinc-700">
        <div
          className="rounded-lg border border-gray-300 bg-white dark:border-zinc-600 dark:bg-zinc-800"
          onKeyDown={handleKeyDown}
        >
          <EditorContent editor={inputEditor} />
        </div>
        <div className="mt-2 flex justify-end">
          <button
            onClick={handleSend}
            disabled={isGenerating}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white transition hover:bg-blue-700 disabled:bg-gray-400"
          >
            {isGenerating ? '生成中...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}
