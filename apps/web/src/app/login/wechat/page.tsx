'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/stores/auth'
import { apiJson } from '@/lib/api'

function WechatCallbackInner() {
  const searchParams = useSearchParams()
  const [error, setError] = useState('')
  const { setToken } = useAuthStore()

  useEffect(() => {
    const code = searchParams.get('code')
    if (!code) {
      setError('missing wechat authorization code')
      return
    }
    apiJson<{ access_token: string }>('/api/v1/auth/wechat/callback', {
      method: 'POST',
      body: { code },
    })
      .then((data) => {
        setToken(data.access_token)
        localStorage.setItem('token', data.access_token)
        window.location.href = '/editor'
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'wechat login failed')
      })
  }, [searchParams, setToken])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{error}</p>
          <a href="/login" className="mt-4 inline-block text-blue-600 underline">
            返回登录
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-gray-600">微信登录中...</p>
    </div>
  )
}

export default function WechatCallbackPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p className="text-gray-600">加载中...</p></div>}>
      <WechatCallbackInner />
    </Suspense>
  )
}
