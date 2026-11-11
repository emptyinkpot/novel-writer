'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { apiJson } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

type LocalConfig = { enabled: boolean; name: string | null }
type LocalSession = {
  access_token: string
  user: { id: number; email: string; name: string; provider: string }
}

export default function LocalAuthInitializer() {
  const pathname = usePathname()
  const router = useRouter()
  const { setToken, setUser, hydrate, setAuthReady, setLocalMode, localMode, isLoggedIn } = useAuthStore()

  useEffect(() => {
    let active = true
    const initialize = async () => {
      let localEnabled = false
      try {
        const config = await fetch('/api/v1/auth/local/config', { cache: 'no-store' }).then((response) => response.json()) as LocalConfig
        if (!active) return
        localEnabled = config.enabled
        setLocalMode(config.enabled)
        if (config.enabled) {
          const session = await fetch('/api/v1/auth/local/bootstrap', { method: 'POST', cache: 'no-store' }).then((response) => response.json()) as LocalSession
          if (!active) return
          setToken(session.access_token)
          setUser({ ...session.user, id: String(session.user.id) })
        } else {
          hydrate()
        }
      } catch {
        if (active) {
          setLocalMode(localEnabled)
          hydrate()
        }
      } finally {
        if (active) setAuthReady(true)
      }
    }
    void initialize()
    return () => { active = false }
  }, [hydrate, setAuthReady, setLocalMode, setToken, setUser])

  useEffect(() => {
    if (localMode && isLoggedIn && (pathname === '/' || pathname === '/login')) router.replace('/library')
  }, [isLoggedIn, localMode, pathname, router])

  return null
}
