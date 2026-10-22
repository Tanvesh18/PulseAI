import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateLineAmount, csvCell, financeCanProcessTimesheet, financeEntryCanBeInvoiced, invoiceTransitionAllowed, validCurrency, validRateDate } from '../financeRules.js'

test('Finance accepts only Manager-approved timesheets', () => {
  for (const status of ['draft', 'submitted', 'returned', 'resubmitted']) assert.equal(financeCanProcessTimesheet(status), false)
  assert.equal(financeCanProcessTimesheet('approved'), true)
})

test('only approved, classified, configured, unlinked billable work can be invoiced', () => {
  const eligible = { timesheetStatus: 'approved', billable: true, hasClient: true, hasRate: true, alreadyLinked: false }
  assert.equal(financeEntryCanBeInvoiced(eligible), true)
  for (const patch of [{ timesheetStatus: 'submitted' }, { billable: false }, { billable: null }, { hasClient: false }, { hasRate: false }, { alreadyLinked: true }]) {
    assert.equal(financeEntryCanBeInvoiced({ ...eligible, ...patch }), false)
  }
})

test('invoice lifecycle rejects invalid or duplicate transitions', () => {
  assert.equal(invoiceTransitionAllowed('draft', 'ready'), true)
  assert.equal(invoiceTransitionAllowed('ready', 'finalized'), true)
  assert.equal(invoiceTransitionAllowed('draft', 'finalized'), false)
  assert.equal(invoiceTransitionAllowed('finalized', 'finalized'), false)
  assert.equal(invoiceTransitionAllowed('ready', 'draft'), true)
})

test('invoice snapshots use rounded amounts independent of future rates', () => {
  assert.equal(calculateLineAmount(3.25, 125.5), 407.88)
  const historicalSnapshot = { hours: 3.25, rate: 125.5, amount: calculateLineAmount(3.25, 125.5) }
  assert.equal(historicalSnapshot.amount, 407.88)
})

test('currency and CSV output are validated and safe for spreadsheet software', () => {
  assert.equal(validCurrency('USD'), true)
  assert.equal(validCurrency('usd'), false)
  assert.equal(validCurrency('US'), false)
  assert.equal(csvCell('=HYPERLINK("https://bad")'), `"'=HYPERLINK(""https://bad"")"`)
  assert.equal(csvCell('Arjun "A"'), `"Arjun ""A"""`)
})

test('rate dates reject malformed and overflow values before database writes', () => {
  assert.equal(validRateDate('2026-02-28'), true)
  assert.equal(validRateDate('2024-02-29'), true)
  assert.equal(validRateDate('2025-02-29'), false)
  assert.equal(validRateDate('2026-04-31'), false)
  assert.equal(validRateDate('2026-1-01'), false)
  assert.equal(validRateDate('not-a-date'), false)
  assert.equal(validRateDate(null), false)
})
