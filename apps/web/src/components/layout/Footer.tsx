import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="bg-black px-6 py-4 text-white md:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-center space-y-3 md:flex-row md:items-center md:justify-between md:space-y-0">
          <div className="md:mb-0">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-lg">咕</div>
          </div>
          <div className="flex flex-col items-center space-y-2 md:flex-row md:space-x-2 md:space-y-0">
            <Link href="/terms" className="text-nowrap text-sm text-zinc-400 hover:text-white">服务条款</Link>
            <span className="text-zinc-600">|</span>
            <Link href="/privacy" className="text-nowrap text-sm text-zinc-400 hover:text-white">隐私政策</Link>
            <span className="text-sm text-zinc-400 text-center md:ml-6">&copy; 2026 咕嘎写作. All rights reserved.</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
