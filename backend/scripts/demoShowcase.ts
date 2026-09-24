import 'dotenv/config'
import mysql, { type PoolConnection, type RowDataPacket } from 'mysql2/promise'

const fixture = {
  key: 'pulseai-showcase-v1',
  period: 'September 2026',
  employeeCode: 'E101',
  employeeEmail: 'aarav@emerson.demo',
  oldActivity: 'Demo delivery work',
  oldDescription: 'Seeded demo timesheet entry',
  entryDescription: 'Showcase client delivery [pulseai-showcase-v1]',
  clientCode: 'SHOWCASE-CLIENT',
  clientName: 'Showcase Client',
  projectCode: 'SHOWCASE-DELIVERY',
  projectName: 'Showcase delivery',
  activityName: 'Showcase client delivery',
  invoiceNumber: 'DEMO-SHOWCASE-202609',
  currency: 'INR',
  rate: 1800,
  leaveReference: 'PULSEAI-SHOWCASE-V1',
  holidayName: 'Showcase holiday',
  holidayDate: '2026-09-30',
}

type DbRow = RowDataPacket & { id: number; [key: string]: unknown }

async function one(connection: PoolConnection, sql: string, params: unknown[] = []) {
  const [rows] = await connection.query<DbRow[]>(sql, params)
  return rows[0]
}

async function all(connection: PoolConnection, sql: string, params: unknown[] = []) {
  const [rows] = await connection.query<DbRow[]>(sql, params)
  return rows
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function seed(connection: PoolConnection) {
  expect(process.env.SEED_DEMO_DATA === 'true', 'This script runs only when SEED_DEMO_DATA=true.')
  await connection.beginTransaction()
  try {
    const financeUser = await one(connection, "SELECT id FROM users WHERE role = 'finance' ORDER BY id LIMIT 1")
    const employee = await one(connection, `SELECT e.id, e.name, e.employee_code AS employeeCode FROM employees e
      JOIN users u ON u.id = e.user_id AND u.role = 'employee'
      WHERE e.employee_code = ? AND e.email = ? AND e.active = TRUE LIMIT 1`, [fixture.employeeCode, fixture.employeeEmail])
    const oldActivity = await one(connection, "SELECT id FROM activities WHERE name = ? AND category = 'internal' LIMIT 1", [fixture.oldActivity])
    expect(financeUser && employee && oldActivity, 'Existing demo Finance user, employee account, or internal activity is missing. No data was changed.')

    const timesheet = await one(connection, `SELECT t.id FROM timesheets t JOIN reporting_periods r ON r.id = t.reporting_period_id
      WHERE t.employee_id = ? AND r.label = ? AND t.status = 'approved'
      ORDER BY (SELECT COUNT(*) FROM timesheet_entries e WHERE e.timesheet_id = t.id) DESC LIMIT 1`, [employee.id, fixture.period])
    expect(timesheet, 'The demo employee has no approved timesheet in the showcase period. No data was changed.')
    const existingMarked = await all(connection, 'SELECT id FROM timesheet_entries WHERE timesheet_id = ? AND work_description = ? FOR UPDATE', [timesheet.id, fixture.entryDescription])
    expect(existingMarked.length === 0 || existingMarked.length === 3, 'The showcase entries were edited. Review them before reseeding.')
    const legacyEntries = existingMarked.length ? [] : await all(connection, `SELECT id FROM timesheet_entries WHERE timesheet_id = ? AND project_id IS NULL
      AND activity_id = ? AND work_description = ? ORDER BY entry_date, id LIMIT 3 FOR UPDATE`, [timesheet.id, oldActivity.id, fixture.oldDescription])
    expect(existingMarked.length || legacyEntries.length === 3, 'Three untouched demo entries are required. No data was changed.')

    await connection.query(`INSERT INTO clients (code, name, currency, active, created_by_user_id)
      VALUES (?, ?, ?, TRUE, ?) ON DUPLICATE KEY UPDATE id = id`, [fixture.clientCode, fixture.clientName, fixture.currency, financeUser.id])
    const client = await one(connection, 'SELECT id, name, currency, active FROM clients WHERE code = ? FOR UPDATE', [fixture.clientCode])
    expect(client?.name === fixture.clientName && client.currency === fixture.currency && Boolean(client.active), 'The showcase client code is already used by different data.')

    await connection.query(`INSERT INTO projects (code, name, description, active, starts_on, ends_on, client_id)
      VALUES (?, ?, ?, TRUE, '2026-09-01', '2026-09-30', ?) ON DUPLICATE KEY UPDATE id = id`,
    [fixture.projectCode, fixture.projectName, fixture.key, client.id])
    const project = await one(connection, 'SELECT id, name, description, client_id AS clientId, active FROM projects WHERE code = ? FOR UPDATE', [fixture.projectCode])
    expect(project?.name === fixture.projectName && project.description === fixture.key && Number(project.clientId) === Number(client.id) && Boolean(project.active), 'The showcase project code is already used by different data.')

    await connection.query(`INSERT INTO activities (name, category, active) VALUES (?, 'project', TRUE)
      ON DUPLICATE KEY UPDATE id = id`, [fixture.activityName])
    const activity = await one(connection, "SELECT id, active FROM activities WHERE name = ? AND category = 'project' FOR UPDATE", [fixture.activityName])
    expect(activity && Boolean(activity.active), 'The showcase activity was changed.')
    await connection.query(`INSERT INTO project_activity_assignments (project_id, activity_id, active, billable, created_by_user_id)
      VALUES (?, ?, TRUE, TRUE, ?) ON DUPLICATE KEY UPDATE id = id`, [project.id, activity.id, financeUser.id])
    const classification = await one(connection, 'SELECT id, active, billable FROM project_activity_assignments WHERE project_id = ? AND activity_id = ? FOR UPDATE', [project.id, activity.id])
    expect(classification && Boolean(classification.active) && Boolean(classification.billable), 'The showcase activity classification was changed.')
    await connection.query(`INSERT INTO employee_project_assignments (employee_id, project_id, active, starts_on, ends_on)
      VALUES (?, ?, TRUE, '2026-09-01', '2026-09-30') ON DUPLICATE KEY UPDATE id = id`, [employee.id, project.id])
    const assignment = await one(connection, 'SELECT id, active FROM employee_project_assignments WHERE employee_id = ? AND project_id = ? FOR UPDATE', [employee.id, project.id])
    expect(assignment && Boolean(assignment.active), 'The showcase employee assignment was changed.')
    await connection.query(`INSERT INTO project_billing_rates (project_id, amount, currency, effective_from, effective_to, active, created_by_user_id)
      VALUES (?, ?, ?, '2026-09-01', '2026-09-30', TRUE, ?) ON DUPLICATE KEY UPDATE id = id`, [project.id, fixture.rate, fixture.currency, financeUser.id])
    const rate = await one(connection, `SELECT id, amount, currency, active FROM project_billing_rates
      WHERE project_id = ? AND effective_from = '2026-09-01' FOR UPDATE`, [project.id])
    expect(rate && Number(rate.amount) === fixture.rate && rate.currency === fixture.currency && Boolean(rate.active), 'The showcase billing rate was changed.')

    for (const entry of legacyEntries) {
      const [result] = await connection.query<mysql.ResultSetHeader>(`UPDATE timesheet_entries SET project_id = ?, activity_id = ?, work_description = ?
        WHERE id = ? AND project_id IS NULL AND activity_id = ? AND work_description = ?`,
      [project.id, activity.id, fixture.entryDescription, entry.id, oldActivity.id, fixture.oldDescription])
      expect(result.affectedRows === 1, `Demo entry ${entry.id} changed during seeding.`)
    }
    const entries = await all(connection, `SELECT e.id, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entryDate, e.hours
      FROM timesheet_entries e WHERE e.timesheet_id = ? AND e.project_id = ? AND e.activity_id = ?
      AND e.work_description = ? ORDER BY e.entry_date, e.id FOR UPDATE`,
    [timesheet.id, project.id, activity.id, fixture.entryDescription])
    expect(entries.length === 3, 'The showcase entries are incomplete.')

    const existingInvoice = await one(connection, 'SELECT id FROM invoices WHERE invoice_number = ? FOR UPDATE', [fixture.invoiceNumber])
    if (!existingInvoice) {
      const entry = entries[0]!
      const amount = Math.round(Number(entry.hours) * fixture.rate * 100) / 100
      const [created] = await connection.query<mysql.ResultSetHeader>(`INSERT INTO invoices
        (invoice_number, client_id, period_label, currency, status, subtotal, version, created_by_user_id, finalized_by_user_id, ready_at, finalized_at)
        VALUES (?, ?, ?, ?, 'finalized', ?, 3, ?, ?, NOW(), NOW())`,
      [fixture.invoiceNumber, client.id, fixture.period, fixture.currency, amount, financeUser.id, financeUser.id])
      await connection.query(`INSERT INTO invoice_lines
        (invoice_id, timesheet_entry_id, billing_rate_id, project_id, entry_date, employee_name_snapshot,
         employee_code_snapshot, project_code_snapshot, project_name_snapshot, activity_name_snapshot,
         hours_snapshot, rate_snapshot, currency_snapshot, amount_snapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [created.insertId, entry.id, rate.id, project.id, entry.entryDate, employee.name, employee.employeeCode,
        fixture.projectCode, fixture.projectName, fixture.activityName, entry.hours, fixture.rate, fixture.currency, amount])
      for (const action of ['invoice_draft_created', 'invoice_marked_ready', 'invoice_finalized']) {
        await connection.query(`INSERT INTO finance_audit_events (actor_user_id, action, entity_type, entity_id, after_state)
          VALUES (?, ?, 'invoice', ?, ?)`, [financeUser.id, action, created.insertId, JSON.stringify({ fixture: fixture.key, invoiceNumber: fixture.invoiceNumber })])
      }
    }

    const leaveEmployee = await one(connection, 'SELECT id FROM employees WHERE employee_code = ? AND active = TRUE LIMIT 1', ['E202'])
    if (leaveEmployee) {
      const existingLeave = await one(connection, 'SELECT id FROM employee_leave_records WHERE source_reference = ? LIMIT 1', [fixture.leaveReference])
      if (!existingLeave) await connection.query(`INSERT INTO employee_leave_records
        (employee_id, starts_on, ends_on, leave_type, status, source_reference)
        VALUES (?, '2026-09-17', '2026-09-18', 'Annual leave', 'approved', ?)`, [leaveEmployee.id, fixture.leaveReference])
    }
    const holiday = await one(connection, 'SELECT id, name FROM public_holidays WHERE holiday_date = ? AND region = ? LIMIT 1', [fixture.holidayDate, 'default'])
    if (!holiday) await connection.query(`INSERT INTO public_holidays (holiday_date, name, region, active)
      VALUES (?, ?, 'default', TRUE)`, [fixture.holidayDate, fixture.holidayName])
    await connection.commit()
    console.log('Showcase seeded: 3 billable approved entries, 1 finalized invoice, and small HR calendar examples. Existing accounts and timesheet hours were preserved.')
  } catch (error) {
    await connection.rollback()
    throw error
  }
}

async function revert(connection: PoolConnection, checkOnly = false) {
  await connection.beginTransaction()
  try {
    const client = await one(connection, 'SELECT id, name, currency, active, billing_email AS billingEmail FROM clients WHERE code = ? FOR UPDATE', [fixture.clientCode])
    const project = await one(connection, `SELECT id, name, description, client_id AS clientId, manager_user_id AS managerId, active,
      DATE_FORMAT(starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(ends_on, '%Y-%m-%d') AS endsOn
      FROM projects WHERE code = ? FOR UPDATE`, [fixture.projectCode])
    const activity = await one(connection, "SELECT id FROM activities WHERE name = ? AND category = 'project' FOR UPDATE", [fixture.activityName])
    const oldActivity = await one(connection, "SELECT id FROM activities WHERE name = ? AND category = 'internal'", [fixture.oldActivity])
    const invoice = await one(connection, 'SELECT id, status FROM invoices WHERE invoice_number = ? FOR UPDATE', [fixture.invoiceNumber])
    const leave = await one(connection, `SELECT l.id, l.status, e.employee_code AS employeeCode, l.leave_type AS leaveType,
      DATE_FORMAT(l.starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(l.ends_on, '%Y-%m-%d') AS endsOn
      FROM employee_leave_records l JOIN employees e ON e.id = l.employee_id WHERE l.source_reference = ? FOR UPDATE`, [fixture.leaveReference])
    const holiday = await one(connection, 'SELECT id, name, active FROM public_holidays WHERE holiday_date = ? AND region = ? FOR UPDATE', [fixture.holidayDate, 'default'])
    if (!client && !project && !activity && !invoice && !leave && holiday?.name !== fixture.holidayName) {
      await connection.rollback()
      console.log('No showcase fixture is present.')
      return
    }
    expect(client && project && activity && oldActivity, 'The fixture is incomplete; rollback stopped before changing data.')
    expect(client.name === fixture.clientName && client.currency === fixture.currency && Boolean(client.active) && !client.billingEmail,
      'The fixture client was edited; rollback stopped.')
    expect(project.name === fixture.projectName && project.description === fixture.key && Number(project.clientId) === Number(client.id)
      && project.managerId == null && Boolean(project.active) && project.startsOn === '2026-09-01' && project.endsOn === '2026-09-30',
    'The fixture project was edited; rollback stopped.')
    expect(!invoice || invoice.status === 'finalized', 'The fixture invoice status changed; rollback stopped.')
    expect(!leave || (leave.status === 'approved' && leave.employeeCode === 'E202' && leave.leaveType === 'Annual leave'
      && leave.startsOn === '2026-09-17' && leave.endsOn === '2026-09-18'), 'The fixture leave record changed; rollback stopped.')
    expect(!holiday || holiday.name !== fixture.holidayName || Boolean(holiday.active), 'The fixture holiday changed; rollback stopped.')

    const entries = await all(connection, 'SELECT id, activity_id AS activityId, work_description AS description FROM timesheet_entries WHERE project_id = ? FOR UPDATE', [project.id])
    expect(entries.length === 3 && entries.every((entry) => Number(entry.activityId) === Number(activity.id) && entry.description === fixture.entryDescription), 'The fixture project has changed work entries; rollback stopped.')
    const rates = await all(connection, `SELECT id, amount, currency, active, DATE_FORMAT(effective_from, '%Y-%m-%d') AS effectiveFrom,
      DATE_FORMAT(effective_to, '%Y-%m-%d') AS effectiveTo FROM project_billing_rates WHERE project_id = ? FOR UPDATE`, [project.id])
    const assignments = await all(connection, `SELECT a.id, a.active, e.employee_code AS employeeCode,
      DATE_FORMAT(a.starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(a.ends_on, '%Y-%m-%d') AS endsOn
      FROM employee_project_assignments a JOIN employees e ON e.id = a.employee_id WHERE a.project_id = ? FOR UPDATE`, [project.id])
    const classifications = await all(connection, 'SELECT id, activity_id AS activityId, active, billable FROM project_activity_assignments WHERE project_id = ? FOR UPDATE', [project.id])
    expect(rates.length === 1 && Number(rates[0]?.amount) === fixture.rate && rates[0]?.currency === fixture.currency
      && Boolean(rates[0]?.active) && rates[0]?.effectiveFrom === '2026-09-01' && rates[0]?.effectiveTo === '2026-09-30'
      && assignments.length === 1 && assignments[0]?.employeeCode === fixture.employeeCode && Boolean(assignments[0]?.active)
      && assignments[0]?.startsOn === '2026-09-01' && assignments[0]?.endsOn === '2026-09-30'
      && classifications.length === 1 && Number(classifications[0]?.activityId) === Number(activity.id)
      && Boolean(classifications[0]?.active) && Boolean(classifications[0]?.billable), 'The fixture project configuration changed; rollback stopped.')
    const linkedProjects = await all(connection, 'SELECT id FROM projects WHERE client_id = ? AND id <> ?', [client.id, project.id])
    expect(linkedProjects.length === 0, 'Another project now uses the fixture client; rollback stopped.')
    const linkedLines = await all(connection, `SELECT il.id, il.invoice_id AS invoiceId, il.timesheet_entry_id AS entryId
      FROM invoice_lines il WHERE il.timesheet_entry_id IN (?,?,?) FOR UPDATE`, entries.map((entry) => entry.id))
    expect((invoice && linkedLines.length === 1 && Number(linkedLines[0]?.invoiceId) === Number(invoice.id)) || (!invoice && linkedLines.length === 0), 'Fixture entries are linked to other invoices; rollback stopped.')
    if (invoice) {
      const invoiceLines = await all(connection, 'SELECT id FROM invoice_lines WHERE invoice_id = ? FOR UPDATE', [invoice.id])
      const audit = await all(connection, "SELECT id, after_state AS afterState FROM finance_audit_events WHERE entity_type = 'invoice' AND entity_id = ? FOR UPDATE", [invoice.id])
      expect(invoiceLines.length === 1 && audit.length === 3 && audit.every((event) => String(event.afterState).includes(fixture.key)), 'The fixture invoice was edited; rollback stopped.')
    }
    if (checkOnly) {
      await connection.rollback()
      console.log('Rollback preflight passed. Run npm run demo:revert -- --apply when you want to remove this fixture.')
      return
    }
    if (invoice) {
      await connection.query("DELETE FROM finance_audit_events WHERE entity_type = 'invoice' AND entity_id = ?", [invoice.id])
      await connection.query('DELETE FROM invoice_lines WHERE invoice_id = ?', [invoice.id])
      await connection.query('DELETE FROM invoices WHERE id = ?', [invoice.id])
    }
    await connection.query('UPDATE timesheet_entries SET project_id = NULL, activity_id = ?, work_description = ? WHERE project_id = ? AND activity_id = ? AND work_description = ?',
      [oldActivity.id, fixture.oldDescription, project.id, activity.id, fixture.entryDescription])
    await connection.query('DELETE FROM employee_project_assignments WHERE project_id = ?', [project.id])
    await connection.query('DELETE FROM project_activity_assignments WHERE project_id = ?', [project.id])
    await connection.query('DELETE FROM project_billing_rates WHERE project_id = ?', [project.id])
    await connection.query('DELETE FROM projects WHERE id = ?', [project.id])
    await connection.query('DELETE FROM activities WHERE id = ?', [activity.id])
    await connection.query('DELETE FROM clients WHERE id = ?', [client.id])
    if (leave) await connection.query('DELETE FROM employee_leave_records WHERE id = ?', [leave.id])
    if (holiday?.name === fixture.holidayName) await connection.query('DELETE FROM public_holidays WHERE id = ?', [holiday.id])
    await connection.commit()
    console.log('Showcase reverted. The 3 original internal entries were restored; fixture invoice, billing setup, leave, and holiday were removed.')
  } catch (error) {
    await connection.rollback()
    throw error
  }
}

async function main() {
  const reverting = process.argv.includes('--revert')
  const applying = process.argv.includes('--apply')
  if (!applying && !reverting) {
    console.log('Seed is ready. Run npm run demo:showcase -- --apply to add the small showcase fixture.')
    return
  }
  const dbCa = String(process.env.DB_CA || '').replace(/\\n/g, '\n').trim()
  const pool = mysql.createPool({
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'pulseai',
    ...(process.env.DB_SSL?.toLowerCase() === 'true' ? { ssl: { rejectUnauthorized: Boolean(dbCa) || process.env.DB_SSL_REJECT_UNAUTHORIZED?.toLowerCase() === 'true', ...(dbCa ? { ca: dbCa } : {}) } } : {}),
  })
  try {
    const connection = await pool.getConnection()
    try { if (reverting) await revert(connection, !applying); else await seed(connection) }
    finally { connection.release() }
  } finally { await pool.end() }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
