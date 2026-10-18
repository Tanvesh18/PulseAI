import test from 'node:test'
import assert from 'node:assert/strict'
import { apiDocsAreEnabled } from '../docsPolicy.js'

test('API docs are enabled outside production and opt-in in production', () => {
  assert.equal(apiDocsAreEnabled('development', undefined), true)
  assert.equal(apiDocsAreEnabled('production', 'false'), false)
  assert.equal(apiDocsAreEnabled('production', 'true'), true)
})
