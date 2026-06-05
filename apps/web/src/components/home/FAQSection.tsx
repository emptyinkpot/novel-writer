'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

const faqs = [
  {
    q: '咕嘎写作使用什么 AI 模型？',
    a: '我们结合了业界领先的多种大语言模型，并针对小说创作进行了专门的微调和优化，以确保生成的内容在逻辑性、创造性和文学性上都达到专业水准。',
  },
  {
    q: '生成的内容易被判定为抄袭吗？',
    a: '不会。我们的 AI 根据您的输入实时生成原创内容。虽然生成的文本是独一无二的，但我们始终建议您像对待任何创作一样，对最终作品负责。',
  },
  {
    q: '我的作品内容安全吗？',
    a: '绝对安全。您的所有创作内容都经过加密存储，未经您的明确许可，我们绝不会将其用于公共模型的训练或泄露给第三方。',
  },
  {
    q: '免费版有什么限制？',
    a: '新注册用户赠送 300000 字数和 200 积分，并可以使用基础的写作辅助功能。这足以让您充分体验咕嘎写作的强大能力。',
  },
]

export default function FAQSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  return (
    <section className="px-4 py-16 sm:px-6 md:px-12 md:py-20">
      <div className="mx-auto max-w-3xl">
        <div className="mb-12 text-center">
          <span className="mb-3 inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">支持</span>
          <h2 className="mb-3 text-3xl font-bold text-gray-900 dark:text-zinc-100 md:text-4xl">您的疑问，我们来解答</h2>
        </div>
        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div key={faq.q} className="rounded-xl border border-gray-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <button
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                className="flex w-full items-center justify-between px-6 py-4 text-left"
              >
                <span className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{faq.q}</span>
                <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${openIdx === i ? 'rotate-180' : ''}`} />
              </button>
              {openIdx === i && (
                <div className="px-6 pb-4">
                  <p className="text-sm leading-relaxed text-gray-600 dark:text-zinc-400">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
