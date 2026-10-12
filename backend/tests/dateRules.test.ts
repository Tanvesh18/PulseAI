import test from 'node:test'
import assert from 'node:assert/strict'
import { validCalendarDate } from '../dateRules.js'

test('calendar dates reject overflow and accept leap days', () => {
  assert.equal(validCalendarDate('2037-02-31'), false)
  assert.equal(validCalendarDate('2024-02-29'), true)
  assert.equal(validCalendarDate('2025-02-29'), false)
  assert.equal(validCalendarDate('2026-13-01'), false)
  assert.equal(validCalendarDate('2026-01-01'), true)
})
