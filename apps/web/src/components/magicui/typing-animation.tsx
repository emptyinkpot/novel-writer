'use client'

import { useEffect, useState } from 'react'

interface TypingAnimationProps {
  text: string
  start: boolean
  speed?: number
  className?: string
  showCursor?: boolean
  onComplete?: () => void
}

export function TypingAnimation({
  text,
  start,
  speed = 40,
  className = '',
  showCursor = true,
  onComplete,
}: TypingAnimationProps) {
  const [displayed, setDisplayed] = useState('')

  useEffect(() => {
    if (!start) {
      setDisplayed('')
      return
    }
    let i = 0
    const timer = setInterval(() => {
      i++
      setDisplayed(text.slice(0, i))
      if (i >= text.length) {
        clearInterval(timer)
        onComplete?.()
      }
    }, speed)
    return () => clearInterval(timer)
  }, [text, start, speed, onComplete])

  return (
    <span className={className}>
      {displayed}
      {showCursor && start && (
        <span className="inline-block w-[2px] h-[1em] bg-current align-middle ml-0.5 animate-pulse" />
      )}
    </span>
  )
}
