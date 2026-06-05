'use client'

import { cn } from '@/lib/cn'

interface AvatarCirclesProps {
  avatars: { name: string; color: string }[]
  className?: string
}

export function AvatarCircles({ avatars, className }: AvatarCirclesProps) {
  return (
    <div className={cn('flex -space-x-3', className)}>
      {avatars.map((a) => (
        <div
          key={a.name}
          className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white dark:border-zinc-900"
          style={{ backgroundColor: a.color }}
        >
          {a.name.slice(0, 1)}
        </div>
      ))}
    </div>
  )
}
