import type { Express, NextFunction, Request, RequestHandler, Response } from 'express'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { randomUUID } from 'node:crypto'
import { calculateLineAmount, csvCell, financeEntryCanBeInvoiced, financeCanProcessTimesheet, invoiceTransitionAllowed, validCurrency, type InvoiceStatus } from './financeRules.js'

type FinanceRequest = Request & { actor?: { id: number; role: string; email: string } }
type Filters = { period?: string; projectId?: number; employeeId?: number; clientId?: number; billingStatus?: string; billable?: string }

async function writeFinanceAudit(connection: Pool | PoolConnection, actorId: number, action: string, entityType: string, entityId: number, before?: unknown, after?: unknown) {
  const beforeState = before == null ? null : JSON.stringify(before); const afterState = after == null ? null : JSON.stringify(after)
  await connection.query('INSERT INTO finance_audit_events (actor_user_id, action, entity_type, entity_id, before_state, after_state) VALUES (?, ?, ?, ?, ?, ?)', [actorId, action, entityType, entityId, beforeState, afterState])
  await connection.query(`INSERT INTO audit_events (actor_name,actor_user_id,actor_role,action,target,entity_type,entity_id,before_state,after_state)
    SELECT email,id,'finance',?,?,?, ?,CAST(? AS JSON),CAST(? AS JSON) FROM users WHERE id = ?`, [action, `${entityType} #${entityId}`, entityType, entityId, beforeState, afterState, actorId])
}

async function applicableRate(connection: Pool | PoolConnection, projectId: number, entryDate: string) {
  const [rates] = await connection.query<RowDataPacket[]>(`SELECT id, amount, currency, active, effective_from AS effectiveFrom, effective_to AS effectiveTo
    FROM project_billing_rates WHERE project_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
    AND (active = TRUE OR ? < CURDATE()) ORDER BY effective_from DESC LIMIT 2 FOR UPDATE`, [projectId, entryDate, entryDate, entryDate])
  return rates.length === 1 ? rates[0] : null
}

async function financeEntries(pool: Pool, filters: Filters = {}) {
  const period = String(filters.period || '')
  const billingStatus = ['unbilled', 'draft', 'ready', 'finalized'].includes(String(filters.billingStatus)) ? String(filters.billingStatus) : 'all'
  const billable = ['billable', 'nonbillable', 'unclassified'].includes(String(filters.billable)) ? String(filters.billable) : 'all'
  const projectId = filters.projectId || null; const employeeId = filters.employeeId || null; const clientId = filters.clientId || null
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT e.id AS entryId, t.id AS timesheetId, t.period_label AS periodLabel, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entryDate,
      e.hours, e.work_description AS workDescription, e.project_id AS projectId, p.code AS projectCode, p.name AS projectName, p.client_id AS clientId,
      c.code AS clientCode, c.name AS clientName, c.currency AS clientCurrency, c.active AS clientActive,
      emp.id AS employeeId, emp.name AS employeeName, emp.employee_code AS employeeCode,
      a.id AS activityId, a.name AS activityName, a.category AS activityCategory, pa.billable,
      r.id AS rateId, r.amount AS rateAmount, r.currency AS rateCurrency,
      il.invoice_id AS invoiceId, i.invoice_number AS invoiceNumber, i.status AS invoiceStatus,
      CASE WHEN a.category = 'internal' THEN 'nonbillable' WHEN pa.billable IS NULL THEN 'unclassified' WHEN pa.billable = TRUE THEN 'billable' ELSE 'nonbillable' END AS financialClass,
      CASE WHEN il.id IS NOT NULL THEN i.status WHEN a.category = 'internal' OR pa.billable = FALSE THEN 'not_billable' ELSE 'unbilled' END AS billingStatus
    FROM timesheet_entries e JOIN timesheets t ON t.id = e.timesheet_id AND t.status = 'approved'
    JOIN employees emp ON emp.id = t.employee_id JOIN activities a ON a.id = e.activity_id
    LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN project_activity_assignments pa ON pa.project_id = p.id AND pa.activity_id = a.id
    LEFT JOIN project_billing_rates r ON r.project_id = p.id AND r.effective_from <= e.entry_date AND (r.effective_to IS NULL OR r.effective_to >= e.entry_date) AND (r.active = TRUE OR e.entry_date < CURDATE())
    LEFT JOIN invoice_lines il ON il.timesheet_entry_id = e.id LEFT JOIN invoices i ON i.id = il.invoice_id
    WHERE (? = '' OR t.period_label = ?) AND (? IS NULL OR p.id = ?) AND (? IS NULL OR emp.id = ?) AND (? IS NULL OR p.client_id = ?)
      AND (? = 'all' OR COALESCE(i.status, CASE WHEN a.category = 'internal' OR pa.billable = FALSE THEN 'not_billable' ELSE 'unbilled' END) = ?)
      AND (? = 'all' OR (? = 'billable' AND a.category = 'project' AND pa.billable = TRUE) OR (? = 'nonbillable' AND (a.category = 'internal' OR pa.billable = FALSE)) OR (? = 'unclassified' AND a.category = 'project' AND pa.billable IS NULL))
    ORDER BY e.entry_date DESC, emp.name, p.code, a.name`, [period, period, projectId, projectId, employeeId, employeeId, clientId, clientId, billingStatus, billingStatus, billable, billable, billable, billable])
  return rows.map((row) => {
    const rateExists = row.rateId != null && String(row.rateCurrency || '') === String(row.clientCurrency || '') && Boolean(row.clientActive)
    const isProjectBillable = row.activityCategory === 'project' && Boolean(row.billable)
    const ready = financeEntryCanBeInvoiced({ timesheetStatus: 'approved', billable: isProjectBillable ? true : row.billable == null ? null : false, hasClient: row.clientId != null && Boolean(row.clientActive), hasRate: rateExists, alreadyLinked: row.invoiceId != null })
    const amount = rateExists && isProjectBillable ? calculateLineAmount(Number(row.hours), Number(row.rateAmount)) : null
    let exception: string | null = null
    if (row.activityCategory === 'project' && row.billable == null) exception = 'Financial classification is not set.'
    else if (Boolean(row.billable) && !row.clientId) exception = 'Project is not linked to a client.'
    else if (Boolean(row.billable) && row.clientId && !row.clientActive) exception = 'Client billing configuration is inactive.'
    else if (Boolean(row.billable) && row.clientId && !row.rateId) exception = 'No billing rate covers this work date.'
    else if (Boolean(row.billable) && row.rateId && row.clientCurrency !== row.rateCurrency) exception = 'Billing rate currency does not match the client currency.'
    else if (row.invoiceStatus === 'draft' || row.invoiceStatus === 'ready') exception = 'Work is reserved on an invoice that has not been finalized.'
    return { ...row, hours: Number(row.hours), billable: row.billable == null ? null : Boolean(row.billable), rateAmount: row.rateAmount == null ? null : Number(row.rateAmount), amount, eligibleForInvoice: ready, exception }
  })
}

async function invoiceById(connection: Pool | PoolConnection, id: number, lock = false) {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT i.id, i.invoice_number AS invoiceNumber, i.client_id AS clientId, c.code AS clientCode, c.name AS clientName,
    i.period_label AS periodLabel, i.currency, i.status, i.subtotal, i.version, i.created_at AS createdAt, i.ready_at AS readyAt,
    i.finalized_at AS finalizedAt, i.cancelled_line_count AS cancelledLineCount, creator.name AS createdBy, finalizer.name AS finalizedBy
    FROM invoices i JOIN clients c ON c.id = i.client_id JOIN users creator ON creator.id = i.created_by_user_id
    LEFT JOIN users finalizer ON finalizer.id = i.finalized_by_user_id WHERE i.id = ?${lock ? ' FOR UPDATE' : ''}`, [id])
  return rows[0]
}

async function invoiceLines(connection: Pool | PoolConnection, invoiceId: number, lock = false) {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT il.id, il.timesheet_entry_id AS entryId, il.billing_rate_id AS rateId, il.project_id AS projectId,
    DATE_FORMAT(il.entry_date, '%Y-%m-%d') AS entryDate, il.employee_name_snapshot AS employeeName, il.employee_code_snapshot AS employeeCode,
    il.project_code_snapshot AS projectCode, il.project_name_snapshot AS projectName, il.activity_name_snapshot AS activityName,
    il.hours_snapshot AS hours, il.rate_snapshot AS rate, il.currency_snapshot AS currency, il.amount_snapshot AS amount,
    e.work_description AS workDescription, t.status AS timesheetStatus
    FROM invoice_lines il JOIN timesheet_entries e ON e.id = il.timesheet_entry_id JOIN timesheets t ON t.id = e.timesheet_id
    WHERE il.invoice_id = ? ORDER BY il.entry_date, il.id${lock ? ' FOR UPDATE' : ''}`, [invoiceId])
  return rows
}

async function validateInvoiceSnapshot(connection: Pool | PoolConnection, invoice: RowDataPacket) {
  const lines = await invoiceLines(connection, Number(invoice.id), true)
  if (!lines.length) return { lines, problem: 'An invoice needs at least one approved work line.' }
  for (const line of lines) {
    if (!financeCanProcessTimesheet(line.timesheetStatus)) return { lines, problem: `Source entry ${line.entryId} is no longer Manager-approved.` }
    const [[current]] = await connection.query<RowDataPacket[]>(`SELECT p.client_id AS clientId, c.currency AS clientCurrency, c.active AS clientActive,
      pa.billable, a.category FROM timesheet_entries e JOIN projects p ON p.id = e.project_id LEFT JOIN clients c ON c.id = p.client_id
      JOIN activities a ON a.id = e.activity_id LEFT JOIN project_activity_assignments pa ON pa.project_id = p.id AND pa.activity_id = a.id
      WHERE e.id = ? FOR UPDATE`, [line.entryId])
    if (!current || Number(current.clientId) !== Number(invoice.clientId) || !current.clientActive || current.clientCurrency !== invoice.currency || current.category !== 'project' || !current.billable) return { lines, problem: `Billing configuration changed for source entry ${line.entryId}. Delete and recreate this draft after correcting configuration.` }
    const rate = await applicableRate(connection, Number(line.projectId), String(line.entryDate))
    if (!rate || Number(rate.id) !== Number(line.rateId) || rate.currency !== invoice.currency || Number(rate.amount) !== Number(line.rate)) return { lines, problem: `The applicable rate changed for source entry ${line.entryId}. Delete and recreate this draft.` }
  }
  return { lines, problem: null as string | null }
}

export function registerFinanceRoutes(app: Express, pool: Pool, financeGuard: RequestHandler) {
  app.get('/api/finance/dashboard', financeGuard, async (_req: FinanceRequest, res: Response, next: NextFunction) => {
    try {
      const [[period]] = await pool.query<RowDataPacket[]>("SELECT label AS periodLabel FROM reporting_periods WHERE active = TRUE ORDER BY starts_on DESC LIMIT 1")
      const allEntries = await financeEntries(pool, { period: period?.periodLabel || '' })
      const invoices = await pool.query<RowDataPacket[]>(`SELECT status, currency, COUNT(*) AS invoiceCount, SUM(subtotal) AS amount FROM invoices WHERE (? = '' OR period_label = ?) GROUP BY status, currency`, [period?.periodLabel || '', period?.periodLabel || ''])
      const invoiceGroups = (invoices[0] as RowDataPacket[]).reduce((groups: Record<string, any>, row) => { groups[row.status] ||= { count: 0, totals: [] }; groups[row.status].count += Number(row.invoiceCount); groups[row.status].totals.push({ currency: row.currency, amount: Number(row.amount || 0) }); return groups }, {})
      const byCurrency = new Map<string, number>()
      const exceptions = allEntries.filter((entry: any) => entry.exception).slice(0, 12)
      let awaitingHours = 0; let billableHours = 0; let nonBillableHours = 0; let unbilledHours = 0
      for (const entry of allEntries as any[]) {
        if (entry.billable === true) { billableHours += entry.hours; if (!entry.invoiceId) awaitingHours += entry.hours; if (!entry.invoiceId && entry.amount != null && !entry.exception) { unbilledHours += entry.hours; byCurrency.set(entry.clientCurrency, (byCurrency.get(entry.clientCurrency) || 0) + entry.amount) } }
        if (entry.billable === false || entry.activityCategory === 'internal') nonBillableHours += entry.hours
      }
      const [notifications] = await pool.query<RowDataPacket[]>('SELECT id, title, message, read_at AS readAt, created_at AS createdAt, timesheet_id AS timesheetId FROM notifications WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 20', [(_req as FinanceRequest).actor!.email])
      return res.json({ period: period?.periodLabel || null, metrics: { approvedHoursAwaitingProcessing: awaitingHours, billableHours, nonBillableHours, unbilledHours, unbilledAmounts: [...byCurrency].map(([currency, amount]) => ({ currency, amount })), draftInvoices: invoiceGroups.draft || { count: 0, totals: [] }, readyInvoices: invoiceGroups.ready || { count: 0, totals: [] }, finalizedInvoices: invoiceGroups.finalized || { count: 0, totals: [] } }, exceptions, notifications })
    } catch (error) { next(error) }
  })

  app.get('/api/finance/periods', financeGuard, async (_req, res, next) => {
    try { const [periods] = await pool.query<RowDataPacket[]>(`SELECT label AS periodLabel FROM reporting_periods UNION SELECT DISTINCT t.period_label AS periodLabel FROM timesheets t WHERE t.status = 'approved' ORDER BY periodLabel DESC`); return res.json({ periods }) } catch (error) { next(error) }
  })

  app.get('/api/finance/options', financeGuard, async (_req, res, next) => {
    try {
      const [employees] = await pool.query<RowDataPacket[]>(`SELECT DISTINCT emp.id, emp.name, emp.employee_code AS employeeCode
        FROM employees emp JOIN timesheets t ON t.employee_id = emp.id AND t.status = 'approved'
        ORDER BY emp.name`)
      return res.json({ employees })
    } catch (error) { next(error) }
  })

  app.get('/api/finance/entries', financeGuard, async (req: FinanceRequest, res, next) => {
    try {
      const filters: Filters = { period: String(req.query.period || ''), billingStatus: String(req.query.billingStatus || 'all'), billable: String(req.query.billable || 'all') }
      if (req.query.projectId) filters.projectId = Number(req.query.projectId); if (req.query.employeeId) filters.employeeId = Number(req.query.employeeId); if (req.query.clientId) filters.clientId = Number(req.query.clientId)
      const entries = await financeEntries(pool, filters); return res.json({ entries })
    } catch (error) { next(error) }
  })

  app.get('/api/finance/clients', financeGuard, async (_req, res, next) => {
    try { const [clients] = await pool.query<RowDataPacket[]>('SELECT id, code, name, billing_email AS billingEmail, currency, active FROM clients ORDER BY active DESC, name'); return res.json({ clients }) } catch (error) { next(error) }
  })

  app.post('/api/finance/clients', financeGuard, async (req: FinanceRequest, res, next) => {
    try {
      const code = String(req.body?.code || '').trim().toUpperCase(); const name = String(req.body?.name || '').trim(); const currency = String(req.body?.currency || '').trim().toUpperCase(); const billingEmail = String(req.body?.billingEmail || '').trim()
      if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code) || name.length < 2 || name.length > 160 || !validCurrency(currency) || (billingEmail && !/^\S+@\S+\.\S+$/.test(billingEmail))) return res.status(400).json({ message: 'Provide a client code, name, three-letter currency, and valid optional billing email.' })
      const [result] = await pool.query<ResultSetHeader>('INSERT INTO clients (code, name, billing_email, currency, created_by_user_id) VALUES (?, ?, ?, ?, ?)', [code, name, billingEmail || null, currency, req.actor!.id])
      await writeFinanceAudit(pool, req.actor!.id, 'client_created', 'client', result.insertId, null, { code, name, billingEmail: billingEmail || null, currency, active: true })
      return res.status(201).json({ message: 'Client created.', clientId: result.insertId })
    } catch (error) { if ((error as any)?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'That client code is already in use.' }); next(error) }
  })

  app.patch('/api/finance/clients/:id', financeGuard, async (req: FinanceRequest, res, next) => {
    try {
      const clientId = Number(req.params.id); const [[before]] = await pool.query<RowDataPacket[]>('SELECT id, code, name, billing_email AS billingEmail, currency, active FROM clients WHERE id = ?', [clientId]); if (!before) return res.status(404).json({ message: 'Client not found.' })
      const name = String(req.body?.name ?? before.name).trim(); const currency = String(req.body?.currency ?? before.currency).trim().toUpperCase(); const billingEmail = String(req.body?.billingEmail ?? before.billingEmail ?? '').trim(); const active = typeof req.body?.active === 'boolean' ? req.body.active : Boolean(before.active)
      if (name.length < 2 || name.length > 160 || !validCurrency(currency) || (billingEmail && !/^\S+@\S+\.\S+$/.test(billingEmail))) return res.status(400).json({ message: 'Provide a client name, three-letter currency, and valid optional billing email.' })
      if (currency !== before.currency) { const [[used]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM invoices WHERE client_id = ? AND status = \'finalized\'', [clientId]); if (Number(used?.count || 0)) return res.status(409).json({ message: 'Currency cannot be changed after this client has finalized invoices.' }) }
      await pool.query('UPDATE clients SET name = ?, billing_email = ?, currency = ?, active = ? WHERE id = ?', [name, billingEmail || null, currency, active, clientId])
      const after = { ...before, name, billingEmail: billingEmail || null, currency, active }; await writeFinanceAudit(pool, req.actor!.id, 'client_updated', 'client', clientId, before, after)
      return res.json({ message: 'Client billing profile updated.' })
    } catch (error) { next(error) }
  })

  app.get('/api/finance/projects', financeGuard, async (_req, res, next) => {
    try {
      const [projects] = await pool.query<RowDataPacket[]>(`SELECT p.id, p.code, p.name, p.active, p.client_id AS clientId, c.code AS clientCode, c.name AS clientName, c.currency,
        COUNT(DISTINCT CASE WHEN t.status = 'approved' THEN e.id END) AS approvedEntryCount,
        COALESCE(SUM(CASE WHEN t.status = 'approved' THEN e.hours ELSE 0 END), 0) AS approvedHours,
        COALESCE(SUM(CASE WHEN t.status = 'approved' AND a.category = 'internal' THEN e.hours WHEN t.status = 'approved' AND pa.billable = FALSE THEN e.hours ELSE 0 END), 0) AS nonBillableHours,
        COALESCE(SUM(CASE WHEN t.status = 'approved' AND a.category = 'project' AND pa.billable = TRUE THEN e.hours ELSE 0 END), 0) AS billableHours,
        COALESCE(SUM(CASE WHEN t.status = 'approved' AND a.category = 'project' AND pa.billable = TRUE AND il.id IS NULL THEN e.hours ELSE 0 END), 0) AS unbilledHours,
        COALESCE(SUM(CASE WHEN t.status = 'approved' AND a.category = 'project' AND pa.billable = TRUE AND il.id IS NOT NULL AND i.status = 'finalized' THEN il.hours_snapshot ELSE 0 END), 0) AS billedHours,
        COALESCE(SUM(CASE WHEN t.status = 'approved' AND a.category = 'project' AND pa.billable = TRUE AND il.id IS NULL AND r.id IS NOT NULL AND c.active = TRUE AND r.currency = c.currency THEN ROUND(e.hours * r.amount, 2) ELSE 0 END), 0) AS unbilledAmount,
        COALESCE(SUM(CASE WHEN i.status = 'finalized' THEN il.amount_snapshot ELSE 0 END), 0) AS billedAmount
        FROM projects p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN timesheet_entries e ON e.project_id = p.id
        LEFT JOIN timesheets t ON t.id = e.timesheet_id LEFT JOIN activities a ON a.id = e.activity_id
        LEFT JOIN project_activity_assignments pa ON pa.project_id = p.id AND pa.activity_id = e.activity_id
        LEFT JOIN project_billing_rates r ON r.project_id = p.id AND r.effective_from <= e.entry_date AND (r.effective_to IS NULL OR r.effective_to >= e.entry_date) AND (r.active = TRUE OR e.entry_date < CURDATE())
        LEFT JOIN invoice_lines il ON il.timesheet_entry_id = e.id LEFT JOIN invoices i ON i.id = il.invoice_id
        GROUP BY p.id, c.id ORDER BY p.active DESC, p.code`)
      return res.json({ projects: projects.map((project) => ({ ...project, approvedHours: Number(project.approvedHours), billableHours: Number(project.billableHours), nonBillableHours: Number(project.nonBillableHours), unbilledHours: Number(project.unbilledHours), billedHours: Number(project.billedHours), unbilledAmount: Number(project.unbilledAmount), billedAmount: Number(project.billedAmount) })) })
    } catch (error) { next(error) }
  })

  app.get('/api/finance/projects/:id', financeGuard, async (req, res, next) => {
    try {
      const projectId = Number(req.params.id); const [[project]] = await pool.query<RowDataPacket[]>(`SELECT p.id, p.code, p.name, p.active, p.client_id AS clientId, c.code AS clientCode, c.currency
        FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = ?`, [projectId]); if (!project) return res.status(404).json({ message: 'Project not found.' })
      const [activities] = await pool.query<RowDataPacket[]>(`SELECT pa.activity_id AS activityId, a.name AS activityName, a.category, pa.billable FROM project_activity_assignments pa JOIN activities a ON a.id = pa.activity_id WHERE pa.project_id = ? ORDER BY a.name`, [projectId])
      const [rates] = await pool.query<RowDataPacket[]>(`SELECT id, amount, currency, DATE_FORMAT(effective_from, '%Y-%m-%d') AS effectiveFrom, DATE_FORMAT(effective_to, '%Y-%m-%d') AS effectiveTo, active, created_at AS createdAt FROM project_billing_rates WHERE project_id = ? ORDER BY effective_from DESC`, [projectId])
      return res.json({ project, activities: activities.map((item) => ({ ...item, billable: item.billable == null ? null : Boolean(item.billable) })), rates: rates.map((rate) => ({ ...rate, amount: Number(rate.amount), active: Boolean(rate.active) })) })
    } catch (error) { next(error) }
  })

  app.patch('/api/finance/projects/:id/client', financeGuard, async (req: FinanceRequest, res, next) => {
    try {
      const projectId = Number(req.params.id); const clientId = req.body?.clientId == null || req.body.clientId === '' ? null : Number(req.body.clientId)
      const [[before]] = await pool.query<RowDataPacket[]>('SELECT id, client_id AS clientId FROM projects WHERE id = ?', [projectId]); if (!before) return res.status(404).json({ message: 'Project not found.' })
      if (clientId != null) { const [[client]] = await pool.query<RowDataPacket[]>('SELECT id, active FROM clients WHERE id = ?', [clientId]); if (!client || !client.active) return res.status(400).json({ message: 'Choose an active client.' }) }
      const [[finalized]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM invoices WHERE client_id = ? AND status = \'finalized\' AND id IN (SELECT invoice_id FROM invoice_lines WHERE project_id = ?)', [before.clientId || 0, projectId])
      if (Number(finalized?.count || 0) && Number(before.clientId) !== Number(clientId)) return res.status(409).json({ message: 'Project client cannot be changed after finalized invoices reference it.' })
      await pool.query('UPDATE projects SET client_id = ? WHERE id = ?', [clientId, projectId]); await writeFinanceAudit(pool, req.actor!.id, 'project_client_changed', 'project', projectId, { clientId: before.clientId }, { clientId })
      return res.json({ message: 'Project client configuration updated.' })
    } catch (error) { next(error) }
  })

  app.patch('/api/finance/projects/:projectId/activities/:activityId', financeGuard, async (req: FinanceRequest, res, next) => {
    try {
      const projectId = Number(req.params.projectId); const activityId = Number(req.params.activityId); const billable = req.body?.billable
      if (billable !== true && billable !== false && billable !== null) return res.status(400).json({ message: 'Set the activity classification to billable, non-billable, or unclassified.' })
      const [[before]] = await pool.query<RowDataPacket[]>('SELECT pa.billable, a.category FROM project_activity_assignments pa JOIN activities a ON a.id = pa.activity_id WHERE pa.project_id = ? AND pa.activity_id = ?', [projectId, activityId]); if (!before) return res.status(404).json({ message: 'Project activity not found.' })
      if (before.category !== 'project' && billable === true) return res.status(400).json({ message: 'Internal activities cannot be classified as billable.' })
      const [[finalized]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM invoices i JOIN invoice_lines il ON il.invoice_id = i.id JOIN timesheet_entries e ON e.id = il.timesheet_entry_id WHERE i.status = \'finalized\' AND il.project_id = ? AND e.activity_id = ?', [projectId, activityId])
      if (Number(finalized?.count || 0) && Boolean(before.billable) !== Boolean(billable)) return res.status(409).json({ message: 'Classification on finalized invoice work is immutable.' })
      await pool.query('UPDATE project_activity_assignments SET billable = ? WHERE project_id = ? AND activity_id = ?', [billable, projectId, activityId])
      await writeFinanceAudit(pool, req.actor!.id, 'activity_classification_changed', 'project_activity', activityId, { projectId, billable: before.billable }, { projectId, billable })
      return res.json({ message: 'Financial activity classification updated.' })
    } catch (error) { next(error) }
  })

  app.post('/api/finance/projects/:id/rates', financeGuard, async (req: FinanceRequest, res, next) => {
    const connection = await pool.getConnection()
    try {
      const projectId = Number(req.params.id); const amount = Number(req.body?.amount); const currency = String(req.body?.currency || '').trim().toUpperCase(); const effectiveFrom = String(req.body?.effectiveFrom || ''); const effectiveTo = String(req.body?.effectiveTo || '') || null
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 || !validCurrency(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || (effectiveTo && (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo) || effectiveTo < effectiveFrom))) return res.status(400).json({ message: 'Provide a positive rate, three-letter currency, and valid effective dates.' })
      await connection.beginTransaction()
      const [[project]] = await connection.query<RowDataPacket[]>('SELECT p.id, p.client_id AS clientId, c.currency FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = ? FOR UPDATE', [projectId])
      if (!project) { await connection.rollback(); return res.status(404).json({ message: 'Project not found.' }) }
      if (!project.clientId || !project.currency) { await connection.rollback(); return res.status(409).json({ message: 'Link this project to a client before creating billing rates.' }) }
      if (currency !== project.currency) { await connection.rollback(); return res.status(400).json({ message: `Rate currency must match the client currency (${project.currency}).` }) }
      const [existing] = await connection.query<RowDataPacket[]>('SELECT id, amount, currency, DATE_FORMAT(effective_from, \'%Y-%m-%d\') AS effectiveFrom, DATE_FORMAT(effective_to, \'%Y-%m-%d\') AS effectiveTo, active FROM project_billing_rates WHERE project_id = ? ORDER BY effective_from DESC FOR UPDATE', [projectId])
      const previousOpen = existing.find((rate) => !rate.effectiveTo && String(rate.effectiveFrom) < effectiveFrom && Boolean(rate.active))
      let previousEndDate: string | null = null
      if (previousOpen) {
        const priorEnd = new Date(`${effectiveFrom}T00:00:00Z`); priorEnd.setUTCDate(priorEnd.getUTCDate() - 1)
        previousEndDate = priorEnd.toISOString().slice(0, 10)
        await connection.query('UPDATE project_billing_rates SET effective_to = ?, active = FALSE WHERE id = ?', [previousEndDate, previousOpen.id])
      }
      const overlapping = existing.find((rate) => Number(rate.id) !== Number(previousOpen?.id) && effectiveFrom <= String(rate.effectiveTo || '9999-12-31') && (!effectiveTo || effectiveTo >= String(rate.effectiveFrom)))
      if (overlapping) { await connection.rollback(); return res.status(409).json({ message: 'Rate effective dates overlap an existing rate. End the existing rate first.' }) }
      const [result] = await connection.query<ResultSetHeader>('INSERT INTO project_billing_rates (project_id, amount, currency, effective_from, effective_to, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)', [projectId, amount, currency, effectiveFrom, effectiveTo, req.actor!.id])
      const after = { projectId, amount, currency, effectiveFrom, effectiveTo, active: true }
      if (previousOpen) await writeFinanceAudit(connection, req.actor!.id, 'billing_rate_ended', 'billing_rate', Number(previousOpen.id), previousOpen, { ...previousOpen, effectiveTo: previousEndDate, active: false })
      await writeFinanceAudit(connection, req.actor!.id, 'billing_rate_created', 'billing_rate', result.insertId, null, after)
      await connection.commit(); return res.status(201).json({ message: 'Effective-dated billing rate created.', rateId: result.insertId })
    } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
  })

  app.patch('/api/finance/rates/:id/active', financeGuard, async (req: FinanceRequest, res, next) => {
    const connection = await pool.getConnection()
    try {
      const rateId = Number(req.params.id); const active = req.body?.active
      if (typeof active !== 'boolean') return res.status(400).json({ message: 'Provide an active state.' })
      await connection.beginTransaction(); const [[before]] = await connection.query<RowDataPacket[]>('SELECT id, project_id AS projectId, amount, currency, DATE_FORMAT(effective_from, \'%Y-%m-%d\') AS effectiveFrom, DATE_FORMAT(effective_to, \'%Y-%m-%d\') AS effectiveTo, active FROM project_billing_rates WHERE id = ? FOR UPDATE', [rateId])
      if (!before) { await connection.rollback(); return res.status(404).json({ message: 'Billing rate not found.' }) }
      const [[finalized]] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE il.billing_rate_id = ? AND i.status = \'finalized\'', [rateId])
      if (!active && Number(finalized?.count || 0) && String(before.effectiveFrom) >= new Date().toISOString().slice(0, 10)) { await connection.rollback(); return res.status(409).json({ message: 'This rate is referenced by finalized work and cannot be deactivated for that effective date.' }) }
      const endDate = !active && !before.effectiveTo ? new Date(Date.now() - 86400000).toISOString().slice(0, 10) : before.effectiveTo
      if (!active && endDate < before.effectiveFrom) { await connection.rollback(); return res.status(409).json({ message: 'A rate cannot end before its effective-from date.' }) }
      await connection.query('UPDATE project_billing_rates SET active = ?, effective_to = ? WHERE id = ?', [active, endDate, rateId])
      await writeFinanceAudit(connection, req.actor!.id, 'billing_rate_state_changed', 'billing_rate', rateId, before, { ...before, active, effectiveTo: endDate })
      await connection.commit(); return res.json({ message: active ? 'Billing rate activated.' : 'Billing rate ended; historical dates remain traceable.' })
    } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
  })

  app.get('/api/finance/exceptions', financeGuard, async (_req, res, next) => {
    try {
      const entries = await financeEntries(pool); const blockingMessages = ['Financial classification is not set.', 'Project is not linked to a client.', 'Client billing configuration is inactive.', 'No billing rate covers this work date.', 'Billing rate currency does not match the client currency.']; const exceptions = entries.filter((entry: any) => entry.exception).map((entry: any) => ({ severity: blockingMessages.includes(entry.exception) ? 'blocking' : 'warning', ...entry }))
      const [drafts] = await pool.query<RowDataPacket[]>(`SELECT i.id AS id, i.id AS invoiceId, i.client_id AS clientId, i.invoice_number AS invoiceNumber, i.status, c.name AS clientName, i.period_label AS periodLabel, i.currency,
        i.subtotal, COUNT(il.id) AS lineCount, c.active AS clientActive FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN invoice_lines il ON il.invoice_id = i.id
        WHERE i.status IN ('draft','ready') GROUP BY i.id, c.id ORDER BY i.created_at DESC`)
      for (const invoice of drafts) {
        if (!invoice.clientActive) exceptions.push({ severity: 'blocking', type: 'inactive_client', invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber, message: 'Client billing configuration is inactive; this invoice cannot be finalized.' })
        const { problem } = await validateInvoiceSnapshot(pool, invoice)
        if (problem) exceptions.push({ severity: 'blocking', type: 'invoice_configuration_changed', invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber, periodLabel: invoice.periodLabel, message: problem })
      }
      return res.json({ exceptions })
    } catch (error) { next(error) }
  })

  app.get('/api/finance/invoices', financeGuard, async (req, res, next) => {
    try {
      const status = ['draft', 'ready', 'finalized', 'cancelled'].includes(String(req.query.status)) ? String(req.query.status) : ''
      const [invoices] = await pool.query<RowDataPacket[]>(`SELECT i.id, i.invoice_number AS invoiceNumber, i.period_label AS periodLabel, i.currency, i.status, i.subtotal, i.created_at AS createdAt, i.ready_at AS readyAt, i.finalized_at AS finalizedAt, c.id AS clientId, c.code AS clientCode, c.name AS clientName, CASE WHEN i.status = 'cancelled' THEN i.cancelled_line_count ELSE COUNT(il.id) END AS lineCount, GROUP_CONCAT(DISTINCT il.project_code_snapshot ORDER BY il.project_code_snapshot SEPARATOR ', ') AS projects
        FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN invoice_lines il ON il.invoice_id = i.id
        WHERE (? = '' OR i.status = ?) AND (? = '' OR i.period_label = ?) AND (? = '' OR c.id = ?)
        GROUP BY i.id, c.id ORDER BY i.created_at DESC`, [status, status, req.query.period || '', req.query.period || '', req.query.clientId || '', req.query.clientId || ''])
      return res.json({ invoices: invoices.map((invoice) => ({ ...invoice, subtotal: Number(invoice.subtotal), lineCount: Number(invoice.lineCount) })) })
    } catch (error) { next(error) }
  })

  app.get('/api/finance/invoices/:id', financeGuard, async (req, res, next) => {
    try { const id = Number(req.params.id); const invoice = await invoiceById(pool, id); if (!invoice) return res.status(404).json({ message: 'Invoice not found.' }); const lines = await invoiceLines(pool, id); return res.json({ invoice: { ...invoice, subtotal: Number(invoice.subtotal) }, lines: lines.map((line) => ({ ...line, hours: Number(line.hours), rate: Number(line.rate), amount: Number(line.amount) })) }) } catch (error) { next(error) }
  })

  app.post('/api/finance/invoices', financeGuard, async (req: FinanceRequest, res, next) => {
    const connection = await pool.getConnection()
    try {
      const entryIds: number[] = Array.isArray(req.body?.entryIds) ? [...new Set((req.body.entryIds as unknown[]).map(Number))] : []
      if (!entryIds.length || entryIds.length > 250 || entryIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) return res.status(400).json({ message: 'Select between 1 and 250 valid approved work entries.' })
      await connection.beginTransaction()
      const [entries] = await connection.query<RowDataPacket[]>(`SELECT e.id AS entryId, t.id AS timesheetId, t.period_label AS periodLabel, t.status AS timesheetStatus, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entryDate,
        e.hours, p.id AS projectId, p.code AS projectCode, p.name AS projectName, p.client_id AS clientId,
        c.code AS clientCode, c.name AS clientName, c.currency AS clientCurrency, c.active AS clientActive,
        emp.name AS employeeName, emp.employee_code AS employeeCode, a.name AS activityName, a.category AS activityCategory, pa.billable
        FROM timesheet_entries e JOIN timesheets t ON t.id = e.timesheet_id JOIN employees emp ON emp.id = t.employee_id
        JOIN projects p ON p.id = e.project_id JOIN activities a ON a.id = e.activity_id LEFT JOIN clients c ON c.id = p.client_id
        LEFT JOIN project_activity_assignments pa ON pa.project_id = p.id AND pa.activity_id = a.id
        WHERE e.id IN (?) FOR UPDATE`, [entryIds])
      if (entries.length !== entryIds.length) { await connection.rollback(); return res.status(404).json({ message: 'One or more source entries could not be found.' }) }
      if (entries.some((entry) => !financeCanProcessTimesheet(entry.timesheetStatus))) { await connection.rollback(); return res.status(409).json({ message: 'Only Manager-approved timesheet entries can be invoiced.' }) }
      const invoiceGroups = new Set(entries.map((entry) => `${entry.clientId}|${entry.clientCurrency}|${entry.periodLabel}`))
      if (invoiceGroups.size !== 1) { await connection.rollback(); return res.status(400).json({ message: 'An invoice draft can contain one client, currency, and reporting period at a time.' }) }
      const first = entries[0]
      if (!first) { await connection.rollback(); return res.status(404).json({ message: 'No approved work entries were selected.' }) }
      const invoiceIdInfo: Array<{ entry: RowDataPacket; rate: RowDataPacket }> = []
      for (const entry of entries) {
        const rate = await applicableRate(connection, Number(entry.projectId), String(entry.entryDate))
        if (entry.activityCategory !== 'project' || !financeEntryCanBeInvoiced({ timesheetStatus: entry.timesheetStatus, billable: entry.billable == null ? null : Boolean(entry.billable), hasClient: entry.clientId != null && Boolean(entry.clientActive), hasRate: Boolean(rate && rate.currency === entry.clientCurrency), alreadyLinked: false })) {
          await connection.rollback(); return res.status(409).json({ message: `Entry ${entry.entryId} is not invoice-ready. Check its classification, active client, and effective billing rate.` })
        }
        invoiceIdInfo.push({ entry, rate: rate! })
      }
      const invoiceNumber = `PI-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`
      const [invoiceResult] = await connection.query<ResultSetHeader>('INSERT INTO invoices (invoice_number, client_id, period_label, currency, status, created_by_user_id) VALUES (?, ?, ?, ?, \'draft\', ?)', [invoiceNumber, first.clientId, first.periodLabel, first.clientCurrency, req.actor!.id])
      let subtotal = 0
      for (const { entry, rate } of invoiceIdInfo) {
        const hours = Number(entry.hours); const rateAmount = Number(rate.amount); const amount = calculateLineAmount(hours, rateAmount); subtotal += amount
        await connection.query(`INSERT INTO invoice_lines (invoice_id, timesheet_entry_id, billing_rate_id, project_id, entry_date, employee_name_snapshot, employee_code_snapshot, project_code_snapshot, project_name_snapshot, activity_name_snapshot, hours_snapshot, rate_snapshot, currency_snapshot, amount_snapshot)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [invoiceResult.insertId, entry.entryId, rate.id, entry.projectId, entry.entryDate, entry.employeeName, entry.employeeCode, entry.projectCode, entry.projectName, entry.activityName, hours, rateAmount, rate.currency, amount])
      }
      await connection.query('UPDATE invoices SET subtotal = ? WHERE id = ?', [subtotal, invoiceResult.insertId])
      await writeFinanceAudit(connection, req.actor!.id, 'invoice_draft_created', 'invoice', invoiceResult.insertId, null, { invoiceNumber, clientId: first.clientId, periodLabel: first.periodLabel, currency: first.clientCurrency, subtotal: Number(subtotal.toFixed(2)), entryIds })
      await connection.commit(); return res.status(201).json({ message: `Draft ${invoiceNumber} created from ${entryIds.length} approved entries.`, invoiceId: invoiceResult.insertId })
    } catch (error) { await connection.rollback(); if ((error as any)?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'At least one approved entry is already reserved by another invoice.' }); next(error) } finally { connection.release() }
  })

  app.post('/api/finance/invoices/:id/ready', financeGuard, async (req: FinanceRequest, res, next) => {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction(); const invoice = await invoiceById(connection, Number(req.params.id), true); if (!invoice) { await connection.rollback(); return res.status(404).json({ message: 'Invoice not found.' }) }
      if (!invoiceTransitionAllowed(invoice.status as InvoiceStatus, 'ready')) { await connection.rollback(); return res.status(409).json({ message: 'Only draft invoices can be marked ready.' }) }
      const { lines, problem } = await validateInvoiceSnapshot(connection, invoice); if (problem) { await connection.rollback(); return res.status(409).json({ message: problem }) }
      await connection.query('UPDATE invoices SET status = \'ready\', ready_at = NOW(), version = version + 1 WHERE id = ? AND status = \'draft\'', [invoice.id])
      await writeFinanceAudit(connection, req.actor!.id, 'invoice_marked_ready', 'invoice', Number(invoice.id), { status: invoice.status }, { status: 'ready', lineCount: lines.length })
      await connection.commit(); return res.json({ message: 'Invoice is ready for final review.' })
    } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
  })

  app.post('/api/finance/invoices/:id/finalize', financeGuard, async (req: FinanceRequest, res, next) => {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction(); const invoice = await invoiceById(connection, Number(req.params.id), true); if (!invoice) { await connection.rollback(); return res.status(404).json({ message: 'Invoice not found.' }) }
      if (!invoiceTransitionAllowed(invoice.status as InvoiceStatus, 'finalized')) { await connection.rollback(); return res.status(409).json({ message: 'Only ready invoices can be finalized.' }) }
      const { problem, lines } = await validateInvoiceSnapshot(connection, invoice); if (problem) { await connection.rollback(); return res.status(409).json({ message: problem }) }
      const [result] = await connection.query<ResultSetHeader>('UPDATE invoices SET status = \'finalized\', finalized_by_user_id = ?, finalized_at = NOW(), version = version + 1 WHERE id = ? AND status = \'ready\'', [req.actor!.id, invoice.id])
      if (!result.affectedRows) { await connection.rollback(); return res.status(409).json({ message: 'Invoice status changed during finalization. Reload and review it.' }) }
      await writeFinanceAudit(connection, req.actor!.id, 'invoice_finalized', 'invoice', Number(invoice.id), { status: invoice.status }, { status: 'finalized', subtotal: Number(invoice.subtotal), currency: invoice.currency, lineCount: lines.length })
      await connection.commit(); return res.json({ message: `${invoice.invoiceNumber} finalized and locked.` })
    } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
  })

  app.delete('/api/finance/invoices/:id', financeGuard, async (req: FinanceRequest, res, next) => {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction(); const invoice = await invoiceById(connection, Number(req.params.id), true); if (!invoice) { await connection.rollback(); return res.status(404).json({ message: 'Invoice not found.' }) }
      if (invoice.status !== 'draft') { await connection.rollback(); return res.status(409).json({ message: 'Only a draft can be cancelled. Ready and finalized invoices are retained.' }) }
      const lines = await invoiceLines(connection, Number(invoice.id), true)
      await writeFinanceAudit(connection, req.actor!.id, 'invoice_draft_cancelled', 'invoice', Number(invoice.id), { invoiceNumber: invoice.invoiceNumber, status: 'draft', subtotal: Number(invoice.subtotal), lines: lines.map((line) => ({ entryId: line.entryId, projectId: line.projectId, date: line.entryDate, hours: line.hours, rate: line.rate, currency: line.currency, amount: line.amount })) }, { status: 'cancelled', releasedLines: lines.length })
      await connection.query('DELETE FROM invoice_lines WHERE invoice_id = ?', [invoice.id])
      await connection.query('UPDATE invoices SET status = \'cancelled\', cancelled_line_count = ?, version = version + 1 WHERE id = ? AND status = \'draft\'', [lines.length, invoice.id])
      await connection.commit(); return res.json({ message: 'Draft cancelled; its approved entries are available for a new draft.' })
    } catch (error) { await connection.rollback(); next(error) } finally { connection.release() }
  })

  app.get('/api/finance/audit', financeGuard, async (_req, res, next) => {
    try { const [events] = await pool.query<RowDataPacket[]>(`SELECT f.id, f.action, f.entity_type AS entityType, f.entity_id AS entityId, f.before_state AS beforeState, f.after_state AS afterState, f.created_at AS createdAt, u.name AS actorName
      FROM finance_audit_events f JOIN users u ON u.id = f.actor_user_id ORDER BY f.created_at DESC LIMIT 100`); return res.json({ events }) } catch (error) { next(error) }
  })

  app.get('/api/finance/notifications', financeGuard, async (req: FinanceRequest, res, next) => {
    try { const [notifications] = await pool.query<RowDataPacket[]>('SELECT id, title, message, notification_type AS type, read_at AS readAt, created_at AS createdAt, timesheet_id AS timesheetId FROM notifications WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 50', [req.actor!.email]); return res.json({ notifications }) } catch (error) { next(error) }
  })

  app.post('/api/finance/notifications/:id/read', financeGuard, async (req: FinanceRequest, res, next) => {
    try { const [result] = await pool.query<ResultSetHeader>('UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND recipient_email = ?', [req.params.id, req.actor!.email]); if (!result.affectedRows) return res.status(404).json({ message: 'Notification not found.' }); return res.json({ message: 'Notification marked as read.' }) } catch (error) { next(error) }
  })

  app.get('/api/finance/exports/:kind', financeGuard, async (req, res, next) => {
    try {
      const kind = String(req.params.kind); let headers: string[]; let rows: unknown[][]
      if (['approved-work', 'unbilled-work'].includes(kind)) {
        const entries = await financeEntries(pool, { period: String(req.query.period || ''), billingStatus: kind === 'unbilled-work' ? 'unbilled' : 'all' }) as any[]
        const selected = kind === 'unbilled-work' ? entries.filter((item) => item.billable && item.eligibleForInvoice) : entries
        headers = ['Entry ID', 'Timesheet ID', 'Period', 'Date', 'Employee code', 'Employee', 'Project code', 'Project', 'Client', 'Activity', 'Classification', 'Hours', 'Rate', 'Currency', 'Amount', 'Billing status']
        rows = selected.map((item) => [item.entryId, item.timesheetId, item.periodLabel, item.entryDate, item.employeeCode, item.employeeName, item.projectCode, item.projectName, item.clientName, item.activityName, item.financialClass, item.hours, item.rateAmount, item.rateCurrency, item.amount, item.billingStatus])
      } else if (kind === 'invoice-lines') {
        const [lines] = await pool.query<RowDataPacket[]>(`SELECT i.invoice_number AS invoiceNumber, c.name AS clientName, i.period_label AS periodLabel, i.status,
          il.timesheet_entry_id AS entryId, DATE_FORMAT(il.entry_date, '%Y-%m-%d') AS entryDate, il.employee_code_snapshot AS employeeCode,
          il.employee_name_snapshot AS employeeName, il.project_code_snapshot AS projectCode, il.project_name_snapshot AS projectName,
          il.activity_name_snapshot AS activityName, il.hours_snapshot AS hours, il.rate_snapshot AS rate, il.currency_snapshot AS currency, il.amount_snapshot AS amount
          FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id JOIN clients c ON c.id = i.client_id WHERE (? = '' OR i.status = ?) ORDER BY i.created_at, il.entry_date`, [req.query.status || '', req.query.status || ''])
        headers = ['Invoice', 'Client', 'Period', 'Invoice status', 'Entry ID', 'Date', 'Employee code', 'Employee', 'Project code', 'Project', 'Activity', 'Hours', 'Rate', 'Currency', 'Amount']; rows = lines.map((line) => [line.invoiceNumber, line.clientName, line.periodLabel, line.status, line.entryId, line.entryDate, line.employeeCode, line.employeeName, line.projectCode, line.projectName, line.activityName, line.hours, line.rate, line.currency, line.amount])
      } else if (kind === 'invoices') {
        const [invoices] = await pool.query<RowDataPacket[]>('SELECT i.invoice_number AS invoiceNumber, c.code AS clientCode, c.name AS clientName, i.period_label AS periodLabel, i.status, i.subtotal, i.currency, i.created_at AS createdAt, i.finalized_at AS finalizedAt FROM invoices i JOIN clients c ON c.id = i.client_id ORDER BY i.created_at DESC')
        headers = ['Invoice', 'Client code', 'Client', 'Period', 'Status', 'Subtotal', 'Currency', 'Created', 'Finalized']; rows = invoices.map((invoice) => [invoice.invoiceNumber, invoice.clientCode, invoice.clientName, invoice.periodLabel, invoice.status, invoice.subtotal, invoice.currency, invoice.createdAt, invoice.finalizedAt])
      } else if (kind === 'project-summary') {
        const [projects] = await pool.query<RowDataPacket[]>(`SELECT p.code AS projectCode, p.name AS projectName, c.code AS clientCode, c.name AS clientName, c.currency,
          COALESCE(SUM(CASE WHEN t.status = 'approved' THEN e.hours ELSE 0 END), 0) AS approvedHours,
          COALESCE(SUM(CASE WHEN t.status = 'approved' AND a.category = 'project' AND pa.billable = TRUE THEN e.hours ELSE 0 END), 0) AS billableHours,
          COALESCE(SUM(CASE WHEN t.status = 'approved' AND (a.category = 'internal' OR pa.billable = FALSE) THEN e.hours ELSE 0 END), 0) AS nonBillableHours,
          COALESCE(SUM(CASE WHEN t.status = 'approved' AND a.category = 'project' AND pa.billable = TRUE AND il.id IS NULL THEN e.hours ELSE 0 END), 0) AS unbilledHours,
          COALESCE(SUM(CASE WHEN t.status = 'approved' AND a.category = 'project' AND pa.billable = TRUE AND il.id IS NOT NULL AND i.status = 'finalized' THEN il.hours_snapshot ELSE 0 END), 0) AS billedHours,
          COALESCE(SUM(CASE WHEN t.status = 'approved' AND a.category = 'project' AND pa.billable = TRUE AND il.id IS NULL AND r.id IS NOT NULL AND c.active = TRUE AND r.currency = c.currency THEN ROUND(e.hours * r.amount, 2) ELSE 0 END), 0) AS unbilledAmount,
          COALESCE(SUM(CASE WHEN i.status = 'finalized' THEN il.amount_snapshot ELSE 0 END), 0) AS billedAmount
          FROM projects p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN timesheet_entries e ON e.project_id = p.id LEFT JOIN timesheets t ON t.id = e.timesheet_id
          LEFT JOIN activities a ON a.id = e.activity_id LEFT JOIN project_activity_assignments pa ON pa.project_id = p.id AND pa.activity_id = e.activity_id
          LEFT JOIN project_billing_rates r ON r.project_id = p.id AND r.effective_from <= e.entry_date AND (r.effective_to IS NULL OR r.effective_to >= e.entry_date) AND (r.active = TRUE OR e.entry_date < CURDATE())
          LEFT JOIN invoice_lines il ON il.timesheet_entry_id = e.id LEFT JOIN invoices i ON i.id = il.invoice_id GROUP BY p.id, c.id ORDER BY p.code`)
        headers = ['Project code', 'Project', 'Client code', 'Client', 'Currency', 'Approved hours', 'Billable hours', 'Non-billable hours', 'Unbilled hours', 'Billed hours', 'Unbilled amount', 'Billed amount']
        rows = projects.map((project) => [project.projectCode, project.projectName, project.clientCode, project.clientName, project.currency, project.approvedHours, project.billableHours, project.nonBillableHours, project.unbilledHours, project.billedHours, project.unbilledAmount, project.billedAmount])
      } else return res.status(404).json({ message: 'Choose approved-work, unbilled-work, invoice-lines, invoices, or project-summary.' })
      const csv = [headers, ...rows].map((line) => line.map(csvCell).join(',')).join('\r\n')
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="pulseai-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`); return res.send(`\uFEFF${csv}`)
    } catch (error) { next(error) }
  })
}
