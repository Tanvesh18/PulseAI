import 'dotenv/config'
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import { createTestPeriod } from './testPeriod.js'

const enabled = process.env.RUN_MYSQL_INTEGRATION === 'true'
const backendDir = resolve(import.meta.dirname, '..')

test('Employee daily timesheet boundary and state workflow against HTTP and MySQL', { skip: !enabled }, async () => {
  const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'pulseai', dateStrings: true })
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`
  const password = `Employee-${suffix}-Pass!`
  const managerEmail = `employee-manager-${suffix}@pulseai.integration`
  const employeeEmail = `employee-check-${suffix}@pulseai.integration`
  let server: ChildProcess | undefined; let port = 0; let periodId = 0; let managerId = 0; let employeeUserId = 0; let employeeId = 0; let activityId = 0; let secondActivityId = 0; let thirdActivityId = 0; let timesheetId = 0; let output = ''
  const request = async (path: string, token = '', method = 'GET', body?: object, signal?: AbortSignal) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, signal, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, data: await response.json() as any }
  }
  const login = async (email: string, role: string) => { const response = await request('/auth/login', '', 'POST', { email, password, role }); assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data.token as string }
  const state = async () => {
    const [[row]] = await db.query<any[]>('SELECT t.status,t.total_hours AS totalHours,t.version,COUNT(e.id) AS entryCount,COALESCE(SUM(e.hours),0) AS entryHours FROM timesheets t LEFT JOIN timesheet_entries e ON e.timesheet_id=t.id WHERE t.id=? GROUP BY t.id', [timesheetId])
    return row && { status: row.status as string, total: Number(row.totalHours), entries: Number(row.entryCount), sum: Number(row.entryHours), version: Number(row.version) }
  }
  try {
    const period = await createTestPeriod(db, suffix); periodId = period.id
    const [[department]] = await db.query<any[]>('SELECT id FROM departments ORDER BY id LIMIT 1'); assert.ok(department)
    const hash = await bcrypt.hash(password, 6)
    const [manager] = await db.query<mysql.ResultSetHeader>('INSERT INTO users (name,email,password_hash,role,auth_provider) VALUES (?,?,?,?,?)', ['Employee test manager',managerEmail,hash,'manager','password']); managerId = manager.insertId
    const [user] = await db.query<mysql.ResultSetHeader>('INSERT INTO users (name,email,password_hash,role,auth_provider) VALUES (?,?,?,?,?)', ['Employee test',employeeEmail,hash,'employee','password']); employeeUserId = user.insertId
    const [employee] = await db.query<mysql.ResultSetHeader>('INSERT INTO employees (employee_code,name,email,department_id,manager_name,manager_user_id,user_id,active) VALUES (?,?,?,?,?,?,?,TRUE)', [`ET-${suffix}`,'Employee test',employeeEmail,department.id,'Employee test manager',managerId,employeeUserId]); employeeId = employee.insertId
    const [activity] = await db.query<mysql.ResultSetHeader>("INSERT INTO activities (name,category,active) VALUES (?, 'internal', TRUE)", [`Employee test activity ${suffix}`]); activityId = activity.insertId
    const [secondActivity] = await db.query<mysql.ResultSetHeader>("INSERT INTO activities (name,category,active) VALUES (?, 'internal', TRUE)", [`Employee test second activity ${suffix}`]); secondActivityId = secondActivity.insertId
    const [thirdActivity] = await db.query<mysql.ResultSetHeader>("INSERT INTO activities (name,category,active) VALUES (?, 'internal', TRUE)", [`Employee test third activity ${suffix}`]); thirdActivityId = thirdActivity.insertId
    const listener = createServer(); await new Promise<void>((resolvePort, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolvePort) }); port = (listener.address() as any).port; await new Promise<void>(resolveClose => listener.close(() => resolveClose()))
    server = spawn(process.execPath, ['--import','tsx','server.ts'], { cwd: backendDir, env: { ...process.env, PORT: String(port), SEED_DEMO_DATA: 'false' }, stdio: ['ignore','pipe','pipe'] }); server.stdout?.on('data', chunk => { output += chunk.toString() }); server.stderr?.on('data', chunk => { output += chunk.toString() })
    let healthy = false; for (let i = 0; i < 120; i++) { if (server.exitCode !== null) break; try { healthy = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; if (healthy) break } catch { /* starting */ } await new Promise(wait => setTimeout(wait, 250)) }; assert.ok(healthy, output)
    const employeeToken = await login(employeeEmail, 'employee'); const managerToken = await login(managerEmail, 'manager')
    assert.equal((await request('/employee/timesheet', employeeToken)).data.timesheet, null, 'Empty dashboard has no timesheet')
    assert.equal((await request('/employee/timesheet/submit-daily', employeeToken, 'POST')).status, 409)
    assert.equal((await request('/employee/timesheet', managerToken)).status, 403)
    assert.equal((await request('/employee/timesheet')).status, 401)
    assert.equal((await request('/manager/timesheets', employeeToken)).status, 403)
    assert.equal((await request('/manager/timesheets/1', employeeToken)).status, 403)
    const entryDate = period.startsOn
    const valid = { entryDate, projectId: null, activityId, hours: 8, workDescription: 'Normal work' }
    for (const [label, body] of [
      ['missing date', { ...valid, entryDate: undefined }], ['missing activity', { ...valid, activityId: undefined }],
      ['missing hours', { ...valid, hours: undefined }], ['zero hours', { ...valid, hours: 0 }],
      ['negative hours', { ...valid, hours: -1 }], ['over 24 hours', { ...valid, hours: 25 }],
    ] as const) { const result = await request('/employee/timesheet/entries', employeeToken, 'POST', body); assert.equal(result.status, 400, `${label}: ${JSON.stringify(result.data)}`) }
    const emptyAfterInvalid = await request('/employee/timesheet', employeeToken); timesheetId = Number(emptyAfterInvalid.data.timesheet?.id || 0)
    assert.equal(emptyAfterInvalid.data.entries.length, 0)
    if (timesheetId) { const emptyState = await state(); assert.equal(emptyState.entries, 0); assert.equal(emptyState.total, 0); assert.equal((await request('/employee/timesheet/submit-daily', employeeToken, 'POST')).status, 400) }
    const created = await request('/employee/timesheet/entries', employeeToken, 'POST', valid); assert.equal(created.status, 201, JSON.stringify(created.data))
    const loaded = await request('/employee/timesheet', employeeToken); timesheetId = Number(loaded.data.timesheet.id); const entryId = Number(loaded.data.entries[0].id)
    assert.equal(loaded.data.entries.length, 1); assert.deepEqual(await state(), { status: 'draft', total: 8, entries: 1, sum: 8, version: Number(loaded.data.timesheet.version) })
    assert.equal((await request('/employee/timesheet/entries', employeeToken, 'POST', valid)).status, 409)
    assert.equal((await request(`/employee/timesheet/entries/${entryId}`, employeeToken, 'PUT', { ...valid, hours: 6 })).status, 200)
    assert.equal((await state()).total, 6); assert.equal((await state()).sum, 6)
    assert.equal((await request(`/employee/timesheet/entries/${entryId}`, employeeToken, 'DELETE')).status, 200)
    assert.deepEqual(await state(), { status: 'draft', total: 0, entries: 0, sum: 0, version: (await state()).version })
    assert.equal((await request('/employee/timesheet/submit-daily', employeeToken, 'POST')).status, 400)
    const tiny = await request('/employee/timesheet/entries', employeeToken, 'POST', { ...valid, hours: 0.001 }); assert.equal(tiny.status, 201, JSON.stringify(tiny.data))
    const tinySheet = await request('/employee/timesheet', employeeToken); const tinyId = Number(tinySheet.data.entries[0].id)
    console.log(`precision probe: supplied=0.001, stored=${(await state()).sum}`)
    assert.equal((await request(`/employee/timesheet/entries/${tinyId}`, employeeToken, 'DELETE')).status, 200)
    const duplicateResults = await Promise.all(Array.from({ length: 12 }, () => request('/employee/timesheet/entries', employeeToken, 'POST', valid)))
    const duplicateSheet = await request('/employee/timesheet', employeeToken)
    console.log(`duplicate race: statuses=${duplicateResults.map(result => result.status).join(',')}, stored=${duplicateSheet.data.entries.length}, total=${(await state()).total}, sum=${(await state()).sum}`)
    for (const row of duplicateSheet.data.entries) assert.equal((await request(`/employee/timesheet/entries/${row.id}`, employeeToken, 'DELETE')).status, 200)
    const overflowResults = await Promise.all([request('/employee/timesheet/entries', employeeToken, 'POST', { ...valid, activityId: secondActivityId, hours: 13 }), request('/employee/timesheet/entries', employeeToken, 'POST', { ...valid, activityId: thirdActivityId, hours: 13 })])
    console.log(`daily-hours race: statuses=${overflowResults.map(result => result.status).join(',')}, total=${(await state()).total}, sum=${(await state()).sum}`)
    const overflowSheet = await request('/employee/timesheet', employeeToken)
    for (const row of overflowSheet.data.entries) assert.equal((await request(`/employee/timesheet/entries/${row.id}`, employeeToken, 'DELETE')).status, 200)
    assert.equal((await request('/employee/timesheet/entries', employeeToken, 'POST', valid)).status, 201)
    const beforeSubmit = await state(); assert.equal(beforeSubmit.total, beforeSubmit.sum)
    const aborted = new AbortController(); const inFlight = request('/employee/timesheet/submit-daily', employeeToken, 'POST', undefined, aborted.signal).catch(() => null); aborted.abort(); await inFlight
    const afterRefresh = await request('/employee/timesheet', employeeToken)
    if (afterRefresh.data.timesheet.status === 'draft') { const submitted = await request('/employee/timesheet/submit-daily', employeeToken, 'POST'); assert.ok([200, 409].includes(submitted.status), JSON.stringify(submitted.data)) }
    assert.equal((await state()).status, 'submitted'); assert.equal((await state()).total, (await state()).sum)
    assert.equal((await request('/employee/timesheet/submit-daily', employeeToken, 'POST')).status, 409)
    const submittedEntryId = Number((await request('/employee/timesheet', employeeToken)).data.entries[0].id)
    assert.equal((await request(`/employee/timesheet/entries/${submittedEntryId}`, employeeToken, 'PUT', { ...valid, hours: 4 })).status, 409)
    assert.equal((await request(`/employee/timesheet/entries/${submittedEntryId}`, employeeToken, 'DELETE')).status, 409)
    assert.equal((await request('/employee/timesheet/entries', employeeToken, 'POST', { ...valid, hours: 1 })).status, 409)
    const review = await request(`/manager/timesheets/${timesheetId}`, managerToken); assert.equal(review.status, 200)
    assert.equal((await request(`/manager/timesheets/${timesheetId}/return`, managerToken, 'POST', { version: review.data.timesheet.version, reason: 'Clarify work' })).status, 200)
    assert.equal((await state()).status, 'returned'); assert.equal((await state()).total, (await state()).sum)
    assert.equal((await request(`/employee/timesheet/entries/${submittedEntryId}`, employeeToken, 'PUT', { ...valid, hours: 7, workDescription: 'Clarified work' })).status, 200)
    assert.equal((await state()).total, 7); assert.equal((await state()).sum, 7)
    const resubmissions = await Promise.all([request('/employee/timesheet/submit-daily', employeeToken, 'POST'), request('/employee/timesheet/submit-daily', employeeToken, 'POST')]); assert.deepEqual(resubmissions.map(result => result.status).sort(), [200, 409])
    assert.equal((await state()).status, 'resubmitted'); assert.equal((await state()).total, (await state()).sum)
    const finalSheet = await request('/employee/timesheet', employeeToken); assert.equal(finalSheet.data.timesheet.status, 'resubmitted'); assert.equal(Number(finalSheet.data.timesheet.totalHours), 7)
  } finally {
    if (server && server.exitCode === null) { server.kill(); await new Promise<void>(resolveExit => { const timer = setTimeout(resolveExit, 3000); server?.once('exit', () => { clearTimeout(timer); resolveExit() }) }) }
    if (timesheetId) { await db.query('DELETE FROM notifications WHERE timesheet_id=?', [timesheetId]); await db.query('DELETE FROM audit_events WHERE entity_type=? AND entity_id=?', ['timesheet',timesheetId]); await db.query('DELETE FROM timesheet_audit_events WHERE timesheet_id=?', [timesheetId]); await db.query('DELETE FROM timesheet_entries WHERE timesheet_id=?', [timesheetId]); await db.query('DELETE FROM timesheets WHERE id=?', [timesheetId]) }
    if (employeeId) await db.query('DELETE FROM employees WHERE id=?', [employeeId])
    for (const id of [activityId,secondActivityId,thirdActivityId].filter(Boolean)) await db.query('DELETE FROM activities WHERE id=?', [id])
    if (managerId && employeeUserId) await db.query('DELETE FROM users WHERE id IN (?,?)', [managerId,employeeUserId])
    if (periodId) await db.query('DELETE FROM reporting_periods WHERE id=?', [periodId])
    await db.end()
  }
})
