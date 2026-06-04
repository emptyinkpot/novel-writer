'use client'

import { useState } from 'react'
import { Search, Plus, FileText } from 'lucide-react'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'

const typeFilters = ['社区模板', '收藏模板', '自定义模板']
const lengthFilters = ['全部', '通用', '超短篇', '短篇', '中篇', '长篇', '剧本']
const categoryFilters = ['全部', '通用', '正文', '书名', '简介', '金手指', '大纲', '细纲', '开篇', '角色', '脑洞', '审稿', '拆书', '消痕', '其他', '代写']
const sortFilters = ['综合', '热门', '最新']

export default function WorkflowPage() {
  const [type, setType] = useState(typeFilters[0])
  const [length, setLength] = useState(lengthFilters[0])
  const [category, setCategory] = useState(categoryFilters[0])
  const [sortBy, setSortBy] = useState(sortFilters[0])
  const [keyword, setKeyword] = useState('')

  return (
    <div className="flex h-screen-dynamic flex-col">
      <Header />
      <div className="flex flex-1 flex-col overflow-auto bg-white dark:bg-zinc-900">
        <div className="container mx-auto flex-1 px-3 py-6 sm:px-4 sm:py-8 lg:px-6">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-lg font-medium text-gray-900 dark:text-zinc-100">工作流模板</h1>
            <div className="flex items-center gap-2">
              <button className="rounded-md border border-gray-200 px-3 py-1.5 text-sm dark:border-zinc-700">添加私有模板</button>
              <button className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"><Plus className="h-3.5 w-3.5" /> 新建模板</button>
            </div>
          </div>
          <div className="mb-8 space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
            <FilterRow label="模板类型" options={typeFilters} value={type} onChange={setType} />
            <FilterRow label="篇幅类型" options={lengthFilters} value={length} onChange={setLength} />
            <FilterRow label="模板分类" options={categoryFilters} value={category} onChange={setCategory} />
            <FilterRow label="内容排序" options={sortFilters} value={sortBy} onChange={setSortBy} />
            <div className="flex items-center gap-3">
              <span className="shrink-0 text-sm text-gray-600 dark:text-zinc-400">关键词</span>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索模板..." className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" />
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileText className="mb-4 h-12 w-12 text-gray-300 dark:text-zinc-600" />
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-zinc-100">暂无模板数据</h3>
            <p className="text-sm text-gray-500 dark:text-zinc-500">请尝试调整筛选条件或搜索关键词</p>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}

function FilterRow({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1.5 shrink-0 text-sm text-gray-600 dark:text-zinc-400">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button key={opt} onClick={() => onChange(opt)} className={`rounded-full px-3 py-1 text-xs font-medium transition ${value === opt ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}`}>{opt}</button>
        ))}
      </div>
    </div>
  )
}
