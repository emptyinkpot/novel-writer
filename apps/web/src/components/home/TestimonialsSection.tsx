const testimonials = [
  { author: '择日生_', role: '老福特大神', content: '自从开始使用 Novel Writer，我的创作灵感简直源源不断。它不仅仅是一个强大的 AI 工具，更像一个与我心有灵犀的写作伙伴，总能在我思路枯竭时，给出恰到好处的启发和建议。' },
  { author: '阿甜甜', role: '七猫短剧作者', content: '太好用了，以前我的很多东西都记在本子上，找资料要翻半天。现在我都记录在 Novel Writer，打开左边的设定就能直接找到资料，写作效率提高了至少 3 倍以上。' },
  { author: '小果', role: '番茄热门作者', content: '身为一名网文作者，我是通过 AI 消痕了解到这里的，深入用了之后发现功能十分齐全：生成器、AI 审稿、章节解析、拆书、生成正文。一天能轻松写 1~2 万字。' },
  { author: '柚子', role: '提示词创作者', content: '价格便宜，功能丰富，可开发性高，对于新人与老手都能用。新人不踩坑，老手可以更好的使用，没有太多限制，调整也更方便。' },
  { author: '清欢', role: '提示词作者', content: '最良心的写作软件，在功能强大的同时，还兼具了简约派的界面风格。看起来养眼，用起来舒心。' },
  { author: '李玄', role: '番茄热门作者', content: '根据概要定制修改章节内容很合理，随时改动剧情，方便作者和读者互动修改剧情，能让作者为读者定制角色。' },
  { author: 'tivial', role: '剧本签约作者', content: '内容很精炼，生成的内容能够很好衔接，而且还能解决卡文，能够反复根据关联的前文修改章纲和大纲。' },
]

export default function TestimonialsSection() {
  return (
    <section className="bg-gray-50 px-4 py-16 dark:bg-zinc-900 sm:px-6 md:px-12 md:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold text-gray-900 dark:text-zinc-100 md:text-4xl">作者们怎么说</h2>
          <p className="text-base text-gray-600 dark:text-zinc-400">来自真实用户的声音</p>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((t) => (
            <div
              key={t.author}
              className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              <p className="mb-4 text-sm leading-relaxed text-gray-700 dark:text-zinc-300">{t.content}</p>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400 font-semibold">
                  {t.author.slice(0, 1)}
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{t.author}</div>
                  <div className="text-xs text-gray-500 dark:text-zinc-500">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
