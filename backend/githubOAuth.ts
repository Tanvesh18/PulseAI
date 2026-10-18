export async function verifiedPrimaryGithubEmail(
  fetchEmails: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
) {
  const response = await fetchEmails('https://api.github.com/user/emails')
  if (!response.ok) return ''
  const emails = await response.json() as Array<{ email?: unknown; primary?: unknown; verified?: unknown }>
  const primary = emails.find((item) => item.primary === true && item.verified === true && typeof item.email === 'string')
  return primary ? String(primary.email).trim().toLowerCase() : ''
}
