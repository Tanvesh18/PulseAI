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

test('HR, Manager, Employee, Finance, and Director share one authorized workflow', { skip: !enabled }, async () => {
  const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Set ${key} in backend/.env to run cross-role integration tests.`); return value }
  const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: required('DB_USER'), password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'pulseai', dateStrings: true })
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`; const password = `CrossRole-${suffix}-Pass!`
  const emails = { hr: `hr-${suffix}@pulseai.integration`, manager: `manager-${suffix}@pulseai.integration`, newManager: `new-manager-${suffix}@pulseai.integration`, employee: `employee-${suffix}@pulseai.integration`, finance: `finance-${suffix}@pulseai.integration`, director: `director-${suffix}@pulseai.integration` }
  let server: ChildProcess | undefined; let port = 0; let departmentId = 0; let hrId = 0; let managerId = 0; let newManagerId = 0; let financeId = 0; let directorId = 0; let employeeId = 0; let employeeUserId = 0; let projectId = 0; let activityId = 0; let clientId = 0; let timesheetId = 0; let entryId = 0; let leaveId = 0; let holidayId = 0; let invoiceId = 0; let departmentSubmissionId = 0; let serverOutput = ''
  const request = async (path: string, authToken: string, method = 'GET', body?: object) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers: { Authorization: `Bearer ${authToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const text = await response.text(); let data: any = {}; try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }; return { status: response.status, data }
  }
  const login = async (email: string, role: string) => { const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, role }) }); const data = await response.json() as any; assert.equal(response.status, 200, JSON.stringify(data)); return data.token as string }
  const workdays = (start: string, count: number) => { const days: string[] = []; const date = new Date(`${start}T00:00:00Z`); while (days.length < count) { if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) days.push(date.toISOString().slice(0, 10)); date.setUTCDate(date.getUTCDate() + 1) }; return days }
  try {
    const [[period]] = await db.query<any[]>("SELECT id,label,DATE_FORMAT(starts_on,'%Y-%m-%d') AS startsOn FROM reporting_periods WHERE active=TRUE ORDER BY starts_on DESC LIMIT 1")
    assert.ok(period, 'An active reporting period is required.')
    const [[department]] = await db.query<any[]>('SELECT id FROM departments ORDER BY id LIMIT 1'); assert.ok(department); departmentId = Number(department.id)
    const [listener] = await new Promise<[ReturnType<typeof createServer>, number]>((resolvePort, reject) => { const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => resolvePort([server, (server.address() as any).port])) })
    port = (listener.address() as any).port; await new Promise<void>(resolveClose => listener.close(() => resolveClose()))
    const hash = await bcrypt.hash(password, 6)
    const createUser = async (name: string, email: string, role: string) => { const [result] = await db.query<mysql.ResultSetHeader>('INSERT INTO users (name,email,password_hash,role,auth_provider) VALUES (?,?,?,?,?)', [name,email,hash,role,'password']); return result.insertId }
    hrId = await createUser('HR integration', emails.hr, 'hr'); managerId = await createUser('Manager integration', emails.manager, 'manager'); newManagerId = await createUser('New Manager integration', emails.newManager, 'manager'); financeId = await createUser('Finance integration', emails.finance, 'finance'); directorId = await createUser('Director integration', emails.director, 'director')
    server = spawn(process.execPath, ['--import','tsx','server.ts'], { cwd: backendDir, env: { ...process.env, PORT: String(port), SEED_DEMO_DATA: 'false' }, stdio: ['ignore','pipe','pipe'] }); server.stdout?.on('data', chunk => { serverOutput += chunk.toString() }); server.stderr?.on('data', chunk => { serverOutput += chunk.toString() })
    let healthy = false; for (let attempt=0; attempt<120; attempt++) { if (server.exitCode !== null) break; try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { healthy=true; break } } catch { /* app still starting */ }; await new Promise(wait => setTimeout(wait,250)) }; assert.equal(healthy,true,`Cross-role API failed to start: ${serverOutput}`)

    const hr = await login(emails.hr,'hr'); const manager = await login(emails.manager,'manager'); const newManager = await login(emails.newManager,'manager'); const finance = await login(emails.finance,'finance'); const director = await login(emails.director,'director')
    const added = await request('/hr/employees', hr, 'POST', { employeeCode:`XR-${suffix}`, name:'Cross-role employee', email:emails.employee, departmentId, managerUserId:managerId }); assert.equal(added.status,201,JSON.stringify(added.data)); employeeId = Number(added.data.employeeId)
    assert.equal((await request('/hr/overview', manager)).status,403,'Manager cannot access HR API.')
    const registration = await fetch(`http://127.0.0.1:${port}/api/auth/register`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Cross-role employee',email:emails.employee,password,role:'employee'}) }); const employeeAccount = await registration.json() as any; assert.equal(registration.status,201,JSON.stringify(employeeAccount)); employeeUserId=Number(employeeAccount.user.id); const employee=employeeAccount.token as string
    const managerTeam = await request('/manager/team',manager); assert.ok(managerTeam.data.team.some((row:any)=>Number(row.id)===employeeId))
    assert.equal((await request('/manager/team',newManager)).data.team.some((row:any)=>Number(row.id)===employeeId),false,'Unrelated Manager cannot see the employee.')
    const project = await request('/manager/projects',manager,'POST',{code:`XP-${suffix}`,name:'Cross-role project',description:'Integration workflow project',startsOn:period.startsOn}); assert.equal(project.status,201,JSON.stringify(project.data)); projectId=Number(project.data.id)
    const activity = await request(`/manager/projects/${projectId}/activities`,manager,'POST',{name:`Cross-role task ${suffix}`}); assert.equal(activity.status,201); activityId=Number(activity.data.activityId)
    assert.equal((await request(`/manager/projects/${projectId}/assignments`,manager,'POST',{employeeId,startsOn:period.startsOn})).status,201)
    const employeeSheet = await request('/employee/timesheet',employee); assert.ok(employeeSheet.data.projects.some((item:any)=>Number(item.id)===projectId)); assert.ok(employeeSheet.data.projectActivities.some((item:any)=>Number(item.id)===activityId))
    const [entryDate, leaveDate, holidayDate] = workdays(period.startsOn,3)
    const leave = await request('/hr/leave',hr,'POST',{employeeId,startsOn:leaveDate,endsOn:leaveDate,leaveType:'Approved leave'}); assert.equal(leave.status,201); leaveId=Number(leave.data.leaveId)
    const holiday = await request('/hr/holidays',hr,'POST',{holidayDate,name:`Cross-role holiday ${suffix}`,region:`test-${suffix}`}); assert.equal(holiday.status,201); holidayId=Number(holiday.data.holidayId)
    assert.equal((await request('/employee/timesheet',employee)).data.leave.some((item:any)=>item.startsOn===leaveDate),true)
    const addedEntry = await request('/employee/timesheet/entries',employee,'POST',{entryDate,projectId,activityId,hours:7,workDescription:'Shared workflow source work'}); assert.equal(addedEntry.status,201,JSON.stringify(addedEntry.data));
    const freshSheet = await request('/employee/timesheet',employee); timesheetId=Number(freshSheet.data.timesheet.id); entryId=Number(freshSheet.data.entries[0].id)
    const submitted = await request('/employee/timesheet/submit-daily',employee,'POST'); assert.equal(submitted.status,200,JSON.stringify(submitted.data)); assert.equal(submitted.data.warnings.includes(leaveDate),false,'Approved leave is excluded from employee missing-workday warnings.'); assert.equal(submitted.data.warnings.includes(holidayDate),false,'Active holiday is excluded from employee missing-workday warnings.')
    const queue = await request('/manager/timesheets',manager); assert.ok(queue.data.timesheets.some((row:any)=>Number(row.id)===timesheetId)); assert.ok((await db.query<any[]>('SELECT id FROM notifications WHERE recipient_email=? AND timesheet_id=? AND title=?',[emails.manager,timesheetId,'Timesheet submitted']))[0].length)
    assert.equal((await request(`/employee/timesheet/entries/${entryId}`,employee,'PUT',{entryDate,projectId,activityId,hours:6,workDescription:'Forbidden while submitted'})).status,409)

    assert.equal((await request(`/hr/employees/${employeeId}`,hr,'PATCH',{managerUserId:newManagerId})).status,200)
    assert.equal((await request(`/manager/timesheets/${timesheetId}`,manager)).status,200,'A reporting-line change does not silently reassign the pending review.')
    assert.equal((await request(`/manager/timesheets/${timesheetId}`,newManager)).status,404)
    const reassigned = await request(`/hr/employees/${employeeId}`,hr,'PATCH',{managerUserId:newManagerId,reassignPendingReviews:true}); assert.equal(reassigned.status,200,JSON.stringify(reassigned.data)); assert.equal(Number(reassigned.data.pendingReviewsReassigned),1,JSON.stringify(reassigned.data))
    assert.equal((await request(`/manager/timesheets/${timesheetId}`,manager)).status,404)
    const firstReview = await request(`/manager/timesheets/${timesheetId}`,newManager); assert.equal(firstReview.status,200)
    assert.equal((await request(`/manager/timesheets/${timesheetId}/return`,newManager,'POST',{version:firstReview.data.timesheet.version})).status,400,'A return requires a reason.')
    const returned = await request(`/manager/timesheets/${timesheetId}/return`,newManager,'POST',{version:firstReview.data.timesheet.version,reason:'Please clarify this project work.'}); assert.equal(returned.status,200)
    assert.equal((await request('/employee/timesheet',employee)).data.timesheet.returnReason,'Please clarify this project work.')
    const correction = await request(`/employee/timesheet/entries/${entryId}`,employee,'PUT',{entryDate,projectId,activityId,hours:6.5,workDescription:'Corrected project work'}); assert.equal(correction.status,200,JSON.stringify(correction.data))
    const resubmission = await request('/employee/timesheet/submit-daily',employee,'POST'); assert.equal(resubmission.status,200)
    assert.equal((await request(`/manager/timesheets/${timesheetId}`,manager)).status,404,'Resubmission remains with the explicitly assigned reviewer.')
    const secondReview = await request(`/manager/timesheets/${timesheetId}`,newManager); assert.equal(secondReview.data.timesheet.status,'resubmitted')
    assert.equal((await request(`/manager/timesheets/${timesheetId}/approve`,newManager,'POST',{version:secondReview.data.timesheet.version})).status,200)
    assert.equal((await request(`/employee/timesheet/entries/${entryId}`,employee,'PUT',{entryDate,projectId,activityId,hours:2,workDescription:'Approved entry is read-only'})).status,409)
    assert.equal((await request('/finance/entries',director)).status,403)
    const client = await request('/finance/clients',finance,'POST',{code:`XC-${suffix}`,name:'Cross-role billing client',currency:'USD'}); assert.equal(client.status,201,JSON.stringify(client.data)); clientId=Number(client.data.clientId)
    assert.equal((await request(`/finance/projects/${projectId}/client`,finance,'PATCH',{clientId})).status,200)
    assert.equal((await request(`/finance/projects/${projectId}/activities/${activityId}`,finance,'PATCH',{billable:true})).status,200)
    const rate = await request(`/finance/projects/${projectId}/rates`,finance,'POST',{amount:100,currency:'USD',effectiveFrom:period.startsOn}); assert.equal(rate.status,201,JSON.stringify(rate.data))
    const financeEntries = await request(`/finance/entries?period=${encodeURIComponent(period.label)}`,finance); const financeEntry=financeEntries.data.entries.find((row:any)=>Number(row.entryId)===entryId); assert.ok(financeEntry); assert.equal(financeEntry.eligibleForInvoice,true); assert.equal(Number(financeEntry.amount),650)
    const draft=await request('/finance/invoices',finance,'POST',{entryIds:[entryId]}); assert.equal(draft.status,201,JSON.stringify(draft.data)); invoiceId=Number(draft.data.invoiceId)
    assert.equal((await request('/finance/invoices',finance,'POST',{entryIds:[entryId]})).status,409,'Source work cannot be linked to two invoices.')
    assert.equal((await request(`/finance/invoices/${invoiceId}/ready`,finance,'POST')).status,200); assert.equal((await request(`/finance/invoices/${invoiceId}/finalize`,finance,'POST')).status,200)
    const report=await request('/director/financial-report',director); assert.ok(report.data.invoices.some((row:any)=>row.currency==='USD'&&Number(row.amount)===650)); assert.ok(report.data.hours.some((row:any)=>row.currency==='USD'&&Number(row.billed)===6.5))
    const [departmentSubmission]=await db.query<mysql.ResultSetHeader>('INSERT INTO department_submissions (department_id,period_label,status,submitted_by) VALUES (?,? ,\'submitted\',?)',[departmentId,`Integration ${suffix}`,'Cross-role manager']); departmentSubmissionId=departmentSubmission.insertId
    assert.equal((await request(`/director/approvals/${departmentSubmissionId}/approve`,director,'POST')).status,200)
    const [[timesheetState]]=await db.query<any[]>('SELECT status FROM timesheets WHERE id=?',[timesheetId]); assert.equal(timesheetState.status,'approved','Director department-cycle review must not change Manager-owned timesheet decisions.')
    const [sharedAudit]=await db.query<any[]>('SELECT action,actor_role FROM audit_events WHERE (entity_type=? AND entity_id=?) OR (entity_type=? AND entity_id=?) ORDER BY id',['timesheet',timesheetId,'invoice',invoiceId]); assert.ok(sharedAudit.some((row:any)=>row.actor_role==='employee'&&row.action==='Timesheet submitted')); assert.ok(sharedAudit.some((row:any)=>row.actor_role==='manager'&&row.action==='Timesheet approved')); assert.ok(sharedAudit.some((row:any)=>row.actor_role==='finance'&&row.action==='invoice_finalized'))
    const hrOverview=await request('/hr/overview',hr); assert.ok(hrOverview.data.employees.some((row:any)=>Number(row.id)===employeeId)); assert.ok(hrOverview.data.leaves.some((row:any)=>Number(row.id)===leaveId)); assert.ok(hrOverview.data.holidays.some((row:any)=>Number(row.id)===holidayId))
    assert.equal((await request('/hr/overview',finance)).status,403)
    assert.equal((await request(`/hr/employees/${employeeId}`,hr,'PATCH',{active:false})).status,200)
    assert.equal((await request('/employee/dashboard',employee)).status,403,'Deactivated workforce members cannot add or read new workspace time.')
    const [[historical]]=await db.query<any[]>('SELECT t.status,COUNT(il.id) AS invoiceLines FROM timesheets t LEFT JOIN timesheet_entries te ON te.timesheet_id=t.id LEFT JOIN invoice_lines il ON il.timesheet_entry_id=te.id WHERE t.id=? GROUP BY t.id',[timesheetId]); assert.equal(historical.status,'approved'); assert.equal(Number(historical.invoiceLines),1,'Deactivation preserves approved and invoiced history.')
  } finally {
    if (server && server.exitCode===null) { server.kill(); await new Promise<void>(resolveExit=>{ const timer=setTimeout(resolveExit,3000); server?.once('exit',()=>{clearTimeout(timer);resolveExit()}) }) }
    if (invoiceId) { await db.query('DELETE FROM finance_audit_events WHERE entity_id=? AND entity_type=\'invoice\'',[invoiceId]).catch(()=>undefined); await db.query('DELETE FROM audit_events WHERE entity_id=? AND entity_type=\'invoice\'',[invoiceId]).catch(()=>undefined); await db.query('DELETE FROM invoice_lines WHERE invoice_id=?',[invoiceId]).catch(()=>undefined); await db.query('DELETE FROM invoices WHERE id=?',[invoiceId]).catch(()=>undefined) }
    if (entryId) await db.query('DELETE FROM invoice_lines WHERE timesheet_entry_id=?',[entryId]).catch(()=>undefined)
    if (departmentSubmissionId) await db.query('DELETE FROM department_submissions WHERE id=?',[departmentSubmissionId]).catch(()=>undefined)
    if (timesheetId) { await db.query('DELETE FROM audit_events WHERE entity_id=? AND entity_type=\'timesheet\'',[timesheetId]).catch(()=>undefined); await db.query('DELETE FROM timesheet_audit_events WHERE timesheet_id=?',[timesheetId]).catch(()=>undefined); await db.query('DELETE FROM validation_findings WHERE timesheet_id=?',[timesheetId]).catch(()=>undefined); await db.query('DELETE FROM notifications WHERE timesheet_id=?',[timesheetId]).catch(()=>undefined); await db.query('DELETE FROM timesheet_entries WHERE timesheet_id=?',[timesheetId]).catch(()=>undefined); await db.query('DELETE FROM timesheets WHERE id=?',[timesheetId]).catch(()=>undefined) }
    if (projectId) { await db.query('DELETE FROM employee_project_assignments WHERE employee_id=? AND project_id=?',[employeeId,projectId]).catch(()=>undefined); await db.query('DELETE FROM project_activity_assignments WHERE project_id=?',[projectId]).catch(()=>undefined); await db.query('DELETE FROM project_billing_rates WHERE project_id=?',[projectId]).catch(()=>undefined); await db.query('DELETE FROM projects WHERE id=?',[projectId]).catch(()=>undefined) }
    if (activityId) await db.query('DELETE FROM activities WHERE id=?',[activityId]).catch(()=>undefined)
    if (clientId) await db.query('DELETE FROM clients WHERE id=?',[clientId]).catch(()=>undefined)
    if (leaveId) { await db.query('DELETE FROM audit_events WHERE entity_type=\'leave\' AND entity_id=?',[leaveId]).catch(()=>undefined); await db.query('DELETE FROM employee_leave_records WHERE id=?',[leaveId]).catch(()=>undefined) }
    if (holidayId) { await db.query('DELETE FROM audit_events WHERE entity_type=\'holiday\' AND entity_id=?',[holidayId]).catch(()=>undefined); await db.query('DELETE FROM public_holidays WHERE id=?',[holidayId]).catch(()=>undefined) }
    if (employeeId) { await db.query('DELETE FROM audit_events WHERE entity_type=\'employee\' AND entity_id=?',[employeeId]).catch(()=>undefined); await db.query('DELETE FROM employees WHERE id=?',[employeeId]).catch(()=>undefined) }
    const userIds=[hrId,managerId,newManagerId,employeeUserId,financeId,directorId].filter(Boolean); if(userIds.length) { const marks=userIds.map(()=>'?').join(','); await db.query(`DELETE FROM audit_events WHERE actor_user_id IN (${marks})`,userIds).catch(()=>undefined); await db.query(`DELETE FROM finance_audit_events WHERE actor_user_id IN (${marks})`,userIds).catch(()=>undefined) }
    if (userIds.length) await db.query(`DELETE FROM notifications WHERE recipient_email IN (${userIds.map(()=>'?').join(',')})`,userIds.map(id=>emails[Object.entries({hr:hrId,manager:managerId,newManager:newManagerId,employee:employeeUserId,finance:financeId,director:directorId}).find(([,value])=>value===id)?.[0] as keyof typeof emails] || '')).catch(()=>undefined)
    if (employeeId) await db.query('DELETE FROM employee_project_assignments WHERE employee_id=?',[employeeId]).catch(()=>undefined)
    if (userIds.length) await db.query(`DELETE FROM users WHERE id IN (${userIds.map(()=>'?').join(',')})`,userIds).catch(()=>undefined)
    await db.end()
  }
})
