'use client'

import { cn } from '@/lib/cn'
import { type ReactNode } from 'react'

interface MarqueeProps {
  children: ReactNode
  direction?: 'left' | 'right'
  speed?: number
  pauseOnHover?: boolean
  className?: string
}

export function Marquee({
  children,
  direction = 'left',
  speed = 30,
  pauseOnHover = true,
  className,
}: MarqueeProps) {
  return (
    <div
      className={cn(
        'group flex overflow-hidden [--gap:1rem]',
        pauseOnHover && '[&:hover>div]:animation-play-state-paused',
        className,
      )}
      style={{ '--duration': `${speed}s` } as React.CSSProperties}
    >
      <div
        className={cn(
          'flex shrink-0 gap-[var(--gap)] py-2',
          direction === 'left' ? 'animate-marquee-left' : 'animate-marquee-right',
          pauseOnHover && 'group-hover:[animation-play-state:paused]',
        )}
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        className={cn(
          'flex shrink-0 gap-[var(--gap)] py-2',
          direction === 'left' ? 'animate-marquee-left' : 'animate-marquee-right',
          pauseOnHover && 'group-hover:[animation-play-state:paused]',
        )}
      >
        {children}
      </div>
    </div>
  )
}
