'use client'

import { motion } from 'framer-motion'

interface AnimatedListProps {
  items: { label: string; active?: boolean }[]
  staggerDelay?: number
  show: boolean
}

export function AnimatedList({ items, staggerDelay = 0.2, show }: AnimatedListProps) {
  return (
    <div className="flex flex-col gap-1">
      {items.map((item, i) => (
        <motion.div
          key={item.label}
          initial={{ opacity: 0, x: -20 }}
          animate={show ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
          transition={{ delay: i * staggerDelay, duration: 0.3, ease: 'easeOut' }}
          className={`rounded-md px-3 py-1.5 text-xs truncate ${
            item.active
              ? 'bg-blue-500/20 text-blue-400 font-medium'
              : 'text-zinc-400 hover:text-zinc-300'
          }`}
        >
          {item.label}
        </motion.div>
      ))}
    </div>
  )
}
