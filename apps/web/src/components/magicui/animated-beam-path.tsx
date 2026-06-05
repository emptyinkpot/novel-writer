'use client'

import { motion } from 'framer-motion'
import { useEffect, useRef, useState, type RefObject } from 'react'

interface AnimatedBeamPathProps {
  containerRef: RefObject<HTMLElement | null>
  fromRef: RefObject<HTMLElement | null>
  toRef: RefObject<HTMLElement | null>
  active: boolean
  duration?: number
  reverse?: boolean
  curvature?: number
}

export function AnimatedBeamPath({
  containerRef,
  fromRef,
  toRef,
  active,
  duration = 2,
  reverse = false,
  curvature = -40,
}: AnimatedBeamPathProps) {
  const [path, setPath] = useState('')
  const [box, setBox] = useState({ width: 0, height: 0 })
  const gradientId = useRef(`beam-${Math.random().toString(36).slice(2, 10)}`).current

  useEffect(() => {
    const update = () => {
      if (!containerRef.current || !fromRef.current || !toRef.current) return
      const c = containerRef.current.getBoundingClientRect()
      const f = fromRef.current.getBoundingClientRect()
      const t = toRef.current.getBoundingClientRect()
      const x1 = f.left + f.width / 2 - c.left
      const y1 = f.top + f.height / 2 - c.top
      const x2 = t.left + t.width / 2 - c.left
      const y2 = t.top + t.height / 2 - c.top
      const cx = (x1 + x2) / 2
      const cy = (y1 + y2) / 2 + curvature
      setPath(`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`)
      setBox({ width: c.width, height: c.height })
    }
    update()
    const ro = new ResizeObserver(update)
    if (containerRef.current) ro.observe(containerRef.current)
    window.addEventListener('resize', update)
    const id = window.setInterval(update, 200)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      window.clearInterval(id)
    }
  }, [containerRef, fromRef, toRef, curvature])

  if (!path || !box.width) return null

  return (
    <svg
      width={box.width}
      height={box.height}
      className="absolute inset-0 pointer-events-none"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0" />
          <stop offset="50%" stopColor="#8b5cf6" stopOpacity="1" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          <animate
            attributeName="x1"
            values={reverse ? '100%;0%' : '0%;100%'}
            dur={`${duration}s`}
            repeatCount="indefinite"
          />
          <animate
            attributeName="x2"
            values={reverse ? '110%;10%' : '10%;110%'}
            dur={`${duration}s`}
            repeatCount="indefinite"
          />
        </linearGradient>
      </defs>
      <path
        d={path}
        stroke="rgba(148, 163, 184, 0.2)"
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="4 4"
      />
      <motion.path
        d={path}
        stroke={`url(#${gradientId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        initial={{ opacity: 0 }}
        animate={{ opacity: active ? 1 : 0 }}
        transition={{ duration: 0.4 }}
      />
    </svg>
  )
}
