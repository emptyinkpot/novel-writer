import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '咕嘎写作 - AI 创作平台',
  description: '咕嘎写作 - AI 创作平台',
  icons: {
    icon: '/favicon.ico',
    apple: '/favicon-192.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-Hans">
      <body className="font-sans">{children}</body>
    </html>
  )
}
