'use client'

import Link from 'next/link'
import { Particles } from '@/components/magicui/particles'
import { SparklesText } from '@/components/magicui/sparkles-text'
import { AvatarCircles } from '@/components/magicui/avatar-circles'
import { ShimmerButton } from '@/components/magicui/shimmer-button'

const avatars = [
  { name: '墨', color: '#6366f1' },
  { name: '清', color: '#ec4899' },
  { name: '云', color: '#10b981' },
  { name: '远', color: '#f59e0b' },
  { name: '夜', color: '#8b5cf6' },
]

export default function FinalCTA() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-blue-950 via-zinc-950 to-purple-950 px-4 py-24 text-center sm:px-6 md:px-12 md:py-32">
      <Particles count={45} color="#a5b4fc" />
      <div className="relative z-10 mx-auto max-w-3xl">
        <h2 className="mb-6 text-4xl font-bold text-white md:text-5xl">
          <SparklesText text="开始你的创作之旅" sparkleCount={10} />
        </h2>
        <p className="mb-10 text-base text-zinc-300 md:text-lg">
          加入万名作者的行列，用 AI 释放您的创作潜能
        </p>
        <Link href="/library" className="inline-block">
          <ShimmerButton className="px-10 py-3.5 text-base">
            免费开始创作
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </ShimmerButton>
        </Link>
        <div className="mt-10 flex flex-col items-center gap-3">
          <AvatarCircles avatars={avatars} />
          <p className="text-sm text-zinc-400">
            已有 <span className="font-semibold text-zinc-200">10 万+</span> 作者加入
          </p>
        </div>
      </div>
    </section>
  )
}
