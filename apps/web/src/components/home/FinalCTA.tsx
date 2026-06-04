import Link from 'next/link'

export default function FinalCTA() {
  return (
    <section className="bg-gradient-to-b from-blue-50 to-white px-4 py-20 text-center dark:from-blue-950/30 dark:to-zinc-950 sm:px-6 md:px-12 md:py-28">
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-4 text-3xl font-bold text-gray-900 dark:text-zinc-100 md:text-4xl">开始您的创作之旅</h2>
        <p className="mb-8 text-base text-gray-600 dark:text-zinc-400">加入万名作者的行列，用 AI 释放您的创作潜能</p>
        <Link
          href="/library"
          className="inline-block rounded-md bg-blue-600 px-8 py-3 text-base font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          免费开始
        </Link>
      </div>
    </section>
  )
}
