const configuredApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, '')

export const apiUrl = (path: string) => `${configuredApiUrl || ''}/api${path}`