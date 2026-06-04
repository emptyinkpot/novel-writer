export default function WorkspaceSection() {
  return (
    <section className="px-4 py-16 sm:px-6 md:px-12 md:py-20">
      <div className="mx-auto max-w-6xl text-center">
        <h2 className="mb-3 text-3xl font-bold text-gray-900 dark:text-zinc-100 md:text-4xl">高效创作</h2>
        <p className="mb-12 text-base text-gray-600 dark:text-zinc-400">功能强大而不失优雅的工作台</p>
        <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-blue-50 to-white p-2 shadow-xl dark:border-zinc-800 dark:from-blue-950/40 dark:to-zinc-900">
          <div className="aspect-video w-full rounded-xl bg-gradient-to-br from-blue-100 via-white to-blue-50 dark:from-zinc-800 dark:via-zinc-850 dark:to-zinc-900 flex items-center justify-center">
            <span className="text-gray-400 dark:text-zinc-500">编辑器工作台预览</span>
          </div>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="text-left rounded-xl border border-gray-200 p-6 dark:border-zinc-800">
            <h3 className="mb-2 font-semibold text-gray-900 dark:text-zinc-100">文件树</h3>
            <p className="text-sm text-gray-600 dark:text-zinc-400">自由管理您的小说章节、设定、角色卡</p>
          </div>
          <div className="text-left rounded-xl border border-gray-200 p-6 dark:border-zinc-800">
            <h3 className="mb-2 font-semibold text-gray-900 dark:text-zinc-100">编辑器</h3>
            <p className="text-sm text-gray-600 dark:text-zinc-400">不只是码字，还拥有：章节摘要、AI高频词汇提示、角色卡关联、重要信息高亮等功能</p>
          </div>
          <div className="text-left rounded-xl border border-gray-200 p-6 dark:border-zinc-800">
            <h3 className="mb-2 font-semibold text-gray-900 dark:text-zinc-100">对话区</h3>
            <p className="text-sm text-gray-600 dark:text-zinc-400">对话、代写、工作流等多种AI协作方式，高效完成您的写作任务</p>
          </div>
        </div>
      </div>
    </section>
  )
}
