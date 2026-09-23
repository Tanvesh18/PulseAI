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