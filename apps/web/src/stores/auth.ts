import { create } from 'zustand'

interface User {
  id: string
  name: string
  email: string
  provider?: string
}

interface AuthState {
  token: string | null
  user: User | null
  isLoggedIn: boolean
  authReady: boolean
  localMode: boolean
  hydrate: () => void
  setAuthReady: (ready: boolean) => void
  setLocalMode: (enabled: boolean) => void
  setToken: (token: string | null) => void
  setUser: (user: User | null) => void
  signOut: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isLoggedIn: false,
  authReady: false,
  localMode: false,
  setAuthReady: (authReady) => set({ authReady }),
  setLocalMode: (localMode) => set({ localMode }),
  hydrate: () => {
    if (typeof window === 'undefined') return
    const token = window.localStorage.getItem('token')
    set({ token, isLoggedIn: !!token })
  },
  setToken: (token) => {
    if (typeof window !== 'undefined') {
      if (token) window.localStorage.setItem('token', token)
      else window.localStorage.removeItem('token')
    }
    set({ token, isLoggedIn: !!token })
  },
  setUser: (user) => set({ user }),
  signOut: () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('token')
    }
    set({ token: null, user: null, isLoggedIn: false })
  },
}))
