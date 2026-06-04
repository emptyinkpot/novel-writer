import { Users, Image as ImageIcon, Sparkles } from 'lucide-react'

const cards = [
  {
    icon: Users,
    title: '人物关系图谱',
    description: '复杂人物，不该只靠脑子硬记。将角色关系、阵营变化与情感脉络可视化展开，让庞杂设定也能层次分明。',
    color: 'blue',
  },
  {
    icon: ImageIcon,
    title: '作品海报',
    description: '让你的小说世界，被一眼看见。基于设定、地图、人设与力量体系，智能生成专属海报，让作品气质跃然纸上。',
    color: 'purple',
  },
  {
    icon: Sparkles,
    title: 'AI 消痕',
    description: '智能识别并优化 AI 生成内容中的机械感表达，降低检测痕迹，让文章更自然流畅，也更具人文温度。',
    color: 'orange',
  },
]

const colorMap: Record<string, string> = {
  blue: 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
  purple: 'bg-purple-100 text-purple-600 dark:bg-purple-950 dark:text-purple-400',
  orange: 'bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-400',
}

export default function FeatureCards() {
  return (
    <section className="bg-gray-50 px-4 py-16 dark:bg-zinc-900 sm:px-6 md:px-12 md:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon
            return (
              <div
                key={card.title}
                className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-all duration-300 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl ${colorMap[card.color]}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-xl font-bold text-gray-900 dark:text-zinc-100">{card.title}</h3>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-zinc-400">{card.description}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
