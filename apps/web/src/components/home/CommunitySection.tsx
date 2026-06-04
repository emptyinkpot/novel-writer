export default function CommunitySection() {
  return (
    <section className="bg-gray-50 px-4 py-16 dark:bg-zinc-900 sm:px-6 md:px-12 md:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2">
          <div>
            <div className="mb-4 inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              全品类大神陪跑训练营
            </div>
            <h2 className="mb-4 text-3xl font-bold text-gray-900 dark:text-zinc-100 md:text-4xl">
              新手离成为作家只差一个联系方式
            </h2>
            <p className="mb-4 text-gray-600 dark:text-zinc-400">
              数百位资深作者在线分享经验，帮你从小白成长为新晋大神。涵盖所有平台：番茄、起点、七猫、纵横、飞卢、刺猬猫、书旗等。
            </p>
            <div className="mb-6 flex flex-wrap gap-2 text-sm text-gray-700 dark:text-zinc-300">
              <span>超短篇</span>
              <span>|</span>
              <span>短篇</span>
              <span>|</span>
              <span>长篇</span>
              <span>|</span>
              <span>剧本</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-extrabold text-blue-600">95%</span>
              <span className="text-gray-700 dark:text-zinc-300">长篇小说签约率</span>
            </div>
            <button className="mt-6 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
              添加微信
            </button>
          </div>
          <div className="flex justify-center">
            <div className="flex h-64 w-64 items-center justify-center rounded-2xl bg-white shadow-md dark:bg-zinc-800">
              <span className="text-sm text-gray-400 dark:text-zinc-500">小助手二维码</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
