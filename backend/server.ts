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
  await seedDirectorAccounts()
  if (process.env.SEED_DEMO_DATA === 'true') await seedDemoData()
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
    return res.json({ period: 'September 2026', metrics: { employees: employeeCount?.value || 0, submitted: submittedCount?.value || 0, approved: approvedCount?.value || 0, pending: pendingCount?.value || 0, exceptions: exceptionCount?.value || 0 }, departments, exceptions, notifications })
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
