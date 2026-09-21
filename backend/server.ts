import 'dotenv/config'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import mysql, { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'

type Role = 'employee' | 'manager' | 'hr' | 'director'
type AuthRequest = { name?: string; email?: string; password?: string; role?: string; credential?: string }

interface UserRecord extends RowDataPacket {
  id: number
  name: string
  email: string
  password_hash: string | null
  google_sub: string | null
  avatar_url: string | null
  role: Role
}

const app = express()
const port = Number(process.env.PORT || 4000)
const dbName = process.env.DB_NAME || 'pulseai'
const jwtSecret = process.env.JWT_SECRET
const googleClientId = process.env.GOOGLE_CLIENT_ID
const validRoles = new Set<Role>(['employee', 'manager', 'hr', 'director'])

if (!jwtSecret) throw new Error('JWT_SECRET is required. Copy backend/.env.example to backend/.env and set it.')

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())

let pool: mysql.Pool
let googleClient: OAuth2Client | undefined
const baseDbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
}

const publicUser = (user: Pick<UserRecord, 'id' | 'name' | 'email' | 'role' | 'avatar_url'>) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  avatarUrl: user.avatar_url || null,
})

const issueToken = (user: Pick<UserRecord, 'id' | 'email' | 'role'>) =>
  jwt.sign({ sub: user.id, role: user.role, email: user.email }, jwtSecret, { expiresIn: '8h' })

function validRole(role: unknown): Role | null {
  const normalized = String(role || '').toLowerCase()
  return validRoles.has(normalized as Role) ? normalized as Role : null
}

async function initializeDatabase() {
  const bootstrap = await mysql.createConnection(baseDbConfig)
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${dbName.replace(/`/g, '``')}\``)
  await bootstrap.end()

  pool = mysql.createPool({ ...baseDbConfig, database: dbName, waitForConnections: true, connectionLimit: 10 })
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NULL,
    google_sub VARCHAR(255) NULL,
    avatar_url VARCHAR(500) NULL,
    role ENUM('employee', 'manager', 'hr', 'director') NOT NULL DEFAULT 'employee',
    auth_provider ENUM('password', 'google') NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    UNIQUE KEY uq_users_google_sub (google_sub)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  await pool.query(`CREATE TABLE IF NOT EXISTS departments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(30) NOT NULL,
    name VARCHAR(120) NOT NULL,
    PRIMARY KEY (id), UNIQUE KEY uq_departments_code (code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS employees (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_code VARCHAR(30) NOT NULL,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL,
    department_id BIGINT UNSIGNED NOT NULL,
    manager_name VARCHAR(120) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (id), UNIQUE KEY uq_employees_code (employee_code),
    CONSTRAINT fk_employee_department FOREIGN KEY (department_id) REFERENCES departments(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS timesheets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_id BIGINT UNSIGNED NOT NULL,
    period_label VARCHAR(40) NOT NULL,
    total_hours DECIMAL(7,2) NOT NULL DEFAULT 0,
    status ENUM('draft', 'submitted', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
    submitted_at TIMESTAMP NULL,
    approved_at TIMESTAMP NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_timesheet_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query('ALTER TABLE timesheets ADD COLUMN remarks VARCHAR(500) NULL').catch(() => undefined)
  await pool.query('ALTER TABLE timesheets ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP').catch(() => undefined)
  await pool.query(`CREATE TABLE IF NOT EXISTS validation_findings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    timesheet_id BIGINT UNSIGNED NOT NULL,
    severity ENUM('warning', 'critical') NOT NULL,
    finding_type VARCHAR(80) NOT NULL,
    message VARCHAR(255) NOT NULL,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_finding_timesheet FOREIGN KEY (timesheet_id) REFERENCES timesheets(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS audit_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_name VARCHAR(120) NOT NULL,
    action VARCHAR(120) NOT NULL,
    target VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    title VARCHAR(160) NOT NULL,
    message VARCHAR(255) NOT NULL,
    notification_type ENUM('info', 'warning', 'critical') NOT NULL DEFAULT 'info',
    read_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query('ALTER TABLE notifications ADD COLUMN recipient_email VARCHAR(255) NULL').catch(() => undefined)
  await pool.query(`CREATE TABLE IF NOT EXISTS reporting_periods (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, label VARCHAR(40) NOT NULL, starts_on DATE NOT NULL, ends_on DATE NOT NULL, submission_deadline DATE NULL, standard_daily_hours DECIMAL(4,2) NOT NULL DEFAULT 8, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY uq_reporting_period_label (label)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS projects (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, code VARCHAR(40) NOT NULL, name VARCHAR(160) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY uq_project_code (code)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS activities (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, name VARCHAR(120) NOT NULL, category ENUM('project','internal') NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY (id), UNIQUE KEY uq_activity_name_category (name, category)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS employee_project_assignments (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, employee_id BIGINT UNSIGNED NOT NULL, project_id BIGINT UNSIGNED NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, starts_on DATE NULL, ends_on DATE NULL, PRIMARY KEY (id), UNIQUE KEY uq_employee_project (employee_id, project_id), CONSTRAINT fk_assignment_employee FOREIGN KEY (employee_id) REFERENCES employees(id), CONSTRAINT fk_assignment_project FOREIGN KEY (project_id) REFERENCES projects(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS public_holidays (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, holiday_date DATE NOT NULL, name VARCHAR(120) NOT NULL, region VARCHAR(60) NOT NULL DEFAULT 'default', PRIMARY KEY (id), UNIQUE KEY uq_holiday_date_region (holiday_date, region)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS employee_leave_records (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, employee_id BIGINT UNSIGNED NOT NULL, starts_on DATE NOT NULL, ends_on DATE NOT NULL, leave_type VARCHAR(80) NOT NULL, status ENUM('approved') NOT NULL DEFAULT 'approved', source_reference VARCHAR(120) NULL, PRIMARY KEY (id), CONSTRAINT fk_leave_employee FOREIGN KEY (employee_id) REFERENCES employees(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS timesheet_entries (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, timesheet_id BIGINT UNSIGNED NOT NULL, entry_date DATE NOT NULL, project_id BIGINT UNSIGNED NULL, activity_id BIGINT UNSIGNED NOT NULL, hours DECIMAL(5,2) NOT NULL, work_description VARCHAR(500) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), KEY idx_entry_timesheet_date (timesheet_id, entry_date), CONSTRAINT fk_entry_timesheet FOREIGN KEY (timesheet_id) REFERENCES timesheets(id) ON DELETE CASCADE, CONSTRAINT fk_entry_project FOREIGN KEY (project_id) REFERENCES projects(id), CONSTRAINT fk_entry_activity FOREIGN KEY (activity_id) REFERENCES activities(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS timesheet_audit_events (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, timesheet_id BIGINT UNSIGNED NOT NULL, actor_user_id BIGINT UNSIGNED NULL, event_type ENUM('draft_saved','entry_added','entry_updated','entry_deleted','submitted','returned','resubmitted','approved') NOT NULL, detail VARCHAR(500) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), KEY idx_timesheet_audit (timesheet_id, created_at), CONSTRAINT fk_timesheet_audit_timesheet FOREIGN KEY (timesheet_id) REFERENCES timesheets(id) ON DELETE CASCADE, CONSTRAINT fk_timesheet_audit_user FOREIGN KEY (actor_user_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query('ALTER TABLE timesheets ADD COLUMN reporting_period_id BIGINT UNSIGNED NULL').catch(() => undefined)
  await pool.query('ALTER TABLE timesheets ADD COLUMN returned_at TIMESTAMP NULL').catch(() => undefined)
  await pool.query('ALTER TABLE timesheets ADD COLUMN reviewer_user_id BIGINT UNSIGNED NULL').catch(() => undefined)
  await pool.query('ALTER TABLE timesheets ADD COLUMN return_reason VARCHAR(500) NULL').catch(() => undefined)
  await pool.query('ALTER TABLE timesheets ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1').catch(() => undefined)
  await pool.query("ALTER TABLE timesheets MODIFY COLUMN status ENUM('draft','submitted','resubmitted','approved','returned','rejected') NOT NULL DEFAULT 'draft'").catch(() => undefined)
  await pool.query('ALTER TABLE notifications ADD COLUMN timesheet_id BIGINT UNSIGNED NULL').catch(() => undefined)
  await pool.query('ALTER TABLE employees ADD COLUMN manager_user_id BIGINT UNSIGNED NULL').catch(() => undefined)
  await pool.query(`CREATE TABLE IF NOT EXISTS billing_cycles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    period_label VARCHAR(40) NOT NULL,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    submission_deadline DATE NOT NULL,
    current_stage ENUM('cycle_initiated', 'hr_data_uploaded', 'b1_travel_updated', 'timesheet_entry', 'manager_submission', 'director_approval', 'oracle_export') NOT NULL DEFAULT 'cycle_initiated',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_billing_cycles_period (period_label)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS department_submissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    department_id BIGINT UNSIGNED NOT NULL,
    period_label VARCHAR(40) NOT NULL,
    status ENUM('submitted', 'approved', 'returned') NOT NULL DEFAULT 'submitted',
    submitted_by VARCHAR(120) NOT NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by VARCHAR(255) NULL,
    decided_at TIMESTAMP NULL,
    return_reason VARCHAR(500) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_department_submission_period (department_id, period_label),
    CONSTRAINT fk_submission_department FOREIGN KEY (department_id) REFERENCES departments(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await seedDirectorAccounts()
  await seedManagerAccounts()
  if (process.env.SEED_DEMO_DATA === 'true') { await seedDemoData(); await seedDemoBillingCycle(); await seedDemoApprovals(); await seedEmployeeWorkspaceData() }
}

async function seedDemoData() {
  const [departmentRows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM departments')
  if (Number(departmentRows[0]?.count || 0) > 0) return
  const departments = [['ENG', 'Engineering'], ['OPS', 'Operations'], ['FIN', 'Finance'], ['HR', 'Human Resources']]
  for (const [code, name] of departments) await pool.query('INSERT INTO departments (code, name) VALUES (?, ?)', [code, name])
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id, code FROM departments')
  const departmentId = new Map(rows.map((row) => [row.code as string, row.id as number]))
  const employees = [
    ['E101', 'Aarav Sharma', 'aarav@emerson.demo', 'ENG', 'Meera Iyer', 168, 'approved'], ['E102', 'Priya Nair', 'priya@emerson.demo', 'ENG', 'Meera Iyer', 160, 'submitted'], ['E103', 'Rohan Gupta', 'rohan@emerson.demo', 'ENG', 'Meera Iyer', 172, 'approved'],
    ['E201', 'Kavya Rao', 'kavya@emerson.demo', 'OPS', 'Dev Malhotra', 167, 'approved'], ['E202', 'Arjun Singh', 'arjun@emerson.demo', 'OPS', 'Dev Malhotra', 0, 'draft'], ['E203', 'Neha Kapoor', 'neha@emerson.demo', 'OPS', 'Dev Malhotra', 148, 'submitted'],
    ['E301', 'Sanjay Patel', 'sanjay@emerson.demo', 'FIN', 'Ritu Shah', 166, 'approved'], ['E302', 'Isha Verma', 'isha@emerson.demo', 'FIN', 'Ritu Shah', 167, 'rejected'], ['E303', 'Vikram Das', 'vikram@emerson.demo', 'FIN', 'Ritu Shah', 168, 'approved'],
    ['E401', 'Ananya Bose', 'ananya@emerson.demo', 'HR', 'Nikhil Roy', 167, 'approved'], ['E402', 'Rahul Jain', 'rahul@emerson.demo', 'HR', 'Nikhil Roy', 120, 'submitted'], ['E403', 'Simran Kaur', 'simran@emerson.demo', 'HR', 'Nikhil Roy', 0, 'draft'],
  ]
  for (const [code, name, email, department, manager, hours, status] of employees) {
    const [employee] = await pool.query<ResultSetHeader>('INSERT INTO employees (employee_code, name, email, department_id, manager_name) VALUES (?, ?, ?, ?, ?)', [code, name, email, departmentId.get(department as string), manager])
    const submittedAt = status === 'draft' ? null : new Date()
    await pool.query('INSERT INTO timesheets (employee_id, period_label, total_hours, status, submitted_at, approved_at) VALUES (?, ?, ?, ?, ?, ?)', [employee.insertId, 'September 2026', hours, status, submittedAt, status === 'approved' ? new Date() : null])
  }
  const [timesheets] = await pool.query<RowDataPacket[]>('SELECT t.id, e.employee_code FROM timesheets t JOIN employees e ON e.id = t.employee_id')
  const idFor = new Map(timesheets.map((row) => [row.employee_code as string, row.id as number]))
  await pool.query('INSERT INTO validation_findings (timesheet_id, severity, finding_type, message) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)', [idFor.get('E203'), 'warning', 'Low hours', '148 hours recorded; review supporting remarks.', idFor.get('E402'), 'critical', 'Low hours', '120 hours recorded; action required before approval.', idFor.get('E302'), 'critical', 'Rejected timesheet', 'Returned for correction: missing project allocation.'])
  await pool.query('INSERT INTO audit_events (actor_name, action, target) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)', ['Meera Iyer', 'Approved timesheet', 'Aarav Sharma - September 2026', 'Ritu Shah', 'Rejected timesheet', 'Isha Verma - missing project allocation', 'System', 'Created reminder', '2 employees have not submitted September timesheets'])
  await pool.query('INSERT INTO notifications (title, message, notification_type) VALUES (?, ?, ?), (?, ?, ?)', ['2 timesheets are overdue', 'Arjun Singh and Simran Kaur have not submitted September timesheets.', 'critical', 'Three exceptions need review', 'Low hours and a rejected submission require follow-up.', 'warning'])
  console.log('Seeded Pulse AI Director demo data.')
}

async function seedDemoBillingCycle() {
  await pool.query(`INSERT INTO billing_cycles (period_label, starts_on, ends_on, submission_deadline, current_stage)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE period_label = VALUES(period_label)`,
  ['September 2026', '2026-08-23', '2026-09-22', '2026-09-25', 'timesheet_entry'])
}

async function seedDemoApprovals() {
  const [departments] = await pool.query<RowDataPacket[]>('SELECT id, code FROM departments')
  const departmentIds = new Map(departments.map((department) => [department.code as string, department.id as number]))
  const submissions: Array<[string, 'submitted' | 'approved' | 'returned', string, string | null]> = [
    ['ENG', 'submitted', 'Meera Iyer', null], ['OPS', 'submitted', 'Dev Malhotra', null], ['HR', 'submitted', 'Nikhil Roy', null], ['FIN', 'returned', 'Ritu Shah', 'Please correct the rejected employee entry before resubmission.'],
  ]
  for (const [code, status, submittedBy, returnReason] of submissions) {
    const departmentId = departmentIds.get(code)
    if (!departmentId) continue
    await pool.query('INSERT IGNORE INTO department_submissions (department_id, period_label, status, submitted_by, return_reason, decided_at) VALUES (?, ?, ?, ?, ?, ?)', [departmentId, 'September 2026', status, submittedBy, returnReason, status === 'returned' ? new Date() : null])
  }
  await pool.query('UPDATE billing_cycles SET current_stage = ? WHERE period_label = ? AND current_stage = ?', ['director_approval', 'September 2026', 'timesheet_entry'])
}

async function seedEmployeeWorkspaceData() {
  await pool.query('INSERT IGNORE INTO reporting_periods (label, starts_on, ends_on, submission_deadline, standard_daily_hours, active) VALUES (?, ?, ?, ?, ?, ?)', ['September 2026', '2026-09-01', '2026-09-30', '2026-09-25', 8, true])
  await pool.query('INSERT IGNORE INTO projects (code, name) VALUES (?, ?), (?, ?)', ['PULSE-OPS', 'Pulse operations', 'CLIENT-DELIVERY', 'Client delivery'])
  await pool.query("INSERT IGNORE INTO activities (name, category) VALUES ('Delivery work', 'project'), ('Project planning', 'project'), ('Training', 'internal'), ('Internal meeting', 'internal')")
  const [employees] = await pool.query<RowDataPacket[]>('SELECT id FROM employees WHERE active = TRUE')
  const [projects] = await pool.query<RowDataPacket[]>('SELECT id FROM projects WHERE active = TRUE')
  for (const employee of employees) for (const project of projects) await pool.query('INSERT IGNORE INTO employee_project_assignments (employee_id, project_id, active) VALUES (?, ?, TRUE)', [employee.id, project.id])
}

async function seedDirectorAccounts() {
  const accounts = [1, 2, 3].map((index) => ({
    name: process.env[`DIRECTOR_${index}_NAME`] || `Pulse AI Director ${index}`,
    email: String(process.env[`DIRECTOR_${index}_EMAIL`] || '').trim().toLowerCase(),
    password: process.env[`DIRECTOR_${index}_PASSWORD`] || '',
  }))

  for (const account of accounts) {
    if (!/^\S+@\S+\.\S+$/.test(account.email) || account.password.length < 8) continue
    const [existing] = await pool.query<UserRecord[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [account.email])
    const passwordHash = await bcrypt.hash(account.password, 12)
    if (existing.length) {
      await pool.query('UPDATE users SET name = ?, password_hash = ?, role = ?, auth_provider = ? WHERE email = ?', [account.name, passwordHash, 'director', 'password', account.email])
      console.log(`Synchronized approved Director account: ${account.email}`)
    } else {
      await pool.query('INSERT INTO users (name, email, password_hash, role, auth_provider) VALUES (?, ?, ?, ?, ?)', [account.name, account.email, passwordHash, 'director', 'password'])
      console.log(`Seeded approved Director account: ${account.email}`)
    }
  }
}

async function seedManagerAccounts() {
  const accounts = [1, 2, 3, 4].map((index) => ({
    name: String(process.env[`MANAGER_${index}_NAME`] || '').trim(),
    email: String(process.env[`MANAGER_${index}_EMAIL`] || '').trim().toLowerCase(),
    password: process.env[`MANAGER_${index}_PASSWORD`] || '',
  }))
  for (const account of accounts) {
    if (account.name.length < 2 || !/^\S+@\S+\.\S+$/.test(account.email) || account.password.length < 8) continue
    const [existing] = await pool.query<UserRecord[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [account.email])
    const passwordHash = await bcrypt.hash(account.password, 12)
    let userId: number
    if (existing[0]) { userId = existing[0].id; await pool.query('UPDATE users SET name = ?, password_hash = ?, role = ?, auth_provider = ? WHERE id = ?', [account.name, passwordHash, 'manager', 'password', userId]) }
    else { const [created] = await pool.query<ResultSetHeader>('INSERT INTO users (name, email, password_hash, role, auth_provider) VALUES (?, ?, ?, ?, ?)', [account.name, account.email, passwordHash, 'manager', 'password']); userId = created.insertId }
    await pool.query('UPDATE employees SET manager_user_id = ? WHERE manager_name = ?', [userId, account.name])
    console.log(`Synchronized Manager account: ${account.email}`)
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'Pulse AI API' }))

type AuthenticatedRequest = Request & { actor?: { id: number; role: Role; email: string } }

function requireDirector(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ message: 'Sign in is required.' })
  try {
    const payload = jwt.verify(token, jwtSecret!)
    if (typeof payload === 'string' || payload.role !== 'director') return res.status(403).json({ message: 'Director access is required.' })
    req.actor = { id: Number(payload.sub), role: 'director', email: String(payload.email) }
    return next()
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' })
  }
}

function requireEmployee(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ message: 'Sign in is required.' })
  try {
    const payload = jwt.verify(token, jwtSecret!)
    if (typeof payload === 'string' || payload.role !== 'employee') return res.status(403).json({ message: 'Employee access is required.' })
    req.actor = { id: Number(payload.sub), role: 'employee', email: String(payload.email) }
    return next()
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' })
  }
}

function requireManager(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ message: 'Sign in is required.' })
  try {
    const payload = jwt.verify(token, jwtSecret!)
    if (typeof payload === 'string' || payload.role !== 'manager') return res.status(403).json({ message: 'Manager access is required.' })
    req.actor = { id: Number(payload.sub), role: 'manager', email: String(payload.email) }
    return next()
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' })
  }
}

async function employeeForActor(actor: NonNullable<AuthenticatedRequest['actor']>) {
  const [employees] = await pool.query<RowDataPacket[]>('SELECT e.id, e.employee_code AS employeeCode, e.name, e.email, e.manager_name AS managerName, d.name AS department FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.email = ? AND e.active = TRUE LIMIT 1', [actor.email])
  return employees[0]
}

async function activeReportingPeriod() {
  // DATE columns must remain calendar dates. Returning them as JavaScript Date objects
  // shifts them in UTC+05:30 and can make a valid September entry appear to be August.
  const [periods] = await pool.query<RowDataPacket[]>("SELECT id, label, DATE_FORMAT(starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(ends_on, '%Y-%m-%d') AS endsOn, DATE_FORMAT(submission_deadline, '%Y-%m-%d') AS submissionDeadline, standard_daily_hours AS standardDailyHours FROM reporting_periods WHERE active = TRUE ORDER BY starts_on DESC LIMIT 1")
  return periods[0]
}

async function employeeCycleIsClosed(periodLabel: string) {
  const [cycles] = await pool.query<RowDataPacket[]>('SELECT current_stage AS currentStage FROM billing_cycles WHERE period_label = ? LIMIT 1', [periodLabel])
  return cycles[0]?.currentStage === 'oracle_export'
}

function isWeekday(date: string) { const day = new Date(`${date}T00:00:00`).getDay(); return day !== 0 && day !== 6 }

async function ownedTimesheet(employeeId: number, period: RowDataPacket, create = false) {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM timesheets WHERE employee_id = ? AND reporting_period_id = ? LIMIT 1', [employeeId, period.id])
  if (rows[0] || !create) return rows[0]
  const [result] = await pool.query<ResultSetHeader>('INSERT INTO timesheets (employee_id, reporting_period_id, period_label, total_hours, status) VALUES (?, ?, ?, 0, ?)', [employeeId, period.id, period.label, 'draft'])
  const [created] = await pool.query<RowDataPacket[]>('SELECT * FROM timesheets WHERE id = ?', [result.insertId])
  return created[0]
}

async function syncTimesheetTotal(timesheetId: number) {
  const [[sum]] = await pool.query<RowDataPacket[]>('SELECT COALESCE(SUM(hours), 0) AS total FROM timesheet_entries WHERE timesheet_id = ?', [timesheetId])
  await pool.query('UPDATE timesheets SET total_hours = ?, version = version + 1 WHERE id = ?', [sum?.total || 0, timesheetId])
}

app.get('/api/employee/timesheet', requireEmployee, async (req: AuthenticatedRequest, res, next) => {
  try {
    const employee = await employeeForActor(req.actor!)
    const period = await activeReportingPeriod()
    if (!employee || !period) return res.status(404).json({ message: 'No active employee or reporting period found.' })
    const timesheet = await ownedTimesheet(employee.id, period)
    const [entries] = timesheet ? await pool.query<RowDataPacket[]>(`SELECT e.id, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entryDate, e.project_id AS projectId, p.code AS projectCode, p.name AS projectName, e.activity_id AS activityId, a.name AS activityName, a.category AS activityCategory, e.hours, e.work_description AS workDescription FROM timesheet_entries e LEFT JOIN projects p ON p.id = e.project_id JOIN activities a ON a.id = e.activity_id WHERE e.timesheet_id = ? ORDER BY e.entry_date, e.id`, [timesheet.id]) : [[]]
    const [projects] = await pool.query<RowDataPacket[]>('SELECT p.id, p.code, p.name FROM employee_project_assignments a JOIN projects p ON p.id = a.project_id WHERE a.employee_id = ? AND a.active = TRUE AND p.active = TRUE ORDER BY p.name', [employee.id])
    const [activities] = await pool.query<RowDataPacket[]>('SELECT id, name, category FROM activities WHERE active = TRUE ORDER BY category, name')
    const [holidays] = await pool.query<RowDataPacket[]>("SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holidayDate, name FROM public_holidays WHERE holiday_date BETWEEN ? AND ?", [period.startsOn, period.endsOn])
    const [leave] = await pool.query<RowDataPacket[]>("SELECT DATE_FORMAT(starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(ends_on, '%Y-%m-%d') AS endsOn, leave_type AS leaveType FROM employee_leave_records WHERE employee_id = ? AND status = 'approved' AND ends_on >= ? AND starts_on <= ?", [employee.id, period.startsOn, period.endsOn])
    const [audit] = timesheet ? await pool.query<RowDataPacket[]>('SELECT event_type AS eventType, detail, created_at AS createdAt FROM timesheet_audit_events WHERE timesheet_id = ? ORDER BY created_at DESC LIMIT 20', [timesheet.id]) : [[]]
    const [notifications] = await pool.query<RowDataPacket[]>('SELECT id, title, message, notification_type AS type, read_at AS readAt, created_at AS createdAt, timesheet_id AS timesheetId FROM notifications WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 30', [req.actor!.email])
    const [cycles] = await pool.query<RowDataPacket[]>("SELECT period_label AS periodLabel, DATE_FORMAT(starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(ends_on, '%Y-%m-%d') AS endsOn, DATE_FORMAT(submission_deadline, '%Y-%m-%d') AS submissionDeadline, current_stage AS currentStage FROM billing_cycles WHERE period_label = ? LIMIT 1", [period.label])
    const [history] = await pool.query<RowDataPacket[]>(`SELECT t.id, t.period_label AS periodLabel, t.total_hours AS totalHours, t.status, t.submitted_at AS submittedAt, t.approved_at AS approvedAt, t.return_reason AS returnReason, reviewer.name AS reviewerName
      FROM timesheets t LEFT JOIN users reviewer ON reviewer.id = t.reviewer_user_id WHERE t.employee_id = ? ORDER BY COALESCE(t.reporting_period_id, 0) DESC, t.updated_at DESC LIMIT 24`, [employee.id])
    return res.json({ employee, period, billingCycle: cycles[0] || null, timesheet: timesheet ? { id: timesheet.id, status: timesheet.status, totalHours: timesheet.total_hours, returnReason: timesheet.return_reason, submittedAt: timesheet.submitted_at, reviewerName: timesheet.reviewer_user_id ? (history.find((item) => item.id === timesheet.id)?.reviewerName || null) : null, version: timesheet.version } : null, entries, projects, activities, holidays, leave, audit, notifications, history })
  } catch (error) { next(error) }
})

app.post('/api/employee/timesheet/entries', requireEmployee, async (req: AuthenticatedRequest, res, next) => {
  try {
    const employee = await employeeForActor(req.actor!); const period = await activeReportingPeriod()
    if (!employee || !period) return res.status(404).json({ message: 'No active employee or reporting period found.' })
    if (await employeeCycleIsClosed(period.label)) return res.status(409).json({ message: 'This billing cycle is closed. Contact your Manager or HR for assistance.' })
    const entryDate = String(req.body?.entryDate || ''); const projectId = req.body?.projectId ? Number(req.body.projectId) : null; const activityId = Number(req.body?.activityId); const hours = Number(req.body?.hours); const workDescription = String(req.body?.workDescription || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || entryDate < String(period.startsOn).slice(0, 10) || entryDate > String(period.endsOn).slice(0, 10)) return res.status(400).json({ message: 'Choose a workday within the active reporting period.' })
    if (!isWeekday(entryDate) || !Number.isFinite(hours) || hours <= 0 || hours > 24 || !Number.isInteger(activityId)) return res.status(400).json({ message: 'Enter a valid weekday, activity, and hours between 0 and 24.' })
    const timesheet = await ownedTimesheet(employee.id, period, true)
    if (!timesheet) return res.status(500).json({ message: 'Unable to prepare a timesheet.' })
    if (!['draft', 'returned', 'rejected'].includes(timesheet.status)) return res.status(409).json({ message: 'This timesheet is read-only while it is under review or approved.' })
    const [activityRows] = await pool.query<RowDataPacket[]>('SELECT id, category FROM activities WHERE id = ? AND active = TRUE LIMIT 1', [activityId]); const activity = activityRows[0]
    if (!activity || (activity.category === 'project' && !projectId) || (activity.category === 'internal' && projectId)) return res.status(400).json({ message: 'Choose a valid project/activity combination.' })
    if (projectId) { const [assigned] = await pool.query<RowDataPacket[]>('SELECT id FROM employee_project_assignments WHERE employee_id = ? AND project_id = ? AND active = TRUE LIMIT 1', [employee.id, projectId]); if (!assigned[0]) return res.status(403).json({ message: 'This project is not assigned to you.' }) }
    const [[daily]] = await pool.query<RowDataPacket[]>('SELECT COALESCE(SUM(hours), 0) AS total FROM timesheet_entries WHERE timesheet_id = ? AND entry_date = ?', [timesheet.id, entryDate])
    if (Number(daily?.total || 0) + hours > 24) return res.status(400).json({ message: 'Daily total cannot exceed 24 hours.' })
    const [duplicates] = await pool.query<RowDataPacket[]>('SELECT id FROM timesheet_entries WHERE timesheet_id = ? AND entry_date = ? AND activity_id = ? AND (project_id <=> ?) LIMIT 1', [timesheet.id, entryDate, activityId, projectId])
    if (duplicates[0]) return res.status(409).json({ message: 'An entry already exists for this date, project, and activity.' })
    const [result] = await pool.query<ResultSetHeader>('INSERT INTO timesheet_entries (timesheet_id, entry_date, project_id, activity_id, hours, work_description) VALUES (?, ?, ?, ?, ?, ?)', [timesheet.id, entryDate, projectId, activityId, hours, workDescription || null])
    await syncTimesheetTotal(timesheet.id); await pool.query('INSERT INTO timesheet_audit_events (timesheet_id, actor_user_id, event_type, detail) VALUES (?, ?, ?, ?)', [timesheet.id, req.actor!.id, 'entry_added', `Added entry ${result.insertId}`])
    return res.status(201).json({ message: 'Entry added.' })
  } catch (error) { next(error) }
})

app.delete('/api/employee/timesheet/entries/:id', requireEmployee, async (req: AuthenticatedRequest, res, next) => {
  try {
    const employee = await employeeForActor(req.actor!); const period = await activeReportingPeriod()
    if (!employee || !period) return res.status(404).json({ message: 'No active employee or reporting period found.' })
    if (await employeeCycleIsClosed(period.label)) return res.status(409).json({ message: 'This billing cycle is closed. Contact your Manager or HR for assistance.' })
    const timesheet = await ownedTimesheet(employee.id, period)
    if (!timesheet || !['draft', 'returned', 'rejected'].includes(timesheet.status)) return res.status(409).json({ message: 'This timesheet cannot be edited.' })
    const [result] = await pool.query<ResultSetHeader>('DELETE FROM timesheet_entries WHERE id = ? AND timesheet_id = ?', [req.params.id, timesheet.id])
    if (!result.affectedRows) return res.status(404).json({ message: 'Entry not found.' })
    await syncTimesheetTotal(timesheet.id); await pool.query('INSERT INTO timesheet_audit_events (timesheet_id, actor_user_id, event_type, detail) VALUES (?, ?, ?, ?)', [timesheet.id, req.actor!.id, 'entry_deleted', `Deleted entry ${req.params.id}`])
    return res.json({ message: 'Entry deleted.' })
  } catch (error) { next(error) }
})

app.put('/api/employee/timesheet/entries/:id', requireEmployee, async (req: AuthenticatedRequest, res, next) => {
  try {
    const employee = await employeeForActor(req.actor!); const period = await activeReportingPeriod()
    if (!employee || !period) return res.status(404).json({ message: 'No active employee or reporting period found.' })
    if (await employeeCycleIsClosed(period.label)) return res.status(409).json({ message: 'This billing cycle is closed. Contact your Manager or HR for assistance.' })
    const timesheet = await ownedTimesheet(employee.id, period)
    if (!timesheet || !['draft', 'returned', 'rejected'].includes(timesheet.status)) return res.status(409).json({ message: 'This timesheet cannot be edited.' })
    const entryDate = String(req.body?.entryDate || ''); const projectId = req.body?.projectId ? Number(req.body.projectId) : null; const activityId = Number(req.body?.activityId); const hours = Number(req.body?.hours); const workDescription = String(req.body?.workDescription || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || entryDate < period.startsOn || entryDate > period.endsOn || !isWeekday(entryDate) || !Number.isFinite(hours) || hours <= 0 || hours > 24 || !Number.isInteger(activityId)) return res.status(400).json({ message: 'Enter a valid weekday, activity, and hours within this reporting period.' })
    const [current] = await pool.query<RowDataPacket[]>('SELECT id FROM timesheet_entries WHERE id = ? AND timesheet_id = ? LIMIT 1', [req.params.id, timesheet.id])
    if (!current[0]) return res.status(404).json({ message: 'Entry not found.' })
    const [activityRows] = await pool.query<RowDataPacket[]>('SELECT id, category FROM activities WHERE id = ? AND active = TRUE LIMIT 1', [activityId]); const activity = activityRows[0]
    if (!activity || (activity.category === 'project' && !projectId) || (activity.category === 'internal' && projectId)) return res.status(400).json({ message: 'Choose a valid project/activity combination.' })
    if (projectId) { const [assigned] = await pool.query<RowDataPacket[]>('SELECT id FROM employee_project_assignments WHERE employee_id = ? AND project_id = ? AND active = TRUE LIMIT 1', [employee.id, projectId]); if (!assigned[0]) return res.status(403).json({ message: 'This project is not assigned to you.' }) }
    const [[daily]] = await pool.query<RowDataPacket[]>('SELECT COALESCE(SUM(hours), 0) AS total FROM timesheet_entries WHERE timesheet_id = ? AND entry_date = ? AND id <> ?', [timesheet.id, entryDate, req.params.id])
    if (Number(daily?.total || 0) + hours > 24) return res.status(400).json({ message: 'Daily total cannot exceed 24 hours.' })
    const [duplicates] = await pool.query<RowDataPacket[]>('SELECT id FROM timesheet_entries WHERE timesheet_id = ? AND entry_date = ? AND activity_id = ? AND (project_id <=> ?) AND id <> ? LIMIT 1', [timesheet.id, entryDate, activityId, projectId, req.params.id])
    if (duplicates[0]) return res.status(409).json({ message: 'An entry already exists for this date, project, and activity.' })
    await pool.query('UPDATE timesheet_entries SET entry_date = ?, project_id = ?, activity_id = ?, hours = ?, work_description = ? WHERE id = ? AND timesheet_id = ?', [entryDate, projectId, activityId, hours, workDescription || null, req.params.id, timesheet.id])
    await syncTimesheetTotal(timesheet.id); await pool.query('INSERT INTO timesheet_audit_events (timesheet_id, actor_user_id, event_type, detail) VALUES (?, ?, ?, ?)', [timesheet.id, req.actor!.id, 'entry_updated', `Updated entry ${req.params.id}`])
    return res.json({ message: 'Entry updated.' })
  } catch (error) { next(error) }
})

app.post('/api/employee/timesheet/submit-daily', requireEmployee, async (req: AuthenticatedRequest, res, next) => {
  const connection = await pool.getConnection()
  try {
    const employee = await employeeForActor(req.actor!); const period = await activeReportingPeriod()
    if (!employee || !period) return res.status(404).json({ message: 'No active employee or reporting period found.' })
    if (await employeeCycleIsClosed(period.label)) return res.status(409).json({ message: 'This billing cycle is closed. Contact your Manager or HR for assistance.' })
    const timesheet = await ownedTimesheet(employee.id, period)
    if (!timesheet || !['draft', 'returned', 'rejected'].includes(timesheet.status)) return res.status(409).json({ message: 'This timesheet cannot be submitted.' })
    const [entries] = await connection.query<RowDataPacket[]>("SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS entryDate, hours, work_description AS workDescription FROM timesheet_entries WHERE timesheet_id = ?", [timesheet.id])
    if (!entries.length) return res.status(400).json({ message: 'Add at least one daily entry before submitting.' })
    const [holidays] = await connection.query<RowDataPacket[]>("SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holidayDate FROM public_holidays WHERE holiday_date BETWEEN ? AND ?", [period.startsOn, period.endsOn])
    const [leave] = await connection.query<RowDataPacket[]>("SELECT DATE_FORMAT(starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(ends_on, '%Y-%m-%d') AS endsOn FROM employee_leave_records WHERE employee_id = ? AND status = 'approved'", [employee.id])
    const dates = new Set(entries.map((entry) => String(entry.entryDate).slice(0, 10)))
    const missing: string[] = []; for (let date = new Date(`${String(period.startsOn).slice(0, 10)}T00:00:00`); date <= new Date(`${String(period.endsOn).slice(0, 10)}T00:00:00`); date.setDate(date.getDate() + 1)) { const value = date.toISOString().slice(0, 10); const holiday = holidays.some((item) => String(item.holidayDate).slice(0, 10) === value); const onLeave = leave.some((item) => value >= String(item.startsOn).slice(0, 10) && value <= String(item.endsOn).slice(0, 10)); if (isWeekday(value) && !holiday && !onLeave && !dates.has(value)) missing.push(value) }
    await connection.beginTransaction()
    const nextStatus = timesheet.status === 'returned' || timesheet.status === 'rejected' ? 'resubmitted' : 'submitted'
    await connection.query('UPDATE timesheets SET status = ?, submitted_at = NOW(), return_reason = NULL, version = version + 1 WHERE id = ?', [nextStatus, timesheet.id])
    await connection.query('INSERT INTO timesheet_audit_events (timesheet_id, actor_user_id, event_type, detail) VALUES (?, ?, ?, ?)', [timesheet.id, req.actor!.id, nextStatus === 'resubmitted' ? 'resubmitted' : 'submitted', missing.length ? `Submitted with ${missing.length} missing workday warning(s).` : null])
    await connection.query('INSERT INTO notifications (title, message, notification_type, recipient_email, timesheet_id) VALUES (?, ?, ?, ?, ?)', ['Timesheet submitted', `Your ${period.label} timesheet was submitted for review.`, 'info', req.actor!.email, timesheet.id])
    await connection.commit(); return res.json({ message: 'Timesheet submitted for review.', warnings: missing })
  } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
})

app.post('/api/employee/notifications/:id/read', requireEmployee, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [result] = await pool.query<ResultSetHeader>('UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND recipient_email = ?', [req.params.id, req.actor!.email])
    if (!result.affectedRows) return res.status(404).json({ message: 'Notification not found.' })
    return res.json({ message: 'Notification marked as read.' })
  } catch (error) { next(error) }
})

async function managerOwnsTimesheet(managerId: number, timesheetId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT t.id, t.status, t.version, t.employee_id AS employeeId, e.name AS employeeName, e.email AS employeeEmail, t.period_label AS periodLabel
    FROM timesheets t JOIN employees e ON e.id = t.employee_id WHERE t.id = ? AND e.manager_user_id = ? LIMIT 1`, [timesheetId, managerId])
  return rows[0]
}

app.get('/api/manager/timesheets', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [timesheets] = await pool.query<RowDataPacket[]>(`SELECT t.id, t.period_label AS periodLabel, t.total_hours AS totalHours, t.status, t.submitted_at AS submittedAt, t.return_reason AS returnReason, t.version,
      e.name AS employeeName, e.employee_code AS employeeCode, d.name AS department
      FROM timesheets t JOIN employees e ON e.id = t.employee_id JOIN departments d ON d.id = e.department_id
      WHERE e.manager_user_id = ? AND t.status IN ('submitted', 'resubmitted') ORDER BY t.submitted_at ASC`, [req.actor!.id])
    return res.json({ timesheets })
  } catch (error) { next(error) }
})

app.get('/api/manager/timesheets/:id', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const timesheet = await managerOwnsTimesheet(req.actor!.id, String(req.params.id))
    if (!timesheet) return res.status(404).json({ message: 'Timesheet not found in your team.' })
    const [entries] = await pool.query<RowDataPacket[]>(`SELECT DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entryDate, e.hours, e.work_description AS workDescription, p.code AS projectCode, p.name AS projectName, a.name AS activityName
      FROM timesheet_entries e LEFT JOIN projects p ON p.id = e.project_id JOIN activities a ON a.id = e.activity_id WHERE e.timesheet_id = ? ORDER BY e.entry_date, e.id`, [timesheet.id])
    return res.json({ timesheet, entries })
  } catch (error) { next(error) }
})

async function decideManagerTimesheet(req: AuthenticatedRequest, res: Response, decision: 'approved' | 'returned') {
  const connection = await pool.getConnection()
  try {
    const timesheet = await managerOwnsTimesheet(req.actor!.id, String(req.params.id))
    if (!timesheet || !['submitted', 'resubmitted'].includes(timesheet.status)) return res.status(404).json({ message: 'A submitted team timesheet was not found.' })
    const expectedVersion = Number(req.body?.version)
    if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(timesheet.version)) return res.status(409).json({ message: 'This timesheet changed before your decision. Refresh it and review the latest version.' })
    const reason = String(req.body?.reason || '').trim()
    if (decision === 'returned' && (!reason || reason.length > 500)) return res.status(400).json({ message: 'Provide a return reason of up to 500 characters.' })
    await connection.beginTransaction()
    const [result] = await connection.query<ResultSetHeader>('UPDATE timesheets SET status = ?, reviewer_user_id = ?, approved_at = ?, returned_at = ?, return_reason = ?, version = version + 1 WHERE id = ? AND version = ?', [decision, req.actor!.id, decision === 'approved' ? new Date() : null, decision === 'returned' ? new Date() : null, decision === 'returned' ? reason : null, timesheet.id, expectedVersion])
    if (!result.affectedRows) { await connection.rollback(); return res.status(409).json({ message: 'This timesheet changed before your decision. Refresh it and review the latest version.' }) }
    await connection.query('INSERT INTO timesheet_audit_events (timesheet_id, actor_user_id, event_type, detail) VALUES (?, ?, ?, ?)', [timesheet.id, req.actor!.id, decision, decision === 'returned' ? reason : 'Approved by Manager.'])
    await connection.query('INSERT INTO notifications (title, message, notification_type, recipient_email, timesheet_id) VALUES (?, ?, ?, ?, ?)', [decision === 'approved' ? 'Timesheet approved' : 'Timesheet returned', decision === 'approved' ? `Your ${timesheet.periodLabel} timesheet was approved.` : `Your ${timesheet.periodLabel} timesheet needs corrections: ${reason}`, decision === 'approved' ? 'info' : 'warning', timesheet.employeeEmail, timesheet.id])
    await connection.commit(); return res.json({ message: decision === 'approved' ? 'Timesheet approved.' : 'Timesheet returned to the employee.' })
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

app.post('/api/manager/timesheets/:id/approve', requireManager, (req: AuthenticatedRequest, res, next) => decideManagerTimesheet(req, res, 'approved').catch(next))
app.post('/api/manager/timesheets/:id/return', requireManager, (req: AuthenticatedRequest, res, next) => decideManagerTimesheet(req, res, 'returned').catch(next))

app.get('/api/employee/dashboard', requireEmployee, async (req: AuthenticatedRequest, res, next) => {
  try {
    const employee = await employeeForActor(req.actor!)
    if (!employee) return res.status(403).json({ message: 'Your employee record is not active.' })
    const [current] = await pool.query<RowDataPacket[]>('SELECT id, period_label AS periodLabel, total_hours AS hours, remarks, status, submitted_at AS submittedAt, updated_at AS updatedAt FROM timesheets WHERE employee_id = ? AND period_label = ? LIMIT 1', [employee.id, 'September 2026'])
    const [history] = await pool.query<RowDataPacket[]>('SELECT period_label AS periodLabel, total_hours AS hours, status, submitted_at AS submittedAt, approved_at AS approvedAt FROM timesheets WHERE employee_id = ? ORDER BY id DESC LIMIT 12', [employee.id])
    const [notifications] = await pool.query<RowDataPacket[]>('SELECT id, title, message, notification_type AS type, created_at AS createdAt FROM notifications WHERE recipient_email = ? OR recipient_email IS NULL ORDER BY created_at DESC LIMIT 5', [req.actor!.email])
    return res.json({ employee, period: 'September 2026', standardHours: 167, timesheet: current[0] || null, history, notifications })
  } catch (error) { next(error) }
})

app.post('/api/employee/timesheet/draft', requireEmployee, async (req: AuthenticatedRequest, res, next) => {
  try {
    const employee = await employeeForActor(req.actor!)
    if (!employee) return res.status(403).json({ message: 'Your employee record is not active.' })
    if (await employeeCycleIsClosed('September 2026')) return res.status(409).json({ message: 'This billing cycle is closed. Contact your Manager or HR for assistance.' })
    const hours = Number(req.body?.hours)
    const remarks = String(req.body?.remarks || '').trim()
    if (!Number.isFinite(hours) || hours < 0 || hours > 200) return res.status(400).json({ message: 'Enter hours between 0 and 200.' })
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id, status FROM timesheets WHERE employee_id = ? AND period_label = ? LIMIT 1', [employee.id, 'September 2026'])
    const existing = rows[0]
    if (existing && ['submitted', 'approved'].includes(existing.status)) return res.status(409).json({ message: 'This timesheet is locked while it is under review or approved.' })
    if (existing) await pool.query('UPDATE timesheets SET total_hours = ?, remarks = ?, status = ? WHERE id = ?', [hours, remarks || null, 'draft', existing.id])
    else await pool.query('INSERT INTO timesheets (employee_id, period_label, total_hours, remarks, status) VALUES (?, ?, ?, ?, ?)', [employee.id, 'September 2026', hours, remarks || null, 'draft'])
    return res.json({ message: 'Draft saved.' })
  } catch (error) { next(error) }
})

app.post('/api/employee/timesheet/submit', requireEmployee, async (req: AuthenticatedRequest, res, next) => {
  try {
    const employee = await employeeForActor(req.actor!)
    if (!employee) return res.status(403).json({ message: 'Your employee record is not active.' })
    if (await employeeCycleIsClosed('September 2026')) return res.status(409).json({ message: 'This billing cycle is closed. Contact your Manager or HR for assistance.' })
    const hours = Number(req.body?.hours)
    const remarks = String(req.body?.remarks || '').trim()
    if (!Number.isFinite(hours) || hours < 0 || hours > 200) return res.status(400).json({ message: 'Enter hours between 0 and 200.' })
    if (hours < 167 && !remarks) return res.status(400).json({ message: 'Add a remark before submitting hours below 167.' })
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id, status FROM timesheets WHERE employee_id = ? AND period_label = ? LIMIT 1', [employee.id, 'September 2026'])
    const existing = rows[0]
    if (existing && ['submitted', 'approved'].includes(existing.status)) return res.status(409).json({ message: 'This timesheet is already locked for review.' })
    if (existing) await pool.query('UPDATE timesheets SET total_hours = ?, remarks = ?, status = ?, submitted_at = NOW() WHERE id = ?', [hours, remarks || null, 'submitted', existing.id])
    else await pool.query('INSERT INTO timesheets (employee_id, period_label, total_hours, remarks, status, submitted_at) VALUES (?, ?, ?, ?, ?, NOW())', [employee.id, 'September 2026', hours, remarks || null, 'submitted'])
    await pool.query('INSERT INTO audit_events (actor_name, action, target) VALUES (?, ?, ?)', [req.actor!.email, 'Submitted timesheet', `September 2026 timesheet for ${employee.name}`])
    await pool.query('INSERT INTO notifications (title, message, notification_type, recipient_email) VALUES (?, ?, ?, ?)', ['Timesheet submitted', 'Your September 2026 timesheet was sent to your Manager for review.', 'info', req.actor!.email])
    return res.json({ message: 'Timesheet submitted for Manager review.' })
  } catch (error) { next(error) }
})

app.get('/api/director/dashboard', requireDirector, async (_req: AuthenticatedRequest, res, next) => {
  try {
    const [[employeeCount]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS value FROM employees WHERE active = TRUE')
    const [[submittedCount]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS value FROM timesheets WHERE status = 'submitted'")
    const [[approvedCount]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS value FROM timesheets WHERE status = 'approved'")
    const [[pendingCount]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS value FROM timesheets WHERE status IN ('draft', 'submitted')")
    const [[exceptionCount]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS value FROM validation_findings WHERE resolved = FALSE')
    const [departments] = await pool.query<RowDataPacket[]>(`SELECT d.id, d.code, d.name, COUNT(DISTINCT e.id) AS employeeCount,
      SUM(t.status = 'submitted') AS submittedCount, SUM(t.status = 'approved') AS approvedCount,
      SUM(t.status IN ('draft', 'submitted')) AS pendingCount, SUM(v.id IS NOT NULL AND v.resolved = FALSE) AS flaggedCount
      FROM departments d LEFT JOIN employees e ON e.department_id = d.id AND e.active = TRUE
      LEFT JOIN timesheets t ON t.employee_id = e.id AND t.period_label = 'September 2026'
      LEFT JOIN validation_findings v ON v.timesheet_id = t.id GROUP BY d.id ORDER BY d.name`)
    const [exceptions] = await pool.query<RowDataPacket[]>(`SELECT v.id, v.severity, v.finding_type AS type, v.message, e.name AS employeeName, d.name AS department, t.status
      FROM validation_findings v JOIN timesheets t ON t.id = v.timesheet_id JOIN employees e ON e.id = t.employee_id JOIN departments d ON d.id = e.department_id
      WHERE v.resolved = FALSE ORDER BY FIELD(v.severity, 'critical', 'warning'), v.created_at DESC LIMIT 5`)
    const [notifications] = await pool.query<RowDataPacket[]>('SELECT id, title, message, notification_type AS type, created_at AS createdAt FROM notifications WHERE read_at IS NULL ORDER BY created_at DESC LIMIT 5')
    const [billingCycles] = await pool.query<RowDataPacket[]>('SELECT period_label AS periodLabel, starts_on AS startsOn, ends_on AS endsOn, submission_deadline AS submissionDeadline, current_stage AS currentStage FROM billing_cycles ORDER BY starts_on DESC LIMIT 1')
    return res.json({ period: 'September 2026', billingCycle: billingCycles[0] || null, metrics: { employees: employeeCount?.value || 0, submitted: submittedCount?.value || 0, approved: approvedCount?.value || 0, pending: pendingCount?.value || 0, exceptions: exceptionCount?.value || 0 }, departments, exceptions, notifications })
  } catch (error) { next(error) }
})

app.get('/api/director/exceptions', requireDirector, async (_req: AuthenticatedRequest, res, next) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT v.id, v.severity, v.finding_type AS type, v.message, v.resolved, e.name AS employeeName, e.employee_code AS employeeCode, d.name AS department, t.total_hours AS hours, t.status
      FROM validation_findings v JOIN timesheets t ON t.id = v.timesheet_id JOIN employees e ON e.id = t.employee_id JOIN departments d ON d.id = e.department_id
      WHERE v.resolved = FALSE ORDER BY FIELD(v.severity, 'critical', 'warning'), e.name`)
    return res.json({ exceptions: rows })
  } catch (error) { next(error) }
})

app.get('/api/director/reports', requireDirector, async (_req: AuthenticatedRequest, res, next) => {
  try {
    const [departments] = await pool.query<RowDataPacket[]>(`SELECT d.id, d.name, COUNT(e.id) AS employees, ROUND(AVG(t.total_hours), 1) AS averageHours,
      SUM(t.status = 'approved') AS approved, SUM(t.status = 'submitted') AS submitted, SUM(t.status IN ('draft', 'submitted')) AS pending
      FROM departments d LEFT JOIN employees e ON e.department_id = d.id AND e.active = TRUE LEFT JOIN timesheets t ON t.employee_id = e.id AND t.period_label = 'September 2026'
      GROUP BY d.id ORDER BY d.name`)
    return res.json({ period: 'September 2026', departments })
  } catch (error) { next(error) }
})

app.get('/api/director/departments/:id', requireDirector, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [departmentRows] = await pool.query<RowDataPacket[]>('SELECT id, code, name FROM departments WHERE id = ? LIMIT 1', [req.params.id])
    if (!departmentRows[0]) return res.status(404).json({ message: 'Department not found.' })
    const [employees] = await pool.query<RowDataPacket[]>(`SELECT e.employee_code AS employeeCode, e.name, e.manager_name AS managerName, t.total_hours AS hours, t.status
      FROM employees e LEFT JOIN timesheets t ON t.employee_id = e.id AND t.period_label = 'September 2026' WHERE e.department_id = ? ORDER BY e.name`, [req.params.id])
    return res.json({ department: departmentRows[0], employees })
  } catch (error) { next(error) }
})

app.get('/api/director/approvals', requireDirector, async (_req: AuthenticatedRequest, res, next) => {
  try {
    const [submissions] = await pool.query<RowDataPacket[]>(`SELECT s.id, s.status, s.submitted_by AS submittedBy, s.submitted_at AS submittedAt, s.decided_by AS decidedBy, s.decided_at AS decidedAt, s.return_reason AS returnReason,
      d.name AS department, d.code AS departmentCode, COUNT(DISTINCT e.id) AS employeeCount, COALESCE(SUM(t.total_hours), 0) AS totalHours,
      SUM(t.status = 'submitted') AS submittedCount, SUM(v.id IS NOT NULL AND v.resolved = FALSE) AS exceptionCount
      FROM department_submissions s JOIN departments d ON d.id = s.department_id
      LEFT JOIN employees e ON e.department_id = d.id AND e.active = TRUE
      LEFT JOIN timesheets t ON t.employee_id = e.id AND t.period_label = s.period_label
      LEFT JOIN validation_findings v ON v.timesheet_id = t.id
      WHERE s.period_label = 'September 2026'
      GROUP BY s.id ORDER BY FIELD(s.status, 'submitted', 'returned', 'approved'), s.submitted_at ASC`)
    return res.json({ period: 'September 2026', submissions })
  } catch (error) { next(error) }
})

app.get('/api/director/approvals/:id', requireDirector, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [submissions] = await pool.query<RowDataPacket[]>(`SELECT s.id, s.period_label AS periodLabel, s.status, s.submitted_by AS submittedBy, s.submitted_at AS submittedAt, s.return_reason AS returnReason, d.name AS department, d.code AS departmentCode
      FROM department_submissions s JOIN departments d ON d.id = s.department_id WHERE s.id = ? LIMIT 1`, [req.params.id])
    const submission = submissions[0]
    if (!submission) return res.status(404).json({ message: 'Submission not found.' })
    const [employees] = await pool.query<RowDataPacket[]>(`SELECT e.employee_code AS employeeCode, e.name, e.manager_name AS managerName, t.total_hours AS hours, t.status,
      GROUP_CONCAT(CASE WHEN v.resolved = FALSE THEN v.message END SEPARATOR ' | ') AS finding
      FROM employees e LEFT JOIN timesheets t ON t.employee_id = e.id AND t.period_label = ?
      LEFT JOIN validation_findings v ON v.timesheet_id = t.id
      WHERE e.department_id = (SELECT department_id FROM department_submissions WHERE id = ?) GROUP BY e.id, t.id ORDER BY e.name`, [submission.periodLabel, submission.id])
    return res.json({ submission, employees })
  } catch (error) { next(error) }
})

app.post('/api/director/approvals/:id/approve', requireDirector, async (req: AuthenticatedRequest, res, next) => {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [submissions] = await connection.query<RowDataPacket[]>('SELECT id, department_id AS departmentId, period_label AS periodLabel, status FROM department_submissions WHERE id = ? FOR UPDATE', [req.params.id])
    const submission = submissions[0]
    if (!submission) { await connection.rollback(); return res.status(404).json({ message: 'Submission not found.' }) }
    if (submission.status !== 'submitted') { await connection.rollback(); return res.status(409).json({ message: 'This submission has already been decided.' }) }
    await connection.query('UPDATE department_submissions SET status = ?, decided_by = ?, decided_at = NOW(), return_reason = NULL WHERE id = ?', ['approved', req.actor!.email, submission.id])
    await connection.query(`UPDATE timesheets t JOIN employees e ON e.id = t.employee_id SET t.status = 'approved', t.approved_at = NOW()
      WHERE e.department_id = ? AND t.period_label = ? AND t.status = 'submitted'`, [submission.departmentId, submission.periodLabel])
    await connection.query('INSERT INTO audit_events (actor_name, action, target) VALUES (?, ?, ?)', [req.actor!.email, 'Approved department submission', `${submission.periodLabel} department submission #${submission.id}`])
    await connection.query('INSERT INTO notifications (title, message, notification_type) VALUES (?, ?, ?)', ['Department submission approved', `The Director approved your ${submission.periodLabel} submission.`, 'info'])
    const [[remaining]] = await connection.query<RowDataPacket[]>('SELECT SUM(status = \'submitted\') AS submittedCount, SUM(status = \'returned\') AS returnedCount FROM department_submissions WHERE period_label = ?', [submission.periodLabel])
    if (Number(remaining?.submittedCount || 0) === 0) await connection.query('UPDATE billing_cycles SET current_stage = ? WHERE period_label = ?', [Number(remaining?.returnedCount || 0) > 0 ? 'manager_submission' : 'oracle_export', submission.periodLabel])
    await connection.commit()
    return res.json({ message: 'Submission approved.' })
  } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
})

app.post('/api/director/approvals/:id/return', requireDirector, async (req: AuthenticatedRequest, res, next) => {
  const reason = String(req.body?.reason || '').trim()
  if (reason.length < 3) return res.status(400).json({ message: 'Provide a reason before returning this submission.' })
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [submissions] = await connection.query<RowDataPacket[]>('SELECT id, department_id AS departmentId, period_label AS periodLabel, status FROM department_submissions WHERE id = ? FOR UPDATE', [req.params.id])
    const submission = submissions[0]
    if (!submission) { await connection.rollback(); return res.status(404).json({ message: 'Submission not found.' }) }
    if (submission.status !== 'submitted') { await connection.rollback(); return res.status(409).json({ message: 'This submission has already been decided.' }) }
    await connection.query('UPDATE department_submissions SET status = ?, decided_by = ?, decided_at = NOW(), return_reason = ? WHERE id = ?', ['returned', req.actor!.email, reason, submission.id])
    await connection.query(`UPDATE timesheets t JOIN employees e ON e.id = t.employee_id SET t.status = 'rejected'
      WHERE e.department_id = ? AND t.period_label = ? AND t.status = 'submitted'`, [submission.departmentId, submission.periodLabel])
    await connection.query('UPDATE billing_cycles SET current_stage = ? WHERE period_label = ?', ['manager_submission', submission.periodLabel])
    await connection.query('INSERT INTO audit_events (actor_name, action, target) VALUES (?, ?, ?)', [req.actor!.email, 'Returned department submission', `${submission.periodLabel} department submission #${submission.id}: ${reason}`])
    await connection.query('INSERT INTO notifications (title, message, notification_type) VALUES (?, ?, ?)', ['Department submission returned', `The Director returned your ${submission.periodLabel} submission: ${reason}`, 'warning'])
    await connection.commit()
    return res.json({ message: 'Submission returned for correction.' })
  } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
})

app.get('/api/director/audit-events', requireDirector, async (_req: AuthenticatedRequest, res, next) => {
  try {
    const [events] = await pool.query<RowDataPacket[]>('SELECT id, actor_name AS actor, action, target, created_at AS createdAt FROM audit_events ORDER BY created_at DESC LIMIT 30')
    return res.json({ events })
  } catch (error) { next(error) }
})

app.post('/api/auth/register', async (req: Request<object, object, AuthRequest>, res: Response, next: NextFunction) => {
  try {
    const name = String(req.body.name || '').trim()
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    const role = validRole(req.body.role)
    if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !role) {
      return res.status(400).json({ message: 'Enter a name, valid email, password of at least 8 characters, and a role.' })
    }
    if (role !== 'employee') return res.status(403).json({ message: 'Only employee self-registration is available. Director accounts are configured by an administrator.' })
    const [employeeRows] = await pool.query<RowDataPacket[]>('SELECT id FROM employees WHERE email = ? AND active = TRUE LIMIT 1', [email])
    if (!employeeRows[0]) return res.status(403).json({ message: 'Your work email is not in the active employee roster.' })
    const [existing] = await pool.query<UserRecord[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
    if (existing.length) return res.status(409).json({ message: 'An account already exists for this email. Please sign in.' })
    const passwordHash = await bcrypt.hash(password, 12)
    const [result] = await pool.query<ResultSetHeader>('INSERT INTO users (name, email, password_hash, role, auth_provider) VALUES (?, ?, ?, ?, ?)', [name, email, passwordHash, role, 'password'])
    const user: UserRecord = { id: result.insertId, name, email, password_hash: passwordHash, google_sub: null, avatar_url: null, role } as UserRecord
    return res.status(201).json({ token: issueToken(user), user: publicUser(user) })
  } catch (error) { next(error) }
})

app.post('/api/auth/login', async (req: Request<object, object, AuthRequest>, res: Response, next: NextFunction) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    const role = validRole(req.body.role)
    const [rows] = await pool.query<UserRecord[]>('SELECT * FROM users WHERE email = ? LIMIT 1', [email])
    const user = rows[0]
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ message: 'Email or password is incorrect.' })
    if (role && user.role !== role) return res.status(403).json({ message: `This account is registered as ${user.role}. Choose that role to continue.` })
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id])
    return res.json({ token: issueToken(user), user: publicUser(user) })
  } catch (error) { next(error) }
})

app.post('/api/auth/google', async (req: Request<object, object, AuthRequest>, res: Response, next: NextFunction) => {
  try {
    if (!googleClientId) return res.status(503).json({ message: 'Google sign-in is not configured yet.' })
    const role = validRole(req.body.role)
    if (!role) return res.status(400).json({ message: 'Choose a portal role before signing in with Google.' })
    const credential = req.body.credential
    if (!credential) return res.status(400).json({ message: 'Google sign-in did not return a credential.' })
    const client = googleClient || new OAuth2Client(googleClientId)
    googleClient = client
    const ticket = await client.verifyIdToken({ idToken: credential, audience: googleClientId })
    const payload = ticket.getPayload()
    if (!payload?.email || !payload.email_verified || !payload.sub) return res.status(401).json({ message: 'Google could not verify this account.' })

    const email = payload.email.toLowerCase()
    const [rows] = await pool.query<UserRecord[]>('SELECT * FROM users WHERE email = ? OR google_sub = ? LIMIT 1', [email, payload.sub])
    let user = rows[0]
    if (!user) return res.status(403).json({ message: 'This Google account has not been approved for Director access.' })
    if (user.role !== role) return res.status(403).json({ message: `This account is registered as ${user.role}. Choose that role to continue.` })
    await pool.query('UPDATE users SET google_sub = COALESCE(google_sub, ?), avatar_url = COALESCE(?, avatar_url), last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [payload.sub, payload.picture || null, user.id])
    return res.json({ token: issueToken(user), user: publicUser(user) })
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('token')) return res.status(401).json({ message: 'Google sign-in could not be verified.' })
    next(error)
  }
})

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error)
  res.status(500).json({ message: 'Something went wrong. Please try again.' })
})

initializeDatabase()
  .then(() => app.listen(port, () => console.log(`Pulse AI API running at http://localhost:${port}`)))
  .catch((error: unknown) => {
    console.error('Database initialization failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
