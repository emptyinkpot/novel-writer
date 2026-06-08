'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DotPattern } from '@/components/magicui/dot-pattern'
import { AnimatedGradientText } from '@/components/magicui/animated-gradient-text'
import { ShimmerButton } from '@/components/magicui/shimmer-button'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { AnimatedBeam } from '@/components/magicui/animated-beam'

const tabs = ['AI 续写', 'AI 扩写', 'AI 润色', 'AI 改写'] as const

const tabDemos: Record<string, string> = {
  'AI 续写': '他握紧手中的剑，目光如炬。下一刻，他纵身跃出...',
  'AI 扩写': '这座古城像被时间遗忘了一般，街角的灯笼映出...',
  'AI 润色': '原文：他很伤心。 润色后：他低垂着眼，肩膀不自觉地耷拉...',
  'AI 改写': '原作改写为玄幻风：灵气如瀑布般倾泻而下，方圆百里...',
}

const stats = [
  { value: 100, suffix: '万+', label: '优质 AI 提示' },
  { value: 10, suffix: '万+', label: '作者' },
  { value: 10, suffix: '亿+', label: '累计字数' },
]

function Typewriter({ text, speed = 40 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState('')

  useEffect(() => {
    setDisplayed('')
    let i = 0
    const timer = setInterval(() => {
      i++
      setDisplayed(text.slice(0, i))
      if (i >= text.length) clearInterval(timer)
    }, speed)
    return () => clearInterval(timer)
  }, [text, speed])

  return (
    <span>
      {displayed}
      <span className="animate-pulse">|</span>
    </span>
  )
}

export default function HeroSection() {
  const [activeTab, setActiveTab] = useState(0)
  const activeDemo = useMemo(() => tabDemos[tabs[activeTab]], [activeTab])
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gray-50 px-4 dark:bg-zinc-950">
      <DotPattern className="z-0" />
      <div className="relative z-10 mx-auto w-full max-w-5xl py-24 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <h1 className="mb-6 text-6xl font-bold tracking-tight md:text-8xl">
            <AnimatedGradientText>我要把精力放在思考上</AnimatedGradientText>
          </h1>
        </motion.div>

        <motion.p
          className="mx-auto mb-10 max-w-2xl text-lg text-gray-500 dark:text-zinc-400 md:text-xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        >
          海量优质提示模板，顶尖大模型加持，让创作更高效
        </motion.p>

        <motion.div
          className="mb-6 flex flex-wrap items-center justify-center gap-2"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
        >
          {tabs.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`relative rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ${
                activeTab === i
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </motion.div>

        <motion.div
          className="mx-auto mb-12 min-h-[88px] max-w-2xl rounded-2xl border border-gray-200/70 bg-white/60 p-5 text-left text-base text-gray-700 shadow-sm backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.5 }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <Typewriter text={activeDemo} />
            </motion.div>
          </AnimatePresence>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.5 }}
        >
          <Link href="/library" aria-label="免费开始创作">
            <ShimmerButton>
              免费开始创作
              <span aria-hidden="true">→</span>
            </ShimmerButton>
          </Link>
        </motion.div>

        <motion.div
          className="mx-auto mt-20 flex max-w-3xl items-center justify-center gap-4 sm:gap-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1, duration: 0.6 }}
        >
          {stats.map((s, idx) => (
            <div key={s.label} className="flex flex-1 items-center gap-4 sm:gap-10">
              <div className="flex flex-1 flex-col items-center text-center">
                <div className="text-3xl font-bold text-gray-900 dark:text-zinc-100 md:text-5xl">
                  <NumberTicker value={s.value} duration={800} />
                  <span className="ml-1 bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
                    {s.suffix}
                  </span>
                </div>
                <div className="mt-2 text-xs text-gray-500 dark:text-zinc-500 md:text-sm">{s.label}</div>
              </div>
              {idx < stats.length - 1 && (
                <div className="hidden h-12 w-px sm:block">
                  <AnimatedBeam orientation="vertical" />
                </div>
              )}
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
