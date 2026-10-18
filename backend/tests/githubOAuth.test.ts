import test from 'node:test'
import assert from 'node:assert/strict'
import { verifiedPrimaryGithubEmail } from '../githubOAuth.js'

test('GitHub identity uses a verified primary address even when the profile supplies another email', async () => {
  const urlCalls: string[] = []
  const email = await verifiedPrimaryGithubEmail(async (url) => {
    urlCalls.push(url)
    return { ok: true, json: async () => [
      { email: 'profile@example.com', primary: false, verified: true },
      { email: 'primary@example.com', primary: true, verified: true },
    ] }
  })
  assert.equal(email, 'primary@example.com')
  assert.deepEqual(urlCalls, ['https://api.github.com/user/emails'])
})

test('GitHub identity rejects an unverified primary address', async () => {
  const email = await verifiedPrimaryGithubEmail(async () => ({ ok: true, json: async () => [
    { email: 'primary@example.com', primary: true, verified: false },
    { email: 'verified-secondary@example.com', primary: false, verified: true },
  ] }))
  assert.equal(email, '')
})
