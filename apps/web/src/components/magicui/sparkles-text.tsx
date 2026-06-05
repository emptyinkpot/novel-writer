'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

interface SparklesTextProps {
  text: string
  className?: string
  sparkleCount?: number
}

interface Sparkle {
  id: number
  x: number
  y: number
  size: number
  delay: number
}

export function SparklesText({ text, className, sparkleCount = 8 }: SparklesTextProps) {
  const [sparkles, setSparkles] = useState<Sparkle[]>([])

  useEffect(() => {
    const generated = Array.from({ length: sparkleCount }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 60 - 10,
      size: Math.random() * 8 + 4,
      delay: Math.random() * 2,
    }))
    setSparkles(generated)
  }, [sparkleCount])

  return (
    <span className={cn('relative inline-block', className)}>
      {sparkles.map((s) => (
        <svg
          key={s.id}
          className="pointer-events-none absolute animate-sparkle"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            animationDelay: `${s.delay}s`,
          }}
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M12 2L13.5 9.5L21 12L13.5 14.5L12 22L10.5 14.5L3 12L10.5 9.5L12 2Z"
            fill="currentColor"
            className="text-yellow-400"
          />
        </svg>
      ))}
      {text}
    </span>
  )
}
