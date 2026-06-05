'use client'

import { useEffect, useRef, useState } from 'react'
import { useInView, useMotionValue, useSpring } from 'framer-motion'
import { cn } from '@/lib/cn'

interface NumberTickerProps {
  value: number
  direction?: 'up' | 'down'
  delay?: number
  duration?: number
  decimalPlaces?: number
  className?: string
}

export function NumberTicker({
  value,
  direction = 'up',
  delay = 0,
  duration = 800,
  decimalPlaces = 0,
  className,
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const motionValue = useMotionValue(direction === 'down' ? value : 0)
  const stiffness = Math.max(40, 200 - duration / 10)
  const springValue = useSpring(motionValue, {
    damping: 30,
    stiffness,
  })
  const isInView = useInView(ref, { once: true, margin: '0px' })
  const [display, setDisplay] = useState('0')

  useEffect(() => {
    if (!isInView) return
    const timer = window.setTimeout(() => {
      motionValue.set(direction === 'down' ? 0 : value)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [motionValue, isInView, delay, value, direction])

  useEffect(() => {
    const unsubscribe = springValue.on('change', (latest) => {
      setDisplay(
        Intl.NumberFormat('en-US', {
          minimumFractionDigits: decimalPlaces,
          maximumFractionDigits: decimalPlaces,
        }).format(Number(latest.toFixed(decimalPlaces))),
      )
    })
    return () => unsubscribe()
  }, [springValue, decimalPlaces])

  return (
    <span
      ref={ref}
      className={cn('inline-block tabular-nums tracking-tight', className)}
    >
      {display}
    </span>
  )
}
