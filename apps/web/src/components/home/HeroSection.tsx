'use client'

import Link from 'next/link'
import { useState } from 'react'

const tabs = ['AI续写', 'AI扩写', 'AI润色', 'AI改写']

const stats = [
  { value: '100万+', label: '优质 AI 提示使用次数' },
  { value: '10万+', label: '作者获取了正收益' },
  { value: '10亿+', label: '累计生成字数' },
]

export default function HeroSection() {
  const [activeTab, setActiveTab] = useState(0)

  return (
    <section className="px-4 py-16 text-center sm:px-6 sm:py-20 md:px-12 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-4 text-4xl font-extrabold text-gray-900 dark:text-zinc-100 md:text-6xl">Novel Writer</h1>
        <h2 className="mb-4 text-xl font-bold text-gray-700 dark:text-zinc-300 md:text-2xl">专业的 AI 小说写作平台</h2>
        <p className="mx-auto mb-8 max-w-2xl text-base text-gray-600 dark:text-zinc-400">
          AI 驱动的创作空间，帮助您轻松构思、写作与打磨您的小说作品。海量优质提示模板，顶尖大模型加持。
        </p>
        <div className="mb-8 flex flex-wrap items-center justify-center gap-2">
          {tabs.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                activeTab === i
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <Link
          href="/library"
          className="inline-block rounded-md bg-blue-600 px-8 py-3 text-base font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          免费开始创作 &rarr;
        </Link>
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-extrabold text-blue-600">{s.value}</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-zinc-400">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
