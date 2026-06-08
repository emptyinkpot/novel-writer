'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Check } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import { apiJson } from '@/lib/api'

type Tab = 'membership' | 'words' | 'credits'

const memberPlans = [
  { key: 'weekly', name: '周卡', duration: '7天', original: '59.9', price: '49.99', credits: '500 积分', popular: false },
  { key: 'monthly', name: '月卡', duration: '30天', original: '119', price: '89.99', credits: '每月赠送 3,000 积分', popular: true },
  { key: 'quarterly', name: '季卡', duration: '90天', original: '349', price: '254.99', credits: '每月赠送 3,500 积分', popular: false },
  { key: 'yearly', name: '年卡', duration: '365天', original: '999', price: '949.99', credits: '每月赠送 5,000 积分', popular: false },
]

const memberFeatures = ['对话模式: 无限输入输出字数', '会员专属群', '积分可用于: 封面生成、工作流模式、至强模型', '最多一台电脑端 + 一台移动端同时使用']

const wordPacks = [
  { name: '小型字数包', amount: '100万字数', original: '50', price: '16.99', popular: false },
  { name: '中型字数包', amount: '200万字数', original: '100', price: '29.99', popular: true },
  { name: '大型字数包', amount: '500万字数', original: '200', price: '54.99', popular: false },
]

const creditPacks = [
  { name: '小型积分包', amount: '5000积分', original: '139.99', price: '54.99', popular: false, desc: '适合轻度工作流用户' },
  { name: '中型积分包', amount: '10000积分', original: '269.99', price: '104.99', popular: true, desc: '比小型包更划算' },
  { name: '大型积分包', amount: '50000积分', original: '1299.99', price: '499.99', popular: false, desc: '适合高频工作流用户' },
]

export default function PricingPage() {
  const [tab, setTab] = useState<Tab>('membership')
  const [paying, setPaying] = useState<string | null>(null)
  const [orderNo, setOrderNo] = useState<string | null>(null)
  const [payMethod, setPayMethod] = useState<'wechat' | 'alipay'>('wechat')
  const [showPayDialog, setShowPayDialog] = useState(false)
  const [payStatus, setPayStatus] = useState<'pending' | 'paid' | 'error'>('pending')
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null)
  const [paymentMode, setPaymentMode] = useState<'redirect' | 'qrcode' | null>(null)
  const [payError, setPayError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  const handleBuy = async (planType: string) => {
    setPaying(planType)
    setPayStatus('pending')
    setPayError('')
    setPaymentUrl(null)
    setPaymentMode(null)
    try {
      const res = await apiJson<{ code: number; data: { orderNo: string; paymentUrl: string; paymentMode: 'redirect' | 'qrcode' } }>(
        '/api/v1/payment/create-order',
        { method: 'POST', body: { planType, payMethod } },
      )
      if (res.code === 0) {
        setOrderNo(res.data.orderNo)
        setPaymentUrl(res.data.paymentUrl)
        setPaymentMode(res.data.paymentMode)
        setShowPayDialog(true)
        if (res.data.paymentMode === 'redirect') {
          window.open(res.data.paymentUrl, '_blank')
        }
        pollRef.current = setInterval(async () => {
          const s = await apiJson<{ code: number; data: { status: string } }>(
            `/api/v1/payment/order-status?orderNo=${res.data.orderNo}`,
          )
          if (s.data.status === 'paid') { setPayStatus('paid'); stopPolling() }
        }, 3000)
      }
    } catch (err: unknown) {
      setPayStatus('error')
      setPayError(err instanceof Error ? err.message : '订单创建失败，请重试')
      setShowPayDialog(true)
    }
    finally { setPaying(null) }
  }

  const closeDialog = () => { setShowPayDialog(false); stopPolling(); setOrderNo(null); setPaymentUrl(null); setPaymentMode(null); setPayError('') }

  return (
    <div className="flex h-screen-dynamic flex-col">
      <Header />
      <div className="flex flex-1 flex-col overflow-auto bg-white dark:bg-zinc-950">
        <section className="px-4 py-10 text-gray-800 dark:text-zinc-200 sm:px-6 sm:py-14 md:px-12 md:py-20">
          <div className="mx-auto max-w-6xl text-center">
            <h1 className="mb-3 text-3xl font-bold leading-tight md:mb-6 md:text-6xl">选择最适合你的计划</h1>
            <div className="mb-10 inline-flex items-center gap-1 rounded-full bg-gray-100 p-1 dark:bg-zinc-800">
              <button onClick={() => setTab('membership')} className={`rounded-full px-4 py-1.5 text-xs font-medium sm:px-5 sm:text-sm md:px-6 md:py-2 ${tab === 'membership' ? 'bg-white shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-gray-600 dark:text-zinc-400'}`}>会员计划</button>
              <button onClick={() => setTab('words')} className={`rounded-full px-4 py-1.5 text-xs font-medium sm:px-5 sm:text-sm md:px-6 md:py-2 ${tab === 'words' ? 'bg-white shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-gray-600 dark:text-zinc-400'}`}>额外字数包</button>
              <button onClick={() => setTab('credits')} className={`rounded-full px-4 py-1.5 text-xs font-medium sm:px-5 sm:text-sm md:px-6 md:py-2 ${tab === 'credits' ? 'bg-white shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-gray-600 dark:text-zinc-400'}`}>积分购买</button>
            </div>
            {tab === 'membership' && (
              <div className="grid grid-cols-1 gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
                {memberPlans.map((plan) => (
                  <div key={plan.name} className={`relative flex flex-col rounded-xl p-3 sm:p-4 md:rounded-lg md:p-8 text-left ${plan.popular ? 'border-2 border-blue-600 dark:border-blue-500 bg-blue-50 dark:bg-blue-950/30 shadow-lg' : 'border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900'}`}>
                    {plan.popular && <span className="absolute right-2 top-1 md:right-3 md:top-2 rounded-full bg-blue-600 px-2 py-1 text-xs text-white">最受欢迎</span>}
                    <div className="min-h-[64px] sm:min-h-[72px] md:min-h-28">
                      <h2 className="mb-1 text-lg font-bold sm:text-xl md:mb-2 md:text-2xl">{plan.name}</h2>
                      <p className="text-xs leading-5 sm:text-sm md:text-base text-gray-600 dark:text-zinc-400">有效期 {plan.duration} · {plan.credits}</p>
                    </div>
                    <div className="h-14 sm:h-16 md:h-24">
                      <span className="text-xs sm:text-sm text-gray-500 line-through">¥{plan.original}</span>
                      <h3 className="text-2xl sm:text-[28px] md:text-3xl font-bold">¥{plan.price}</h3>
                    </div>
                    <button onClick={() => handleBuy(plan.key)} disabled={paying === plan.key} className={`w-full h-10 sm:h-11 md:py-6 rounded-md text-sm md:text-base font-semibold flex items-center justify-center ${plan.popular ? 'bg-blue-600 hover:bg-blue-700 shadow-md text-white' : 'bg-black text-white dark:bg-slate-100 dark:text-slate-900'} disabled:opacity-50`}>{paying === plan.key ? '处理中...' : '购买'}</button>
                    <ul className="mt-3 md:mt-8 space-y-2.5 md:space-y-4 text-xs text-gray-600 dark:text-zinc-400 md:text-sm">
                      {memberFeatures.map((f) => (
                        <li key={f} className="flex gap-x-3 items-start">
                          <div className="mt-0.5 rounded-full bg-blue-100 p-0.5 dark:bg-blue-900"><Check className="h-3.5 w-3.5 text-blue-600" /></div>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {tab === 'words' && (
              <div className="grid grid-cols-1 gap-6 text-left sm:grid-cols-3">
                {wordPacks.map((pack) => (
                  <div key={pack.name} className={`relative flex flex-col rounded-xl p-6 ${pack.popular ? 'border-2 border-blue-600 dark:border-blue-500 bg-blue-50 dark:bg-blue-950/30 shadow-lg' : 'border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900'}`}>
                    {pack.popular && <span className="absolute right-3 top-2 rounded-full bg-blue-600 px-2 py-1 text-xs text-white">最受欢迎</span>}
                    <h2 className="mb-1 text-xl font-bold">{pack.name}</h2>
                    <p className="mb-4 text-sm text-gray-600 dark:text-zinc-400">{pack.amount} · 永久有效</p>
                    <span className="text-sm text-gray-500 line-through">¥{pack.original}</span>
                    <h3 className="mb-6 text-3xl font-bold">¥{pack.price}</h3>
                    <button className={`w-full rounded-md py-2.5 text-sm font-semibold ${pack.popular ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-black text-white dark:bg-slate-100 dark:text-slate-900'}`}>购买</button>
                  </div>
                ))}
              </div>
            )}
            {tab === 'credits' && (
              <div className="grid grid-cols-1 gap-6 text-left sm:grid-cols-3">
                {creditPacks.map((pack) => (
                  <div key={pack.name} className={`relative flex flex-col rounded-xl p-6 ${pack.popular ? 'border-2 border-blue-600 dark:border-blue-500 bg-blue-50 dark:bg-blue-950/30 shadow-lg' : 'border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900'}`}>
                    {pack.popular && <span className="absolute right-3 top-2 rounded-full bg-blue-600 px-2 py-1 text-xs text-white">最受欢迎</span>}
                    <h2 className="mb-1 text-xl font-bold">{pack.name}</h2>
                    <p className="mb-1 text-sm text-gray-600 dark:text-zinc-400">{pack.amount} · 永久有效</p>
                    <p className="mb-4 text-xs text-gray-500 dark:text-zinc-500">{pack.desc}</p>
                    <span className="text-sm text-gray-500 line-through">¥{pack.original}</span>
                    <h3 className="mb-6 text-3xl font-bold">¥{pack.price}</h3>
                    <button className={`w-full rounded-md py-2.5 text-sm font-semibold ${pack.popular ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-black text-white dark:bg-slate-100 dark:text-slate-900'}`}>购买</button>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-8 text-center text-sm text-gray-500 dark:text-zinc-500">
              购买即表示同意 <a href="#" className="text-blue-600 underline-offset-4 hover:underline">《虚拟商品购买协议》</a>
            </p>
            <div className="mt-6 flex items-center justify-center gap-4">
              <span className="text-sm text-gray-600 dark:text-zinc-400">支付方式:</span>
              <button onClick={() => setPayMethod('wechat')} className={`rounded-md px-4 py-1.5 text-sm ${payMethod === 'wechat' ? 'bg-green-500 text-white' : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300'}`}>微信支付</button>
              <button onClick={() => setPayMethod('alipay')} className={`rounded-md px-4 py-1.5 text-sm ${payMethod === 'alipay' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300'}`}>支付宝</button>
            </div>
          </div>
        </section>
      </div>
      {showPayDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 dark:bg-zinc-900">
            <h3 className="mb-4 text-lg font-bold text-gray-800 dark:text-zinc-200">
              {payStatus === 'paid' ? '支付成功' : payStatus === 'error' ? '支付失败' : '等待支付'}
            </h3>
            {payStatus === 'pending' && (
              <div className="text-center text-sm text-gray-600 dark:text-zinc-400">
                <p className="mb-2">订单号: {orderNo}</p>
                {paymentMode === 'qrcode' && paymentUrl ? (
                  <div className="mb-4 flex flex-col items-center gap-3">
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <QRCodeSVG value={paymentUrl} size={220} />
                    </div>
                    <p>请使用{payMethod === 'wechat' ? '微信' : '支付宝'}扫码完成付款</p>
                  </div>
                ) : (
                  <p>请在支付页面完成付款，完成后此处将自动更新...</p>
                )}
                <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-700">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500" />
                </div>
              </div>
            )}
            {payStatus === 'paid' && (
              <p className="text-center text-sm text-green-600">会员已激活</p>
            )}
            {payStatus === 'error' && (
              <p className="text-center text-sm text-red-500">{payError || '订单创建失败，请重试'}</p>
            )}
            <button onClick={closeDialog} className="mt-6 w-full rounded-md bg-gray-100 py-2 text-sm font-medium text-gray-800 dark:bg-zinc-800 dark:text-zinc-200">关闭</button>
          </div>
        </div>
      )}
      <Footer />
    </div>
  )
}
