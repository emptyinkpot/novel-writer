'use client'

import { Play } from 'lucide-react'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'

const tutorials = [
  { title: '快速入门指南', desc: '5 分钟了解 Novel Writer 的核心功能与基本操作', duration: '5:32' },
  { title: 'AI 对话生成教程', desc: '掌握高效的对话式写作流程，让 AI 为你快速生成精彩对白', duration: '8:14' },
  { title: '消痕功能详解', desc: '让 AI 生成的文字更具人文温度，降低 AI 痕迹检测率', duration: '6:48' },
  { title: '生成器使用技巧', desc: '10+ 余款生成器的进阶玩法，从书名到细纲一网打尽', duration: '12:05' },
  { title: '工作流模板入门', desc: '了解工作流模式，批量自动化生成章节内容', duration: '9:22' },
  { title: '角色卡与设定管理', desc: '高效管理复杂的角色设定和世界观资料', duration: '7:15' },
  { title: '人物关系图谱教程', desc: '可视化展示角色关系，让庞杂设定层次分明', duration: '5:50' },
  { title: '发布与变现指南', desc: '从写作到上架，一站式了解各平台签约流程', duration: '15:30' },
]

export default function TutorialsPage() {
  return (
    <div className="flex h-screen-dynamic flex-col">
      <Header />
      <div className="flex flex-1 flex-col overflow-auto bg-white dark:bg-zinc-900">
        <div className="container mx-auto flex-1 px-3 py-6 sm:px-4 sm:py-8 lg:px-6">
          <div className="mb-8 text-center">
            <h1 className="mb-3 text-4xl font-extrabold dark:text-zinc-100">使用教程</h1>
            <p className="text-gray-600 dark:text-zinc-400">观看视频教程，快速上手各项功能</p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {tutorials.map((t) => (
              <div key={t.title} className="cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all duration-300 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
                <div className="relative aspect-video bg-gradient-to-br from-blue-100 to-blue-50 dark:from-zinc-800 dark:to-zinc-900 flex items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-blue-600 shadow-md"><Play className="h-5 w-5 fill-current" /></div>
                  <span className="absolute right-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{t.duration}</span>
                </div>
                <div className="p-4">
                  <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-zinc-100">{t.title}</h3>
                  <p className="text-xs text-gray-600 dark:text-zinc-400 line-clamp-2">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
