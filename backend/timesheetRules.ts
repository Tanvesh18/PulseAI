export type TimesheetStatus = 'draft' | 'submitted' | 'returned' | 'resubmitted' | 'approved' | 'rejected'

export function employeeCanEdit(status: TimesheetStatus, cycleClosed = false) { return !cycleClosed && ['draft', 'returned', 'rejected'].includes(status) }
export function employeeCanSubmit(status: TimesheetStatus, cycleClosed = false) { return employeeCanEdit(status, cycleClosed) }
export function managerCanDecide(status: TimesheetStatus) { return ['submitted', 'resubmitted'].includes(status) }
export function managerCanAccess(managerUserId: number, assignedManagerUserId: number | null | undefined) { return Number.isInteger(managerUserId) && managerUserId === assignedManagerUserId }
export function employeeCanUseProject(assignmentActive: boolean, projectActive: boolean, withinAssignmentDates: boolean) { return assignmentActive && projectActive && withinAssignmentDates }
export function validReturnReason(reason: unknown) { const value = String(reason || '').trim(); return value.length > 0 && value.length <= 500 }
export function versionMatches(expectedVersion: unknown, currentVersion: number) { return Number.isInteger(Number(expectedVersion)) && Number(expectedVersion) === currentVersion }
export function isAllowedTransition(from: TimesheetStatus, to: TimesheetStatus) {
  return (from === 'draft' && to === 'submitted') || (from === 'submitted' && (to === 'approved' || to === 'returned')) || (from === 'returned' && to === 'resubmitted') || (from === 'resubmitted' && (to === 'approved' || to === 'returned'))
}
