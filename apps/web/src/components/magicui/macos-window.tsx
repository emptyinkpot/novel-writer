'use client'

import { type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface MacosWindowProps {
  title?: string
  children: ReactNode
  className?: string
}

export function MacosWindow({ title = 'Novel Writer', children, className }: MacosWindowProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-zinc-200/60 bg-white shadow-2xl shadow-blue-500/10',
        'dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-blue-500/5',
        className,
      )}
    >
      <div className="flex h-9 items-center gap-2 border-b border-zinc-200/60 bg-zinc-100/80 px-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1 text-center text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {title}
        </div>
        <div className="w-12" />
      </div>
      <div className="bg-zinc-50 dark:bg-zinc-950">{children}</div>
    </div>
  )
}
