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

test('Finance processes approved work once and preserves finalized rate snapshots', { skip: !enabled }, async () => {
  const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Set ${key} in backend/.env to run Finance integration tests.`); return value }
  const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: required('DB_USER'), password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'pulseai', dateStrings: true })
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`; const password = `Finance-${suffix}-Pass!`; const financeEmail = `finance-${suffix}@pulseai.integration`; const otherEmail = `director-${suffix}@pulseai.integration`
  const testPeriodIds: number[] = []
  let server: ChildProcess | undefined; let port = 0; let financeId = 0; let otherId = 0; let projectId = 0; let noRateProjectId = 0; let activityId = 0; let internalActivityId = 0; let clientId = 0; let apiClientId = 0; let noticeId = 0; let employeeId = 0; let timesheetId = 0; let entryId = 0; let reusableEntryId = 0; let unapprovedEntryId = 0; let noRateEntryId = 0; let smallEntryId = 0; let invoiceId = 0; const cancelledInvoiceIds: number[] = []; let serverOutput = ''
  const request = async (path: string, authToken: string, method = 'GET', body?: object) => { const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers: { Authorization: `Bearer ${authToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); const text = await response.text(); let data: any = {}; try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }; return { status: response.status, data } }
  const csvRows = (raw: string) => raw.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map((line) => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((match) => match[1].replaceAll('""', '"')))
  const login = async (email: string, role: string) => { const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, role }) }); const data = await response.json() as any; assert.equal(response.status, 200, JSON.stringify(data)); return data.token as string }
  try {
    const period = await createTestPeriod(db, suffix); testPeriodIds.push(period.id)
    const unapprovedPeriod = await createTestPeriod(db, suffix, 30); testPeriodIds.push(unapprovedPeriod.id)
    const [[department]] = await db.query<any[]>('SELECT id FROM departments ORDER BY id LIMIT 1'); assert.ok(department, 'At least one department is required.')
    const listener = createServer(); await new Promise<void>((resolvePort, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolvePort) }); port = (listener.address() as any).port; await new Promise<void>(resolveClose => listener.close(() => resolveClose()))
    server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: backendDir, env: { ...process.env, PORT: String(port), SEED_DEMO_DATA: 'false', FINANCE_3_EMAIL: financeEmail, FINANCE_3_PASSWORD: password, DIRECTOR_3_NAME: 'Non-Finance integration', DIRECTOR_3_EMAIL: otherEmail, DIRECTOR_3_PASSWORD: password }, stdio: ['ignore', 'pipe', 'pipe'] }); server.stdout?.on('data', chunk => { serverOutput += chunk.toString() }); server.stderr?.on('data', chunk => { serverOutput += chunk.toString() })
    let healthy = false; for (let attempt = 0; attempt < 120; attempt++) { if (server.exitCode !== null) break; try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { healthy = true; break } } catch { /* wait for startup */ } await new Promise(wait => setTimeout(wait, 250)) }; assert.equal(healthy, true, `Finance test API failed to start: ${serverOutput}`)
    const hash = await bcrypt.hash(password, 6)
    const [financeResult] = await db.query<mysql.ResultSetHeader>('INSERT INTO users (name,email,password_hash,role,auth_provider) VALUES (?,?,?,?,?)', ['Finance integration', financeEmail, hash, 'finance', 'password']); financeId = financeResult.insertId
    const [[otherResult]] = await db.query<any[]>('SELECT id FROM users WHERE email = ?', [otherEmail]); otherId = Number(otherResult.id)
    const [employeeResult] = await db.query<mysql.ResultSetHeader>('INSERT INTO employees (employee_code,name,email,department_id,manager_name,active) VALUES (?,?,?,?,?,TRUE)', [`FI-${suffix}`, 'Finance fixture employee', `employee-${suffix}@pulseai.integration`, department.id, 'Finance fixture manager']); employeeId = employeeResult.insertId
    const [clientResult] = await db.query<mysql.ResultSetHeader>('INSERT INTO clients (code,name,currency,created_by_user_id) VALUES (?,?,?,?)', [`FI-${suffix}`, 'Finance test client', 'USD', financeId]); clientId = clientResult.insertId
    const [projectResult] = await db.query<mysql.ResultSetHeader>('INSERT INTO projects (code,name,client_id,active) VALUES (?,?,?,TRUE)', [`FP-${suffix}`, 'Finance integration project', clientId]); projectId = projectResult.insertId
    const [noRateProject] = await db.query<mysql.ResultSetHeader>('INSERT INTO projects (code,name,client_id,active) VALUES (?,?,?,TRUE)', [`FN-${suffix}`, 'Finance project missing a rate', clientId]); noRateProjectId = noRateProject.insertId
    const [activityResult] = await db.query<mysql.ResultSetHeader>("INSERT INTO activities (name,category,active) VALUES (?, 'project', TRUE)", [`Finance task ${suffix}`]); activityId = activityResult.insertId
    const [internalActivity] = await db.query<mysql.ResultSetHeader>("INSERT INTO activities (name,category,active) VALUES (?, 'internal', TRUE)", [`Internal activity ${suffix}`]); internalActivityId = internalActivity.insertId
    await db.query('INSERT INTO project_activity_assignments (project_id,activity_id,active,created_by_user_id,billable) VALUES (?,?,TRUE,?,TRUE)', [projectId, activityId, financeId])
    await db.query('INSERT INTO project_activity_assignments (project_id,activity_id,active,created_by_user_id,billable) VALUES (?,?,TRUE,?,TRUE)', [noRateProjectId, activityId, financeId])
    const [sheetResult] = await db.query<mysql.ResultSetHeader>('INSERT INTO timesheets (employee_id,reporting_period_id,period_label,total_hours,status) VALUES (?,?,?,?,?)', [employeeId, period.id, period.label, 4, 'approved']); timesheetId = sheetResult.insertId
    const [entryResult] = await db.query<mysql.ResultSetHeader>('INSERT INTO timesheet_entries (timesheet_id,entry_date,project_id,activity_id,hours,work_description) VALUES (?,?,?,?,?,?)', [timesheetId, period.startsOn, projectId, activityId, 4, 'Finance integration source']); entryId = entryResult.insertId
    const [reusableEntry] = await db.query<mysql.ResultSetHeader>('INSERT INTO timesheet_entries (timesheet_id,entry_date,project_id,activity_id,hours,work_description) VALUES (?,?,?,?,?,?)', [timesheetId, new Date(new Date(`${period.startsOn}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10), projectId, activityId, 1, 'Draft cancellation source']); reusableEntryId = reusableEntry.insertId
    const [unapprovedSheet] = await db.query<mysql.ResultSetHeader>('INSERT INTO timesheets (employee_id,reporting_period_id,period_label,total_hours,status) VALUES (?,?,?,?,?)', [employeeId, unapprovedPeriod.id, unapprovedPeriod.label, 2, 'submitted'])
    const [unapprovedEntry] = await db.query<mysql.ResultSetHeader>('INSERT INTO timesheet_entries (timesheet_id,entry_date,project_id,activity_id,hours,work_description) VALUES (?,?,?,?,?,?)', [unapprovedSheet.insertId, period.startsOn, projectId, activityId, 2, 'Not approved']); unapprovedEntryId = unapprovedEntry.insertId
    const [missingRateEntry] = await db.query<mysql.ResultSetHeader>('INSERT INTO timesheet_entries (timesheet_id,entry_date,project_id,activity_id,hours,work_description) VALUES (?,?,?,?,?,?)', [timesheetId, period.startsOn, noRateProjectId, activityId, 1, 'No effective billing rate']); noRateEntryId = missingRateEntry.insertId
    const financeToken = await login(financeEmail, 'finance'); const directorToken = await login(otherEmail, 'director')
    assert.equal((await request('/finance/dashboard', directorToken)).status, 403)
    assert.equal((await request('/director/financial-report', financeToken)).status, 403)
    assert.equal((await request('/finance/dashboard', financeToken)).status, 200)
    const createdClient = await request('/finance/clients', financeToken, 'POST', { code: `FC-${suffix}`, name: 'API client', currency: 'USD' }); assert.equal(createdClient.status, 201); apiClientId = Number(createdClient.data.clientId)
    assert.equal((await request(`/finance/clients/${apiClientId}`, financeToken, 'PATCH', { name: 'Updated API client' })).status, 200)
    assert.equal((await request(`/finance/projects/${projectId}/client`, financeToken, 'PATCH', { clientId: apiClientId })).status, 200)
    assert.equal((await request(`/finance/projects/${projectId}/client`, financeToken, 'PATCH', { clientId })).status, 200)
    const [noticeResult] = await db.query<mysql.ResultSetHeader>('INSERT INTO notifications (title,message,recipient_email) VALUES (?,?,?)', ['Finance fixture notice', 'Review', financeEmail]); noticeId = noticeResult.insertId
    assert.equal((await request(`/finance/notifications/${noticeId}/read`, financeToken, 'POST')).status, 200)
    assert.equal((await request(`/finance/notifications/${noticeId}/read`, financeToken, 'POST')).status, 200)
    const [atomicAudits] = await db.query<any[]>("SELECT action,actor_user_id FROM finance_audit_events WHERE actor_user_id = ? AND action IN ('client_created','client_updated','project_client_changed','notification_marked_read')", [financeId])
    assert.equal(atomicAudits.filter((row) => row.action === 'project_client_changed').length, 2)
    assert.equal(atomicAudits.filter((row) => row.action === 'notification_marked_read').length, 1)
    assert.ok(atomicAudits.every((row) => Number(row.actor_user_id) === financeId))
    const configuredRate = await request(`/finance/projects/${projectId}/rates`, financeToken, 'POST', { amount: 125, currency: 'USD', effectiveFrom: period.startsOn }); assert.equal(configuredRate.status, 201, JSON.stringify(configuredRate.data))
    const oldRateId = Number(configuredRate.data.rateId)
    assert.equal((await request(`/finance/projects/${projectId}/activities/${internalActivityId}`, financeToken, 'PATCH', { billable: true })).status, 404, 'An activity outside this project cannot be changed.')
    await db.query('INSERT INTO project_activity_assignments (project_id,activity_id,active,created_by_user_id,billable) VALUES (?,?,TRUE,?,NULL)', [projectId, internalActivityId, financeId])
    assert.equal((await request(`/finance/projects/${projectId}/activities/${internalActivityId}`, financeToken, 'PATCH', { billable: true })).status, 400, 'Internal activities cannot be made billable.')
    const classify = await request(`/finance/projects/${noRateProjectId}/activities/${activityId}`, financeToken, 'PATCH', { billable: false }); assert.equal(classify.status, 200); assert.equal((await request(`/finance/projects/${noRateProjectId}/activities/${activityId}`, financeToken, 'PATCH', { billable: true })).status, 200)
    const work = await request(`/finance/entries?period=${encodeURIComponent(period.label)}`, financeToken); assert.equal(work.status, 200); const source = work.data.entries.find((item: any) => Number(item.entryId) === entryId); assert.ok(source); assert.equal(source.eligibleForInvoice, true); assert.equal(Number(source.amount), 500)
    assert.equal(work.data.entries.some((item: any) => Number(item.entryId) === unapprovedEntryId), false, 'Submitted employee entries must not be visible to Finance.')
    const missingRate = work.data.entries.find((item: any) => Number(item.entryId) === noRateEntryId); assert.ok(missingRate); assert.equal(missingRate.eligibleForInvoice, false); assert.match(missingRate.exception, /No billing rate/)
    assert.equal((await request('/finance/invoices', financeToken, 'POST', { entryIds: [unapprovedEntryId] })).status, 409)
    assert.equal((await request(`/finance/entries/${entryId}`, financeToken, 'PATCH', { hours: 999 })).status, 404, 'Finance does not have an API to change approved employee hours.')
    const draft = await request('/finance/invoices', financeToken, 'POST', { entryIds: [entryId] }); assert.equal(draft.status, 201, JSON.stringify(draft.data)); invoiceId = draft.data.invoiceId
    assert.equal((await request('/finance/invoices', financeToken, 'POST', { entryIds: [entryId] })).status, 409)
    const releasable = await request('/finance/invoices', financeToken, 'POST', { entryIds: [reusableEntryId] }); assert.equal(releasable.status, 201); cancelledInvoiceIds.push(Number(releasable.data.invoiceId))
    assert.equal((await request(`/finance/invoices/${releasable.data.invoiceId}`, financeToken, 'DELETE')).status, 200)
    const cancelled = await request(`/finance/invoices/${releasable.data.invoiceId}`, financeToken); assert.equal(cancelled.data.invoice.status, 'cancelled'); assert.equal(Number(cancelled.data.invoice.cancelledLineCount), 1)
    const cancellationAudit = await request('/finance/audit', financeToken); const cancelEvent = cancellationAudit.data.events.find((event: any) => Number(event.entityId) === Number(releasable.data.invoiceId) && event.action === 'invoice_draft_cancelled'); assert.ok(cancelEvent); assert.match(cancelEvent.beforeState, new RegExp(String(reusableEntryId)))
    const redraft = await request('/finance/invoices', financeToken, 'POST', { entryIds: [reusableEntryId] }); assert.equal(redraft.status, 201, 'Cancelled draft source work should become eligible again.'); cancelledInvoiceIds.push(Number(redraft.data.invoiceId)); assert.equal((await request(`/finance/invoices/${redraft.data.invoiceId}`, financeToken, 'DELETE')).status, 200)
    assert.equal((await request(`/finance/invoices/${invoiceId}/ready`, financeToken, 'POST')).status, 200)
    const concurrentFinalize = await Promise.all([request(`/finance/invoices/${invoiceId}/finalize`, financeToken, 'POST'), request(`/finance/invoices/${invoiceId}/finalize`, financeToken, 'POST')]); assert.deepEqual(concurrentFinalize.map(result => result.status).sort(), [200, 409])
    const audit = await request('/finance/audit', financeToken); assert.ok(audit.data.events.some((event: any) => event.action === 'invoice_finalized' && Number(event.entityId) === Number(invoiceId)))
    const effectiveTomorrow = new Date(); effectiveTomorrow.setUTCDate(effectiveTomorrow.getUTCDate() + 1)
    const rateVersion = await request(`/finance/projects/${projectId}/rates`, financeToken, 'POST', { amount: 300, currency: 'USD', effectiveFrom: effectiveTomorrow.toISOString().slice(0, 10) }); assert.equal(rateVersion.status, 201, JSON.stringify(rateVersion.data))
    const overlappingActivation = await request(`/finance/rates/${oldRateId}/active`, financeToken, 'PATCH', { active: true }); assert.equal(overlappingActivation.status, 409, JSON.stringify(overlappingActivation.data))
    const [[oldRate]] = await db.query<any[]>("SELECT active, DATE_FORMAT(effective_to, '%Y-%m-%d') AS effectiveTo FROM project_billing_rates WHERE id = ?", [oldRateId]); assert.equal(Number(oldRate.active), 0); assert.ok(oldRate.effectiveTo)
    const historical = await request(`/finance/invoices/${invoiceId}`, financeToken); assert.equal(Number(historical.data.lines[0].rate), 125); assert.equal(Number(historical.data.lines[0].amount), 500); assert.equal(Number(historical.data.invoice.subtotal), 500)
    const directorReport = await request('/director/financial-report', directorToken); assert.equal(directorReport.status, 200); assert.ok(directorReport.data.invoices.some((row: any) => row.currency === 'USD' && Number(row.amount) === 500)); assert.ok(directorReport.data.hours.some((row: any) => row.currency === 'USD' && Number(row.billed) === 4))
    const tinyRate = await request(`/finance/projects/${noRateProjectId}/rates`, financeToken, 'POST', { amount: 0.02, currency: 'USD', effectiveFrom: period.startsOn }); assert.equal(tinyRate.status, 201, JSON.stringify(tinyRate.data))
    await db.query('UPDATE timesheet_entries SET hours = 0.25 WHERE id = ?', [noRateEntryId])
    const tinyDate = new Date(new Date(`${period.startsOn}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)
    const [smallEntry] = await db.query<mysql.ResultSetHeader>('INSERT INTO timesheet_entries (timesheet_id,entry_date,project_id,activity_id,hours,work_description) VALUES (?,?,?,?,?,?)', [timesheetId, tinyDate, noRateProjectId, activityId, 0.25, 'Half-cent rounding boundary']); smallEntryId = smallEntry.insertId
    const exports = ['approved-work', 'unbilled-work', 'invoice-lines', 'invoices', 'project-summary'] as const
    const csv = new Map<string, string[][]>()
    for (const kind of exports) { const result = await request(`/finance/exports/${kind}`, financeToken); assert.equal(result.status, 200, kind); csv.set(kind, csvRows(result.data.raw)); assert.equal((await request(`/finance/exports/${kind}`, directorToken)).status, 403, kind) }
    const [[sourceRow]] = await db.query<any[]>('SELECT hours FROM timesheet_entries WHERE id = ?', [entryId])
    const [[invoiceRow]] = await db.query<any[]>('SELECT subtotal FROM invoices WHERE id = ?', [invoiceId])
    const [lineRows] = await db.query<any[]>('SELECT amount_snapshot AS amount FROM invoice_lines WHERE invoice_id = ?', [invoiceId])
    const [projectRows] = await db.query<any[]>('SELECT SUM(hours) AS hours FROM timesheet_entries WHERE project_id = ? AND timesheet_id = ?', [projectId, timesheetId])
    const [[billedRow]] = await db.query<any[]>("SELECT SUM(il.amount_snapshot) AS amount FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE il.project_id = ? AND i.status = 'finalized'", [projectId])
    const [[unbilledRow]] = await db.query<any[]>('SELECT ROUND(e.hours * r.amount, 2) AS amount FROM timesheet_entries e JOIN project_billing_rates r ON r.project_id = e.project_id WHERE e.id = ?', [noRateEntryId])
    assert.equal(Number(csv.get('approved-work')!.find((row) => row[0] === String(entryId))?.[11]), Number(sourceRow.hours))
    assert.equal(Number(csv.get('unbilled-work')!.find((row) => row[0] === String(noRateEntryId))?.[14]), Number(unbilledRow.amount))
    assert.equal(Number(csv.get('invoice-lines')!.find((row) => row[4] === String(entryId))?.[14]), Number(lineRows[0].amount))
    assert.equal(Number(csv.get('invoices')!.find((row) => row[0] === historical.data.invoice.invoiceNumber)?.[5]), Number(invoiceRow.subtotal))
    assert.equal(Number(csv.get('project-summary')!.find((row) => row[0] === `FP-${suffix}`)?.[5]), Number(projectRows[0].hours))
    assert.equal(Number(csv.get('project-summary')!.find((row) => row[0] === `FP-${suffix}`)?.[11]), Number(billedRow.amount))
    const rounded = await request('/finance/invoices', financeToken, 'POST', { entryIds: [noRateEntryId, smallEntryId] }); assert.equal(rounded.status, 201, JSON.stringify(rounded.data)); cancelledInvoiceIds.push(Number(rounded.data.invoiceId))
    const roundedDetail = await request(`/finance/invoices/${rounded.data.invoiceId}`, financeToken); assert.deepEqual(roundedDetail.data.lines.map((line: any) => Number(line.amount)), [0.01, 0.01]); assert.equal(Number(roundedDetail.data.invoice.subtotal), 0.02)
    const [[roundedStored]] = await db.query<any[]>('SELECT subtotal FROM invoices WHERE id = ?', [rounded.data.invoiceId]); assert.equal(Number(roundedStored.subtotal), 0.02)
    assert.equal((await request(`/finance/invoices/${rounded.data.invoiceId}/ready`, financeToken, 'POST')).status, 200)
    const race = await Promise.all([request(`/finance/invoices/${rounded.data.invoiceId}/finalize`, financeToken, 'POST'), request(`/finance/projects/${noRateProjectId}/activities/${activityId}`, financeToken, 'PATCH', { billable: false })])
    assert.deepEqual(race.map((item) => item.status).sort(), [200, 409], JSON.stringify(race) + '\n' + serverOutput)
    const [[raceInvoice]] = await db.query<any[]>('SELECT status FROM invoices WHERE id = ?', [rounded.data.invoiceId])
    const [[raceClassification]] = await db.query<any[]>('SELECT billable FROM project_activity_assignments WHERE project_id = ? AND activity_id = ?', [noRateProjectId, activityId])
    assert.ok(raceInvoice.status !== 'finalized' || Number(raceClassification.billable) === 1, 'Classification cannot change after finalization.')
    const [raceAudits] = await db.query<any[]>("SELECT action FROM finance_audit_events WHERE actor_user_id = ? AND entity_type = 'invoice' AND entity_id = ? AND action = 'invoice_finalized'", [financeId, rounded.data.invoiceId]); assert.equal(raceAudits.length, raceInvoice.status === 'finalized' ? 1 : 0)
    const projectExport = await request('/finance/exports/project-summary', financeToken); assert.equal(projectExport.status, 200); assert.match(projectExport.data.raw, new RegExp(`FP-${suffix}`)); assert.match(projectExport.data.raw, /Unbilled amount/)
  } finally {
    if (server && server.exitCode === null) { server.kill(); await new Promise<void>(resolveExit => { const timer = setTimeout(resolveExit, 3000); server?.once('exit', () => { clearTimeout(timer); resolveExit() }) }) }
    const cleanupInvoiceIds = [invoiceId, ...cancelledInvoiceIds].filter(Boolean); if (cleanupInvoiceIds.length) { const marks = cleanupInvoiceIds.map(() => '?').join(','); await db.query(`DELETE FROM finance_audit_events WHERE actor_user_id = ? AND entity_type = 'invoice' AND entity_id IN (${marks})`, [financeId, ...cleanupInvoiceIds]).catch(() => undefined); await db.query(`DELETE FROM invoices WHERE id IN (${marks})`, cleanupInvoiceIds).catch(() => undefined) }
    if (employeeId) {
      const [sheets] = await db.query<any[]>('SELECT id FROM timesheets WHERE employee_id = ?', [employeeId]); const ids = sheets.map((row: any) => Number(row.id)); if (ids.length) { const marks = ids.map(() => '?').join(','); await db.query('DELETE FROM notifications WHERE timesheet_id IN (' + marks + ')', ids).catch(() => undefined); await db.query(`DELETE FROM timesheet_audit_events WHERE timesheet_id IN (${marks})`, ids); await db.query(`DELETE FROM validation_findings WHERE timesheet_id IN (${marks})`, ids).catch(() => undefined); await db.query(`DELETE FROM timesheet_entries WHERE timesheet_id IN (${marks})`, ids); await db.query(`DELETE FROM timesheets WHERE id IN (${marks})`, ids) }
    }
    if (projectId || noRateProjectId) { const ids = [projectId, noRateProjectId].filter(Boolean); await db.query(`DELETE FROM project_activity_assignments WHERE project_id IN (${ids.map(() => '?').join(',')})`, ids).catch(() => undefined); await db.query(`DELETE FROM employee_project_assignments WHERE project_id IN (${ids.map(() => '?').join(',')})`, ids).catch(() => undefined) }
    if (projectId || noRateProjectId) { const ids = [projectId, noRateProjectId].filter(Boolean); await db.query(`DELETE FROM project_billing_rates WHERE project_id IN (${ids.map(() => '?').join(',')})`, ids).catch(() => undefined) }
    if (projectId || noRateProjectId) { const ids = [projectId, noRateProjectId].filter(Boolean); await db.query(`DELETE FROM projects WHERE id IN (${ids.map(() => '?').join(',')})`, ids).catch(() => undefined) }
    if (activityId || internalActivityId) { const ids = [activityId, internalActivityId].filter(Boolean); await db.query(`DELETE FROM activities WHERE id IN (${ids.map(() => '?').join(',')})`, ids).catch(() => undefined) }
    if (noticeId) await db.query('DELETE FROM notifications WHERE id = ?', [noticeId]).catch(() => undefined)
    if (apiClientId) await db.query('DELETE FROM clients WHERE id = ?', [apiClientId]).catch(() => undefined)
    if (clientId) await db.query('DELETE FROM clients WHERE id = ?', [clientId]).catch(() => undefined)
    if (employeeId) await db.query('DELETE FROM employees WHERE id = ?', [employeeId]).catch(() => undefined)
    if (financeId) await db.query('DELETE FROM finance_audit_events WHERE actor_user_id = ?', [financeId]).catch(() => undefined)
    if (financeId) await db.query('DELETE FROM audit_events WHERE actor_user_id = ?', [financeId]).catch(() => undefined)
    if (financeId) await db.query('DELETE FROM users WHERE id = ?', [financeId]).catch(() => undefined)
    if (otherId) await db.query('DELETE FROM users WHERE id = ?', [otherId]).catch(() => undefined)
    for (const id of testPeriodIds.reverse()) await db.query('DELETE FROM reporting_periods WHERE id = ?', [id])
    await db.end()
  }
})
