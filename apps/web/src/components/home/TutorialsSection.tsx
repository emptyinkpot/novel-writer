import { Play } from 'lucide-react'
import Link from 'next/link'

const videos = [
  { title: '快速入门指南', desc: '5 分钟了解 Novel Writer 的核心功能', duration: '5:32' },
  { title: 'AI 对话生成教程', desc: '掌握高效的对话式写作流程', duration: '8:14' },
  { title: '消痕功能详解', desc: '让 AI 生成的文字更具人文温度', duration: '6:48' },
  { title: '生成器使用技巧', desc: '10+ 余款生成器的进阶玩法', duration: '12:05' },
]

export default function TutorialsSection() {
  return (
    <section className="px-4 py-16 sm:px-6 md:px-12 md:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold text-gray-900 dark:text-zinc-100 md:text-4xl">入门教程</h2>
          <p className="text-base text-gray-600 dark:text-zinc-400">观看视频教程，快速上手 Novel Writer 的各项功能</p>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {videos.map((v) => (
            <div
              key={v.title}
              className="cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all duration-300 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="relative aspect-video bg-gradient-to-br from-blue-100 to-blue-50 dark:from-zinc-800 dark:to-zinc-900 flex items-center justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-blue-600 shadow-md">
                  <Play className="h-5 w-5 fill-current" />
                </div>
                <span className="absolute right-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{v.duration}</span>
              </div>
              <div className="p-4">
                <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-zinc-100">{v.title}</h3>
                <p className="text-xs text-gray-600 dark:text-zinc-400">{v.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link href="/tutorials" className="text-sm font-medium text-blue-600 hover:underline">
            查看更多教程 &rarr;
          </Link>
        </div>
      </div>
    </section>
  )
}
