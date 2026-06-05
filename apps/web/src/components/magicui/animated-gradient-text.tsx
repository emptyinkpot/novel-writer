'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface AnimatedGradientTextProps {
  children: ReactNode
  className?: string
}

export function AnimatedGradientText({ children, className }: AnimatedGradientTextProps) {
  return (
    <span
      className={cn(
        'inline-block bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 bg-clip-text text-transparent animate-gradient',
        className,
      )}
      style={{ backgroundSize: '200% 200%' }}
    >
      {children}
    </span>
  )
}
