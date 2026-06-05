'use client'

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface ShimmerButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  shimmerColor?: string
  shimmerSize?: string
  borderRadius?: string
  shimmerDuration?: string
  background?: string
  children: ReactNode
}

export const ShimmerButton = forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  (
    {
      shimmerColor = '#ffffff',
      shimmerSize = '0.05em',
      shimmerDuration = '2s',
      borderRadius = '9999px',
      background = 'linear-gradient(110deg, #2563eb 0%, #7c3aed 50%, #2563eb 100%)',
      className,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        style={
          {
            '--shimmer-color': shimmerColor,
            '--shimmer-size': shimmerSize,
            '--shimmer-duration': shimmerDuration,
            '--radius': borderRadius,
            '--bg': background,
          } as React.CSSProperties
        }
        className={cn(
          'group relative z-0 inline-flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap',
          'border border-white/10 px-8 py-3 text-base font-semibold text-white shadow-2xl',
          'transition-transform duration-300 hover:scale-[1.03] active:scale-[0.98]',
          '[border-radius:var(--radius)] [background:var(--bg)] [background-size:200%_100%]',
          'animate-gradient',
          className,
        )}
        {...props}
      >
        <span
          className="pointer-events-none absolute inset-0 overflow-hidden [border-radius:var(--radius)]"
          aria-hidden="true"
        >
          <span
            className="absolute inset-y-0 -left-[100%] w-[60%] animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-[-20deg]"
            style={{ animationDuration: 'var(--shimmer-duration)' }}
          />
        </span>
        <span className="relative z-10 flex items-center gap-2">{children}</span>
        <span
          className="pointer-events-none absolute inset-0 -z-10 [border-radius:var(--radius)] opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-60"
          style={{ background: 'linear-gradient(110deg, #2563eb, #7c3aed, #2563eb)' }}
          aria-hidden="true"
        />
      </button>
    )
  },
)

ShimmerButton.displayName = 'ShimmerButton'
