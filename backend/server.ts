import 'dotenv/config'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import mysql, { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import { employeeCanEdit, employeeCanSubmit, managerCanDecide, validReturnReason, versionMatches } from './timesheetRules.js'
import { registerFinanceRoutes } from './financeRoutes.js'

type Role = 'employee' | 'manager' | 'hr' | 'director' | 'finance'
type AuthRequest = { name?: string; email?: string; password?: string; role?: string; credential?: string }

interface UserRecord extends RowDataPacket {
  id: number
  name: string
  email: string
  password_hash: string | null
  google_sub: string | null
  github_id: string | null
  avatar_url: string | null
  role: Role
}

const app = express()
const port = Number(process.env.PORT || 4000)
const dbName = process.env.DB_NAME || process.env.MYSQLDATABASE || 'pulseai'
const jwtSecret = process.env.JWT_SECRET
const googleClientId = process.env.GOOGLE_CLIENT_ID
const githubClientId = process.env.GITHUB_CLIENT_ID
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET
const githubCallbackUrl = process.env.GITHUB_CALLBACK_URL || `http://localhost:${port}/api/auth/github/callback`
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
const railwayDatabase = Boolean(process.env.MYSQLHOST || process.env.MYSQLDATABASE)
const dbSsl = process.env.DB_SSL?.toLowerCase() === 'true'
const validRoles = new Set<Role>(['employee', 'manager', 'hr', 'director', 'finance'])

if (!jwtSecret) throw new Error('JWT_SECRET is required. Copy backend/.env.example to backend/.env and set it.')

app.use(cors({ origin: clientOrigin }))
app.use(express.json())

let pool: mysql.Pool
let googleClient: OAuth2Client | undefined
const githubStates = new Map<string, { role: Role; expiresAt: number }>()
const baseDbConfig = {
  host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
  port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
  user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
  ...(dbSsl ? { ssl: { rejectUnauthorized: false } } : {}),
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
  if (!railwayDatabase) {
    const bootstrap = await mysql.createConnection(baseDbConfig)
    await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${dbName.replace(/`/g, '``')}\``)
    await bootstrap.end()
  }

  pool = mysql.createPool({ ...baseDbConfig, database: dbName, waitForConnections: true, connectionLimit: 10 })
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NULL,
    google_sub VARCHAR(255) NULL,
    avatar_url VARCHAR(500) NULL,
    role ENUM('employee', 'manager', 'hr', 'director', 'finance') NOT NULL DEFAULT 'employee',
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
  await pool.query('ALTER TABLE timesheet_entries ADD COLUMN manager_comment VARCHAR(500) NULL').catch(() => undefined)
  await pool.query('ALTER TABLE timesheet_entries ADD COLUMN manager_comment_by_user_id BIGINT UNSIGNED NULL').catch(() => undefined)
  await pool.query('ALTER TABLE timesheet_entries ADD COLUMN manager_comment_at TIMESTAMP NULL').catch(() => undefined)
  await pool.query("ALTER TABLE timesheets MODIFY COLUMN status ENUM('draft','submitted','resubmitted','approved','returned','rejected') NOT NULL DEFAULT 'draft'").catch(() => undefined)
  await pool.query('ALTER TABLE notifications ADD COLUMN timesheet_id BIGINT UNSIGNED NULL').catch(() => undefined)
  await pool.query('ALTER TABLE employees ADD COLUMN manager_user_id BIGINT UNSIGNED NULL').catch(() => undefined)
  await pool.query('ALTER TABLE users ADD COLUMN github_id VARCHAR(100) NULL').catch(() => undefined)
  await pool.query('ALTER TABLE users ADD UNIQUE KEY uq_user_github_id (github_id)').catch(() => undefined)
  await pool.query('ALTER TABLE employees ADD COLUMN user_id BIGINT UNSIGNED NULL').catch(() => undefined)
  await pool.query('ALTER TABLE employees ADD UNIQUE KEY uq_employee_user (user_id)').catch(() => undefined)
  await pool.query('ALTER TABLE employees ADD CONSTRAINT fk_employee_user FOREIGN KEY (user_id) REFERENCES users(id)').catch(() => undefined)
  await pool.query('UPDATE employees e JOIN users u ON LOWER(u.email) = LOWER(e.email) AND u.role = \'employee\' SET e.user_id = u.id WHERE e.user_id IS NULL').catch(() => undefined)
  await pool.query('ALTER TABLE timesheets ADD COLUMN assigned_manager_user_id BIGINT UNSIGNED NULL').catch(() => undefined)
  await pool.query('ALTER TABLE timesheets ADD KEY idx_timesheet_assigned_manager_status (assigned_manager_user_id, status, reporting_period_id)').catch(() => undefined)
  await pool.query('ALTER TABLE timesheets ADD CONSTRAINT fk_timesheet_assigned_manager FOREIGN KEY (assigned_manager_user_id) REFERENCES users(id)').catch(() => undefined)
  await pool.query("ALTER TABLE employee_leave_records MODIFY COLUMN status ENUM('approved','cancelled') NOT NULL DEFAULT 'approved'").catch(() => undefined)
  await pool.query('ALTER TABLE public_holidays ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE').catch(() => undefined)
  await pool.query('ALTER TABLE audit_events ADD COLUMN actor_user_id BIGINT UNSIGNED NULL').catch(() => undefined)
  await pool.query('ALTER TABLE audit_events ADD COLUMN actor_role VARCHAR(20) NULL').catch(() => undefined)
  await pool.query('ALTER TABLE audit_events ADD COLUMN entity_type VARCHAR(40) NULL').catch(() => undefined)
  await pool.query('ALTER TABLE audit_events ADD COLUMN entity_id BIGINT UNSIGNED NULL').catch(() => undefined)
  await pool.query('ALTER TABLE audit_events ADD COLUMN before_state JSON NULL').catch(() => undefined)
  await pool.query('ALTER TABLE audit_events ADD COLUMN after_state JSON NULL').catch(() => undefined)
  await pool.query('ALTER TABLE audit_events ADD KEY idx_audit_entity (entity_type, entity_id, created_at)').catch(() => undefined)
  await pool.query("UPDATE timesheets t JOIN employees e ON e.id = t.employee_id SET t.assigned_manager_user_id = e.manager_user_id WHERE t.assigned_manager_user_id IS NULL AND t.status IN ('submitted','resubmitted','approved','returned')").catch(() => undefined)
  await pool.query('ALTER TABLE projects ADD COLUMN manager_user_id BIGINT UNSIGNED NULL').catch(() => undefined)
  await pool.query('ALTER TABLE projects ADD COLUMN description VARCHAR(500) NULL').catch(() => undefined)
  await pool.query('ALTER TABLE projects ADD COLUMN starts_on DATE NULL').catch(() => undefined)
  await pool.query('ALTER TABLE projects ADD COLUMN ends_on DATE NULL').catch(() => undefined)
  await pool.query('CREATE INDEX idx_projects_manager_active ON projects (manager_user_id, active)').catch(() => undefined)
  await pool.query(`CREATE TABLE IF NOT EXISTS project_activity_assignments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NOT NULL,
    activity_id BIGINT UNSIGNED NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_activity (project_id, activity_id),
    KEY idx_project_activity_active (project_id, active),
    CONSTRAINT fk_project_activity_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_project_activity_activity FOREIGN KEY (activity_id) REFERENCES activities(id),
    CONSTRAINT fk_project_activity_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS clients (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(160) NOT NULL,
    billing_email VARCHAR(255) NULL,
    currency CHAR(3) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY uq_client_code (code),
    CONSTRAINT fk_client_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query('ALTER TABLE projects ADD COLUMN client_id BIGINT UNSIGNED NULL').catch(() => undefined)
  await pool.query('ALTER TABLE projects ADD CONSTRAINT fk_project_client FOREIGN KEY (client_id) REFERENCES clients(id)').catch(() => undefined)
  await pool.query('CREATE INDEX idx_project_client_active ON projects (client_id, active)').catch(() => undefined)
  await pool.query('ALTER TABLE project_activity_assignments ADD COLUMN billable BOOLEAN NULL DEFAULT NULL').catch(() => undefined)
  await pool.query(`CREATE TABLE IF NOT EXISTS project_billing_rates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id BIGINT UNSIGNED NOT NULL,
    amount DECIMAL(12,4) NOT NULL,
    currency CHAR(3) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY uq_project_rate_start (project_id, effective_from),
    KEY idx_project_rate_effective (project_id, effective_from, effective_to, active),
    CONSTRAINT fk_billing_rate_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_billing_rate_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS invoices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    invoice_number VARCHAR(50) NOT NULL,
    client_id BIGINT UNSIGNED NOT NULL,
    period_label VARCHAR(40) NOT NULL,
    currency CHAR(3) NOT NULL,
    status ENUM('draft','ready','finalized') NOT NULL DEFAULT 'draft',
    subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
    cancelled_line_count INT UNSIGNED NOT NULL DEFAULT 0,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    finalized_by_user_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ready_at TIMESTAMP NULL,
    finalized_at TIMESTAMP NULL,
    PRIMARY KEY (id), UNIQUE KEY uq_invoice_number (invoice_number),
    KEY idx_invoice_status_period (status, period_label),
    CONSTRAINT fk_invoice_client FOREIGN KEY (client_id) REFERENCES clients(id),
    CONSTRAINT fk_invoice_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_invoice_finalizer FOREIGN KEY (finalized_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query("ALTER TABLE invoices MODIFY COLUMN status ENUM('draft','ready','finalized','cancelled') NOT NULL DEFAULT 'draft'").catch(() => undefined)
  await pool.query('ALTER TABLE invoices ADD COLUMN cancelled_line_count INT UNSIGNED NOT NULL DEFAULT 0').catch(() => undefined)
  await pool.query(`CREATE TABLE IF NOT EXISTS invoice_lines (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    invoice_id BIGINT UNSIGNED NOT NULL,
    timesheet_entry_id BIGINT UNSIGNED NOT NULL,
    billing_rate_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NOT NULL,
    entry_date DATE NOT NULL,
    employee_name_snapshot VARCHAR(120) NOT NULL,
    employee_code_snapshot VARCHAR(30) NOT NULL,
    project_code_snapshot VARCHAR(40) NOT NULL,
    project_name_snapshot VARCHAR(160) NOT NULL,
    activity_name_snapshot VARCHAR(120) NOT NULL,
    hours_snapshot DECIMAL(7,2) NOT NULL,
    rate_snapshot DECIMAL(12,4) NOT NULL,
    currency_snapshot CHAR(3) NOT NULL,
    amount_snapshot DECIMAL(14,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY uq_invoice_line_source (timesheet_entry_id),
    KEY idx_invoice_line_invoice (invoice_id, entry_date),
    CONSTRAINT fk_invoice_line_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    CONSTRAINT fk_invoice_line_entry FOREIGN KEY (timesheet_entry_id) REFERENCES timesheet_entries(id),
    CONSTRAINT fk_invoice_line_rate FOREIGN KEY (billing_rate_id) REFERENCES project_billing_rates(id),
    CONSTRAINT fk_invoice_line_project FOREIGN KEY (project_id) REFERENCES projects(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query(`CREATE TABLE IF NOT EXISTS finance_audit_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    action VARCHAR(80) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    before_state TEXT NULL,
    after_state TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id), KEY idx_finance_audit_entity (entity_type, entity_id, created_at),
    CONSTRAINT fk_finance_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await pool.query("ALTER TABLE users MODIFY COLUMN role ENUM('employee','manager','hr','director','finance') NOT NULL DEFAULT 'employee'")
  await pool.query('CREATE INDEX idx_notifications_recipient_read_created ON notifications (recipient_email, read_at, created_at)').catch(() => undefined)
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
  await pool.query("UPDATE timesheets t JOIN employees e ON e.id = t.employee_id SET t.assigned_manager_user_id = e.manager_user_id WHERE t.assigned_manager_user_id IS NULL AND e.manager_user_id IS NOT NULL AND t.status IN ('submitted','resubmitted','approved','returned')").catch(() => undefined)
  await seedHRAccounts()
  await seedFinanceAccounts()
  if (process.env.SEED_DEMO_DATA === 'true') { await seedDemoData(); await seedDemoEmployeeAccount(); await seedDemoBillingCycle(); await seedDemoApprovals(); await seedEmployeeWorkspaceData() }
}

async function seedDemoData() {
  const [departmentRows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM departments')
  if (Number(departmentRows[0]?.count || 0) > 0) return
  await pool.query('INSERT IGNORE INTO reporting_periods (label, starts_on, ends_on, submission_deadline, standard_daily_hours, active) VALUES (?, ?, ?, ?, ?, ?)', ['September 2026', '2026-09-01', '2026-09-30', '2026-09-25', 8, true])
  const [[reportingPeriod]] = await pool.query<RowDataPacket[]>('SELECT id FROM reporting_periods WHERE label = ? LIMIT 1', ['September 2026'])
  if (!reportingPeriod) throw new Error('Unable to prepare the demo reporting period.')
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
    await pool.query('INSERT INTO timesheets (employee_id, reporting_period_id, period_label, total_hours, status, submitted_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [employee.insertId, reportingPeriod.id, 'September 2026', hours, status, submittedAt, status === 'approved' ? new Date() : null])
  }
  const [timesheets] = await pool.query<RowDataPacket[]>('SELECT t.id, e.employee_code FROM timesheets t JOIN employees e ON e.id = t.employee_id')
  const idFor = new Map(timesheets.map((row) => [row.employee_code as string, row.id as number]))
  await pool.query('INSERT INTO validation_findings (timesheet_id, severity, finding_type, message) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)', [idFor.get('E203'), 'warning', 'Low hours', '148 hours recorded; review supporting remarks.', idFor.get('E402'), 'critical', 'Low hours', '120 hours recorded; action required before approval.', idFor.get('E302'), 'critical', 'Rejected timesheet', 'Returned for correction: missing project allocation.'])
  await pool.query('INSERT INTO audit_events (actor_name, action, target) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)', ['Meera Iyer', 'Approved timesheet', 'Aarav Sharma - September 2026', 'Ritu Shah', 'Rejected timesheet', 'Isha Verma - missing project allocation', 'System', 'Created reminder', '2 employees have not submitted September timesheets'])
  await pool.query('INSERT INTO notifications (title, message, notification_type) VALUES (?, ?, ?), (?, ?, ?)', ['2 timesheets are overdue', 'Arjun Singh and Simran Kaur have not submitted September timesheets.', 'critical', 'Three exceptions need review', 'Low hours and a rejected submission require follow-up.', 'warning'])
  console.log('Seeded Pulse AI Director demo data.')
}

async function seedDemoEmployeeAccount() {
  const name = String(process.env.EMPLOYEE_1_NAME || '').trim()
  const email = String(process.env.EMPLOYEE_1_EMAIL || '').trim().toLowerCase()
  const password = String(process.env.EMPLOYEE_1_PASSWORD || '')
  if (!name || !email || !password) return
  const [[employee]] = await pool.query<RowDataPacket[]>('SELECT id FROM employees WHERE LOWER(email) = LOWER(?) AND active = TRUE LIMIT 1', [email])
  if (!employee) { console.warn(`Demo employee account skipped: ${email} is not in the active employee roster.`); return }
  const passwordHash = await bcrypt.hash(password, 10)
  const [[existing]] = await pool.query<RowDataPacket[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
  let userId = Number(existing?.id || 0)
  if (userId) await pool.query('UPDATE users SET name = ?, password_hash = ?, role = \'employee\', auth_provider = \'password\' WHERE id = ?', [name, passwordHash, userId])
  else {
    const [created] = await pool.query<ResultSetHeader>('INSERT INTO users (name, email, password_hash, role, auth_provider) VALUES (?, ?, ?, \'employee\', \'password\')', [name, email, passwordHash])
    userId = created.insertId
  }
  await pool.query('UPDATE employees SET user_id = ? WHERE id = ?', [userId, employee.id])
  console.log(`Synchronized demo Employee account: ${email}`)
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
  const [projectActivities] = await pool.query<RowDataPacket[]>("SELECT id FROM activities WHERE active = TRUE AND category = 'project'")
  for (const employee of employees) for (const project of projects) await pool.query('INSERT IGNORE INTO employee_project_assignments (employee_id, project_id, active) VALUES (?, ?, TRUE)', [employee.id, project.id])
  for (const project of projects) for (const activity of projectActivities) await pool.query('INSERT IGNORE INTO project_activity_assignments (project_id, activity_id, active, created_by_user_id) SELECT ?, ?, TRUE, id FROM users WHERE role = ? ORDER BY id LIMIT 1', [project.id, activity.id, 'director'])
}

async function seedDirectorAccounts() {
  const accounts = [1, 2, 3].map((index) => ({
    name: process.env[`DIRECTOR_${index}_NAME`] || `Pulse AI Director ${index}`,
    email: String(process.env[`DIRECTOR_${index}_EMAIL`] || '').trim().toLowerCase(),
    password: process.env[`DIRECTOR_${index}_PASSWORD`] || '',
  }))

  for (const account of accounts) {
    if (!/^\S+@\S+\.\S+$/.test(account.email) || account.password.length < 8) continue
    const [existing] = await pool.query<(UserRecord & { id: number })[]>('SELECT id, role FROM users WHERE email = ? LIMIT 1', [account.email])
    if (existing[0] && existing[0].role !== 'finance') {
      console.warn(`Finance account ${account.email} was not synchronized because that email already belongs to a different role.`)
      continue
    }
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

async function seedFinanceAccounts() {
  const accounts = [1, 2, 3].map((index) => ({
    name: String(process.env[`FINANCE_${index}_NAME`] || '').trim(),
    email: String(process.env[`FINANCE_${index}_EMAIL`] || '').trim().toLowerCase(),
    password: process.env[`FINANCE_${index}_PASSWORD`] || '',
  }))
  for (const account of accounts) {
    if (account.name.length < 2 || !/^\S+@\S+\.\S+$/.test(account.email) || account.password.length < 8) continue
    const [existing] = await pool.query<UserRecord[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [account.email])
    const passwordHash = await bcrypt.hash(account.password, 12)
    if (existing[0]) await pool.query('UPDATE users SET name = ?, password_hash = ?, role = ?, auth_provider = ? WHERE id = ?', [account.name, passwordHash, 'finance', 'password', existing[0].id])
    else await pool.query('INSERT INTO users (name, email, password_hash, role, auth_provider) VALUES (?, ?, ?, ?, ?)', [account.name, account.email, passwordHash, 'finance', 'password'])
    console.log(`Synchronized Finance account: ${account.email}`)
  }
}

async function seedHRAccounts() {
  const accounts = [1, 2, 3].map((index) => ({
    name: String(process.env[`HR_${index}_NAME`] || '').trim(),
    email: String(process.env[`HR_${index}_EMAIL`] || '').trim().toLowerCase(),
    password: process.env[`HR_${index}_PASSWORD`] || '',
  }))
  for (const account of accounts) {
    if (account.name.length < 2 || !/^\S+@\S+\.\S+$/.test(account.email) || account.password.length < 8) continue
    const [existing] = await pool.query<UserRecord[]>('SELECT id, role FROM users WHERE email = ? LIMIT 1', [account.email])
    if (existing[0] && existing[0].role !== 'hr') {
      console.warn(`HR account ${account.email} was not synchronized because that email already belongs to a different role.`)
      continue
    }
    const passwordHash = await bcrypt.hash(account.password, 12)
    if (existing[0]) await pool.query('UPDATE users SET name = ?, password_hash = ?, role = ?, auth_provider = ? WHERE id = ?', [account.name, passwordHash, 'hr', 'password', existing[0].id])
    else await pool.query('INSERT INTO users (name, email, password_hash, role, auth_provider) VALUES (?, ?, ?, ?, ?)', [account.name, account.email, passwordHash, 'hr', 'password'])
    console.log(`Synchronized HR account: ${account.email}`)
  }
}

app.get('/', (_req, res) => res.status(200).json({
  service: 'PulseAI API',
  status: 'ok',
  message: 'PulseAI backend is running',
}))

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

function requireHR(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ message: 'Sign in is required.' })
  try {
    const payload = jwt.verify(token, jwtSecret!)
    if (typeof payload === 'string' || payload.role !== 'hr') return res.status(403).json({ message: 'HR access is required.' })
    req.actor = { id: Number(payload.sub), role: 'hr', email: String(payload.email) }
    return next()
  } catch { return res.status(401).json({ message: 'Your session has expired. Please sign in again.' }) }
}

function requireFinance(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ message: 'Sign in is required.' })
  try {
    const payload = jwt.verify(token, jwtSecret!)
    if (typeof payload === 'string' || payload.role !== 'finance') return res.status(403).json({ message: 'Finance access is required.' })
    req.actor = { id: Number(payload.sub), role: 'finance', email: String(payload.email) }
    return next()
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' })
  }
}

async function employeeForActor(actor: NonNullable<AuthenticatedRequest['actor']>) {
  const [employees] = await pool.query<RowDataPacket[]>('SELECT e.id, e.user_id AS userId, e.employee_code AS employeeCode, e.name, e.email, e.manager_name AS managerName, e.manager_user_id AS managerUserId, d.name AS department FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.active = TRUE AND (e.user_id = ? OR (e.user_id IS NULL AND LOWER(e.email) = LOWER(?))) LIMIT 1', [actor.id, actor.email])
  if (employees[0] && !employees[0].userId) await pool.query('UPDATE employees SET user_id = ? WHERE id = ? AND user_id IS NULL', [actor.id, employees[0].id]).catch(() => undefined)
  return employees[0]
}

async function writeWorkflowAudit(executor: mysql.Pool | mysql.PoolConnection, actor: { id: number; role: Role; email: string }, action: string, entityType: string, entityId: number, target: string, beforeState?: unknown, afterState?: unknown) {
  await executor.query('INSERT INTO audit_events (actor_name, actor_user_id, actor_role, action, target, entity_type, entity_id, before_state, after_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [actor.email, actor.id, actor.role, action, target, entityType, entityId, beforeState == null ? null : JSON.stringify(beforeState), afterState == null ? null : JSON.stringify(afterState)])
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

app.get('/api/hr/overview', requireHR, async (_req: AuthenticatedRequest, res, next) => {
  try {
    const [[summary]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS employees, SUM(active = TRUE) AS activeEmployees,
      SUM(active = FALSE) AS inactiveEmployees FROM employees`)
    const [employees] = await pool.query<RowDataPacket[]>(`SELECT e.id, e.employee_code AS employeeCode, e.name, e.email, e.active,
      e.manager_user_id AS managerUserId, e.manager_name AS managerName, d.id AS departmentId, d.name AS department,
      (SELECT COUNT(*) FROM employee_leave_records l WHERE l.employee_id = e.id AND l.status = 'approved' AND l.ends_on >= CURDATE()) AS upcomingLeaveCount,
      (SELECT COUNT(*) FROM timesheets t WHERE t.employee_id = e.id AND t.status IN ('submitted','resubmitted','returned')) AS pendingReviewCount,
      (SELECT COUNT(*) FROM timesheets t WHERE t.employee_id = e.id AND t.status IN ('submitted','resubmitted','returned') AND t.assigned_manager_user_id IS NOT NULL AND t.assigned_manager_user_id <> e.manager_user_id) AS pendingReassignmentCount
      FROM employees e JOIN departments d ON d.id = e.department_id ORDER BY e.active DESC, e.name`)
    const [departments] = await pool.query<RowDataPacket[]>('SELECT id, code, name FROM departments ORDER BY name')
    const [managers] = await pool.query<RowDataPacket[]>("SELECT id, name, email FROM users WHERE role = 'manager' ORDER BY name")
    const [leaves] = await pool.query<RowDataPacket[]>(`SELECT l.id, l.employee_id AS employeeId, e.name AS employeeName, e.employee_code AS employeeCode,
      DATE_FORMAT(l.starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(l.ends_on, '%Y-%m-%d') AS endsOn, l.leave_type AS leaveType, l.status, l.source_reference AS sourceReference
      FROM employee_leave_records l JOIN employees e ON e.id = l.employee_id ORDER BY l.starts_on DESC LIMIT 200`)
    const [holidays] = await pool.query<RowDataPacket[]>("SELECT id, DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holidayDate, name, region, active FROM public_holidays ORDER BY holiday_date DESC LIMIT 200")
    return res.json({ summary: summary || {}, employees, departments, managers, leaves, holidays })
  } catch (error) { next(error) }
})

app.post('/api/hr/employees', requireHR, async (req: AuthenticatedRequest, res, next) => {
  const connection = await pool.getConnection()
  try {
    const employeeCode = String(req.body?.employeeCode || '').trim().toUpperCase()
    const name = String(req.body?.name || '').trim()
    const email = String(req.body?.email || '').trim().toLowerCase()
    const departmentId = Number(req.body?.departmentId)
    const managerUserId = Number(req.body?.managerUserId)
    if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(employeeCode) || name.length < 2 || name.length > 120 || !/^\S+@\S+\.\S+$/.test(email) || !Number.isInteger(departmentId) || !Number.isInteger(managerUserId)) return res.status(400).json({ message: 'Enter a valid employee code, name, work email, department, and Manager.' })
    const [[department]] = await connection.query<RowDataPacket[]>('SELECT id FROM departments WHERE id = ? LIMIT 1', [departmentId])
    const [[manager]] = await connection.query<RowDataPacket[]>("SELECT id, name, email FROM users WHERE id = ? AND role = 'manager' LIMIT 1", [managerUserId])
    if (!department || !manager) return res.status(400).json({ message: 'Choose an existing department and active Manager account.' })
    const [[account]] = await connection.query<RowDataPacket[]>('SELECT id, role FROM users WHERE LOWER(email) = ? LIMIT 1', [email])
    if (account && account.role !== 'employee') return res.status(409).json({ message: 'This email is already attached to a non-employee account.' })
    await connection.beginTransaction()
    const [created] = await connection.query<ResultSetHeader>('INSERT INTO employees (employee_code,name,email,department_id,manager_name,manager_user_id,user_id,active) VALUES (?,?,?,?,?,?,?,TRUE)', [employeeCode, name, email, departmentId, manager.name, manager.id, account?.id || null])
    const employeeId = Number(created.insertId)
    await writeWorkflowAudit(connection, req.actor!, 'Workforce record created', 'employee', employeeId, `${employeeCode} · ${name}`, null, { departmentId, managerUserId, active: true })
    await connection.query('INSERT INTO notifications (title,message,notification_type,recipient_email) VALUES (?,?,?,?)', ['New team member assigned', `${name} (${employeeCode}) was added to your team by HR.`, 'info', manager.email])
    await connection.commit()
    return res.status(201).json({ employeeId, message: 'Employee added to the shared workforce roster.' })
  } catch (error: any) { await connection.rollback(); if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'An employee already uses that workforce code or account.' }); next(error) } finally { connection.release() }
})

app.patch('/api/hr/employees/:id', requireHR, async (req: AuthenticatedRequest, res, next) => {
  const connection = await pool.getConnection()
  try {
    const employeeId = Number(req.params.id)
    if (!Number.isInteger(employeeId) || employeeId < 1) return res.status(400).json({ message: 'Choose a valid employee record.' })
    await connection.beginTransaction()
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT e.id,e.employee_code AS employeeCode,e.name,e.department_id AS departmentId,e.manager_user_id AS managerUserId,e.manager_name AS managerName,e.active
      FROM employees e WHERE e.id = ? FOR UPDATE`, [employeeId])
    const employee = rows[0]
    if (!employee) { await connection.rollback(); return res.status(404).json({ message: 'Employee record not found.' }) }
    const departmentId = req.body?.departmentId === undefined ? Number(employee.departmentId) : Number(req.body.departmentId)
    const managerUserId = req.body?.managerUserId === undefined ? Number(employee.managerUserId) : Number(req.body.managerUserId)
    const active = typeof req.body?.active === 'boolean' ? req.body.active : Boolean(employee.active)
    const reassignPendingReviews = req.body?.reassignPendingReviews === true
    const [[department]] = await connection.query<RowDataPacket[]>('SELECT id FROM departments WHERE id = ? LIMIT 1', [departmentId])
    const [[manager]] = await connection.query<RowDataPacket[]>("SELECT id, name FROM users WHERE id = ? AND role = 'manager' LIMIT 1", [managerUserId])
    if (!department || !manager) { await connection.rollback(); return res.status(400).json({ message: 'Choose an existing department and Manager account.' }) }
    const before = { departmentId: Number(employee.departmentId), managerUserId: employee.managerUserId ? Number(employee.managerUserId) : null, active: Boolean(employee.active) }
    await connection.query('UPDATE employees SET department_id = ?, manager_user_id = ?, manager_name = ?, active = ? WHERE id = ?', [departmentId, managerUserId, manager.name, active, employeeId])
    let reassignedCount = 0
    if (reassignPendingReviews) {
      const [pendingRows] = await connection.query<RowDataPacket[]>("SELECT id,period_label AS periodLabel,status FROM timesheets WHERE employee_id = ? AND status IN ('submitted','resubmitted','returned') FOR UPDATE", [employeeId])
      const [result] = await connection.query<ResultSetHeader>("UPDATE timesheets SET assigned_manager_user_id = ?, version = version + 1 WHERE employee_id = ? AND status IN ('submitted','resubmitted','returned')", [managerUserId, employeeId])
      reassignedCount = result.affectedRows
      for (const pending of pendingRows) await connection.query('INSERT INTO notifications (title,message,notification_type,recipient_email,timesheet_id) SELECT ?,?,?,email,? FROM users WHERE id=? AND role=\'manager\'', ['Timesheet review reassigned', `${employee.name}'s ${pending.periodLabel} timesheet was explicitly assigned to your review queue by HR.`, 'warning', pending.id, managerUserId])
    }
    if (!active) await connection.query('UPDATE employee_project_assignments SET active = FALSE, ends_on = CASE WHEN starts_on IS NOT NULL AND starts_on > CURDATE() THEN starts_on ELSE COALESCE(ends_on,CURDATE()) END WHERE employee_id = ? AND active = TRUE', [employeeId])
    const after = { departmentId, managerUserId, active, pendingReviewsReassigned: reassignedCount }
    await writeWorkflowAudit(connection, req.actor!, 'Workforce record updated', 'employee', employeeId, `${employee.employeeCode} · ${employee.name}`, before, after)
    if (managerUserId !== before.managerUserId) await connection.query('INSERT INTO notifications (title,message,notification_type,recipient_email) SELECT ?,?,?,email FROM users WHERE id = ? AND role = \'manager\'', ['Team member assigned', `${employee.name} (${employee.employeeCode}) was assigned to your team by HR.`, 'info', managerUserId])
    await connection.commit()
    return res.json({ message: active ? 'Workforce record updated. Pending reviews remain with their original Manager unless reassignment was explicitly selected.' : 'Employee deactivated. New time entry is blocked and project assignments are inactive; history remains available.', pendingReviewsReassigned: reassignedCount })
  } catch (error: any) { await connection.rollback(); if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'That account is already linked to another employee.' }); next(error) } finally { connection.release() }
})

app.post('/api/hr/leave', requireHR, async (req: AuthenticatedRequest, res, next) => {
  const connection = await pool.getConnection()
  try {
    const employeeId = Number(req.body?.employeeId); const startsOn = String(req.body?.startsOn || ''); const endsOn = String(req.body?.endsOn || ''); const leaveType = String(req.body?.leaveType || '').trim(); const sourceReference = String(req.body?.sourceReference || '').trim()
    if (!Number.isInteger(employeeId) || employeeId < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || startsOn > endsOn || leaveType.length < 2 || leaveType.length > 80 || sourceReference.length > 120) return res.status(400).json({ message: 'Enter an employee, valid date range, leave type, and optional reference.' })
    const [[employee]] = await connection.query<RowDataPacket[]>('SELECT id,name FROM employees WHERE id = ? LIMIT 1', [employeeId])
    if (!employee) return res.status(404).json({ message: 'Employee record not found.' })
    await connection.beginTransaction()
    const [result] = await connection.query<ResultSetHeader>("INSERT INTO employee_leave_records (employee_id,starts_on,ends_on,leave_type,status,source_reference) VALUES (?,?,?,?,'approved',?)", [employeeId, startsOn, endsOn, leaveType, sourceReference || null])
    await writeWorkflowAudit(connection, req.actor!, 'Approved leave recorded', 'leave', Number(result.insertId), `${employee.name} · ${startsOn} to ${endsOn}`, null, { employeeId, startsOn, endsOn, leaveType, status: 'approved' })
    await connection.commit()
    return res.status(201).json({ leaveId: result.insertId, message: 'Approved leave added to the shared work calendar.' })
  } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
})

app.patch('/api/hr/leave/:id', requireHR, async (req: AuthenticatedRequest, res, next) => {
  const status = req.body?.status
  if (!['approved','cancelled'].includes(status)) return res.status(400).json({ message: 'Leave status must be approved or cancelled.' })
  const connection = await pool.getConnection()
  try {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT id,employee_id AS employeeId,status FROM employee_leave_records WHERE id = ? FOR UPDATE', [req.params.id])
    if (!rows[0]) return res.status(404).json({ message: 'Leave record not found.' })
    const before = { status: rows[0].status }; await connection.beginTransaction()
    await connection.query('UPDATE employee_leave_records SET status = ? WHERE id = ?', [status, rows[0].id])
    await writeWorkflowAudit(connection, req.actor!, status === 'approved' ? 'Leave approved' : 'Leave cancelled', 'leave', Number(rows[0].id), `Employee #${rows[0].employeeId}`, before, { status })
    await connection.commit(); return res.json({ message: status === 'approved' ? 'Leave restored to the work calendar.' : 'Leave cancelled. Missing-workday calculations will use the updated calendar.' })
  } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
})

app.post('/api/hr/holidays', requireHR, async (req: AuthenticatedRequest, res, next) => {
  try {
    const holidayDate = String(req.body?.holidayDate || ''); const name = String(req.body?.name || '').trim(); const region = String(req.body?.region || 'default').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holidayDate) || name.length < 2 || name.length > 120 || region.length < 1 || region.length > 60) return res.status(400).json({ message: 'Enter a valid holiday date, name, and region.' })
    const [result] = await pool.query<ResultSetHeader>('INSERT INTO public_holidays (holiday_date,name,region,active) VALUES (?,?,?,TRUE)', [holidayDate, name, region])
    await writeWorkflowAudit(pool, req.actor!, 'Public holiday added', 'holiday', Number(result.insertId), `${name} · ${holidayDate} (${region})`, null, { holidayDate, name, region, active: true })
    return res.status(201).json({ holidayId: result.insertId, message: 'Holiday added to the shared calendar.' })
  } catch (error: any) { if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'A holiday already exists for that date and region.' }); next(error) }
})

app.patch('/api/hr/holidays/:id', requireHR, async (req: AuthenticatedRequest, res, next) => {
  try {
    const active = req.body?.active
    if (typeof active !== 'boolean') return res.status(400).json({ message: 'Provide an active state.' })
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id,name,active FROM public_holidays WHERE id = ? LIMIT 1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ message: 'Holiday record not found.' })
    await pool.query('UPDATE public_holidays SET active = ? WHERE id = ?', [active, rows[0].id])
    await writeWorkflowAudit(pool, req.actor!, active ? 'Public holiday activated' : 'Public holiday deactivated', 'holiday', Number(rows[0].id), rows[0].name, { active: Boolean(rows[0].active) }, { active })
    return res.json({ message: active ? 'Holiday restored to the shared calendar.' : 'Holiday deactivated; historical calendar records remain.' })
  } catch (error) { next(error) }
})

function managerDailyHoursWarningThreshold() {
  const value = Number(process.env.MANAGER_DAILY_HOURS_WARNING_THRESHOLD)
  return Number.isFinite(value) && value > 0 ? value : null
}

function isWeekday(date: string) { const day = new Date(`${date}T00:00:00`).getDay(); return day !== 0 && day !== 6 }

async function missingWorkdays(employeeId: number, period: RowDataPacket, timesheetId?: number | null) {
  const [holidays] = await pool.query<RowDataPacket[]>("SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS day FROM public_holidays WHERE active = TRUE AND holiday_date BETWEEN ? AND ?", [period.startsOn, period.endsOn])
  const [leave] = await pool.query<RowDataPacket[]>("SELECT DATE_FORMAT(starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(ends_on, '%Y-%m-%d') AS endsOn FROM employee_leave_records WHERE employee_id = ? AND status = 'approved' AND ends_on >= ? AND starts_on <= ?", [employeeId, period.startsOn, period.endsOn])
  const [entries] = timesheetId ? await pool.query<RowDataPacket[]>("SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS day FROM timesheet_entries WHERE timesheet_id = ? GROUP BY entry_date", [timesheetId]) : [[]]
  const holidayDates = new Set(holidays.map((row) => String(row.day).slice(0, 10)))
  const entryDates = new Set(entries.map((row) => String(row.day).slice(0, 10)))
  const missing: string[] = []
  for (let date = new Date(`${String(period.startsOn).slice(0, 10)}T00:00:00Z`); date <= new Date(`${String(period.endsOn).slice(0, 10)}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10)
    const onLeave = leave.some((row) => day >= String(row.startsOn).slice(0, 10) && day <= String(row.endsOn).slice(0, 10))
    if (isWeekday(day) && !holidayDates.has(day) && !onLeave && !entryDates.has(day)) missing.push(day)
  }
  return missing
}

async function directorMissingWorkdayExceptions(period: RowDataPacket) {
  const [members] = await pool.query<RowDataPacket[]>(`SELECT e.id, e.name, e.employee_code AS employeeCode, d.name AS department, t.id AS timesheetId, t.status,
    (SELECT COUNT(*) FROM timesheet_entries te WHERE te.timesheet_id = t.id) AS entryCount
    FROM employees e JOIN departments d ON d.id = e.department_id LEFT JOIN timesheets t ON t.employee_id = e.id AND t.reporting_period_id = ?
    WHERE e.active = TRUE ORDER BY e.name`, [period.id])
  const exceptions: any[] = []
  for (const member of members) {
    const shouldCheckDays = !member.timesheetId || member.status === 'draft' || Number(member.entryCount) > 0
    if (!shouldCheckDays) continue
    const days = await missingWorkdays(Number(member.id), period, member.timesheetId ? Number(member.timesheetId) : null)
    if (days.length) exceptions.push({ id: `missing-${member.id}`, severity: 'warning', finding_type: 'missing_workdays', type: 'missing_workdays', message: `${days.length} scheduled workday(s) have no recorded time after excluding approved leave and active holidays.`, employeeName: member.name, employeeCode: member.employeeCode, department: member.department, hours: null, status: member.status || 'not_started', resolved: false })
  }
  return exceptions
}

function managerTitleFor(status: string) { return status === 'resubmitted' ? 'Timesheet resubmitted' : 'Timesheet submitted' }

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
    const [entries] = timesheet ? await pool.query<RowDataPacket[]>(`SELECT e.id, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entryDate, e.project_id AS projectId, p.code AS projectCode, p.name AS projectName, e.activity_id AS activityId, a.name AS activityName, a.category AS activityCategory, e.hours, e.work_description AS workDescription, e.manager_comment AS managerComment FROM timesheet_entries e LEFT JOIN projects p ON p.id = e.project_id JOIN activities a ON a.id = e.activity_id WHERE e.timesheet_id = ? ORDER BY e.entry_date, e.id`, [timesheet.id]) : [[]]
    const [projects] = await pool.query<RowDataPacket[]>(`SELECT p.id, p.code, p.name FROM employee_project_assignments a JOIN projects p ON p.id = a.project_id
      WHERE a.employee_id = ? AND a.active = TRUE AND p.active = TRUE AND (a.starts_on IS NULL OR a.starts_on <= CURDATE()) AND (a.ends_on IS NULL OR a.ends_on >= CURDATE()) ORDER BY p.name`, [employee.id])
    const [activities] = await pool.query<RowDataPacket[]>("SELECT id, name, category FROM activities WHERE active = TRUE AND category = 'internal' ORDER BY name")
    const [projectActivities] = await pool.query<RowDataPacket[]>(`SELECT pa.project_id AS projectId, a.id, a.name, a.category FROM project_activity_assignments pa JOIN activities a ON a.id = pa.activity_id
      JOIN projects p ON p.id = pa.project_id JOIN employee_project_assignments ep ON ep.project_id = pa.project_id WHERE ep.employee_id = ? AND ep.active = TRUE AND p.active = TRUE AND pa.active = TRUE AND a.active = TRUE AND (ep.starts_on IS NULL OR ep.starts_on <= CURDATE()) AND (ep.ends_on IS NULL OR ep.ends_on >= CURDATE()) ORDER BY pa.project_id, a.name`, [employee.id])
    const [holidays] = await pool.query<RowDataPacket[]>("SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holidayDate, name FROM public_holidays WHERE active = TRUE AND holiday_date BETWEEN ? AND ?", [period.startsOn, period.endsOn])
    const [leave] = await pool.query<RowDataPacket[]>("SELECT DATE_FORMAT(starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(ends_on, '%Y-%m-%d') AS endsOn, leave_type AS leaveType FROM employee_leave_records WHERE employee_id = ? AND status = 'approved' AND ends_on >= ? AND starts_on <= ?", [employee.id, period.startsOn, period.endsOn])
    const [audit] = timesheet ? await pool.query<RowDataPacket[]>('SELECT event_type AS eventType, detail, created_at AS createdAt FROM timesheet_audit_events WHERE timesheet_id = ? ORDER BY created_at DESC LIMIT 20', [timesheet.id]) : [[]]
    const [notifications] = await pool.query<RowDataPacket[]>('SELECT id, title, message, notification_type AS type, read_at AS readAt, created_at AS createdAt, timesheet_id AS timesheetId FROM notifications WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 30', [req.actor!.email])
    const [cycles] = await pool.query<RowDataPacket[]>("SELECT period_label AS periodLabel, DATE_FORMAT(starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(ends_on, '%Y-%m-%d') AS endsOn, DATE_FORMAT(submission_deadline, '%Y-%m-%d') AS submissionDeadline, current_stage AS currentStage FROM billing_cycles WHERE period_label = ? LIMIT 1", [period.label])
    const [history] = await pool.query<RowDataPacket[]>(`SELECT t.id, t.period_label AS periodLabel, t.total_hours AS totalHours, t.status, t.submitted_at AS submittedAt, t.approved_at AS approvedAt, t.return_reason AS returnReason, reviewer.name AS reviewerName
      FROM timesheets t LEFT JOIN users reviewer ON reviewer.id = t.reviewer_user_id WHERE t.employee_id = ? ORDER BY COALESCE(t.reporting_period_id, 0) DESC, t.updated_at DESC LIMIT 24`, [employee.id])
    return res.json({ employee, period, billingCycle: cycles[0] || null, timesheet: timesheet ? { id: timesheet.id, status: timesheet.status, totalHours: timesheet.total_hours, returnReason: timesheet.return_reason, submittedAt: timesheet.submitted_at, reviewerName: timesheet.reviewer_user_id ? (history.find((item) => item.id === timesheet.id)?.reviewerName || null) : null, version: timesheet.version } : null, entries, projects, activities, projectActivities, holidays, leave, audit, notifications, history })
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
    if (!employeeCanEdit(timesheet.status)) return res.status(409).json({ message: 'This timesheet is read-only while it is under review or approved.' })
    const [activityRows] = await pool.query<RowDataPacket[]>('SELECT id, category FROM activities WHERE id = ? AND active = TRUE LIMIT 1', [activityId]); const activity = activityRows[0]
    if (!activity || (activity.category === 'project' && !projectId) || (activity.category === 'internal' && projectId)) return res.status(400).json({ message: 'Choose a valid project/activity combination.' })
    if (projectId) { const [project] = await pool.query<RowDataPacket[]>('SELECT id FROM projects WHERE id = ? AND active = TRUE LIMIT 1', [projectId]); const [assigned] = await pool.query<RowDataPacket[]>('SELECT id FROM employee_project_assignments WHERE employee_id = ? AND project_id = ? AND active = TRUE AND (starts_on IS NULL OR starts_on <= ?) AND (ends_on IS NULL OR ends_on >= ?) LIMIT 1', [employee.id, projectId, entryDate, entryDate]); if (!project[0] || !assigned[0]) return res.status(403).json({ message: 'This project is not currently assigned to you for that work date.' }); const [linkedActivity] = await pool.query<RowDataPacket[]>('SELECT id FROM project_activity_assignments WHERE project_id = ? AND activity_id = ? AND active = TRUE LIMIT 1', [projectId, activityId]); if (!linkedActivity[0]) return res.status(400).json({ message: 'This activity is not valid for the selected project.' }) }
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
    if (!timesheet || !employeeCanEdit(timesheet.status)) return res.status(409).json({ message: 'This timesheet cannot be edited.' })
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
    if (!timesheet || !employeeCanEdit(timesheet.status)) return res.status(409).json({ message: 'This timesheet cannot be edited.' })
    const entryDate = String(req.body?.entryDate || ''); const projectId = req.body?.projectId ? Number(req.body.projectId) : null; const activityId = Number(req.body?.activityId); const hours = Number(req.body?.hours); const workDescription = String(req.body?.workDescription || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || entryDate < period.startsOn || entryDate > period.endsOn || !isWeekday(entryDate) || !Number.isFinite(hours) || hours <= 0 || hours > 24 || !Number.isInteger(activityId)) return res.status(400).json({ message: 'Enter a valid weekday, activity, and hours within this reporting period.' })
    const [current] = await pool.query<RowDataPacket[]>("SELECT id, project_id AS projectId, activity_id AS activityId, DATE_FORMAT(entry_date, '%Y-%m-%d') AS entryDate FROM timesheet_entries WHERE id = ? AND timesheet_id = ? LIMIT 1", [req.params.id, timesheet.id])
    const currentEntry = current[0]
    if (!currentEntry) return res.status(404).json({ message: 'Entry not found.' })
    const sameHistoricalPair = Number(currentEntry.projectId || 0) === Number(projectId || 0) && Number(currentEntry.activityId) === activityId && String(currentEntry.entryDate) === entryDate
    const [activityRows] = await pool.query<RowDataPacket[]>('SELECT id, category, active FROM activities WHERE id = ? AND (active = TRUE OR ? = TRUE) LIMIT 1', [activityId, sameHistoricalPair]); const activity = activityRows[0]
    if (!activity || (activity.category === 'project' && !projectId) || (activity.category === 'internal' && projectId)) return res.status(400).json({ message: 'Choose a valid project/activity combination.' })
    if (projectId) { const [project] = await pool.query<RowDataPacket[]>('SELECT id,active FROM projects WHERE id = ? AND (active = TRUE OR ? = TRUE) LIMIT 1', [projectId, sameHistoricalPair]); const [assigned] = await pool.query<RowDataPacket[]>('SELECT id FROM employee_project_assignments WHERE employee_id = ? AND project_id = ? AND (active = TRUE OR ? = TRUE) AND (starts_on IS NULL OR starts_on <= ?) AND (ends_on IS NULL OR ends_on >= ?) LIMIT 1', [employee.id, projectId, sameHistoricalPair, entryDate, entryDate]); if (!project[0] || !assigned[0]) return res.status(403).json({ message: 'This project was not assigned to you for that work date.' }); const [linkedActivity] = await pool.query<RowDataPacket[]>('SELECT id FROM project_activity_assignments WHERE project_id = ? AND activity_id = ? AND (active = TRUE OR ? = TRUE) LIMIT 1', [projectId, activityId, sameHistoricalPair]); if (!linkedActivity[0]) return res.status(400).json({ message: 'This activity is not valid for the selected project.' }) }
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
    if (!timesheet || !employeeCanSubmit(timesheet.status)) return res.status(409).json({ message: 'This timesheet cannot be submitted.' })
    const [managerRows] = await connection.query<RowDataPacket[]>("SELECT id, email FROM users WHERE id = ? AND role = 'manager' LIMIT 1", [employee.managerUserId])
    if (!managerRows[0]) return res.status(409).json({ message: 'Your timesheet cannot be submitted until HR assigns an active Manager.' })
    const [entries] = await connection.query<RowDataPacket[]>("SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS entryDate, hours, work_description AS workDescription FROM timesheet_entries WHERE timesheet_id = ?", [timesheet.id])
    if (!entries.length) return res.status(400).json({ message: 'Add at least one daily entry before submitting.' })
    const [holidays] = await connection.query<RowDataPacket[]>("SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holidayDate FROM public_holidays WHERE active = TRUE AND holiday_date BETWEEN ? AND ?", [period.startsOn, period.endsOn])
    const [leave] = await connection.query<RowDataPacket[]>("SELECT DATE_FORMAT(starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(ends_on, '%Y-%m-%d') AS endsOn FROM employee_leave_records WHERE employee_id = ? AND status = 'approved'", [employee.id])
    const dates = new Set(entries.map((entry) => String(entry.entryDate).slice(0, 10)))
    const missing: string[] = []; for (let date = new Date(`${String(period.startsOn).slice(0, 10)}T00:00:00`); date <= new Date(`${String(period.endsOn).slice(0, 10)}T00:00:00`); date.setDate(date.getDate() + 1)) { const value = date.toISOString().slice(0, 10); const holiday = holidays.some((item) => String(item.holidayDate).slice(0, 10) === value); const onLeave = leave.some((item) => value >= String(item.startsOn).slice(0, 10) && value <= String(item.endsOn).slice(0, 10)); if (isWeekday(value) && !holiday && !onLeave && !dates.has(value)) missing.push(value) }
    await connection.beginTransaction()
    const nextStatus = timesheet.status === 'returned' || timesheet.status === 'rejected' ? 'resubmitted' : 'submitted'
    const [submitted] = await connection.query<ResultSetHeader>('UPDATE timesheets SET status = ?, assigned_manager_user_id = COALESCE(assigned_manager_user_id, ?), submitted_at = NOW(), return_reason = NULL, version = version + 1 WHERE id = ? AND status = ? AND version = ?', [nextStatus, employee.managerUserId, timesheet.id, timesheet.status, timesheet.version])
    if (!submitted.affectedRows) { await connection.rollback(); return res.status(409).json({ message: 'This timesheet changed before submission. Refresh and try again.' }) }
    await connection.query('INSERT INTO timesheet_audit_events (timesheet_id, actor_user_id, event_type, detail) VALUES (?, ?, ?, ?)', [timesheet.id, req.actor!.id, nextStatus === 'resubmitted' ? 'resubmitted' : 'submitted', missing.length ? `Submitted with ${missing.length} missing workday warning(s).` : null])
    await connection.query('INSERT INTO notifications (title, message, notification_type, recipient_email, timesheet_id) VALUES (?, ?, ?, ?, ?)', [managerTitleFor(nextStatus), `Your ${period.label} timesheet was ${nextStatus === 'resubmitted' ? 'resubmitted' : 'submitted'} for review.`, 'info', req.actor!.email, timesheet.id])
    const managerEmail = managerRows[0].email as string
    const managerTitle = managerTitleFor(nextStatus)
    await connection.query('INSERT INTO notifications (title, message, notification_type, recipient_email, timesheet_id) VALUES (?, ?, ?, ?, ?)', [managerTitle, `${employee.name} ${nextStatus === 'resubmitted' ? 'resubmitted' : 'submitted'} a ${period.label} timesheet for your review.`, 'info', managerEmail, timesheet.id])
    await writeWorkflowAudit(connection, req.actor!, managerTitle, 'timesheet', Number(timesheet.id), `${employee.name} · ${period.label}`, { status: timesheet.status }, { status: nextStatus, assignedManagerUserId: employee.managerUserId })
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
    FROM timesheets t JOIN employees e ON e.id = t.employee_id WHERE t.id = ? AND COALESCE(t.assigned_manager_user_id, e.manager_user_id) = ? LIMIT 1`, [timesheetId, managerId])
  return rows[0]
}

async function managerOwnsEmployee(managerId: number, employeeId: string | number) {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT e.id, e.name, e.email, e.employee_code AS employeeCode, e.manager_name AS managerName, d.name AS department
    FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.id = ? AND e.manager_user_id = ? AND e.active = TRUE LIMIT 1`, [employeeId, managerId])
  return rows[0]
}

async function managerOwnsProject(managerId: number, projectId: string | number) {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id, code, name, active FROM projects WHERE id = ? AND manager_user_id = ? LIMIT 1', [projectId, managerId])
  return rows[0]
}

async function managerNotificationEmail(managerId: number) {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT email FROM users WHERE id = ? AND role = ? LIMIT 1', [managerId, 'manager'])
  return rows[0]?.email as string | undefined
}

async function notifyManagerOfSubmission(employeeId: number, timesheetId: number, managerId: number | null, periodLabel: string, status: string) {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT e.name, ? AS managerUserId FROM employees e WHERE e.id = ? LIMIT 1', [managerId, employeeId])
  const employee = rows[0]; if (!employee?.managerUserId) return
  const email = await managerNotificationEmail(employee.managerUserId); if (!email) return
  const title = status === 'resubmitted' ? 'Timesheet resubmitted' : 'Timesheet submitted'
  const [existing] = await pool.query<RowDataPacket[]>('SELECT id FROM notifications WHERE recipient_email = ? AND timesheet_id = ? AND title = ? LIMIT 1', [email, timesheetId, title])
  if (!existing[0]) await pool.query('INSERT INTO notifications (title, message, notification_type, recipient_email, timesheet_id) VALUES (?, ?, ?, ?, ?)', [title, `${employee.name} ${status === 'resubmitted' ? 'resubmitted' : 'submitted'} a ${periodLabel} timesheet for your review.`, 'info', email, timesheetId])
}

app.get('/api/manager/dashboard', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const period = await activeReportingPeriod(); if (!period) return res.status(404).json({ message: 'No active reporting period found.' })
    const [[metrics]] = await pool.query<RowDataPacket[]>(`SELECT (SELECT COUNT(*) FROM employees WHERE manager_user_id = ? AND active = TRUE) AS employees,
      SUM(t.status IN ('submitted','resubmitted')) AS awaitingReview, SUM(t.status = 'resubmitted') AS resubmitted,
      SUM(t.status = 'returned') AS returned, SUM(t.status = 'approved') AS approved,
      SUM(t.status IN ('submitted','resubmitted','approved')) AS submittedOrApproved,
      COALESCE(SUM(CASE WHEN t.status IN ('submitted','resubmitted','approved') THEN t.total_hours ELSE 0 END), 0) AS submittedHours,
      COALESCE(SUM(CASE WHEN t.status = 'approved' THEN t.total_hours ELSE 0 END), 0) AS approvedHours
      FROM timesheets t JOIN employees e ON e.id = t.employee_id
      WHERE COALESCE(t.assigned_manager_user_id, e.manager_user_id) = ? AND t.reporting_period_id = ?`, [req.actor!.id, req.actor!.id, period.id])
    const [teamWorkload] = await pool.query<RowDataPacket[]>(`SELECT e.id AS employeeId,e.name AS employeeName,t.id AS timesheetId,t.status FROM employees e
      LEFT JOIN timesheets t ON t.employee_id = e.id AND t.reporting_period_id = ? WHERE e.manager_user_id = ? AND e.active = TRUE`, [period.id, req.actor!.id])
    let missingCount = 0
    for (const member of teamWorkload) if (!member.timesheetId || member.status === 'draft') {
      if ((await missingWorkdays(Number(member.employeeId), period, member.timesheetId ? Number(member.timesheetId) : null)).length) missingCount++
    }
    if (metrics) metrics.missing = missingCount
    const [attention] = await pool.query<RowDataPacket[]>(`SELECT t.id AS timesheetId, e.id AS employeeId, e.name AS employeeName, t.status, t.total_hours AS totalHours, t.return_reason AS returnReason,
      CASE WHEN t.status IN ('submitted','resubmitted') THEN 'review' WHEN t.status = 'returned' THEN 'correction' ELSE 'missing' END AS kind
      FROM employees e LEFT JOIN timesheets t ON t.employee_id = e.id AND t.reporting_period_id = ?
      WHERE e.manager_user_id = ? AND e.active = TRUE AND (t.id IS NULL OR (t.status IN ('draft','returned','submitted','resubmitted') AND COALESCE(t.assigned_manager_user_id, e.manager_user_id) = ?))
      ORDER BY FIELD(t.status, 'resubmitted','submitted','returned','draft'), e.name LIMIT 12`, [period.id, req.actor!.id, req.actor!.id])
    for (let index = attention.length - 1; index >= 0; index--) { const item = attention[index]; if (item && item.kind === 'missing' && (await missingWorkdays(Number(item.employeeId), period, item.timesheetId ? Number(item.timesheetId) : null)).length === 0) attention.splice(index, 1) }
    const [inFlight] = await pool.query<RowDataPacket[]>(`SELECT t.id AS timesheetId, e.id AS employeeId, e.name AS employeeName, t.status, t.total_hours AS totalHours, t.return_reason AS returnReason,
      CASE WHEN t.status IN ('submitted','resubmitted') THEN 'review' ELSE 'correction' END AS kind
      FROM timesheets t JOIN employees e ON e.id = t.employee_id WHERE t.assigned_manager_user_id = ? AND t.reporting_period_id = ? AND t.status IN ('submitted','resubmitted','returned') AND e.manager_user_id <> ? ORDER BY FIELD(t.status,'resubmitted','submitted','returned'), e.name LIMIT 12`, [req.actor!.id, period.id, req.actor!.id])
    attention.push(...inFlight)
    return res.json({ period, metrics: metrics || {}, attention })
  } catch (error) { next(error) }
})

app.get('/api/manager/team', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const period = await activeReportingPeriod(); if (!period) return res.status(404).json({ message: 'No active reporting period found.' })
    const [team] = await pool.query<RowDataPacket[]>(`SELECT e.id, e.name, e.email, e.employee_code AS employeeCode, d.name AS department, t.id AS timesheetId, t.status, COALESCE(t.total_hours, 0) AS totalHours,
      GROUP_CONCAT(DISTINCT p.code ORDER BY p.code SEPARATOR ', ') AS projects,
      SUM(CASE WHEN f.resolved = FALSE THEN 1 ELSE 0 END) AS findingCount
      FROM employees e JOIN departments d ON d.id = e.department_id
      LEFT JOIN timesheets t ON t.employee_id = e.id AND t.reporting_period_id = ?
      LEFT JOIN employee_project_assignments a ON a.employee_id = e.id AND a.active = TRUE
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN validation_findings f ON f.timesheet_id = t.id
      WHERE e.manager_user_id = ? AND e.active = TRUE GROUP BY e.id, d.name, t.id ORDER BY e.name`, [period.id, req.actor!.id])
    return res.json({ period, team })
  } catch (error) { next(error) }
})

app.get('/api/manager/team/:id', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const employee = await managerOwnsEmployee(req.actor!.id, String(req.params.id)); if (!employee) return res.status(404).json({ message: 'Employee not found in your team.' })
    const period = await activeReportingPeriod(); if (!period) return res.status(404).json({ message: 'No active reporting period found.' })
    const [assignments] = await pool.query<RowDataPacket[]>('SELECT a.id, a.active, DATE_FORMAT(a.starts_on, \'%Y-%m-%d\') AS startsOn, DATE_FORMAT(a.ends_on, \'%Y-%m-%d\') AS endsOn, p.id AS projectId, p.code, p.name FROM employee_project_assignments a JOIN projects p ON p.id = a.project_id WHERE a.employee_id = ? ORDER BY a.active DESC, p.name', [employee.id])
    const [timesheets] = await pool.query<RowDataPacket[]>('SELECT id, period_label AS periodLabel, total_hours AS totalHours, status, submitted_at AS submittedAt, return_reason AS returnReason FROM timesheets WHERE employee_id = ? ORDER BY COALESCE(reporting_period_id, 0) DESC, updated_at DESC LIMIT 12', [employee.id])
    const [findings] = await pool.query<RowDataPacket[]>('SELECT f.severity, f.finding_type AS findingType, f.message, f.resolved FROM validation_findings f JOIN timesheets t ON t.id = f.timesheet_id WHERE t.employee_id = ? AND t.reporting_period_id = ? AND f.resolved = FALSE', [employee.id, period.id])
    return res.json({ employee, period, assignments, timesheets, findings })
  } catch (error) { next(error) }
})

app.get('/api/manager/periods', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [periods] = await pool.query<RowDataPacket[]>(`SELECT label AS periodLabel FROM reporting_periods
      UNION SELECT DISTINCT t.period_label AS periodLabel FROM timesheets t JOIN employees e ON e.id = t.employee_id WHERE e.manager_user_id = ?
      ORDER BY periodLabel DESC`, [req.actor!.id])
    return res.json({ periods })
  } catch (error) { next(error) }
})

app.get('/api/manager/projects', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [projects] = await pool.query<RowDataPacket[]>(`SELECT p.id, p.code, p.name, p.description, p.active, DATE_FORMAT(p.starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(p.ends_on, '%Y-%m-%d') AS endsOn,
      COUNT(DISTINCT a.employee_id) AS assignedEmployees, COUNT(DISTINCT pa.activity_id) AS activityCount
      FROM projects p LEFT JOIN employee_project_assignments a ON a.project_id = p.id AND a.active = TRUE
      LEFT JOIN project_activity_assignments pa ON pa.project_id = p.id AND pa.active = TRUE
      WHERE p.manager_user_id = ? GROUP BY p.id ORDER BY p.active DESC, p.name`, [req.actor!.id])
    return res.json({ projects })
  } catch (error) { next(error) }
})

app.post('/api/manager/projects', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase(); const name = String(req.body?.name || '').trim(); const description = String(req.body?.description || '').trim(); const startsOn = String(req.body?.startsOn || '') || null; const endsOn = String(req.body?.endsOn || '') || null
    if (!/^[A-Z0-9][A-Z0-9-_]{1,39}$/.test(code) || name.length < 2 || name.length > 160 || description.length > 500 || (startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) || (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) || (startsOn && endsOn && startsOn > endsOn)) return res.status(400).json({ message: 'Provide a valid project code, name, optional description, and valid dates.' })
    const [result] = await pool.query<ResultSetHeader>('INSERT INTO projects (code, name, description, starts_on, ends_on, manager_user_id, active) VALUES (?, ?, ?, ?, ?, ?, TRUE)', [code, name, description || null, startsOn, endsOn, req.actor!.id])
    await writeWorkflowAudit(pool, req.actor!, 'Project created', 'project', Number(result.insertId), `${code} · ${name}`, null, { code, name, description: description || null, startsOn, endsOn, active: true })
    return res.status(201).json({ id: result.insertId, message: 'Project created.' })
  } catch (error: any) { if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'A project with this code already exists.' }); next(error) }
})

app.patch('/api/manager/projects/:id', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const project = await managerOwnsProject(req.actor!.id, String(req.params.id)); if (!project) return res.status(404).json({ message: 'Project not found in your managed projects.' })
    const name = String(req.body?.name ?? project.name).trim(); const description = String(req.body?.description ?? '').trim(); const active = typeof req.body?.active === 'boolean' ? req.body.active : Boolean(project.active); const startsOn = req.body?.startsOn || null; const endsOn = req.body?.endsOn || null
    if (name.length < 2 || name.length > 160 || description.length > 500 || (startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) || (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) || (startsOn && endsOn && startsOn > endsOn)) return res.status(400).json({ message: 'Provide valid project details.' })
    await pool.query('UPDATE projects SET name = ?, description = ?, active = ?, starts_on = ?, ends_on = ? WHERE id = ? AND manager_user_id = ?', [name, description || null, active, startsOn, endsOn, project.id, req.actor!.id])
    await writeWorkflowAudit(pool, req.actor!, active ? 'Project updated' : 'Project deactivated', 'project', Number(project.id), `${project.code} · ${name}`, { name: project.name, active: Boolean(project.active) }, { name, description: description || null, active })
    return res.json({ message: active ? 'Project updated.' : 'Project deactivated. Historical entries were preserved.' })
  } catch (error) { next(error) }
})

app.get('/api/manager/projects/:id/activities', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const project = await managerOwnsProject(req.actor!.id, String(req.params.id)); if (!project) return res.status(404).json({ message: 'Project not found in your managed projects.' })
    const [activities] = await pool.query<RowDataPacket[]>(`SELECT pa.id AS assignmentId, pa.active, a.id, a.name, a.category FROM project_activity_assignments pa JOIN activities a ON a.id = pa.activity_id WHERE pa.project_id = ? ORDER BY pa.active DESC, a.name`, [project.id])
    return res.json({ activities })
  } catch (error) { next(error) }
})

app.post('/api/manager/projects/:id/activities', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const project = await managerOwnsProject(req.actor!.id, String(req.params.id)); if (!project) return res.status(404).json({ message: 'Project not found in your managed projects.' })
    const name = String(req.body?.name || '').trim(); if (name.length < 2 || name.length > 120) return res.status(400).json({ message: 'Provide an activity name between 2 and 120 characters.' })
    const [existing] = await pool.query<RowDataPacket[]>('SELECT id FROM activities WHERE name = ? AND category = ? LIMIT 1', [name, 'project'])
    const activityId = existing[0]?.id || (await pool.query<ResultSetHeader>('INSERT INTO activities (name, category, active) VALUES (?, ?, TRUE)', [name, 'project']))[0].insertId
    await pool.query('INSERT INTO project_activity_assignments (project_id, activity_id, active, created_by_user_id) VALUES (?, ?, TRUE, ?) ON DUPLICATE KEY UPDATE active = TRUE, created_by_user_id = VALUES(created_by_user_id)', [project.id, activityId, req.actor!.id])
    await writeWorkflowAudit(pool, req.actor!, 'Project activity assigned', 'project', Number(project.id), `${project.code} · ${name}`, null, { activityId: Number(activityId), active: true })
    return res.status(201).json({ message: 'Project activity saved.', activityId })
  } catch (error) { next(error) }
})

app.patch('/api/manager/projects/:projectId/activities/:activityId', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const project = await managerOwnsProject(req.actor!.id, String(req.params.projectId)); if (!project) return res.status(404).json({ message: 'Project not found in your managed projects.' })
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ message: 'Provide an active state.' })
    const [result] = await pool.query<ResultSetHeader>('UPDATE project_activity_assignments SET active = ? WHERE project_id = ? AND activity_id = ?', [req.body.active, project.id, req.params.activityId])
    if (!result.affectedRows) return res.status(404).json({ message: 'Project activity not found.' })
    await writeWorkflowAudit(pool, req.actor!, req.body.active ? 'Project activity activated' : 'Project activity deactivated', 'project', Number(project.id), `${project.code} · activity #${req.params.activityId}`, { active: !req.body.active }, { active: req.body.active })
    return res.json({ message: req.body.active ? 'Activity activated.' : 'Activity deactivated. Historical entries were preserved.' })
  } catch (error) { next(error) }
})

app.get('/api/manager/projects/:id/assignments', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const project = await managerOwnsProject(req.actor!.id, String(req.params.id)); if (!project) return res.status(404).json({ message: 'Project not found in your managed projects.' })
    const [assignments] = await pool.query<RowDataPacket[]>(`SELECT a.id, a.active, DATE_FORMAT(a.starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(a.ends_on, '%Y-%m-%d') AS endsOn, e.id AS employeeId, e.name, e.employee_code AS employeeCode
      FROM employee_project_assignments a JOIN employees e ON e.id = a.employee_id WHERE a.project_id = ? AND e.manager_user_id = ? ORDER BY a.active DESC, e.name`, [project.id, req.actor!.id])
    return res.json({ assignments })
  } catch (error) { next(error) }
})

app.post('/api/manager/projects/:id/assignments', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const project = await managerOwnsProject(req.actor!.id, String(req.params.id)); if (!project) return res.status(404).json({ message: 'Project not found in your managed projects.' })
    const employee = await managerOwnsEmployee(req.actor!.id, Number(req.body?.employeeId)); if (!employee) return res.status(404).json({ message: 'Employee not found in your team.' })
    const startsOn = String(req.body?.startsOn || '') || null; const endsOn = String(req.body?.endsOn || '') || null
    if ((startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) || (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) || (startsOn && endsOn && startsOn > endsOn)) return res.status(400).json({ message: 'Provide valid assignment dates.' })
    await pool.query('INSERT INTO employee_project_assignments (employee_id, project_id, active, starts_on, ends_on) VALUES (?, ?, TRUE, ?, ?) ON DUPLICATE KEY UPDATE active = TRUE, starts_on = VALUES(starts_on), ends_on = VALUES(ends_on)', [employee.id, project.id, startsOn, endsOn])
    await writeWorkflowAudit(pool, req.actor!, 'Employee assigned to project', 'project', Number(project.id), `${employee.employeeCode} · ${project.code}`, null, { employeeId: Number(employee.id), active: true, startsOn, endsOn })
    return res.status(201).json({ message: 'Employee assigned to project.' })
  } catch (error) { next(error) }
})

app.patch('/api/manager/projects/:projectId/assignments/:employeeId', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const project = await managerOwnsProject(req.actor!.id, String(req.params.projectId)); const employee = await managerOwnsEmployee(req.actor!.id, String(req.params.employeeId))
    if (!project || !employee) return res.status(404).json({ message: 'Project or employee not found in your authorized team.' })
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ message: 'Provide an active state.' })
    const [result] = await pool.query<ResultSetHeader>('UPDATE employee_project_assignments SET active = ?, ends_on = CASE WHEN ? THEN ends_on ELSE COALESCE(ends_on, CURDATE()) END WHERE employee_id = ? AND project_id = ?', [req.body.active, req.body.active, employee.id, project.id])
    if (!result.affectedRows) return res.status(404).json({ message: 'Project assignment not found.' })
    await writeWorkflowAudit(pool, req.actor!, req.body.active ? 'Project assignment activated' : 'Project assignment ended', 'project', Number(project.id), `${employee.employeeCode} · ${project.code}`, { active: !req.body.active }, { employeeId: Number(employee.id), active: req.body.active })
    return res.json({ message: req.body.active ? 'Assignment activated.' : 'Assignment ended. Historical entries were preserved.' })
  } catch (error) { next(error) }
})

app.get('/api/manager/timesheets', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const status = String(req.query.status || 'all'); const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null; const periodLabel = String(req.query.period || '').trim()
    if (!['all', 'submitted', 'resubmitted'].includes(status)) return res.status(400).json({ message: 'Invalid review status filter.' })
    const [timesheets] = await pool.query<RowDataPacket[]>(`SELECT t.id, t.period_label AS periodLabel, t.total_hours AS totalHours, t.status, t.submitted_at AS submittedAt, t.return_reason AS returnReason, t.version,
      e.name AS employeeName, e.employee_code AS employeeCode, d.name AS department, SUM(CASE WHEN f.resolved = FALSE THEN 1 ELSE 0 END) AS findingCount
      FROM timesheets t JOIN employees e ON e.id = t.employee_id JOIN departments d ON d.id = e.department_id
      LEFT JOIN validation_findings f ON f.timesheet_id = t.id
      WHERE COALESCE(t.assigned_manager_user_id, e.manager_user_id) = ? AND t.status IN ('submitted', 'resubmitted')
      AND (? = 'all' OR t.status = ?) AND (? IS NULL OR e.id = ?) AND (? = '' OR t.period_label = ?)
      GROUP BY t.id, e.id, d.name ORDER BY t.submitted_at ASC`, [req.actor!.id, status, status, employeeId, employeeId, periodLabel, periodLabel])
    return res.json({ timesheets })
  } catch (error) { next(error) }
})

app.get('/api/manager/timesheets/:id', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const timesheet = await managerOwnsTimesheet(req.actor!.id, String(req.params.id))
    if (!timesheet) return res.status(404).json({ message: 'Timesheet not found in your team.' })
    const [entries] = await pool.query<RowDataPacket[]>(`SELECT e.id, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entryDate, e.hours, e.work_description AS workDescription, e.manager_comment AS managerComment, p.code AS projectCode, p.name AS projectName, a.name AS activityName,
      SUM(e.hours) OVER (PARTITION BY e.entry_date) AS dailyTotal
      FROM timesheet_entries e LEFT JOIN projects p ON p.id = e.project_id JOIN activities a ON a.id = e.activity_id WHERE e.timesheet_id = ? ORDER BY e.entry_date, e.id`, [timesheet.id])
    const [findings] = await pool.query<RowDataPacket[]>('SELECT severity, finding_type AS findingType, message, resolved FROM validation_findings WHERE timesheet_id = ? AND resolved = FALSE ORDER BY severity DESC, id DESC', [timesheet.id])
    const [history] = await pool.query<RowDataPacket[]>(`SELECT a.event_type AS eventType, a.detail, a.created_at AS createdAt, u.name AS actorName FROM timesheet_audit_events a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.timesheet_id = ? ORDER BY a.created_at DESC`, [timesheet.id])
    return res.json({ timesheet, entries, findings, history })
  } catch (error) { next(error) }
})

app.get('/api/manager/exceptions', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const period = await activeReportingPeriod(); if (!period) return res.status(404).json({ message: 'No active reporting period found.' })
    const [exceptionRows] = await pool.query<RowDataPacket[]>(`SELECT e.id AS employeeId, e.name AS employeeName, t.id AS timesheetId, t.status, t.total_hours AS totalHours,
      CASE WHEN t.id IS NULL OR t.status = 'draft' THEN 'missing_submission' WHEN t.status = 'returned' THEN 'returned_waiting_for_correction' WHEN t.status IN ('submitted','resubmitted') THEN 'awaiting_review' ELSE 'validation_warning' END AS type,
      CASE WHEN t.id IS NULL OR t.status = 'draft' THEN 'No submitted timesheet for the current reporting period.' WHEN t.status = 'returned' THEN COALESCE(t.return_reason, 'Timesheet was returned for correction.') WHEN t.status IN ('submitted','resubmitted') THEN 'Timesheet requires your review.' ELSE 'Validation warning requires investigation.' END AS message,
      CASE WHEN t.id IS NULL OR t.status IN ('draft','returned') THEN 'warning' ELSE 'info' END AS severity
      FROM employees e LEFT JOIN timesheets t ON t.employee_id = e.id AND t.reporting_period_id = ?
      WHERE e.manager_user_id = ? AND e.active = TRUE AND (t.id IS NULL OR (t.status IN ('draft','returned','submitted','resubmitted') AND COALESCE(t.assigned_manager_user_id, e.manager_user_id) = ?))
      UNION ALL
      SELECT e.id, e.name, t.id, t.status, t.total_hours, f.finding_type, f.message, f.severity
      FROM validation_findings f JOIN timesheets t ON t.id = f.timesheet_id JOIN employees e ON e.id = t.employee_id
      WHERE COALESCE(t.assigned_manager_user_id, e.manager_user_id) = ? AND t.reporting_period_id = ? AND f.resolved = FALSE
      ORDER BY severity DESC, employeeName`, [period.id, req.actor!.id, req.actor!.id, req.actor!.id, period.id])
    const exceptions: any[] = [...exceptionRows]
    for (let index = exceptions.length - 1; index >= 0; index--) {
      const issue = exceptions[index]
      if (!issue) continue
      if (issue.type === 'missing_submission' && (await missingWorkdays(Number(issue.employeeId), period, issue.timesheetId ? Number(issue.timesheetId) : null)).length === 0) exceptions.splice(index, 1)
    }
    const [reviewedWork] = await pool.query<RowDataPacket[]>(`SELECT t.id AS timesheetId,t.employee_id AS employeeId,e.name AS employeeName,t.status,t.total_hours AS totalHours,
      (SELECT COUNT(*) FROM timesheet_entries te WHERE te.timesheet_id=t.id) AS entryCount FROM timesheets t JOIN employees e ON e.id=t.employee_id
      WHERE COALESCE(t.assigned_manager_user_id,e.manager_user_id)=? AND t.reporting_period_id=?`, [req.actor!.id, period.id])
    for (const work of reviewedWork) if (Number(work.entryCount) > 0) {
      const days = await missingWorkdays(Number(work.employeeId), period, Number(work.timesheetId))
      if (days.length) exceptions.push({ employeeId: work.employeeId, employeeName: work.employeeName, timesheetId: work.timesheetId, status: work.status, totalHours: work.totalHours, type: 'missing_workdays', message: `${days.length} scheduled workday(s) have no entry after accounting for active holidays and approved leave.`, severity: 'warning' })
    }
    const threshold = managerDailyHoursWarningThreshold()
    if (threshold) {
      const [highDays] = await pool.query<RowDataPacket[]>(`SELECT e.id AS employeeId, e.name AS employeeName, t.id AS timesheetId, t.status, t.total_hours AS totalHours,
        'unusually_high_daily_hours' AS type, CONCAT('A daily total exceeds the configured ', ?, '-hour review threshold.') AS message, 'warning' AS severity
        FROM timesheet_entries te JOIN timesheets t ON t.id = te.timesheet_id JOIN employees e ON e.id = t.employee_id
        WHERE COALESCE(t.assigned_manager_user_id, e.manager_user_id) = ? AND t.reporting_period_id = ? GROUP BY e.id, t.id, te.entry_date HAVING SUM(te.hours) > ?`, [threshold, req.actor!.id, period.id, threshold])
      exceptions.push(...highDays)
    }
    return res.json({ period, dailyHoursWarningThreshold: threshold, exceptions })
  } catch (error) { next(error) }
})

app.get('/api/manager/history', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try {
    const [history] = await pool.query<RowDataPacket[]>(`SELECT t.id AS timesheetId, e.name AS employeeName, e.employee_code AS employeeCode, t.period_label AS periodLabel, t.total_hours AS totalHours, t.status, t.submitted_at AS submittedAt, t.approved_at AS approvedAt, t.returned_at AS returnedAt, t.return_reason AS returnReason, reviewer.name AS reviewerName
      FROM timesheets t JOIN employees e ON e.id = t.employee_id LEFT JOIN users reviewer ON reviewer.id = t.reviewer_user_id
      WHERE COALESCE(t.assigned_manager_user_id, e.manager_user_id) = ? AND t.status IN ('approved','returned','resubmitted') ORDER BY COALESCE(t.approved_at, t.returned_at, t.submitted_at) DESC LIMIT 100`, [req.actor!.id])
    return res.json({ history })
  } catch (error) { next(error) }
})

app.get('/api/manager/notifications', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try { const email = await managerNotificationEmail(req.actor!.id); const [notifications] = await pool.query<RowDataPacket[]>('SELECT id, title, message, notification_type AS type, read_at AS readAt, created_at AS createdAt, timesheet_id AS timesheetId FROM notifications WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 50', [email || '']); return res.json({ notifications }) } catch (error) { next(error) }
})

app.post('/api/manager/notifications/:id/read', requireManager, async (req: AuthenticatedRequest, res, next) => {
  try { const email = await managerNotificationEmail(req.actor!.id); const [result] = await pool.query<ResultSetHeader>('UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND recipient_email = ?', [req.params.id, email || '']); if (!result.affectedRows) return res.status(404).json({ message: 'Notification not found.' }); return res.json({ message: 'Notification marked as read.' }) } catch (error) { next(error) }
})

async function decideManagerTimesheet(req: AuthenticatedRequest, res: Response, decision: 'approved' | 'returned') {
  const connection = await pool.getConnection()
  try {
    const timesheet = await managerOwnsTimesheet(req.actor!.id, String(req.params.id))
    if (!timesheet || !managerCanDecide(timesheet.status)) return res.status(404).json({ message: 'A submitted team timesheet was not found.' })
    const expectedVersion = Number(req.body?.version)
    if (!versionMatches(expectedVersion, Number(timesheet.version))) return res.status(409).json({ message: 'This timesheet changed before your decision. Refresh it and review the latest version.' })
    const reason = String(req.body?.reason || '').trim(); const entryId = req.body?.entryId ? Number(req.body.entryId) : null; const entryComment = String(req.body?.entryComment || '').trim()
    if (decision === 'returned' && !validReturnReason(reason)) return res.status(400).json({ message: 'Provide a return reason of up to 500 characters.' })
    if (entryId && (decision !== 'returned' || !entryComment || entryComment.length > 500)) return res.status(400).json({ message: 'An entry comment is only allowed when returning a timesheet and must be 1 to 500 characters.' })
    await connection.beginTransaction()
    const [result] = await connection.query<ResultSetHeader>('UPDATE timesheets SET status = ?, reviewer_user_id = ?, approved_at = ?, returned_at = ?, return_reason = ?, version = version + 1 WHERE id = ? AND version = ?', [decision, req.actor!.id, decision === 'approved' ? new Date() : null, decision === 'returned' ? new Date() : null, decision === 'returned' ? reason : null, timesheet.id, expectedVersion])
    if (!result.affectedRows) { await connection.rollback(); return res.status(409).json({ message: 'This timesheet changed before your decision. Refresh it and review the latest version.' }) }
    if (entryId) { const [entryResult] = await connection.query<ResultSetHeader>('UPDATE timesheet_entries SET manager_comment = ?, manager_comment_by_user_id = ?, manager_comment_at = NOW() WHERE id = ? AND timesheet_id = ?', [entryComment, req.actor!.id, entryId, timesheet.id]); if (!entryResult.affectedRows) { await connection.rollback(); return res.status(400).json({ message: 'The selected entry does not belong to this timesheet.' }) } }
    let auditDetail = decision === 'returned' ? reason : 'Approved by Manager.'
    if (entryId) {
      const [[entry]] = await connection.query<RowDataPacket[]>("SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS entryDate FROM timesheet_entries WHERE id = ? AND timesheet_id = ?", [entryId, timesheet.id])
      auditDetail += ` | Entry ${entry?.entryDate || entryId}: ${entryComment}`
    }
    await connection.query('INSERT INTO timesheet_audit_events (timesheet_id, actor_user_id, event_type, detail) VALUES (?, ?, ?, ?)', [timesheet.id, req.actor!.id, decision, auditDetail])
    await writeWorkflowAudit(connection, req.actor!, decision === 'approved' ? 'Timesheet approved' : 'Timesheet returned', 'timesheet', Number(timesheet.id), `${timesheet.employeeName} · ${timesheet.periodLabel}`, { status: timesheet.status }, { status: decision, reason: decision === 'returned' ? reason : null })
    await connection.query('INSERT INTO notifications (title, message, notification_type, recipient_email, timesheet_id) VALUES (?, ?, ?, ?, ?)', [decision === 'approved' ? 'Timesheet approved' : 'Timesheet returned', decision === 'approved' ? `Your ${timesheet.periodLabel} timesheet was approved.` : `Your ${timesheet.periodLabel} timesheet needs corrections: ${reason}${entryComment ? ` Entry note: ${entryComment}` : ''}`, decision === 'approved' ? 'info' : 'warning', timesheet.employeeEmail, timesheet.id])
    if (decision === 'approved') {
      const [financeUsers] = await connection.query<RowDataPacket[]>("SELECT email FROM users WHERE role = 'finance'")
      for (const financeUser of financeUsers) {
        const [existingNotice] = await connection.query<RowDataPacket[]>('SELECT id FROM notifications WHERE title = ? AND recipient_email = ? AND timesheet_id = ? LIMIT 1', ['Approved work ready for billing', financeUser.email, timesheet.id])
        if (!existingNotice[0]) await connection.query('INSERT INTO notifications (title, message, notification_type, recipient_email, timesheet_id) VALUES (?, ?, ?, ?, ?)', ['Approved work ready for billing', `${timesheet.employeeName} has approved work in ${timesheet.periodLabel} ready for Finance review.`, 'info', financeUser.email, timesheet.id])
      }
    }
    await connection.commit(); return res.json({ message: decision === 'approved' ? 'Timesheet approved.' : 'Timesheet returned to the employee.' })
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

app.post('/api/manager/timesheets/:id/approve', requireManager, (req: AuthenticatedRequest, res, next) => decideManagerTimesheet(req, res, 'approved').catch(next))
app.post('/api/manager/timesheets/:id/return', requireManager, (req: AuthenticatedRequest, res, next) => decideManagerTimesheet(req, res, 'returned').catch(next))

app.get('/api/employee/dashboard', requireEmployee, async (req: AuthenticatedRequest, res, next) => {
  try {
    const employee = await employeeForActor(req.actor!)
    if (!employee) return res.status(403).json({ message: 'Your employee record is not active.' })
    const period = await activeReportingPeriod()
    if (!period) return res.status(404).json({ message: 'No active reporting period found.' })
    const [current] = await pool.query<RowDataPacket[]>('SELECT id, period_label AS periodLabel, total_hours AS hours, remarks, status, submitted_at AS submittedAt, updated_at AS updatedAt FROM timesheets WHERE employee_id = ? AND reporting_period_id = ? LIMIT 1', [employee.id, period.id])
    const [history] = await pool.query<RowDataPacket[]>('SELECT period_label AS periodLabel, total_hours AS hours, status, submitted_at AS submittedAt, approved_at AS approvedAt FROM timesheets WHERE employee_id = ? ORDER BY id DESC LIMIT 12', [employee.id])
    const [notifications] = await pool.query<RowDataPacket[]>('SELECT id, title, message, notification_type AS type, created_at AS createdAt FROM notifications WHERE recipient_email = ? OR recipient_email IS NULL ORDER BY created_at DESC LIMIT 5', [req.actor!.email])
    return res.json({ employee, period: period.label, standardHours: period.standardDailyHours, timesheet: current[0] || null, history, notifications })
  } catch (error) { next(error) }
})

app.post('/api/employee/timesheet/draft', requireEmployee, (_req: AuthenticatedRequest, res) => res.status(410).json({ message: 'Use daily timesheet entries so recorded work stays linked to its project, activity, and review history.' }))
app.post('/api/employee/timesheet/submit', requireEmployee, (_req: AuthenticatedRequest, res) => res.status(410).json({ message: 'Submit the saved daily entries from the Employee timesheet workspace.' }))

app.get('/api/director/dashboard', requireDirector, async (req: AuthenticatedRequest, res, next) => {
  try {
    const period = await activeReportingPeriod()
    if (!period) return res.status(404).json({ message: 'No active reporting period found.' })
    const [[employeeCount]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS value FROM employees WHERE active = TRUE')
    const [[submittedCount]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS value FROM timesheets WHERE reporting_period_id = ? AND status IN ('submitted', 'resubmitted')", [period.id])
    const [[approvedCount]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS value FROM timesheets WHERE reporting_period_id = ? AND status = 'approved'", [period.id])
    const [[hoursSummary]] = await pool.query<RowDataPacket[]>(`SELECT COALESCE(SUM(total_hours), 0) AS totalHours,
      COALESCE(SUM(CASE WHEN status = 'approved' THEN total_hours ELSE 0 END), 0) AS approvedHours,
      COUNT(CASE WHEN status IN ('submitted', 'resubmitted', 'returned', 'approved') THEN 1 END) AS completedCount
      FROM timesheets WHERE reporting_period_id = ?`, [period.id])
    const [[exceptionCount]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS value FROM validation_findings f JOIN timesheets t ON t.id = f.timesheet_id WHERE f.resolved = FALSE AND t.reporting_period_id = ?', [period.id])
    const [workforcePosition] = await pool.query<RowDataPacket[]>(`SELECT e.id,e.name,e.employee_code AS employeeCode,d.name AS department,t.id AS timesheetId,t.status,
      (SELECT COUNT(*) FROM timesheet_entries te WHERE te.timesheet_id=t.id) AS entryCount
      FROM employees e JOIN departments d ON d.id = e.department_id LEFT JOIN timesheets t ON t.employee_id = e.id AND t.reporting_period_id = ? WHERE e.active = TRUE ORDER BY e.name`, [period.id])
    let pendingValue = 0; let missingWorkdayValue = 0
    const timesheetDistribution = { draft: 0, submitted: 0, returned: 0, approved: 0 }
    const missingWorkdayExceptions: any[] = []
    for (const member of workforcePosition) {
      const status = String(member.status || 'draft')
      if (status === 'approved') timesheetDistribution.approved++
      else if (status === 'returned' || status === 'rejected') timesheetDistribution.returned++
      else if (status === 'submitted' || status === 'resubmitted') timesheetDistribution.submitted++
      else timesheetDistribution.draft++
      if (['submitted','resubmitted','returned'].includes(String(member.status))) pendingValue++
      const shouldCheckDays = !member.timesheetId || member.status === 'draft' || Number(member.entryCount) > 0
      if (shouldCheckDays) {
        const days = await missingWorkdays(Number(member.id), period, member.timesheetId ? Number(member.timesheetId) : null)
        if (days.length) {
          missingWorkdayValue += days.length
          if (!member.timesheetId || member.status === 'draft') pendingValue++
          missingWorkdayExceptions.push({ id: `missing-${member.id}`, severity: 'warning', finding_type: 'missing_workdays', type: 'missing_workdays', message: `${days.length} scheduled workday(s) have no recorded time after excluding approved leave and active holidays.`, employeeName: member.name, employeeCode: member.employeeCode, department: member.department, hours: null, status: member.status || 'not_started', resolved: false })
        }
      }
    }
    const [departments] = await pool.query<RowDataPacket[]>(`SELECT d.id, d.code, d.name, COUNT(DISTINCT e.id) AS employeeCount,
      SUM(t.status IN ('submitted', 'resubmitted', 'returned', 'approved')) AS submittedCount, SUM(t.status = 'approved') AS approvedCount,
      SUM(t.status IN ('draft', 'submitted', 'resubmitted')) AS pendingCount, SUM(v.id IS NOT NULL AND v.resolved = FALSE) AS flaggedCount
      FROM departments d LEFT JOIN employees e ON e.department_id = d.id AND e.active = TRUE
      LEFT JOIN timesheets t ON t.employee_id = e.id AND t.reporting_period_id = ?
      LEFT JOIN validation_findings v ON v.timesheet_id = t.id GROUP BY d.id ORDER BY d.name`, [period.id])
    const [exceptions] = await pool.query<RowDataPacket[]>(`SELECT v.id, v.severity, v.finding_type AS type, v.message, e.name AS employeeName, d.name AS department, t.status
      FROM validation_findings v JOIN timesheets t ON t.id = v.timesheet_id JOIN employees e ON e.id = t.employee_id JOIN departments d ON d.id = e.department_id
      WHERE v.resolved = FALSE AND t.reporting_period_id = ? ORDER BY FIELD(v.severity, 'critical', 'warning'), v.created_at DESC LIMIT 5`, [period.id])
    exceptions.push(...missingWorkdayExceptions.slice(0, Math.max(0, 5 - exceptions.length)))
    const [notifications] = await pool.query<RowDataPacket[]>('SELECT id, title, message, notification_type AS type, read_at AS readAt, created_at AS createdAt FROM notifications WHERE read_at IS NULL AND (recipient_email = ? OR recipient_email IS NULL) ORDER BY created_at DESC LIMIT 5', [req.actor!.email])
    const [billingCycles] = await pool.query<RowDataPacket[]>('SELECT period_label AS periodLabel, starts_on AS startsOn, ends_on AS endsOn, submission_deadline AS submissionDeadline, current_stage AS currentStage FROM billing_cycles ORDER BY starts_on DESC LIMIT 1')
    return res.json({ period: period.label, billingCycle: billingCycles[0] || null, metrics: { employees: Number(employeeCount?.value || 0), submitted: Number(submittedCount?.value || 0), approved: Number(approvedCount?.value || 0), pending: pendingValue, missingWorkdays: missingWorkdayValue, exceptions: Number(exceptionCount?.value || 0) + missingWorkdayExceptions.length, totalHours: Number(hoursSummary?.totalHours || 0), approvedHours: Number(hoursSummary?.approvedHours || 0), completedCount: Number(hoursSummary?.completedCount || 0), timesheetDistribution }, departments, exceptions, notifications })
  } catch (error) { next(error) }
})

app.get('/api/director/exceptions', requireDirector, async (_req: AuthenticatedRequest, res, next) => {
  try {
    const period = await activeReportingPeriod()
    if (!period) return res.status(404).json({ message: 'No active reporting period found.' })
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT v.id, v.severity, v.finding_type AS type, v.message, v.resolved, e.name AS employeeName, e.employee_code AS employeeCode, d.name AS department, t.total_hours AS hours, t.status
      FROM validation_findings v JOIN timesheets t ON t.id = v.timesheet_id JOIN employees e ON e.id = t.employee_id JOIN departments d ON d.id = e.department_id
      WHERE v.resolved = FALSE AND t.reporting_period_id = ? ORDER BY FIELD(v.severity, 'critical', 'warning'), e.name`, [period.id])
    const missingWorkdayExceptions = await directorMissingWorkdayExceptions(period)
    return res.json({ exceptions: [...rows, ...missingWorkdayExceptions] })
  } catch (error) { next(error) }
})

app.get('/api/director/reports', requireDirector, async (_req: AuthenticatedRequest, res, next) => {
  try {
    const period = await activeReportingPeriod()
    if (!period) return res.status(404).json({ message: 'No active reporting period found.' })
    const [departments] = await pool.query<RowDataPacket[]>(`SELECT d.id, d.name, COUNT(e.id) AS employees, ROUND(AVG(t.total_hours), 1) AS averageHours,
      SUM(t.status = 'approved') AS approved, SUM(t.status IN ('submitted', 'resubmitted')) AS submitted, SUM(t.status IN ('draft', 'submitted', 'resubmitted')) AS pending
      FROM departments d LEFT JOIN employees e ON e.department_id = d.id AND e.active = TRUE LEFT JOIN timesheets t ON t.employee_id = e.id AND t.reporting_period_id = ?
      GROUP BY d.id ORDER BY d.name`, [period.id])
    return res.json({ period: period.label, departments })
  } catch (error) { next(error) }
})

app.get('/api/director/financial-report', requireDirector, async (_req: AuthenticatedRequest, res, next) => {
  try {
    const period = await activeReportingPeriod()
    const periodLabel = period?.label || ''
    const [invoices] = await pool.query<RowDataPacket[]>(`SELECT currency, COUNT(*) AS invoiceCount, SUM(subtotal) AS finalizedAmount
      FROM invoices WHERE status = 'finalized' AND (? = '' OR period_label = ?) GROUP BY currency ORDER BY currency`, [periodLabel, periodLabel])
    const [hours] = await pool.query<RowDataPacket[]>(`SELECT c.currency, SUM(CASE WHEN il.id IS NULL THEN e.hours ELSE 0 END) AS unbilledHours,
      SUM(CASE WHEN il.id IS NOT NULL AND i.status = 'finalized' THEN il.hours_snapshot ELSE 0 END) AS billedHours
      FROM timesheet_entries e JOIN timesheets t ON t.id = e.timesheet_id AND t.status = 'approved'
      JOIN projects p ON p.id = e.project_id JOIN clients c ON c.id = p.client_id
      JOIN project_activity_assignments pa ON pa.project_id = p.id AND pa.activity_id = e.activity_id AND pa.billable = TRUE
      LEFT JOIN invoice_lines il ON il.timesheet_entry_id = e.id LEFT JOIN invoices i ON i.id = il.invoice_id
      WHERE (? = '' OR t.period_label = ?) GROUP BY c.currency ORDER BY c.currency`, [periodLabel, periodLabel])
    return res.json({ period: periodLabel || null, invoices: invoices.map((row) => ({ currency: row.currency, count: Number(row.invoiceCount), amount: Number(row.finalizedAmount || 0) })), hours: hours.map((row) => ({ currency: row.currency, billed: Number(row.billedHours || 0), unbilled: Number(row.unbilledHours || 0) })) })
  } catch (error) { next(error) }
})

app.get('/api/director/departments/:id', requireDirector, async (req: AuthenticatedRequest, res, next) => {
  try {
    const period = await activeReportingPeriod()
    if (!period) return res.status(404).json({ message: 'No active reporting period found.' })
    const [departmentRows] = await pool.query<RowDataPacket[]>('SELECT id, code, name FROM departments WHERE id = ? LIMIT 1', [req.params.id])
    if (!departmentRows[0]) return res.status(404).json({ message: 'Department not found.' })
    const [employees] = await pool.query<RowDataPacket[]>(`SELECT e.employee_code AS employeeCode, e.name, e.manager_name AS managerName, t.total_hours AS hours, t.status
      FROM employees e LEFT JOIN timesheets t ON t.employee_id = e.id AND t.reporting_period_id = ? WHERE e.department_id = ? ORDER BY e.name`, [period.id, req.params.id])
    return res.json({ period: period.label, department: departmentRows[0], employees })
  } catch (error) { next(error) }
})

app.get('/api/director/approvals', requireDirector, async (_req: AuthenticatedRequest, res, next) => {
  try {
    const period = await activeReportingPeriod()
    if (!period) return res.status(404).json({ message: 'No active reporting period found.' })
    const [submissions] = await pool.query<RowDataPacket[]>(`SELECT s.id, s.status, s.submitted_by AS submittedBy, s.submitted_at AS submittedAt, s.decided_by AS decidedBy, s.decided_at AS decidedAt, s.return_reason AS returnReason,
      d.name AS department, d.code AS departmentCode, COUNT(DISTINCT e.id) AS employeeCount, COALESCE(SUM(t.total_hours), 0) AS totalHours,
      SUM(t.status = 'submitted') AS submittedCount, SUM(v.id IS NOT NULL AND v.resolved = FALSE) AS exceptionCount
      FROM department_submissions s JOIN departments d ON d.id = s.department_id
      LEFT JOIN employees e ON e.department_id = d.id AND e.active = TRUE
      LEFT JOIN timesheets t ON t.employee_id = e.id AND t.period_label = s.period_label
      LEFT JOIN validation_findings v ON v.timesheet_id = t.id
      WHERE s.period_label = ?
      GROUP BY s.id ORDER BY FIELD(s.status, 'submitted', 'returned', 'approved'), s.submitted_at ASC`, [period.label])
    return res.json({ period: period.label, submissions })
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
    await writeWorkflowAudit(connection, req.actor!, 'Department submission approved', 'department_submission', Number(submission.id), `${submission.periodLabel} department #${submission.departmentId}`, { status: 'submitted' }, { status: 'approved' })
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
    await connection.query('UPDATE billing_cycles SET current_stage = ? WHERE period_label = ?', ['manager_submission', submission.periodLabel])
    await writeWorkflowAudit(connection, req.actor!, 'Department submission returned', 'department_submission', Number(submission.id), `${submission.periodLabel} department #${submission.departmentId}: ${reason}`, { status: 'submitted' }, { status: 'returned', reason })
    await connection.commit()
    return res.json({ message: 'Submission returned for correction.' })
  } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
})

app.get('/api/director/audit-events', requireDirector, async (_req: AuthenticatedRequest, res, next) => {
  try {
    const search = String(_req.query.search || '').trim()
    const role = String(_req.query.role || '').trim()
    const entity = String(_req.query.entity || '').trim()
    const requestedPage = Number(_req.query.page || 1)
    const requestedPageSize = Number(_req.query.pageSize || 20)
    const pageSize = Number.isInteger(requestedPageSize) ? Math.min(Math.max(requestedPageSize, 10), 50) : 20
    const page = Number.isInteger(requestedPage) ? Math.max(requestedPage, 1) : 1
    const auditSource = `SELECT id, CONVERT(actor_name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS actor, actor_user_id AS actorUserId,
      CONVERT(actor_role USING utf8mb4) COLLATE utf8mb4_unicode_ci AS actorRole, CONVERT(action USING utf8mb4) COLLATE utf8mb4_unicode_ci AS action,
      CONVERT(target USING utf8mb4) COLLATE utf8mb4_unicode_ci AS target, CONVERT(entity_type USING utf8mb4) COLLATE utf8mb4_unicode_ci AS entityType,
      entity_id AS entityId, before_state AS beforeState, after_state AS afterState, created_at AS createdAt
      FROM audit_events
      UNION ALL
      SELECT 1000000000 + a.id AS id, CONVERT(COALESCE(u.name, u.email, 'Unknown') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS actor,
        a.actor_user_id AS actorUserId, CONVERT(u.role USING utf8mb4) COLLATE utf8mb4_unicode_ci AS actorRole,
        CONVERT(CONCAT('Timesheet ', REPLACE(a.event_type, '_', ' ')) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS action,
        CONVERT(CONCAT(e.name, ' · ', t.period_label) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS target,
        CONVERT('timesheet' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS entityType, t.id AS entityId, NULL AS beforeState,
        JSON_OBJECT('eventType', a.event_type, 'detail', a.detail) AS afterState, a.created_at AS createdAt
      FROM timesheet_audit_events a JOIN timesheets t ON t.id = a.timesheet_id JOIN employees e ON e.id = t.employee_id
      LEFT JOIN users u ON u.id = a.actor_user_id`
    const conditions: string[] = []
    const values: unknown[] = []
    if (search) { conditions.push(`LOWER(CONCAT_WS(' ', events.actor, events.action, events.target)) LIKE ?`); values.push(`%${search.toLowerCase()}%`) }
    if (role) { conditions.push('events.actorRole = ?'); values.push(role) }
    if (entity) { conditions.push('events.entityType = ?'); values.push(entity) }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
    const [[totalRow]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM (${auditSource}) events${where}`, values)
    const offset = (page - 1) * pageSize
    const [events] = await pool.query<RowDataPacket[]>(`SELECT * FROM (${auditSource}) events${where} ORDER BY events.createdAt DESC LIMIT ? OFFSET ?`, [...values, pageSize, offset])
    const total = Number(totalRow?.total || 0)
    return res.json({ events, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } })
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
    const [employeeRows] = await pool.query<RowDataPacket[]>('SELECT id FROM employees WHERE LOWER(email) = ? AND active = TRUE LIMIT 1', [email])
    if (!employeeRows[0]) return res.status(403).json({ message: 'Your work email is not in the active employee roster.' })
    const [existing] = await pool.query<UserRecord[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
    if (existing.length) return res.status(409).json({ message: 'An account already exists for this email. Please sign in.' })
    const passwordHash = await bcrypt.hash(password, 12)
    const [result] = await pool.query<ResultSetHeader>('INSERT INTO users (name, email, password_hash, role, auth_provider) VALUES (?, ?, ?, ?, ?)', [name, email, passwordHash, role, 'password'])
    await pool.query('UPDATE employees SET user_id = ? WHERE id = ? AND user_id IS NULL', [result.insertId, employeeRows[0].id])
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
    if (user.role === 'employee') {
      const [employeeRows] = await pool.query<RowDataPacket[]>('SELECT id, user_id AS userId FROM employees WHERE LOWER(email) = LOWER(?) AND active = TRUE LIMIT 1', [user.email])
      if (!employeeRows[0]) return res.status(403).json({ message: 'Your employee record is inactive or unavailable. Contact HR.' })
      if (!employeeRows[0].userId) await pool.query('UPDATE employees SET user_id = ? WHERE id = ? AND user_id IS NULL', [user.id, employeeRows[0].id])
    }
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id])
    return res.json({ token: issueToken(user), user: publicUser(user) })
  } catch (error) { next(error) }
})

app.get('/api/auth/github', (req: Request, res: Response) => {
  const role = validRole(req.query.role)
  if (!githubClientId || !githubClientSecret) return res.redirect(`${clientOrigin}/#oauth_error=${encodeURIComponent('GitHub sign-in is not configured yet.')}`)
  if (!role) return res.redirect(`${clientOrigin}/#oauth_error=${encodeURIComponent('Choose a portal role before signing in with GitHub.')}`)
  const state = randomUUID()
  githubStates.set(state, { role, expiresAt: Date.now() + 10 * 60 * 1000 })
  const authorization = new URL('https://github.com/login/oauth/authorize')
  authorization.searchParams.set('client_id', githubClientId)
  authorization.searchParams.set('redirect_uri', githubCallbackUrl)
  authorization.searchParams.set('scope', 'read:user user:email')
  authorization.searchParams.set('state', state)
  return res.redirect(authorization.toString())
})

app.get('/api/auth/github/callback', async (req: Request, res: Response, next: NextFunction) => {
  const finish = (message: string) => res.redirect(`${clientOrigin}/#oauth_error=${encodeURIComponent(message)}`)
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const pending = githubStates.get(state)
    githubStates.delete(state)
    if (!code || !pending || pending.expiresAt < Date.now()) return finish('GitHub sign-in session expired. Please try again.')
    if (!githubClientId || !githubClientSecret) return finish('GitHub sign-in is not configured yet.')
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: githubClientId, client_secret: githubClientSecret, code, redirect_uri: githubCallbackUrl }),
    })
    const tokenData = await tokenResponse.json() as { access_token?: string; error_description?: string }
    if (!tokenResponse.ok || !tokenData.access_token) return finish(tokenData.error_description || 'GitHub could not complete sign-in.')
    const githubHeaders = { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'PulseAI' }
    const profileResponse = await fetch('https://api.github.com/user', { headers: githubHeaders })
    const profile = await profileResponse.json() as { id?: number; login?: string; name?: string | null; email?: string | null; avatar_url?: string | null }
    if (!profileResponse.ok || !profile.id) return finish('GitHub could not verify this account.')
    let email = profile.email?.toLowerCase() || ''
    if (!email) {
      const emailsResponse = await fetch('https://api.github.com/user/emails', { headers: githubHeaders })
      const emails = await emailsResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>
      email = emails.find((item) => item.primary && item.verified)?.email?.toLowerCase() || emails.find((item) => item.verified)?.email?.toLowerCase() || ''
    }
    const githubId = String(profile.id)
    const [rows] = await pool.query<UserRecord[]>('SELECT * FROM users WHERE github_id = ? OR (? <> \'\' AND LOWER(email) = ?) LIMIT 1', [githubId, email, email])
    const user = rows[0]
    if (!user) return finish('This GitHub account has not been approved for this workspace.')
    if (user.role !== pending.role) return finish(`This account is registered as ${user.role}. Choose that role to continue.`)
    if (user.role === 'employee') {
      const [employeeRows] = await pool.query<RowDataPacket[]>('SELECT id, user_id AS userId FROM employees WHERE LOWER(email) = LOWER(?) AND active = TRUE LIMIT 1', [user.email])
      if (!employeeRows[0]) return finish('Your employee record is inactive or unavailable. Contact HR.')
      if (!employeeRows[0].userId) await pool.query('UPDATE employees SET user_id = ? WHERE id = ? AND user_id IS NULL', [user.id, employeeRows[0].id])
    }
    await pool.query('UPDATE users SET github_id = COALESCE(github_id, ?), avatar_url = COALESCE(?, avatar_url), last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [githubId, profile.avatar_url || null, user.id])
    const result = `${clientOrigin}/#oauth_token=${encodeURIComponent(issueToken(user))}&oauth_user=${encodeURIComponent(JSON.stringify({ ...publicUser(user), avatarUrl: profile.avatar_url || user.avatar_url || null }))}`
    return res.redirect(result)
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
    if (!user) return res.status(403).json({ message: 'This Google account has not been approved for this workspace.' })
    if (user.role !== role) return res.status(403).json({ message: `This account is registered as ${user.role}. Choose that role to continue.` })
    if (user.role === 'employee') {
      const [employeeRows] = await pool.query<RowDataPacket[]>('SELECT id, user_id AS userId FROM employees WHERE LOWER(email) = LOWER(?) AND active = TRUE LIMIT 1', [user.email])
      if (!employeeRows[0]) return res.status(403).json({ message: 'Your employee record is inactive or unavailable. Contact HR.' })
      if (!employeeRows[0].userId) await pool.query('UPDATE employees SET user_id = ? WHERE id = ? AND user_id IS NULL', [user.id, employeeRows[0].id])
    }
    await pool.query('UPDATE users SET google_sub = COALESCE(google_sub, ?), avatar_url = COALESCE(?, avatar_url), last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [payload.sub, payload.picture || null, user.id])
    return res.json({ token: issueToken(user), user: publicUser(user) })
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('token')) return res.status(401).json({ message: 'Google sign-in could not be verified.' })
    next(error)
  }
})

initializeDatabase()
  .then(() => {
    registerFinanceRoutes(app, pool, requireFinance)
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error(error)
      res.status(500).json({ message: 'Something went wrong. Please try again.' })
    })
    return app.listen(port, () => console.log(`Pulse AI API running at http://localhost:${port}`))
  })
  .catch((error: unknown) => {
    console.error('Database initialization failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
