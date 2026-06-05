'use client'

import { useRef, useState } from 'react'
import { motion, useMotionValue, useTransform } from 'framer-motion'
import { cn } from '@/lib/cn'

function MagicCard({
  children,
  className,
  glowColor = 'rgba(99,102,241,0.15)',
  large = false,
}: {
  children: React.ReactNode
  className?: string
  glowColor?: string
  large?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)
  const [hovered, setHovered] = useState(false)

  const background = useTransform([mouseX, mouseY], ([x, y]) =>
    `radial-gradient(400px circle at ${x}px ${y}px, ${glowColor}, transparent 70%)`,
  )

  const handleMouse = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    mouseX.set(e.clientX - rect.left)
    mouseY.set(e.clientY - rect.top)
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMouse}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950',
        large && 'md:col-span-2 md:row-span-1',
        className,
      )}
    >
      {hovered && (
        <motion.div
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background }}
        />
      )}
      {large && <BorderBeam />}
      <div className="relative z-10">{children}</div>
    </div>
  )
}

function BorderBeam() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-2xl">
      <div
        className="absolute h-[2px] w-20 animate-border-beam bg-gradient-to-r from-transparent via-blue-500 to-purple-500"
        style={{ offsetPath: 'rect(0 100% 100% 0 round 16px)' }}
      />
    </div>
  )
}

function TypingVisual() {
  const lines = ['林清远缓步走入客厅...', '窗外的雨声渐渐小了...', '她转身望向远方的灯火...']
  return (
    <div className="mt-4 space-y-2 font-mono text-xs">
      {lines.map((line, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.8, duration: 0.5 }}
          className="text-gray-600 dark:text-zinc-400"
        >
          <span className="text-blue-500 dark:text-blue-400">{'>'}</span> {line}
        </motion.div>
      ))}
    </div>
  )
}

function RelationshipVisual() {
  return (
    <svg viewBox="0 0 120 80" className="mt-4 h-20 w-full">
      <line x1="30" y1="40" x2="90" y2="20" stroke="currentColor" className="text-red-300 dark:text-red-700" strokeWidth="1.5" />
      <line x1="30" y1="40" x2="90" y2="60" stroke="currentColor" className="text-red-300 dark:text-red-700" strokeWidth="1.5" />
      <circle cx="30" cy="40" r="8" className="fill-red-400/80" />
      <circle cx="90" cy="20" r="6" className="fill-red-300/80" />
      <circle cx="90" cy="60" r="6" className="fill-red-300/80" />
      <text x="30" y="58" textAnchor="middle" className="fill-gray-500 dark:fill-zinc-500 text-[7px]">主角</text>
      <text x="90" y="10" textAnchor="middle" className="fill-gray-500 dark:fill-zinc-500 text-[7px]">挚友</text>
      <text x="90" y="76" textAnchor="middle" className="fill-gray-500 dark:fill-zinc-500 text-[7px]">对手</text>
    </svg>
  )
}

function PolishVisual() {
  return (
    <div className="mt-4 space-y-1.5 text-xs">
      <div className="text-gray-400 line-through dark:text-zinc-600">
        他非常高兴地走过去打开了门
      </div>
      <div className="rounded bg-green-50 px-2 py-1 text-green-700 dark:bg-green-950/40 dark:text-green-400">
        他快步上前，推开了那扇门
      </div>
    </div>
  )
}

function TemplateVisual() {
  const items = ['悬疑', '言情', '玄幻', '都市']
  return (
    <div className="mt-4 grid grid-cols-2 gap-1.5">
      {items.map((t, i) => (
        <motion.div
          key={t}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.2 }}
          className="rounded-lg bg-amber-50 px-2 py-2 text-center text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
        >
          {t}
        </motion.div>
      ))}
    </div>
  )
}

export default function FeaturesSection() {
  return (
    <section className="px-4 py-16 sm:px-6 md:px-12 md:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold text-gray-900 dark:text-zinc-100 md:text-4xl">
            专为小说创作打造
          </h2>
          <p className="text-base text-gray-600 dark:text-zinc-400">
            从构思到成稿，为您的创作之路提供全方位支持
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <MagicCard large glowColor="rgba(99,102,241,0.2)" className="md:col-span-2">
            <span className="inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              核心引擎
            </span>
            <h3 className="mt-2 text-xl font-bold text-gray-900 dark:text-zinc-100">AI 创作引擎</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-zinc-400">
              对话式生成万字长文，AI 与您协同完成从大纲到成稿的全流程
            </p>
            <TypingVisual />
          </MagicCard>
          <MagicCard glowColor="rgba(239,68,68,0.15)">
            <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
              人物管理
            </span>
            <h3 className="mt-2 text-lg font-bold text-gray-900 dark:text-zinc-100">人物关系图谱</h3>
            <RelationshipVisual />
          </MagicCard>
          <MagicCard glowColor="rgba(34,197,94,0.15)">
            <span className="inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
              润色
            </span>
            <h3 className="mt-2 text-lg font-bold text-gray-900 dark:text-zinc-100">AI 消痕润色</h3>
            <PolishVisual />
          </MagicCard>
          <MagicCard glowColor="rgba(234,179,8,0.15)" className="md:col-span-2">
            <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              模板
            </span>
            <h3 className="mt-2 text-lg font-bold text-gray-900 dark:text-zinc-100">海量模板库</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-zinc-400">
              覆盖各类热门题材，一键套用快速开文
            </p>
            <TemplateVisual />
          </MagicCard>
        </div>
      </div>
    </section>
  )
}
