import test from 'node:test'
import assert from 'node:assert/strict'
import { employeeCanEdit, employeeCanSubmit, employeeCanUseProject, isAllowedTransition, managerCanAccess, managerCanDecide, validReturnReason, versionMatches } from '../timesheetRules.js'

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
