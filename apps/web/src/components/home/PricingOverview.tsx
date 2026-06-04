'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import Link from 'next/link'

const features = {
  free: ['对话模式（消耗字数包和积分）', '工作流模式（无赠送积分）', '1 台设备', '高级模型（消耗字数包和积分）', '标准生成速度'],
  pro: ['对话模式 - 无限输入输出字数', '工作流模式 - 每月赠送积分', '1 台电脑端 + 1 台移动端', '极速生成速度', '优先客服支持'],
}

export default function PricingOverview() {
  const [yearly, setYearly] = useState(false)

  return (
    <section className="bg-gray-50 px-4 py-16 dark:bg-zinc-900 sm:px-6 md:px-12 md:py-20">
      <div className="mx-auto max-w-6xl text-center">
        <span className="mb-3 inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">定价方案</span>
        <h2 className="mb-3 text-3xl font-bold text-gray-900 dark:text-zinc-100 md:text-4xl">选择最适合您的方案</h2>
        <p className="mb-8 text-base text-gray-600 dark:text-zinc-400">无论是个人创作还是专业需求，我们都有合适的计划</p>
        <div className="mb-10 inline-flex items-center gap-3 rounded-full bg-gray-200 p-1 dark:bg-zinc-800">
          <button
            onClick={() => setYearly(false)}
            className={`rounded-full px-5 py-1.5 text-sm font-medium transition ${!yearly ? 'bg-white shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-gray-600 dark:text-zinc-400'}`}
          >月付</button>
          <button
            onClick={() => setYearly(true)}
            className={`rounded-full px-5 py-1.5 text-sm font-medium transition ${yearly ? 'bg-white shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-gray-600 dark:text-zinc-400'}`}
          >年付 <span className="text-xs text-green-600">省30%</span></button>
        </div>
        <div className="grid grid-cols-1 gap-6 text-left md:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900">
            <h3 className="mb-1 text-xl font-bold text-gray-900 dark:text-zinc-100">免费版</h3>
            <p className="mb-4 text-sm text-gray-600 dark:text-zinc-400">体验基础写作辅助功能</p>
            <div className="mb-6"><span className="text-3xl font-bold text-gray-900 dark:text-zinc-100">¥0</span></div>
            <button className="mb-6 w-full rounded-md bg-black py-2.5 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900">开始使用</button>
            <ul className="space-y-3">
              {features.free.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-gray-600 dark:text-zinc-400">
                  <div className="mt-0.5 rounded-full bg-gray-100 p-0.5 dark:bg-zinc-800"><Check className="h-3.5 w-3.5 text-gray-500" /></div>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative rounded-xl border-2 border-blue-600 bg-blue-50 p-6 shadow-lg dark:border-blue-500 dark:bg-blue-950/30">
            <span className="absolute right-3 top-2 rounded-full bg-blue-600 px-2 py-1 text-xs text-white">最受欢迎</span>
            <h3 className="mb-1 text-xl font-bold text-gray-900 dark:text-zinc-100">月卡</h3>
            <p className="mb-4 text-sm text-gray-600 dark:text-zinc-400">适合持续创作的作者</p>
            <div className="mb-1"><span className="text-sm text-gray-500 line-through">¥119</span></div>
            <div className="mb-6"><span className="text-3xl font-bold text-gray-900 dark:text-zinc-100">¥89.99</span><span className="text-sm text-gray-500">/月</span></div>
            <button className="mb-6 w-full rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-blue-700">购买</button>
            <p className="mb-3 text-xs text-gray-600 dark:text-zinc-400">包含所有免费版功能，以及：</p>
            <ul className="space-y-3">
              {features.pro.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-gray-600 dark:text-zinc-400">
                  <div className="mt-0.5 rounded-full bg-blue-100 p-0.5 dark:bg-blue-900"><Check className="h-3.5 w-3.5 text-blue-600" /></div>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900">
            <h3 className="mb-1 text-xl font-bold text-gray-900 dark:text-zinc-100">年卡</h3>
            <p className="mb-4 text-sm text-gray-600 dark:text-zinc-400">长期创作的最佳选择</p>
            <div className="mb-1"><span className="text-sm text-gray-500 line-through">¥999</span></div>
            <div className="mb-6"><span className="text-3xl font-bold text-gray-900 dark:text-zinc-100">¥949.99</span><span className="text-sm text-gray-500">/年</span></div>
            <button className="mb-6 w-full rounded-md bg-black py-2.5 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900">购买</button>
            <p className="mb-3 text-xs text-gray-600 dark:text-zinc-400">包含所有免费版功能，以及：</p>
            <ul className="space-y-3">
              {features.pro.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-gray-600 dark:text-zinc-400">
                  <div className="mt-0.5 rounded-full bg-gray-100 p-0.5 dark:bg-zinc-800"><Check className="h-3.5 w-3.5 text-gray-500" /></div>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-8">
          <Link href="/pricing" className="text-sm font-medium text-blue-600 hover:underline">查看完整定价方案 &rarr;</Link>
        </div>
      </div>
    </section>
  )
}
