'use client'

import { Marquee } from '@/components/magicui/marquee'

const testimonials = [
  { content: '用了三个月，产出了两本完结小说，AI 续写的衔接度比我预期的好太多', author: '墨染书生', role: '网文作者' },
  { content: '模板库太香了，开新文不用再从零开始构思', author: '沐阳', role: '起点签约作者' },
  { content: '消痕功能是刚需，编辑要求的"去AI味"一键搞定', author: '陈远', role: '自由撰稿人' },
  { content: '对话模式写大纲特别好用，像有个搭档在旁边', author: '小鹿', role: '学生' },
  { content: '月卡值回票价了，极速模式出稿真的快', author: '夜猫子', role: '副业写手' },
  { content: '人物关系图谱帮我理清了十几个角色的关系', author: '浮生', role: '长篇作者' },
  { content: '从白梦写作迁过来的，功能更强了', author: '清欢', role: '老用户' },
  { content: '细纲扩写功能救了我的日更', author: '李玄', role: '番茄签约作者' },
  { content: 'AI 改写让我的文风更有辨识度', author: '月半弯', role: '豆瓣文青' },
  { content: '教程视频很贴心，新手也能快速上手', author: '阿甜', role: '编程小白' },
]

const row1 = testimonials.slice(0, 4)
const row2 = testimonials.slice(4, 7)
const row3 = testimonials.slice(7, 10)

function ReviewCard({ content, author, role }: { content: string; author: string; role: string }) {
  return (
    <div className="w-[280px] shrink-0 rounded-xl border border-gray-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-2 flex gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <svg key={i} className="h-3.5 w-3.5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        ))}
      </div>
      <p className="mb-3 text-sm leading-relaxed text-gray-700 dark:text-zinc-300">{content}</p>
      <div className="text-xs font-medium text-gray-900 dark:text-zinc-100">
        @{author} <span className="font-normal text-gray-500 dark:text-zinc-500">· {role}</span>
      </div>
    </div>
  )
}

export default function TestimonialsSection() {
  return (
    <section className="overflow-hidden bg-gray-50 py-16 dark:bg-zinc-900 md:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 md:px-12">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold text-gray-900 dark:text-zinc-100 md:text-4xl">
            作者们怎么说
          </h2>
          <p className="text-base text-gray-600 dark:text-zinc-400">来自真实用户的声音</p>
        </div>
      </div>
      <div className="space-y-4">
        <Marquee direction="left" speed={40}>
          {row1.map((t) => (
            <ReviewCard key={t.author} {...t} />
          ))}
        </Marquee>
        <Marquee direction="right" speed={35}>
          {row2.map((t) => (
            <ReviewCard key={t.author} {...t} />
          ))}
        </Marquee>
        <Marquee direction="left" speed={38}>
          {row3.map((t) => (
            <ReviewCard key={t.author} {...t} />
          ))}
        </Marquee>
      </div>
    </section>
  )
}
