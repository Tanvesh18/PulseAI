const configuredApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, '')

export const apiUrl = (path: string) => `${configuredApiUrl || ''}/api${path}`

export function clearSession() {
  localStorage.removeItem('pulseai_token')
  localStorage.removeItem('pulseai_user')
}

export function handleUnauthorized(status: number) {
  if (status !== 401) return false
  clearSession()
  window.location.reload()
  return true
}

type ApiOptions = RequestInit & { timeoutMs?: number; fallbackMessage?: string }

export async function requestJson<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const { timeoutMs = 20000, fallbackMessage = 'The server could not complete this request.', ...requestOptions } = options
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(apiUrl(path), { ...requestOptions, signal: controller.signal })
    const text = await response.text()
    let data: any = {}
    if (text) {
      try { data = JSON.parse(text) }
      catch { data = { message: response.ok ? 'The server returned an unreadable response.' : fallbackMessage } }
    }
    if (handleUnauthorized(response.status)) throw new Error('Your session has expired. Please sign in again.')
    if (!response.ok) throw new Error(data.message || (response.status === 429 ? 'Too many requests. Wait a moment and try again.' : fallbackMessage))
    return data as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('The server is taking too long to respond. It may be starting up; wait a moment and try again.')
    if (error instanceof TypeError) throw new Error('The website could not reach the API. Check the backend status and VITE_API_URL, then try again.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}
