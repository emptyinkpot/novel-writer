'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { MacosWindow } from '@/components/magicui/macos-window'
import { AnimatedList } from '@/components/magicui/animated-list'
import { TypingAnimation } from '@/components/magicui/typing-animation'
import { ChatBubble } from '@/components/magicui/chat-bubble'
import { AnimatedBeamPath } from '@/components/magicui/animated-beam-path'

const CYCLE_MS = 10000

const treeItems = [
  { label: '📁 鸿蒙仙路', active: false },
  { label: '  第一章 林中遇', active: false },
  { label: '  第二章 修真初', active: false },
  { label: '  第三章 觉醒', active: true },
]

const editorText =
  '林轩睁开眼，发现自己置身于一片青翠的密林之中。\n晨光透过密集的枝叶洒下斑驳的光影，远处隐约传来溪水的潺潺声。\n他低头看了看自己的双手，皮肤白皙，骨节分明……'

const userMessage = '写一段穿越修仙开头'
const aiResponse = '好的，我来为你创作一段穿越修仙的开篇。主角将在一片灵气充沛的密林中苏醒，记忆模糊中开启新的修仙之旅……'

interface Stage {
  treeShow: boolean
  chatUserShow: boolean
  chatAiShow: boolean
  beamChatToEditor: boolean
  editorTyping: boolean
  beamEditorToTree: boolean
}

const initialStage: Stage = {
  treeShow: false,
  chatUserShow: false,
  chatAiShow: false,
  beamChatToEditor: false,
  editorTyping: false,
  beamEditorToTree: false,
}

export default function WorkspaceSection() {
  const [stage, setStage] = useState<Stage>(initialStage)
  const [cycleKey, setCycleKey] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  const runCycle = useCallback(() => {
    setStage(initialStage)
    const timers: number[] = []
    const at = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, ms))
    }
    at(50, () => setStage((s) => ({ ...s, treeShow: true })))
    at(1000, () => setStage((s) => ({ ...s, chatUserShow: true })))
    at(1500, () => setStage((s) => ({ ...s, chatAiShow: true })))
    at(2000, () => setStage((s) => ({ ...s, beamChatToEditor: true, editorTyping: true })))
    at(6000, () => setStage((s) => ({ ...s, beamChatToEditor: false, beamEditorToTree: true })))
    at(7500, () => setStage((s) => ({ ...s, beamEditorToTree: false })))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [])

  useEffect(() => {
    const cleanup = runCycle()
    const loop = window.setInterval(() => {
      setCycleKey((k) => k + 1)
    }, CYCLE_MS)
    return () => {
      cleanup()
      window.clearInterval(loop)
    }
  }, [runCycle, cycleKey])

  return (
    <section className="px-4 py-16 sm:px-6 md:px-12 md:py-20">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-12 text-center"
        >
          <h2 className="mb-3 text-3xl font-bold text-gray-900 dark:text-zinc-100 md:text-4xl">
            高效创作
          </h2>
          <p className="text-base text-gray-600 dark:text-zinc-400">
            功能强大而不失优雅的工作台
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <MacosWindow title="Novel Writer  ·  鸿蒙仙路">
            <div ref={containerRef} className="relative grid h-[440px] grid-cols-[15%_55%_30%]">
              <div
                ref={treeRef}
                className="border-r border-zinc-200/60 bg-zinc-100/40 p-3 dark:border-zinc-800 dark:bg-zinc-900/60"
              >
                <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  目录
                </div>
                <AnimatedList items={treeItems} show={stage.treeShow} staggerDelay={0.2} />
              </div>

              <div
                ref={editorRef}
                className="relative overflow-hidden bg-white p-6 dark:bg-zinc-950"
              >
                <div className="mb-3 flex items-center justify-between border-b border-zinc-200/60 pb-2 dark:border-zinc-800">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    第三章 觉醒
                  </span>
                  <span className="text-[10px] text-zinc-400">已自动保存</span>
                </div>
                <div
                  className="text-[15px] leading-[1.9] text-zinc-800 dark:text-zinc-200 whitespace-pre-line"
                  style={{ fontFamily: '"STKaiti", "KaiTi", "楷体", serif' }}
                >
                  <TypingAnimation
                    text={editorText}
                    start={stage.editorTyping}
                    speed={45}
                    showCursor
                  />
                </div>
              </div>

              <div
                ref={chatRef}
                className="flex flex-col border-l border-zinc-200/60 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/40"
              >
                <div className="flex items-center justify-between border-b border-zinc-200/60 px-3 py-2 dark:border-zinc-800">
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                    AI 助手
                  </span>
                  <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-500">
                    大师模型
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2 overflow-hidden p-3">
                  <ChatBubble role="user" text={userMessage} show={stage.chatUserShow} />
                  <ChatBubble
                    role="ai"
                    text={aiResponse}
                    show={stage.chatAiShow}
                    typing
                  />
                </div>
                <div className="border-t border-zinc-200/60 p-2 dark:border-zinc-800">
                  <div className="rounded-md border border-zinc-200/60 bg-white px-2 py-1.5 text-[11px] text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
                    输入消息...
                  </div>
                </div>
              </div>

              <AnimatedBeamPath
                containerRef={containerRef}
                fromRef={chatRef}
                toRef={editorRef}
                active={stage.beamChatToEditor}
                duration={2}
                reverse
                curvature={-30}
              />
              <AnimatedBeamPath
                containerRef={containerRef}
                fromRef={editorRef}
                toRef={treeRef}
                active={stage.beamEditorToTree}
                duration={1.6}
                reverse
                curvature={-30}
              />
            </div>
          </MacosWindow>
        </motion.div>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-gray-200 p-6 text-left dark:border-zinc-800">
            <h3 className="mb-2 font-semibold text-gray-900 dark:text-zinc-100">文件树</h3>
            <p className="text-sm text-gray-600 dark:text-zinc-400">
              自由管理您的小说章节、设定、角色卡
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-6 text-left dark:border-zinc-800">
            <h3 className="mb-2 font-semibold text-gray-900 dark:text-zinc-100">编辑器</h3>
            <p className="text-sm text-gray-600 dark:text-zinc-400">
              不只是码字，还拥有：章节摘要、AI 高频词汇提示、角色卡关联、重要信息高亮等功能
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-6 text-left dark:border-zinc-800">
            <h3 className="mb-2 font-semibold text-gray-900 dark:text-zinc-100">对话区</h3>
            <p className="text-sm text-gray-600 dark:text-zinc-400">
              对话、代写、工作流等多种 AI 协作方式，高效完成您的写作任务
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
