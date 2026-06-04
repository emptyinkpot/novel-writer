const features = [
  {
    tag: '高效创作',
    title: '对话快速生成',
    description: '一键生成 1000 字以上的精彩对话内容，海量优质提示模板供您选择。无论是日常对白还是戏剧冲突，AI 都能帮您快速产出高质量文字。',
  },
  {
    tag: '智能优化',
    title: 'AI 消痕功能',
    description: '独特的 AI 消痕模板，智能识别并优化 AI 生成内容中的机械感表达，显著降低文章的 AI 检测率，让您的作品更具人文温度。',
  },
  {
    tag: '深度分析',
    title: '小说章节拆解',
    description: '智能分析优秀小说的章节结构，帮您深入理解书籍的设计思路。学习大师的创作技巧，让您的故事架构更加专业。',
  },
  {
    tag: '创意工具',
    title: '10+ 余款生成器',
    description: '涵盖书名、人物、场景、道具、情节等创作要素的生成器集合。从零散灵感到完整设定，助您跨越创作瓶颈。',
  },
  {
    tag: '质量把控',
    title: 'AI 智能审稿',
    description: '专业的 AI 审稿功能，从情节逻辑、人物塑造、语言表达等多维度评估您的作品，提供针对性的优化建议。',
  },
]

export default function FeaturesSection() {
  return (
    <section className="px-4 py-16 sm:px-6 md:px-12 md:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold text-gray-900 dark:text-zinc-100 md:text-4xl">专为小说创作打造</h2>
          <p className="text-base text-gray-600 dark:text-zinc-400">从构思到成稿，为您的创作之路提供全方位支持</p>
        </div>
        <div className="space-y-16">
          {features.map((f, i) => (
            <div key={f.title} className={`flex flex-col items-center gap-8 md:flex-row ${i % 2 === 1 ? 'md:flex-row-reverse' : ''}`}>
              <div className="flex-1">
                <span className="mb-2 inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">{f.tag}</span>
                <h3 className="mb-3 text-2xl font-bold text-gray-900 dark:text-zinc-100">{f.title}</h3>
                <p className="mb-4 text-gray-600 dark:text-zinc-400 leading-relaxed">{f.description}</p>
              </div>
              <div className="flex-1">
                <div className="aspect-video w-full rounded-2xl bg-gradient-to-br from-blue-50 to-gray-100 dark:from-zinc-800 dark:to-zinc-900 flex items-center justify-center">
                  <span className="text-gray-400 dark:text-zinc-500 text-sm">{f.title} 示意图</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
