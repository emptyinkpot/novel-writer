import { useAuthStore } from '@/stores/auth'

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || ''

export interface ApiOptions extends RequestInit {
  body?: any
}

export async function apiClient(path: string, options: ApiOptions = {}) {
  const token = useAuthStore.getState().token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const body =
    options.body && typeof options.body !== 'string'
      ? JSON.stringify(options.body)
      : options.body

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    body,
  })

  if (!res.ok) {
    const text = await res.text()
    if (res.status === 401) {
      useAuthStore.getState().signOut()
    }
    throw new Error(`API ${res.status}: ${text}`)
  }

  return res
}

export async function apiJson<T = unknown>(
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const res = await apiClient(path, options)
  return res.json() as Promise<T>
}

export async function apiStream(
  path: string,
  options: ApiOptions = {},
  onChunk: (chunk: string) => void
) {
  const res = await apiClient(path, options)
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    onChunk(text)
  }
}
