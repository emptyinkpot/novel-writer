import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '咕嘎写作 - AI 创作平台',
  description: '咕嘎写作 - AI 创作平台',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-Hans">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
