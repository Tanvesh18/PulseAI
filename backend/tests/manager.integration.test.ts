import 'dotenv/config'
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'

const enabled = process.env.RUN_MYSQL_INTEGRATION === 'true'
const backendDir = resolve(import.meta.dirname, '..')

test('Manager and Employee workflow is enforced against MySQL and the HTTP API', { skip: !enabled }, async () => {
  const required = (key: string) => {
    const value = process.env[key]
    if (!value) throw new Error(`Set ${key} in backend/.env to run the MySQL integration test.`)
    return value
  }
  const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: required('DB_USER'), password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'pulseai', dateStrings: true })
  let server: ChildProcess | undefined; let port = 0; let managerId = 0; let outsiderManagerId = 0; let employeeId = 0; let outsiderEmployeeId = 0; let managerEmail = ''; let outsiderManagerEmail = ''; let employeeEmail = ''; let outsiderEmail = ''; let projectId = 0; let outsiderProjectId = 0; let activityId = 0; let sheetId = 0; let concurrentSheetId = 0; let draftSheetId = 0; let outsiderSheetId = 0; let entryId = 0; let employeeUserId = 0; let outsiderEmployeeUserId = 0; let periodId = 0; let periodLabel = ''; let departmentId = 0; let serverOutput = ''
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const password = `Integration-${suffix}-Pass!`
  const token = async (email: string, role: string) => { const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, role }) }); const data = await response.json() as any; assert.equal(response.status, 200, `${email}: ${JSON.stringify(data)}`); return data.token as string }
  const request = async (path: string, authToken: string, method = 'GET', body?: object) => { const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers: { Authorization: `Bearer ${authToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); const raw = await response.text(); let data: any = {}; try { data = raw ? JSON.parse(raw) : {} } catch { data = { raw } }; return { status: response.status, data } }
  const workday = (dateText: string) => { const date = new Date(`${dateText}T00:00:00Z`); while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10) }
  try {
    const [[period]] = await db.query<any[]>('SELECT id, label, DATE_FORMAT(starts_on, \'%Y-%m-%d\') AS startsOn FROM reporting_periods WHERE active = TRUE ORDER BY starts_on DESC LIMIT 1')
    assert.ok(period, 'An active reporting period is required for integration tests; start the backend once with demo seed data enabled.')
    periodId = Number(period.id); periodLabel = period.label
    const [[department]] = await db.query<any[]>('SELECT id FROM departments ORDER BY id LIMIT 1')
    assert.ok(department, 'At least one department must exist in the MySQL database.')
    departmentId = Number(department.id)
    const [portServer] = await new Promise<[ReturnType<typeof createServer>, number]>((resolvePort, reject) => { const listener = createServer(); listener.once('error', reject); listener.listen(0, '127.0.0.1', () => resolvePort([listener, (listener.address() as any).port])) })
    port = (portServer.address() as any).port; await new Promise<void>(resolveClose => portServer.close(() => resolveClose()))

    managerEmail = `manager-${suffix}@pulseai.integration`; outsiderManagerEmail = `outsider-${suffix}@pulseai.integration`; employeeEmail = `employee-${suffix}@pulseai.integration`; outsiderEmail = `other-${suffix}@pulseai.integration`
    const passwordHash = await bcrypt.hash(password, 6)
    const [managerInsert] = await db.query<mysql.ResultSetHeader>('INSERT INTO users (name,email,password_hash,role,auth_provider) VALUES (?,?,?,?,?)', ['Integration Manager', managerEmail, passwordHash, 'manager', 'password']); managerId = managerInsert.insertId
    const [outsiderInsert] = await db.query<mysql.ResultSetHeader>('INSERT INTO users (name,email,password_hash,role,auth_provider) VALUES (?,?,?,?,?)', ['Other Manager', outsiderManagerEmail, passwordHash, 'manager', 'password']); outsiderManagerId = outsiderInsert.insertId
    const [employeeInsert] = await db.query<mysql.ResultSetHeader>('INSERT INTO employees (employee_code,name,email,department_id,manager_name,manager_user_id,active) VALUES (?,?,?,?,?,?,TRUE)', [`IT-${suffix}`, 'Integration Employee', employeeEmail, departmentId, 'Integration Manager', managerId]); employeeId = employeeInsert.insertId
    const [outsiderEmployeeInsert] = await db.query<mysql.ResultSetHeader>('INSERT INTO employees (employee_code,name,email,department_id,manager_name,manager_user_id,active) VALUES (?,?,?,?,?,?,TRUE)', [`IX-${suffix}`, 'Other Team Employee', outsiderEmail, departmentId, 'Other Manager', outsiderManagerId]); outsiderEmployeeId = outsiderEmployeeInsert.insertId
    const [employeeUserInsert] = await db.query<mysql.ResultSetHeader>('INSERT INTO users (name,email,password_hash,role,auth_provider) VALUES (?,?,?,?,?)', ['Integration Employee', employeeEmail, passwordHash, 'employee', 'password']); employeeUserId = employeeUserInsert.insertId
    const [outsiderEmployeeUserInsert] = await db.query<mysql.ResultSetHeader>('INSERT INTO users (name,email,password_hash,role,auth_provider) VALUES (?,?,?,?,?)', ['Other Team Employee', outsiderEmail, passwordHash, 'employee', 'password']); outsiderEmployeeUserId = outsiderEmployeeUserInsert.insertId
    const [projectInsert] = await db.query<mysql.ResultSetHeader>('INSERT INTO projects (code,name,manager_user_id,active) VALUES (?,?,?,TRUE)', [`IT-${suffix}`, 'Integration project', managerId]); projectId = projectInsert.insertId
    const [outsiderProjectInsert] = await db.query<mysql.ResultSetHeader>('INSERT INTO projects (code,name,manager_user_id,active) VALUES (?,?,?,TRUE)', [`IO-${suffix}`, 'Other manager project', outsiderManagerId]); outsiderProjectId = outsiderProjectInsert.insertId
    const [activityInsert] = await db.query<mysql.ResultSetHeader>("INSERT INTO activities (name,category,active) VALUES (?, 'project', TRUE)", [`Integration activity ${suffix}`]); activityId = activityInsert.insertId
    await db.query('INSERT INTO project_activity_assignments (project_id,activity_id,active,created_by_user_id) VALUES (?,?,TRUE,?)', [projectId, activityId, managerId])
    await db.query('INSERT INTO employee_project_assignments (employee_id,project_id,active,starts_on) VALUES (?,?,TRUE,?)', [employeeId, projectId, period.startsOn])
    await db.query('INSERT INTO employee_project_assignments (employee_id,project_id,active,starts_on) VALUES (?,?,TRUE,?)', [outsiderEmployeeId, outsiderProjectId, period.startsOn])
    await db.query('INSERT INTO project_activity_assignments (project_id,activity_id,active,created_by_user_id) VALUES (?,?,TRUE,?)', [outsiderProjectId, activityId, outsiderManagerId])
    const entryDate = workday(period.startsOn)
    const makeTimesheet = async (status: string, hours: number) => {
      const [result] = await db.query<mysql.ResultSetHeader>('INSERT INTO timesheets (employee_id,reporting_period_id,period_label,total_hours,status,submitted_at) VALUES (?,?,?,?,?,NOW())', [employeeId, periodId, periodLabel, hours, status])
      const [entry] = await db.query<mysql.ResultSetHeader>('INSERT INTO timesheet_entries (timesheet_id,entry_date,project_id,activity_id,hours,work_description) VALUES (?,?,?,?,?,?)', [result.insertId, entryDate, projectId, activityId, hours, 'Integration test work'])
      return { timesheetId: result.insertId, entryId: entry.insertId }
    }
    const first = await makeTimesheet('submitted', 8.5); sheetId = first.timesheetId; entryId = first.entryId
    const concurrent = await makeTimesheet('submitted', 7); concurrentSheetId = concurrent.timesheetId
    const [outsiderSheetInsert] = await db.query<mysql.ResultSetHeader>('INSERT INTO timesheets (employee_id,reporting_period_id,period_label,total_hours,status) VALUES (?,?,?,?,?)', [outsiderEmployeeId, periodId, periodLabel, 0, 'draft']); outsiderSheetId = outsiderSheetInsert.insertId
    const [draftInsert] = await db.query<mysql.ResultSetHeader>('INSERT INTO timesheets (employee_id,reporting_period_id,period_label,total_hours,status) VALUES (?,?,?,?,?)', [employeeId, periodId, periodLabel, 0, 'draft']); draftSheetId = draftInsert.insertId

    // Keep this isolated from application/demo seeding: in particular the demo
    // seed assigns every employee to every project, which would mutate unrelated rows.
    server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: backendDir, env: { ...process.env, PORT: String(port), SEED_DEMO_DATA: 'false', MANAGER_DAILY_HOURS_WARNING_THRESHOLD: '8' }, stdio: ['ignore', 'pipe', 'pipe'] })
    server.stdout?.on('data', chunk => { serverOutput += chunk.toString() }); server.stderr?.on('data', chunk => { serverOutput += chunk.toString() })
    let healthy = false
    for (let attempt = 0; attempt < 120; attempt++) { if (server.exitCode !== null) break; try { const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) { healthy = true; break } } catch { /* wait for startup */ } await new Promise(resolveWait => setTimeout(resolveWait, 250)) }
    assert.equal(healthy, true, `Test API failed to start: ${serverOutput}`)

    const managerToken = await token(managerEmail, 'manager'); const outsiderToken = await token(outsiderManagerEmail, 'manager'); const employeeToken = await token(employeeEmail, 'employee'); const outsiderEmployeeToken = await token(outsiderEmail, 'employee')
    const periods = await request('/manager/periods', managerToken); assert.equal(periods.status, 200); assert.ok(periods.data.periods.some((item: any) => item.periodLabel === periodLabel))
    const ownTeam = await request('/manager/team', managerToken); assert.equal(ownTeam.status, 200); assert.ok(ownTeam.data.team.some((item: any) => Number(item.id) === employeeId)); assert.ok(!ownTeam.data.team.some((item: any) => Number(item.id) === outsiderEmployeeId))
    assert.equal((await request(`/manager/team/${outsiderEmployeeId}`, managerToken)).status, 404)
    assert.equal((await request(`/manager/timesheets/${outsiderSheetId}`, managerToken)).status, 404)
    assert.equal((await request(`/manager/timesheets/${outsiderSheetId}/approve`, managerToken, 'POST', { version: 1 })).status, 404)
    const filtered = await request(`/manager/timesheets?status=submitted&employeeId=${employeeId}&period=${encodeURIComponent(periodLabel)}`, managerToken); assert.equal(filtered.status, 200); assert.ok(filtered.data.timesheets.some((item: any) => Number(item.id) === sheetId)); assert.ok(!filtered.data.timesheets.some((item: any) => Number(item.employeeId) === outsiderEmployeeId))
    assert.equal((await request(`/manager/timesheets/${draftSheetId}/approve`, managerToken, 'POST', { version: 1 })).status, 404)
    const periodsWrongTeam = await request('/manager/periods', outsiderToken); assert.equal(periodsWrongTeam.status, 200)

    const projectUpdate = await request(`/manager/projects/${projectId}`, managerToken, 'PATCH', { name: 'Updated integration project', description: 'Editable detail', startsOn: period.startsOn, endsOn: period.startsOn }); assert.equal(projectUpdate.status, 200)
    assert.equal((await request(`/manager/projects/${outsiderProjectId}`, managerToken, 'PATCH', { name: 'Unauthorized' })).status, 404)
    assert.equal((await request(`/manager/projects/${outsiderProjectId}/assignments`, managerToken, 'POST', { employeeId: outsiderEmployeeId })).status, 404)
    assert.equal((await request('/manager/projects', employeeToken, 'POST', { code: `X-${suffix}`, name: 'Employee-created project' })).status, 403)
    const employeeData = await request('/employee/timesheet', employeeToken); assert.equal(employeeData.status, 200); assert.ok(employeeData.data.projects.some((item: any) => Number(item.id) === projectId)); assert.ok(employeeData.data.projectActivities.some((item: any) => Number(item.projectId) === projectId && Number(item.id) === activityId)); assert.ok(!employeeData.data.projects.some((item: any) => Number(item.id) === outsiderProjectId))
    const forbiddenEntry = await request('/employee/timesheet/entries', outsiderEmployeeToken, 'POST', { entryDate, projectId, activityId, hours: 1, workDescription: 'Should be denied' }); assert.equal(forbiddenEntry.status, 403, JSON.stringify(forbiddenEntry.data))

    const review = await request(`/manager/timesheets/${sheetId}`, managerToken); assert.equal(review.status, 200); const version = Number(review.data.timesheet.version)
    assert.equal((await request(`/employee/timesheet/entries/${entryId}`, employeeToken, 'PUT', { entryDate, projectId, activityId, hours: 8, workDescription: 'Must remain locked while submitted' })).status, 409)
    assert.equal((await request(`/manager/timesheets/${sheetId}/entries/${entryId}`, managerToken, 'PUT', { hours: 2 })).status, 404)
    const returnWithoutReason = await request(`/manager/timesheets/${sheetId}/return`, managerToken, 'POST', { version, reason: '   ' }); assert.equal(returnWithoutReason.status, 400)
    const returned = await request(`/manager/timesheets/${sheetId}/return`, managerToken, 'POST', { version, reason: 'Please clarify this daily project entry.', entryId, entryComment: 'Confirm the selected client project for this work.' }); assert.equal(returned.status, 200)
    const returnedEmployeeData = await request('/employee/timesheet', employeeToken); assert.equal(returnedEmployeeData.data.timesheet.status, 'returned'); assert.equal(returnedEmployeeData.data.entries.find((item: any) => Number(item.id) === entryId)?.managerComment, 'Confirm the selected client project for this work.')
    const edit = await request(`/employee/timesheet/entries/${entryId}`, employeeToken, 'PUT', { entryDate, projectId, activityId, hours: 7.5, workDescription: 'Corrected integration test work' }); assert.equal(edit.status, 200)
    const resubmitted = await request('/employee/timesheet/submit-daily', employeeToken, 'POST'); assert.equal(resubmitted.status, 200)
    const reviewAgain = await request(`/manager/timesheets/${sheetId}`, managerToken); assert.equal(reviewAgain.data.timesheet.status, 'resubmitted')
    const approved = await request(`/manager/timesheets/${sheetId}/approve`, managerToken, 'POST', { version: Number(reviewAgain.data.timesheet.version) }); assert.equal(approved.status, 200)
    const lockedEdit = await request(`/employee/timesheet/entries/${entryId}`, employeeToken, 'PUT', { entryDate, projectId, activityId, hours: 6, workDescription: 'Should stay locked' }); assert.equal(lockedEdit.status, 409)
    const [approvedRows] = await db.query<any[]>('SELECT status, reviewer_user_id, approved_at FROM timesheets WHERE id = ?', [sheetId]); assert.equal(approvedRows[0].status, 'approved'); assert.equal(Number(approvedRows[0].reviewer_user_id), managerId); assert.ok(approvedRows[0].approved_at)
    const [auditRows] = await db.query<any[]>('SELECT event_type, detail FROM timesheet_audit_events WHERE timesheet_id = ? ORDER BY id', [sheetId]); assert.deepEqual(auditRows.map(row => row.event_type), ['returned', 'entry_updated', 'resubmitted', 'approved']); assert.match(auditRows[0].detail, /Confirm the selected client project/)
    assert.equal((await request(`/manager/timesheets/${sheetId}/return`, managerToken, 'POST', { version: Number(reviewAgain.data.timesheet.version), reason: 'Second decision' })).status, 404)
    const exceptions = await request('/manager/exceptions', managerToken); assert.equal(exceptions.status, 200); assert.equal(Number(exceptions.data.dailyHoursWarningThreshold), 8)

    const [notifications] = await db.query<any[]>('SELECT title FROM notifications WHERE recipient_email = ? AND timesheet_id = ?', [outsiderEmail, sheetId]); assert.equal(notifications.length, 0)
    const [employeeNotices] = await db.query<any[]>('SELECT title FROM notifications WHERE recipient_email = ? AND timesheet_id = ?', [employeeEmail, sheetId]); assert.ok(employeeNotices.some(row => row.title === 'Timesheet returned')); assert.ok(employeeNotices.some(row => row.title === 'Timesheet approved'))

    const concurrentReview = await request(`/manager/timesheets/${concurrentSheetId}`, managerToken); const concurrentVersion = Number(concurrentReview.data.timesheet.version)
    const decisions = await Promise.all([request(`/manager/timesheets/${concurrentSheetId}/approve`, managerToken, 'POST', { version: concurrentVersion }), request(`/manager/timesheets/${concurrentSheetId}/return`, managerToken, 'POST', { version: concurrentVersion, reason: 'Review in parallel.' })])
    assert.deepEqual(decisions.map(item => item.status).sort(), [200, 409])
  } finally {
    if (server && server.exitCode === null) { server.kill(); await new Promise<void>(resolveExit => { const timer = setTimeout(resolveExit, 3000); server?.once('exit', () => { clearTimeout(timer); resolveExit() }) }) }
    if (departmentId) {
      const userIds = [managerId, outsiderManagerId, employeeUserId, outsiderEmployeeUserId].filter(Boolean); const employeeIds = [employeeId, outsiderEmployeeId].filter(Boolean); const projectIds = [projectId, outsiderProjectId].filter(Boolean); const knownTimesheetIds = [sheetId, concurrentSheetId, draftSheetId, outsiderSheetId].filter(Boolean)
      const employeeMarks = employeeIds.map(() => '?').join(','); const [fixtureTimesheets] = employeeIds.length ? await db.query<any[]>(`SELECT id FROM timesheets WHERE employee_id IN (${employeeMarks})`, employeeIds) : [[]]
      const timesheetIds = [...new Set([...knownTimesheetIds, ...fixtureTimesheets.map((row: any) => Number(row.id))])]
      await db.query('DELETE FROM notifications WHERE recipient_email IN (?,?,?,?)', [managerEmail, outsiderManagerEmail, outsiderEmail, employeeEmail]).catch(() => undefined)
      if (timesheetIds.length) { const marks = timesheetIds.map(() => '?').join(','); await db.query(`DELETE FROM timesheet_audit_events WHERE timesheet_id IN (${marks})`, timesheetIds); await db.query(`DELETE FROM validation_findings WHERE timesheet_id IN (${marks})`, timesheetIds); await db.query(`DELETE FROM timesheet_entries WHERE timesheet_id IN (${marks})`, timesheetIds); await db.query(`DELETE FROM timesheets WHERE id IN (${marks})`, timesheetIds) }
      if (projectIds.length) { const marks = projectIds.map(() => '?').join(','); await db.query(`DELETE FROM employee_project_assignments WHERE project_id IN (${marks})`, projectIds) }
      if (projectIds.length) { const marks = projectIds.map(() => '?').join(','); await db.query(`DELETE FROM project_activity_assignments WHERE project_id IN (${marks})`, projectIds); await db.query(`DELETE FROM projects WHERE id IN (${marks})`, projectIds) }
      if (activityId) await db.query('DELETE FROM activities WHERE id = ?', [activityId])
      if (employeeIds.length) { const marks = employeeIds.map(() => '?').join(','); await db.query(`DELETE FROM employees WHERE id IN (${marks})`, employeeIds) }
      if (userIds.length) { const marks = userIds.map(() => '?').join(','); await db.query(`DELETE FROM users WHERE id IN (${marks})`, userIds) }
    }
    await db.end()
  }
})
