'use client'

import { Crown } from 'lucide-react'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'

const tools = [
  { name: '降AI率', desc: '粘贴原文，一键调用增强消痕，输出更自然的真人写作版本' },
  { name: '拆书', desc: '将长篇内容拆分成关键情节和人物' },
  { name: '名字生成器', desc: '传统的随机名字生成器，包含各种风格' },
  { name: '封面生成器', desc: '输入提示词，自动生成精美的作品封面', vip: true },
  { name: '海报生成器', desc: '上传小说，自动生成精美的作品海报', vip: true },
  { name: '章节合并', desc: '上传多个 TXT 章节，按文件名排序后合并下载' },
  { name: '章节拆分', desc: '输入完整 TXT，自动拆分为多个章节 TXT 导出' },
  { name: '章节区间导出', desc: '上传完整小说后，用滑动条选择首尾章节导出' },
]

const generators = [
  { name: '书名生成器', desc: '爆款书名一键生成，流量密码轻松拿捏' },
  { name: '简介生成器', desc: '浓缩故事精华，勾住读者好奇心' },
  { name: '金手指生成器', desc: '神转折引爆剧情，颠覆读者预期' },
  { name: '大纲生成器', desc: '结构严谨层次清，故事发展一目了然' },
  { name: '细纲生成器', desc: '分场景细化章节脉络，让情节推进更扎实' },
  { name: '黄金开篇生成器', desc: '三秒抓住眼球，开篇即高能' },
  { name: '角色生成器', desc: '鲜活人设一键生成，让每个角色跃然纸上' },
  { name: '脑洞生成器', desc: '灵感乍现，一键生成意想不到的巧妙情节' },
  { name: '正文生成器', desc: '生成丰富细节和生动描述的引人入胜的故事内容' },
  { name: '通用写作助手', desc: '获得写作问题和挑战的帮助' },
]

export default function GeneratorPage() {
  return (
    <div className="flex h-screen-dynamic flex-col">
      <Header />
      <div className="flex flex-1 flex-col overflow-auto bg-white dark:bg-zinc-900">
        <div className="container mx-auto flex-1 px-3 py-6 sm:px-4 sm:py-8 lg:px-6">
          <h1 className="mb-3 text-4xl font-extrabold dark:text-zinc-100">咕嘎写作工坊</h1>
          <p className="mb-8 text-gray-600 dark:text-zinc-400">AI赋能创作，让灵感永不枯竭</p>
          <div className="mb-4 flex items-center px-2 sm:mb-6">
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100 sm:text-3xl lg:text-4xl">实用工具箱</h2>
          </div>
          <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tools.map((t) => (
              <div key={t.name} className="border-border group relative flex h-full min-h-[160px] cursor-pointer flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-white to-orange-50 dark:from-zinc-800 dark:to-orange-950/30 p-4 shadow-sm transition-all duration-300 hover:border-orange-300 dark:hover:border-orange-700 hover:shadow-lg sm:min-h-[180px] sm:p-5 lg:min-h-[200px] lg:p-6">
                {t.vip && <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/50 dark:text-orange-300"><Crown className="h-3 w-3" />会员</span>}
                <h3 className="text-foreground relative z-10 mb-2 line-clamp-2 text-lg font-bold sm:text-xl dark:text-zinc-100">{t.name}</h3>
                <p className="text-sm text-gray-600 dark:text-zinc-400">{t.desc}</p>
              </div>
            ))}
          </div>
          <div className="mb-4 flex items-center px-2 sm:mb-6">
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100 sm:text-3xl lg:text-4xl">AI 生成器</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {generators.map((g) => (
              <div key={g.name} className="border-border group relative flex h-full min-h-[160px] cursor-pointer flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-white to-blue-50 dark:from-zinc-800 dark:to-blue-950/30 p-4 shadow-sm transition-all duration-300 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-lg sm:min-h-[180px] sm:p-5 lg:min-h-[200px] lg:p-6">
                <h3 className="text-foreground relative z-10 mb-2 line-clamp-2 text-lg font-bold sm:text-xl dark:text-zinc-100">{g.name}</h3>
                <p className="text-sm text-gray-600 dark:text-zinc-400">{g.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}