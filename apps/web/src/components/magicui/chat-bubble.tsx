'use client'

import { motion } from 'framer-motion'
import { TypingAnimation } from './typing-animation'

interface ChatBubbleProps {
  role: 'user' | 'ai'
  text: string
  show: boolean
  typing?: boolean
  onTypingComplete?: () => void
}

export function ChatBubble({ role, text, show, typing, onTypingComplete }: ChatBubbleProps) {
  const isUser = role === 'user'
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
          isUser
            ? 'bg-zinc-700/60 text-zinc-100'
            : 'bg-blue-500/15 text-blue-100 border border-blue-500/20'
        }`}
      >
        {typing ? (
          <TypingAnimation
            text={text}
            start={show}
            speed={30}
            onComplete={onTypingComplete}
          />
        ) : (
          text
        )}
      </div>
    </motion.div>
  )
}
