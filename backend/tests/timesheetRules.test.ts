import test from 'node:test'
import assert from 'node:assert/strict'
import { employeeCanEdit, employeeCanSubmit, employeeCanUseProject, isAllowedTransition, managerCanAccess, managerCanDecide, managerApprovalIntegrityValid, missingWorkdayCutoff, validEntryHours, validReturnReason, versionMatches } from '../timesheetRules.js'

test('Manager access is limited to the assigned team', () => {
  assert.equal(managerCanAccess(7, 7), true)
  assert.equal(managerCanAccess(7, 8), false)
  assert.equal(managerCanAccess(7, null), false)
})

test('only submitted and resubmitted timesheets can be reviewed', () => {
  assert.equal(managerCanDecide('submitted'), true)
  assert.equal(managerCanDecide('resubmitted'), true)
  assert.equal(managerCanDecide('draft'), false)
  assert.equal(managerCanDecide('approved'), false)
  assert.equal(managerCanDecide('returned'), false)
})

test('workflow transitions preserve approval safety', () => {
  assert.equal(isAllowedTransition('submitted', 'approved'), true)
  assert.equal(isAllowedTransition('submitted', 'returned'), true)
  assert.equal(isAllowedTransition('returned', 'resubmitted'), true)
  assert.equal(isAllowedTransition('resubmitted', 'approved'), true)
  assert.equal(isAllowedTransition('resubmitted', 'returned'), true)
  assert.equal(isAllowedTransition('approved', 'returned'), false)
  assert.equal(isAllowedTransition('draft', 'approved'), false)
  assert.equal(isAllowedTransition('approved', 'approved'), false)
})

test('approved or cycle-closed timesheets cannot be edited or submitted', () => {
  assert.equal(employeeCanEdit('draft'), true)
  assert.equal(employeeCanEdit('returned'), true)
  assert.equal(employeeCanEdit('approved'), false)
  assert.equal(employeeCanEdit('draft', true), false)
  assert.equal(employeeCanSubmit('resubmitted'), false)
})

test('employees can only use active current project assignments', () => {
  assert.equal(employeeCanUseProject(true, true, true), true)
  assert.equal(employeeCanUseProject(false, true, true), false)
  assert.equal(employeeCanUseProject(true, false, true), false)
  assert.equal(employeeCanUseProject(true, true, false), false)
})

test('returning a timesheet requires a bounded reason', () => {
  assert.equal(validReturnReason(''), false)
  assert.equal(validReturnReason('   '), false)
  assert.equal(validReturnReason("Friday's project is incorrect. Please correct it."), true)
  assert.equal(validReturnReason('x'.repeat(501)), false)
})

test('a stale decision version is rejected to prevent concurrent review overwrites', () => {
  assert.equal(versionMatches(4, 4), true)
  assert.equal(versionMatches(3, 4), false)
  assert.equal(versionMatches('not-a-version', 4), false)
})

test('Manager approval requires entries, matching hours, and no unresolved critical findings', () => {
  assert.equal(managerApprovalIntegrityValid(8, 1, 8, 0), true)
  assert.equal(managerApprovalIntegrityValid(8, 0, 0, 0), false)
  assert.equal(managerApprovalIntegrityValid(8, 1, 7.5, 0), false)
  assert.equal(managerApprovalIntegrityValid(8, 1, 8, 1), false)
  assert.equal(managerApprovalIntegrityValid(undefined, 1, 8, 0), false)
})

test('Employee entry hours use quarter-hour steps within one day', () => {
  for (const hours of [0.25, 0.5, 6.5, 24]) assert.equal(validEntryHours(hours), true)
  for (const hours of [0, -1, 0.001, 0.1, 24.25, Infinity, NaN]) assert.equal(validEntryHours(hours), false)
})

test('missing workdays stop at today, period end, or an earlier requested date', () => {
  assert.equal(missingWorkdayCutoff('2026-10-31', '2026-10-12'), '2026-10-12')
  assert.equal(missingWorkdayCutoff('2026-09-30', '2026-10-12'), '2026-09-30')
  assert.equal(missingWorkdayCutoff('2026-10-31', '2026-10-12', '2026-10-09'), '2026-10-09')
})
