'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

interface DotPatternProps {
  width?: number
  height?: number
  cx?: number
  cy?: number
  cr?: number
  className?: string
}

export function DotPattern({
  width = 20,
  height = 20,
  cx = 1,
  cy = 1,
  cr = 1,
  className,
}: DotPatternProps) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      const node = ref.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    window.addEventListener('mousemove', handle)
    return () => window.removeEventListener('mousemove', handle)
  }, [])

  return (
    <div
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn('pointer-events-auto absolute inset-0 overflow-hidden', className)}
      style={{
        WebkitMaskImage: hovered
          ? `radial-gradient(circle 240px at ${pos.x}px ${pos.y}px, transparent 0%, black 100%)`
          : 'radial-gradient(circle at center, black 0%, black 100%)',
        maskImage: hovered
          ? `radial-gradient(circle 240px at ${pos.x}px ${pos.y}px, transparent 0%, black 100%)`
          : 'radial-gradient(circle at center, black 0%, black 100%)',
      }}
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full text-zinc-300/60 dark:text-zinc-700/60"
      >
        <defs>
          <pattern
            id={id}
            width={width}
            height={height}
            patternUnits="userSpaceOnUse"
            patternContentUnits="userSpaceOnUse"
          >
            <circle cx={cx} cy={cy} r={cr} fill="currentColor" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
      </svg>
    </div>
  )
}
