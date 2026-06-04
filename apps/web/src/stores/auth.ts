import { create } from 'zustand'

interface User {
  id: string
  name: string
  email: string
}

interface AuthState {
  token: string | null
  user: User | null
  isLoggedIn: boolean
  setToken: (token: string | null) => void
  setUser: (user: User | null) => void
  signOut: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isLoggedIn: false,
  setToken: (token) => set({ token, isLoggedIn: !!token }),
  setUser: (user) => set({ user }),
  signOut: () => set({ token: null, user: null, isLoggedIn: false }),
}))
