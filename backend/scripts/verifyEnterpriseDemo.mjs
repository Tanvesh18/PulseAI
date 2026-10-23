import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import { resolve } from 'node:path'

dotenv.config({ path: resolve(import.meta.dirname, '../.env.demo'), quiet: true, override: true })
if (process.env.DB_NAME !== 'pulseai_demo') throw new Error('Verification requires pulseai_demo.')
const c=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME,dateStrings:true})
async function scalar(sql) { const [[row]]=await c.query(sql); return Object.values(row)[0] }
try {
  const database=await scalar('SELECT DATABASE()')
  if(database!=='pulseai_demo') throw new Error(`Wrong database: ${database}`)
  const counts={}
  for(const table of ['departments','employees','projects','timesheets','timesheet_entries','invoices','invoice_lines','department_submissions']) counts[table]=Number(await scalar(`SELECT COUNT(*) FROM ${table}`))
  counts.managers=Number(await scalar("SELECT COUNT(*) FROM users WHERE role='manager'"))
  const [statuses]=await c.query('SELECT status,COUNT(*) AS count FROM timesheets GROUP BY status ORDER BY status')
  const [invoiceStatuses]=await c.query('SELECT status,currency,COUNT(*) AS count,ROUND(SUM(subtotal),2) AS amount FROM invoices GROUP BY status,currency ORDER BY status,currency')
  const [departmentStatuses]=await c.query('SELECT status,COUNT(*) AS count FROM department_submissions GROUP BY status')
  const errors={
    totalMismatch:await scalar('SELECT COUNT(*) FROM timesheets t LEFT JOIN (SELECT timesheet_id,SUM(hours) AS hours FROM timesheet_entries GROUP BY timesheet_id) e ON e.timesheet_id=t.id WHERE t.total_hours<>COALESCE(e.hours,0)'),
    futureEntries:await scalar('SELECT COUNT(*) FROM timesheet_entries WHERE entry_date>CURRENT_DATE()'),
    entriesOutsidePeriods:await scalar('SELECT COUNT(*) FROM timesheet_entries e JOIN timesheets t ON t.id=e.timesheet_id JOIN reporting_periods r ON r.id=t.reporting_period_id WHERE e.entry_date<r.starts_on OR e.entry_date>r.ends_on'),
    reviewOwnership:await scalar("SELECT COUNT(*) FROM timesheets t JOIN employees e ON e.id=t.employee_id WHERE t.status IN ('approved','returned') AND (t.reviewer_user_id<>t.assigned_manager_user_id OR t.assigned_manager_user_id IS NULL)"),
    invoiceMismatch:await scalar('SELECT COUNT(*) FROM invoices i LEFT JOIN (SELECT invoice_id,SUM(amount_snapshot) AS amount FROM invoice_lines GROUP BY invoice_id) l ON l.invoice_id=i.id WHERE i.subtotal<>COALESCE(l.amount,0)'),
    invoiceIneligible:await scalar("SELECT COUNT(*) FROM invoice_lines l JOIN timesheet_entries e ON e.id=l.timesheet_entry_id JOIN timesheets t ON t.id=e.timesheet_id JOIN projects p ON p.id=e.project_id JOIN invoices i ON i.id=l.invoice_id JOIN project_activity_assignments pa ON pa.project_id=p.id AND pa.activity_id=e.activity_id JOIN project_billing_rates r ON r.id=l.billing_rate_id WHERE t.status<>'approved' OR pa.billable<>TRUE OR p.client_id<>i.client_id OR r.project_id<>p.id OR r.effective_from>e.entry_date OR (r.effective_to IS NOT NULL AND r.effective_to<e.entry_date) OR l.hours_snapshot<>e.hours OR l.rate_snapshot<>r.amount OR l.currency_snapshot<>r.currency"),
    departmentReadiness:await scalar("SELECT COUNT(*) FROM department_submissions s JOIN reporting_periods r ON r.label=s.period_label WHERE EXISTS (SELECT 1 FROM employees e LEFT JOIN timesheets t ON t.employee_id=e.id AND t.reporting_period_id=r.id WHERE e.department_id=s.department_id AND e.active=TRUE AND (t.id IS NULL OR t.status<>'approved'))"),
    missingJobTitles:await scalar('SELECT COUNT(*) FROM employees WHERE job_title IS NULL OR job_title=\'\''),
    overlappingRates:await scalar('SELECT COUNT(*) FROM project_billing_rates a JOIN project_billing_rates b ON a.project_id=b.project_id AND a.id<b.id AND a.effective_from<=COALESCE(b.effective_to,\'9999-12-31\') AND b.effective_from<=COALESCE(a.effective_to,\'9999-12-31\')'),
    managersMissingWorkflowState:await scalar("SELECT COUNT(*) FROM users u WHERE u.role='manager' AND (NOT EXISTS (SELECT 1 FROM timesheets t WHERE t.assigned_manager_user_id=u.id AND t.status IN ('submitted','resubmitted')) OR NOT EXISTS (SELECT 1 FROM timesheets t WHERE t.assigned_manager_user_id=u.id AND t.status='approved') OR NOT EXISTS (SELECT 1 FROM timesheets t WHERE t.assigned_manager_user_id=u.id AND t.status='returned'))"),
  }
  console.log(JSON.stringify({database,counts,statuses,invoiceStatuses,departmentStatuses,errors},null,2))
  if(Object.values(errors).some(value=>Number(value)!==0)) process.exitCode=1
} finally { await c.end() }
