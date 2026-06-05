'use client'

import { cn } from '@/lib/cn'

interface AnimatedBeamProps {
  className?: string
  orientation?: 'horizontal' | 'vertical'
}

export function AnimatedBeam({ className, orientation = 'horizontal' }: AnimatedBeamProps) {
  const baseHorizontal =
    'bg-gradient-to-r from-transparent via-blue-400/70 to-transparent dark:via-blue-300/60 h-px w-full'
  const baseVertical =
    'bg-gradient-to-b from-transparent via-blue-400/70 to-transparent dark:via-blue-300/60 w-px h-full'

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden animate-beam-pulse',
        orientation === 'horizontal' ? baseHorizontal : baseVertical,
        className,
      )}
    >
      <div
        className={cn(
          'absolute inset-0 animate-shimmer',
          orientation === 'horizontal'
            ? 'bg-gradient-to-r from-transparent via-purple-400/80 to-transparent'
            : 'bg-gradient-to-b from-transparent via-purple-400/80 to-transparent',
        )}
      />
    </div>
  )
}
