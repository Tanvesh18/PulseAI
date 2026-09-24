type Shape = Record<string, string>

type OperationOptions = {
  body?: Shape
  required?: string[]
  query?: Shape
  response?: Shape
  status?: number
  description?: string
  deprecated?: boolean
  redirect?: boolean
}

const roleTags: Record<string, string> = {
  auth: 'Authentication', employee: 'Employee', manager: 'Manager', hr: 'HR',
  finance: 'Finance', director: 'Director',
}

function fieldSchema(kind: string): Record<string, unknown> {
  if (kind.startsWith('enum:')) return { type: 'string', enum: kind.slice(5).split('|') }
  if (kind.startsWith('array:')) return { type: 'array', items: fieldSchema(kind.slice(6)) }
  if (kind.startsWith('nullable:')) return { ...fieldSchema(kind.slice(9)), nullable: true }
  if (kind === 'object') return { type: 'object', additionalProperties: true }
  if (kind === 'date') return { type: 'string', format: 'date' }
  if (kind === 'email') return { type: 'string', format: 'email' }
  if (kind === 'id') return { type: 'integer', minimum: 1 }
  if (kind === 'integer') return { type: 'integer' }
  if (kind === 'number') return { type: 'number' }
  if (kind === 'boolean') return { type: 'boolean' }
  return { type: 'string' }
}

function objectSchema(shape: Shape, required: string[] = []) {
  return {
    type: 'object',
    properties: Object.fromEntries(Object.entries(shape).map(([name, kind]) => [name, fieldSchema(kind)])),
    ...(required.length ? { required } : {}),
  }
}

const paths: Record<string, Record<string, unknown>> = {}

function add(method: string, path: string, summary: string, options: OperationOptions = {}) {
  const role = path.split('/')[2] || ''
  const protectedRoute = role !== 'auth' && path !== '/api/health'
  const successStatus = String(options.status ?? 200)
  const params = [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
    name: match[1], in: 'path', required: true, schema: fieldSchema('id'),
  }))
  const query = Object.entries(options.query || {}).map(([name, kind]) => ({
    name, in: 'query', required: false, schema: fieldSchema(kind),
  }))
  const operation: Record<string, unknown> = {
    tags: [roleTags[role] || 'General'], summary,
    operationId: `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
    ...(options.description ? { description: options.description } : {}),
    ...(options.deprecated ? { deprecated: true } : {}),
    ...(protectedRoute ? { security: [{ bearerAuth: [] }] } : {}),
    ...(params.length || query.length ? { parameters: [...params, ...query] } : {}),
    ...(options.body ? { requestBody: {
      required: true,
      content: { 'application/json': { schema: objectSchema(options.body, options.required) } },
    } } : {}),
    responses: {
      [successStatus]: options.redirect ? { description: 'Redirect to the OAuth provider or frontend.' } : options.status === 410 ? {
        description: 'This legacy endpoint has been removed.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      } : {
        description: 'Successful response.',
        content: { 'application/json': { schema: objectSchema(options.response || { message: 'string' }) } },
      },
      ...(protectedRoute ? {
        '401': { description: 'Missing, invalid, or expired bearer token.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '403': { description: 'The authenticated account does not have this role.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      } : {}),
      default: { description: 'Error response (typically 400, 404, 409, 429, or 500).', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    },
  }
  ;(paths[path] ||= {})[method] = operation
}

const notificationResponse = { message: 'string' }
const entryBody = { entryDate: 'date', projectId: 'nullable:id', activityId: 'id', hours: 'number', workDescription: 'string' }
const projectBody = { code: 'string', name: 'string', description: 'string', startsOn: 'date', endsOn: 'date' }
const role = 'enum:employee|manager|hr|finance|director'

add('get', '/api/health', 'Health check', { response: { ok: 'boolean', service: 'string' } })

add('post', '/api/auth/register', 'Register an employee already on the active roster', {
  body: { name: 'string', email: 'email', password: 'string', role }, required: ['name', 'email', 'password', 'role'], status: 201,
  response: { token: 'string', user: 'object' },
  description: 'Self registration is limited to the employee role and an email already in the active HR roster. Password must be at least eight characters.',
})
add('post', '/api/auth/login', 'Sign in with email and password', {
  body: { email: 'email', password: 'string', role }, required: ['email', 'password'], response: { token: 'string', user: 'object' },
  description: 'role is optional; when provided it must match the account role. Use the returned token in Authorization: Bearer <token>.',
})
add('post', '/api/auth/google', 'Sign in with a Google ID token', {
  body: { credential: 'string', role }, required: ['credential', 'role'], response: { token: 'string', user: 'object' },
  description: 'Requires GOOGLE_CLIENT_ID and a previously approved account.',
})
add('get', '/api/auth/github', 'Begin GitHub OAuth sign in', {
  query: { role }, status: 302, redirect: true,
  description: 'Opens the GitHub OAuth flow. Requires configured GitHub OAuth credentials. Use a browser, not Swagger Try it out.',
})
add('get', '/api/auth/github/callback', 'GitHub OAuth callback', {
  query: { code: 'string', state: 'string' }, status: 302, redirect: true,
  description: 'The GitHub OAuth app redirects here. The backend then redirects to CLIENT_ORIGIN with the application session in the URL fragment.',
})

add('get', '/api/employee/dashboard', 'Get employee dashboard', { response: { employee: 'object', period: 'string', standardHours: 'number', timesheet: 'nullable:object', history: 'array:object', notifications: 'array:object' } })
add('get', '/api/employee/timesheet', 'Get active timesheet and entry options', { response: { employee: 'object', period: 'object', billingCycle: 'nullable:object', timesheet: 'nullable:object', entries: 'array:object', projects: 'array:object', activities: 'array:object', projectActivities: 'array:object', holidays: 'array:object', leave: 'array:object', audit: 'array:object', notifications: 'array:object', history: 'array:object' } })
add('post', '/api/employee/timesheet/entries', 'Add a daily work entry', { body: entryBody, required: ['entryDate', 'activityId', 'hours'], status: 201, description: 'Entry date must be a weekday in the active period. Project activities require an assigned project; internal activities do not use projectId. Hours must be > 0 and <= 24.' })
add('put', '/api/employee/timesheet/entries/{id}', 'Update a daily work entry', { body: entryBody, required: ['entryDate', 'activityId', 'hours'] })
add('delete', '/api/employee/timesheet/entries/{id}', 'Delete a daily work entry')
add('post', '/api/employee/timesheet/submit-daily', 'Submit the active timesheet', { response: { message: 'string', warnings: 'array:date' }, description: 'Requires at least one entry. Warnings contain missing workday dates.' })
add('post', '/api/employee/notifications/{id}/read', 'Mark employee notification as read', { response: notificationResponse })
add('post', '/api/employee/timesheet/draft', 'Legacy draft action', { status: 410, deprecated: true, description: 'Removed. Use daily entry endpoints.' })
add('post', '/api/employee/timesheet/submit', 'Legacy submit action', { status: 410, deprecated: true, description: 'Removed. Use submit-daily.' })

add('get', '/api/manager/dashboard', 'Get manager dashboard', { response: { period: 'object', metrics: 'object', attention: 'array:object' } })
add('get', '/api/manager/team', 'List assigned employees', { response: { period: 'object', team: 'array:object' } })
add('get', '/api/manager/team/{id}', 'Get assigned employee detail', { response: { employee: 'object', period: 'object', assignments: 'array:object', timesheets: 'array:object', findings: 'array:object' } })
add('get', '/api/manager/periods', 'List reporting periods', { response: { periods: 'array:object' } })
add('get', '/api/manager/projects', 'List managed projects', { response: { projects: 'array:object' } })
add('post', '/api/manager/projects', 'Create a managed project', { body: projectBody, required: ['code', 'name'], status: 201, response: { id: 'id', message: 'string' } })
add('patch', '/api/manager/projects/{id}', 'Update a managed project', { body: { name: 'string', description: 'string', active: 'boolean', startsOn: 'date', endsOn: 'date' } })
add('get', '/api/manager/projects/{id}/activities', 'List project activities', { response: { activities: 'array:object' } })
add('post', '/api/manager/projects/{id}/activities', 'Add a project activity', { body: { name: 'string' }, required: ['name'], status: 201, response: { message: 'string', activityId: 'id' } })
add('patch', '/api/manager/projects/{projectId}/activities/{activityId}', 'Activate or deactivate project activity', { body: { active: 'boolean' }, required: ['active'] })
add('get', '/api/manager/projects/{id}/assignments', 'List project employee assignments', { response: { assignments: 'array:object' } })
add('post', '/api/manager/projects/{id}/assignments', 'Assign an employee to a project', { body: { employeeId: 'id', startsOn: 'date', endsOn: 'date' }, required: ['employeeId'], status: 201 })
add('patch', '/api/manager/projects/{projectId}/assignments/{employeeId}', 'Activate or end project assignment', { body: { active: 'boolean' }, required: ['active'] })
add('get', '/api/manager/timesheets', 'List timesheets awaiting review', { query: { status: 'enum:all|submitted|resubmitted', employeeId: 'id', period: 'string' }, response: { timesheets: 'array:object' } })
add('get', '/api/manager/timesheets/{id}', 'Get team timesheet for review', { response: { timesheet: 'object', entries: 'array:object', findings: 'array:object', history: 'array:object' } })
add('post', '/api/manager/timesheets/{id}/approve', 'Approve a submitted timesheet', { body: { version: 'integer' }, required: ['version'], description: 'version must match the current timesheet version to prevent a stale decision.' })
add('post', '/api/manager/timesheets/{id}/return', 'Return a timesheet for correction', { body: { version: 'integer', reason: 'string', entryId: 'id', entryComment: 'string' }, required: ['version', 'reason'], description: 'A return reason is required. entryId and entryComment may identify one entry for a focused comment.' })
add('get', '/api/manager/exceptions', 'Get team exceptions', { response: { period: 'object', dailyHoursWarningThreshold: 'nullable:number', exceptions: 'array:object' } })
add('get', '/api/manager/history', 'Get manager decision history', { response: { history: 'array:object' } })
add('get', '/api/manager/notifications', 'Get manager notifications', { response: { notifications: 'array:object' } })
add('post', '/api/manager/notifications/{id}/read', 'Mark manager notification as read')
add('get', '/api/manager/department-submission', 'Get department submission status', { response: { department: 'nullable:object', period: 'string', eligible: 'boolean', teamTotal: 'integer', teamApproved: 'integer', submission: 'nullable:object' } })
add('post', '/api/manager/department-submission', 'Submit department for director approval', { description: 'Every active employee in the department must have a Manager approved timesheet.' })

add('get', '/api/hr/overview', 'Get HR roster and calendar overview', { response: { summary: 'object', employees: 'array:object', departments: 'array:object', managers: 'array:object', leaves: 'array:object', holidays: 'array:object', reportingPeriods: 'array:object' } })
add('post', '/api/hr/departments', 'Create a department', { body: { code: 'string', name: 'string' }, required: ['code', 'name'], status: 201, response: { departmentId: 'id', message: 'string' } })
add('post', '/api/hr/manager-accounts', 'Provision a manager account', { body: { name: 'string', email: 'email', password: 'string' }, required: ['name', 'email', 'password'], status: 201, response: { userId: 'id', message: 'string' } })
add('post', '/api/hr/reporting-periods', 'Open a reporting period', { body: { label: 'string', startsOn: 'date', endsOn: 'date', submissionDeadline: 'date', standardDailyHours: 'number' }, required: ['label', 'startsOn', 'endsOn', 'submissionDeadline'], status: 201, response: { reportingPeriodId: 'id', message: 'string' } })
add('post', '/api/hr/employees', 'Add an employee to the workforce roster', { body: { employeeCode: 'string', name: 'string', email: 'email', region: 'string', departmentId: 'id', managerUserId: 'id' }, required: ['employeeCode', 'name', 'email', 'departmentId', 'managerUserId'], status: 201, response: { employeeId: 'id', message: 'string' } })
add('patch', '/api/hr/employees/{id}', 'Update employee roster assignment and status', { body: { departmentId: 'id', managerUserId: 'id', region: 'string', active: 'boolean', reassignPendingReviews: 'boolean' }, response: { message: 'string', pendingReviewsReassigned: 'integer' }, description: 'Pending reviews stay assigned to their original Manager unless reassignPendingReviews is true.' })
add('post', '/api/hr/leave', 'Record approved leave', { body: { employeeId: 'id', startsOn: 'date', endsOn: 'date', leaveType: 'string', sourceReference: 'string' }, required: ['employeeId', 'startsOn', 'endsOn', 'leaveType'], status: 201, response: { leaveId: 'id', message: 'string' } })
add('patch', '/api/hr/leave/{id}', 'Approve or cancel leave', { body: { status: 'enum:approved|cancelled' }, required: ['status'] })
add('post', '/api/hr/holidays', 'Add a public holiday', { body: { holidayDate: 'date', name: 'string', region: 'string' }, required: ['holidayDate', 'name'], status: 201, response: { holidayId: 'id', message: 'string' } })
add('patch', '/api/hr/holidays/{id}', 'Activate or deactivate a public holiday', { body: { active: 'boolean' }, required: ['active'] })

add('get', '/api/finance/dashboard', 'Get finance dashboard', { response: { period: 'nullable:string', metrics: 'object', exceptions: 'array:object', notifications: 'array:object' } })
add('get', '/api/finance/periods', 'List finance reporting periods', { response: { periods: 'array:object' } })
add('get', '/api/finance/options', 'List finance employee filter options', { response: { employees: 'array:object' } })
add('get', '/api/finance/entries', 'List approved work entries', { query: { period: 'string', billingStatus: 'enum:all|unbilled|draft|ready|finalized', billable: 'enum:all|billable|nonbillable|unclassified', projectId: 'id', employeeId: 'id', clientId: 'id' }, response: { entries: 'array:object' } })
add('get', '/api/finance/clients', 'List clients', { response: { clients: 'array:object' } })
add('post', '/api/finance/clients', 'Create a client', { body: { code: 'string', name: 'string', currency: 'string', billingEmail: 'email' }, required: ['code', 'name', 'currency'], status: 201, response: { clientId: 'id', message: 'string' } })
add('patch', '/api/finance/clients/{id}', 'Update client billing profile', { body: { name: 'string', currency: 'string', billingEmail: 'email', active: 'boolean' } })
add('get', '/api/finance/projects', 'List projects with finance totals', { response: { projects: 'array:object' } })
add('get', '/api/finance/projects/{id}', 'Get project billing setup', { response: { project: 'object', activities: 'array:object', rates: 'array:object' } })
add('patch', '/api/finance/projects/{id}/client', 'Link a project to a client', { body: { clientId: 'nullable:id' }, required: ['clientId'] })
add('patch', '/api/finance/projects/{projectId}/activities/{activityId}', 'Classify project activity for billing', { body: { billable: 'nullable:boolean' }, required: ['billable'], description: 'true = billable; false = non billable; null = unclassified.' })
add('post', '/api/finance/projects/{id}/rates', 'Create an effective dated billing rate', { body: { amount: 'number', currency: 'string', effectiveFrom: 'date', effectiveTo: 'date' }, required: ['amount', 'currency', 'effectiveFrom'], status: 201, response: { rateId: 'id', message: 'string' } })
add('patch', '/api/finance/rates/{id}/active', 'Activate or end a billing rate', { body: { active: 'boolean' }, required: ['active'] })
add('get', '/api/finance/exceptions', 'Get billing exceptions', { response: { exceptions: 'array:object' } })
add('get', '/api/finance/invoices', 'List invoices', { query: { status: 'enum:draft|ready|finalized|cancelled', period: 'string', clientId: 'id' }, response: { invoices: 'array:object' } })
add('get', '/api/finance/invoices/{id}', 'Get invoice and line items', { response: { invoice: 'object', lines: 'array:object' } })
add('post', '/api/finance/invoices', 'Create draft invoice from approved entries', { body: { entryIds: 'array:id' }, required: ['entryIds'], status: 201, response: { invoiceId: 'id', message: 'string' }, description: 'Provide 1 to 250 approved entry IDs for one client, currency, and reporting period.' })
add('post', '/api/finance/invoices/{id}/ready', 'Mark a draft invoice ready')
add('post', '/api/finance/invoices/{id}/finalize', 'Finalize a ready invoice')
add('delete', '/api/finance/invoices/{id}', 'Cancel a draft invoice', { description: 'Only draft invoices can be cancelled; this releases their source entries.' })
add('get', '/api/finance/audit', 'Get finance audit events', { response: { events: 'array:object' } })
add('get', '/api/finance/notifications', 'Get finance notifications', { response: { notifications: 'array:object' } })
add('post', '/api/finance/notifications/{id}/read', 'Mark finance notification as read')
add('get', '/api/finance/exports/{kind}', 'Download finance CSV export', {
  query: { period: 'string', status: 'enum:draft|ready|finalized|cancelled' },
  description: 'kind is approved-work, unbilled-work, invoice-lines, invoices, or project-summary. Returns text/csv rather than JSON.',
  response: {},
})

add('get', '/api/director/dashboard', 'Get organization dashboard', { response: { period: 'string', billingCycle: 'nullable:object', metrics: 'object', departments: 'array:object', exceptions: 'array:object', notifications: 'array:object', unreadNotificationCount: 'integer' } })
add('get', '/api/director/exceptions', 'Get organization exceptions', { response: { exceptions: 'array:object' } })
add('get', '/api/director/reports', 'Get department report', { response: { period: 'string', departments: 'array:object' } })
add('get', '/api/director/financial-report', 'Get finalized invoice and hour totals', { response: { period: 'nullable:string', invoices: 'array:object', hours: 'array:object' } })
add('get', '/api/director/departments/{id}', 'Get department drilldown', { response: { period: 'string', department: 'object', employees: 'array:object' } })
add('get', '/api/director/approvals', 'List department submissions', { response: { period: 'string', submissions: 'array:object' } })
add('get', '/api/director/approvals/{id}', 'Get department submission', { response: { submission: 'object', employees: 'array:object' } })
add('post', '/api/director/approvals/{id}/approve', 'Approve department submission')
add('post', '/api/director/approvals/{id}/return', 'Return department submission', { body: { reason: 'string' }, required: ['reason'], description: 'Reason must contain at least three characters.' })
add('get', '/api/director/audit-events', 'Search organization audit events', { query: { search: 'string', role, entity: 'string', page: 'integer', pageSize: 'integer' }, response: { events: 'array:object', pagination: 'object' }, description: 'Results are paginated. The server bounds pageSize and supports search, role, and entity filters.' })

// The CSV endpoint has a non-JSON success response.
const exportOperation = paths['/api/finance/exports/{kind}']!.get as Record<string, unknown>
;(exportOperation.responses as Record<string, unknown>)['200'] = {
  description: 'CSV download.', content: { 'text/csv': { schema: { type: 'string' } } },
}
;(exportOperation.parameters as Array<Record<string, unknown>>)[0]!.schema = {
  type: 'string', enum: ['approved-work', 'unbilled-work', 'invoice-lines', 'invoices', 'project-summary'],
}

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'PulseAI API', version: '1.0.0',
    description: 'HTTP API for PulseAI timesheets, workforce, approvals, billing, and audit. Most routes require a role-specific JWT. Sign in, copy the token, and use Authorize to send it as a bearer token. Data-changing actions in Try it out affect the connected database.',
  },
  servers: [{ url: '/', description: 'Same origin as this documentation' }],
  tags: ['Authentication', 'Employee', 'Manager', 'HR', 'Finance', 'Director', 'General'].map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: { Error: objectSchema({ message: 'string' }, ['message']) },
  },
}
