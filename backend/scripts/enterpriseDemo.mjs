import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const demoPath = resolve(root, '.env.demo')
const source = dotenv.parse(readFileSync(resolve(root, '.env')))
const database = 'pulseai_demo'
const departments = [
  ['ENG', 'Engineering', 'Meera Iyer'], ['QA', 'Quality Assurance', 'Dev Malhotra'],
  ['PRODUCT', 'Product', 'Ritu Sen'], ['OPS', 'Operations', 'Nikhil Rao'],
  ['HR', 'Human Resources', 'Lara Bhat'], ['FIN', 'Finance', 'Omar Sethi'], ['IT', 'Information Technology', 'Tara Menon'],
]
const names = [
  ['Aarav Mehta','Sana Qureshi','Ishaan Bedi','Priya Nair','Neel Arora','Mira Joshi','Rohan Desai'],
  ['Anika Sethi','Vikram Kohli','Zoya Mirza','Aditya Bose','Kavya Pillai','Farhan Ali','Leena Sood'],
  ['Tanya Gill','Arjun Khanna','Nisha Verma','Omkar Patil','Sara Dutta','Reyansh Jain','Ira Banerjee'],
  ['Diya Sharma','Karan Shetty','Fatima Khan','Yash Kulkarni','Avni Shah','Ravi Menon','Nora Thomas'],
  ['Simran Batra','Anil Reddy','Maya Chawla','Pooja Vyas','Harshita Rao','Sahil Arora','Ruhi Das'],
  ['Rhea Patel','Manav Gupta','Alina Merchant','Tushar Sinha','Kriti Shah','Rizwan Ansari','Jiya Nanda'],
  ['Naveen Kumar','Esha Lobo','Parth Trivedi','Aditi Saxena','Neil Fernandes','Sonal Puri','Dhruv Ghosh'],
]
const titles = [
  ['Software Engineer','Senior Software Engineer','Platform Engineer','Backend Engineer','Frontend Engineer','Data Engineer','Software Engineer'],
  ['QA Analyst','Automation Engineer','Quality Engineer','Test Lead','QA Analyst','Performance Tester','Automation Engineer'],
  ['Product Analyst','Product Designer','Business Analyst','Product Owner','UX Researcher','Product Analyst','Technical Writer'],
  ['Operations Analyst','Service Coordinator','Operations Specialist','Delivery Analyst','Process Analyst','Service Analyst','Operations Coordinator'],
  ['HR Generalist','Talent Partner','People Analyst','HR Operations Specialist','Recruiter','Learning Coordinator','HR Associate'],
  ['Financial Analyst','Billing Specialist','Revenue Analyst','Accounts Associate','Finance Analyst','Commercial Analyst','Billing Coordinator'],
  ['IT Support Engineer','Systems Administrator','Security Analyst','IT Analyst','Cloud Administrator','Support Specialist','IT Engineer'],
]
const clientDefs = [
  ['ASTER','Aster Mobility Labs','USD'], ['HARBOR','Harbor Retail Group','USD'],
  ['CEDAR','Cedar Health Systems','INR'], ['MERIDIAN','Meridian Industrial Works','INR'],
]
const projectDefs = [
  ['ASTER-PORTAL','Aster dealer portal','ASTER','ENG',185], ['ASTER-API','Aster integration services','ASTER','ENG',210],
  ['HARBOR-QA','Harbor release assurance','HARBOR','QA',145], ['HARBOR-INSIGHTS','Harbor customer insights','HARBOR','PRODUCT',170],
  ['CEDAR-WORKFLOW','Cedar care workflow','CEDAR','OPS',1950], ['MERIDIAN-REPORT','Meridian operations reporting','MERIDIAN','FIN',2250],
  ['NORTHSTAR-PEOPLE','People operations improvement',null,'HR',0], ['NORTHSTAR-IT','Workplace systems modernization',null,'IT',0],
  ['NORTHSTAR-PLATFORM','Internal platform reliability',null,'ENG',0], ['NORTHSTAR-QUALITY','Internal quality program',null,'QA',0],
]
const periods = [
  ['July 2026','2026-07-01','2026-07-31','2026-08-05'],
  ['August 2026','2026-08-01','2026-08-31','2026-09-05'],
  ['September 2026','2026-09-01','2026-09-30','2026-10-05'],
  ['October 2026','2026-10-01','2026-10-31','2026-11-05'],
]

function envText(values) { return Object.entries(values).map(([key,value]) => `${key}=${String(value).replaceAll('\n','')}`).join('\n') + '\n' }
function demoEnvironment() {
  if (existsSync(demoPath)) {
    const existing = dotenv.parse(readFileSync(demoPath))
    if (existing.DB_NAME !== database || existing.SEED_DEMO_DATA !== 'false') throw new Error('.env.demo must target pulseai_demo with SEED_DEMO_DATA=false.')
    return existing
  }
  const password = randomBytes(24).toString('base64url')
  const cleanSource = Object.fromEntries(Object.entries(source).filter(([key]) => !/^(DIRECTOR|MANAGER|HR|FINANCE|EMPLOYEE)_\d+_/.test(key)))
  const values = { ...cleanSource, DB_NAME: database, MYSQLDATABASE: '', SEED_DEMO_DATA: 'false', DEMO_USER_PASSWORD: password,
    JWT_SECRET: randomBytes(48).toString('base64url'), PORT: '4100', CLIENT_ORIGIN: 'http://localhost:5174',
    HR_1_NAME: 'Aisha Kapoor', HR_1_EMAIL: 'aisha.kapoor@northstar.example', HR_1_PASSWORD: password,
    MANAGER_1_NAME: 'Meera Iyer', MANAGER_1_EMAIL: 'meera.iyer@northstar.example', MANAGER_1_PASSWORD: password,
    FINANCE_1_NAME: 'Kabir Shah', FINANCE_1_EMAIL: 'kabir.shah@northstar.example', FINANCE_1_PASSWORD: password,
    DIRECTOR_1_NAME: 'Elena Park', DIRECTOR_1_EMAIL: 'elena.park@northstar.example', DIRECTOR_1_PASSWORD: password,
  }
  writeFileSync(demoPath, envText(values), { mode: 0o600, flag: 'wx' })
  return values
}
function config(env, databaseName) { return { host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER || 'root', password: env.DB_PASSWORD || '', ...(databaseName ? { database: databaseName } : {}) } }
function ensure(condition, message) { if (!condition) throw new Error(message) }
async function identity(connection, expected) {
  const [[row]] = await connection.query('SELECT DATABASE() AS activeDatabase')
  ensure(row.activeDatabase === expected, `Expected active database ${expected}; got ${row.activeDatabase}. Refusing to write.`)
}
async function schema(env) {
  const child = spawn(process.execPath, ['--import','tsx','server.ts'], { cwd: root, env: { ...process.env, ...env, DOTENV_CONFIG_PATH: demoPath }, stdio: ['ignore','pipe','pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk.toString() })
  child.stderr.on('data', chunk => { output += chunk.toString() })
  try {
    for (let attempt=0; attempt<80; attempt++) {
      if (child.exitCode !== null) throw new Error(`Demo schema startup failed: ${output.slice(-2500)}`)
      try { const response = await fetch(`http://127.0.0.1:${env.PORT}/api/health`); if (response.ok && output.includes('Pulse AI API running')) return }
      catch { /* startup in progress */ }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error(`Demo schema startup timed out: ${output.slice(-2500)}`)
  } finally { child.kill() }
}
async function put(c, sql, params=[]) { const [result] = await c.query(sql, params); return result.insertId }
async function one(c, sql, params=[]) { const [[row]] = await c.query(sql, params); return row }
function dateList(start, end) {
  const result=[]
  for(let date=new Date(`${start}T00:00:00Z`); date<=new Date(`${end}T00:00:00Z`); date.setUTCDate(date.getUTCDate()+1)) {
    if(date.getUTCDay()!==0 && date.getUTCDay()!==6) result.push(date.toISOString().slice(0,10))
  }
  return result
}
async function seed(c, env) {
  await identity(c, database)
  const [[existing]] = await c.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'enterprise_demo_seed'")
  if (existing.count) {
    const marker = await one(c, "SELECT completed_at FROM enterprise_demo_seed WHERE seed_key = 'northstar-v1'")
    if (marker) { console.log('Enterprise demo already seeded; records were not duplicated.'); return }
  }
  await c.query('CREATE TABLE IF NOT EXISTS enterprise_demo_seed (seed_key VARCHAR(80) PRIMARY KEY, completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)')
  await c.beginTransaction()
  try {
    const hash = await bcrypt.hash(env.DEMO_USER_PASSWORD, 12)
    const users = new Map()
    async function user(name,email,role) {
      const prior=await one(c,'SELECT id,role,name FROM users WHERE email=?',[email])
      if(prior) { ensure(prior.role===role&&prior.name===name,`Demo account conflict: ${email}`); users.set(email,prior.id); return prior.id }
      const id=await put(c,"INSERT INTO users (name,email,password_hash,role,auth_provider) VALUES (?,?,?,?,'password')",[name,email,hash,role]); users.set(email,id); return id
    }
    const managers=[]
    for (const [code,,name] of departments) { const email=`${name.toLowerCase().replaceAll(' ','.')}@northstar.example`; managers.push({code,name,email,id:await user(name,email,'manager')}) }
    const hrId=await user('Aisha Kapoor','aisha.kapoor@northstar.example','hr')
    const financeId=await user('Kabir Shah','kabir.shah@northstar.example','finance')
    const directorId=await user('Elena Park','elena.park@northstar.example','director')
    const depIds=new Map()
    for(const [code,name] of departments) depIds.set(code,await put(c,'INSERT INTO departments (code,name) VALUES (?,?)',[code,name]))
    const employees=[]
    for(let d=0;d<departments.length;d++) for(let n=0;n<7;n++) {
      const name=names[d][n], code=`NS${String(d*7+n+1).padStart(3,'0')}`
      const email=`${name.toLowerCase().replaceAll(' ','.')}@northstar.example`
      const userId=await user(name,email,'employee')
      const department=departments[d][0], manager=managers[d]
      const id=await put(c,'INSERT INTO employees (employee_code,name,email,department_id,manager_name,manager_user_id,user_id,region,active) VALUES (?,?,?,?,?,?,?, ?,TRUE)',[code,name,email,depIds.get(department),manager.name,manager.id,userId,'India'])
      employees.push({id,code,name,email,userId,department,manager,d,n})
    }
    const periodsByLabel=new Map()
    for(const [label,start,end,deadline] of periods) {
      const id=await put(c,'INSERT INTO reporting_periods (label,starts_on,ends_on,submission_deadline,standard_daily_hours,active) VALUES (?,?,?,?,8,TRUE)',[label,start,end,deadline])
      periodsByLabel.set(label,id)
      await put(c,'INSERT INTO billing_cycles (period_label,starts_on,ends_on,submission_deadline,current_stage) VALUES (?,?,?,?,?)',[label,start,end,deadline,label==='October 2026'?'manager_submission':'oracle_export'])
    }
    const clients=new Map()
    for(const [code,name,currency] of clientDefs) clients.set(code,{id:await put(c,'INSERT INTO clients (code,name,billing_email,currency,created_by_user_id) VALUES (?,?,?,?,?)',[code,name,`billing@${code.toLowerCase()}.example`,currency,financeId]),currency})
    const projectActivity=await put(c,"INSERT INTO activities (name,category) VALUES ('Client delivery','project')")
    const internalActivity=await put(c,"INSERT INTO activities (name,category) VALUES ('Team operations','internal')")
    const trainingActivity=await put(c,"INSERT INTO activities (name,category) VALUES ('Learning and development','internal')")
    const projects=[]
    for(const [code,name,clientCode,department,rate] of projectDefs) {
      const manager=managers.find(item=>item.code===department)
      const id=await put(c,'INSERT INTO projects (code,name,description,active,starts_on,client_id,manager_user_id) VALUES (?,?,?,TRUE,?,?,?)',[code,name,`Northstar 2026 ${clientCode?'client engagement':'internal initiative'}`,'2026-07-01',clientCode?clients.get(clientCode).id:null,manager.id])
      projects.push({id,code,name,clientCode,department,rate})
      await put(c,'INSERT INTO project_activity_assignments (project_id,activity_id,active,billable,created_by_user_id) VALUES (?,?,TRUE,?,?)',[id,projectActivity,Boolean(clientCode),manager.id])
      if(clientCode) {
        const currency=clients.get(clientCode).currency
        if(code==='ASTER-PORTAL') {
          await put(c,'INSERT INTO project_billing_rates (project_id,amount,currency,effective_from,effective_to,created_by_user_id) VALUES (?,?,?,?,?,?)',[id,175,currency,'2026-07-01','2026-08-31',financeId])
          await put(c,'INSERT INTO project_billing_rates (project_id,amount,currency,effective_from,created_by_user_id) VALUES (?,?,?,?,?)',[id,rate,currency,'2026-09-01',financeId])
        } else await put(c,'INSERT INTO project_billing_rates (project_id,amount,currency,effective_from,created_by_user_id) VALUES (?,?,?,?,?)',[id,rate,currency,'2026-07-01',financeId])
      }
    }
    for(const employee of employees) {
      const choices=projects.filter(project=>project.department===employee.department)
      if(employee.department==='ENG') choices.push(projects.find(project=>project.code==='HARBOR-QA'))
      for(const project of choices) await put(c,'INSERT INTO employee_project_assignments (employee_id,project_id,active,starts_on) VALUES (?,?,TRUE,?)',[employee.id,project.id,'2026-07-01'])
    }
    for(const [date,name] of [['2026-08-15','Independence Day'],['2026-10-02','Gandhi Jayanti']]) await put(c,'INSERT INTO public_holidays (holiday_date,name,region,active) VALUES (?,?,?,TRUE)',[date,name,'India'])
    for(const employee of employees.filter((_,index)=>index%9===0)) await put(c,"INSERT INTO employee_leave_records (employee_id,starts_on,ends_on,leave_type,status,source_reference) VALUES (?,?,?,'Annual leave','approved',?)",[employee.id,'2026-09-18','2026-09-18',`NS-LEAVE-${employee.code}`])
    const billable=[]
    for(let p=0;p<periods.length;p++) {
      const [label,start,end]=periods[p]
      const days=dateList(start,p===3?'2026-10-22':end).filter(day=>day!=='2026-08-15'&&day!=='2026-10-02')
      for(const employee of employees) {
        let status='approved'
        if(p===3) status=employee.d<2?'approved':employee.n===0?'submitted':employee.n===1?'returned':employee.n===2?'resubmitted':employee.n===3?'draft':'approved'
        const selectedDays=status==='draft'?days.filter((_,index)=>index%3!==0):status==='returned'?days.filter((_,index)=>index%5!==0):days
        const id=await put(c,'INSERT INTO timesheets (employee_id,reporting_period_id,period_label,total_hours,status,submitted_at,approved_at,returned_at,reviewer_user_id,assigned_manager_user_id,return_reason,remarks,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[
          employee.id,periodsByLabel.get(label),label,0,status,status==='draft'?null:`${p===3?'2026-10-22':end} 09:00:00`,null,null,
          ['approved','returned'].includes(status)?employee.manager.id:null,employee.manager.id,
          status==='returned'?'Please add the missing client delivery notes and correct the unrecorded workday.':null,
          `Work recorded for ${label}; ${employee.department} delivery and team activity.`,status==='draft'?2:status==='approved'?4:3,
        ])
        const values=[]; let total=0
        for(let dayIndex=0;dayIndex<selectedDays.length;dayIndex++) {
          const day=selectedDays[dayIndex]
          if(day==='2026-09-18' && (employee.d*7+employee.n)%9===0) continue
          const choices=projects.filter(project=>project.department===employee.department)
          const project=choices[dayIndex%choices.length]
          const projectHours=[6,6.5,7,5.5,7.5][(dayIndex+employee.n)%5]
          const internalHours=[1,1.5,0.5,2,0.5][(dayIndex+employee.n)%5]
          const detail=['Reviewed requirements and delivered the next workflow slice','Resolved integration issues and updated handoff notes','Validated release changes with the project team','Prepared stakeholder feedback and delivery updates','Improved reporting, documentation, and operational checks'][(dayIndex+employee.n)%5]
          values.push([id,day,project.id,projectActivity,projectHours,`${detail} for ${project.name}.`])
          values.push([id,day,null,dayIndex%7===0?trainingActivity:internalActivity,internalHours,dayIndex%7===0?'Completed role training and documented follow-up actions.':'Joined team planning and reviewed delivery blockers.'])
          total+=projectHours+internalHours
        }
        if(values.length) await c.query('INSERT INTO timesheet_entries (timesheet_id,entry_date,project_id,activity_id,hours,work_description) VALUES ?',[values])
        await c.query('UPDATE timesheets SET total_hours=?, submitted_at=?, approved_at=?, returned_at=? WHERE id=?',[
          total,status==='draft'?null:`${p===3?'2026-10-22':end} 09:00:00`,status==='approved'?`${p===3?'2026-10-22':periods[Math.min(p+1,3)][1]} 10:00:00`:null,status==='returned'?'2026-10-22 11:00:00':null,id])
        const audit=[['draft_saved',employee.userId,'Daily work entered.']]
        if(status!=='draft') audit.push(['submitted',employee.userId,'Submitted daily work for Manager review.'])
        if(status==='returned'||status==='resubmitted') audit.push(['returned',employee.manager.id,'Please correct the missing delivery detail.'])
        if(status==='resubmitted') audit.push(['resubmitted',employee.userId,'Added requested detail and resubmitted.'])
        if(status==='approved') audit.push(['approved',employee.manager.id,'Hours and project work approved.'])
        for(const [event,actor,detail] of audit) await put(c,'INSERT INTO timesheet_audit_events (timesheet_id,actor_user_id,event_type,detail) VALUES (?,?,?,?)',[id,actor,event,detail])
        if(status==='returned') await put(c,"INSERT INTO validation_findings (timesheet_id,severity,finding_type,message) VALUES (?,'warning','missing_workdays',?)",[id,'Some scheduled workdays need entries or approved leave.'])
        if(status==='draft') await put(c,"INSERT INTO validation_findings (timesheet_id,severity,finding_type,message) VALUES (?,'warning','incomplete_draft',?)",[id,'Draft has unrecorded workdays.'])
        if(status==='approved' && employee.d<6) {
          for(const value of values.filter(value=>value[2]!==null)) {
            const project=projects.find(item=>item.id===value[2])
            if(project.clientCode) billable.push({employee,period:label,day:value[1],project,hours:value[4]})
          }
        }
        if(p===3) {
          const title=status==='approved'?'Timesheet approved':status==='returned'?'Timesheet returned':'Timesheet update'
          await put(c,'INSERT INTO notifications (title,message,notification_type,recipient_email,timesheet_id,read_at) VALUES (?,?,?,?,?,?)',[title,`${employee.name}: ${label} is ${status}.`,status==='returned'?'warning':'info',employee.email,id,employee.n%2===0?'2026-10-22 12:00:00':null])
          if(status==='submitted'||status==='resubmitted') await put(c,'INSERT INTO notifications (title,message,notification_type,recipient_email,timesheet_id) VALUES (?,?,?,?,?)',['Timesheet awaiting review',`${employee.name} submitted ${label} work.`,'info',employee.manager.email,id])
        }
      }
    }
    // Resolve invoice source rows from the committed timesheet relationships, never from calculated dashboard totals.
    const [sources]=await c.query(`SELECT e.id,e.entry_date,e.hours,t.period_label,emp.name AS employee_name,emp.employee_code,p.id AS project_id,p.code AS project_code,p.name AS project_name,p.client_id,a.name AS activity_name,r.id AS rate_id,r.amount AS rate,r.currency
      FROM timesheet_entries e JOIN timesheets t ON t.id=e.timesheet_id AND t.status='approved' JOIN employees emp ON emp.id=t.employee_id
      JOIN projects p ON p.id=e.project_id JOIN activities a ON a.id=e.activity_id JOIN project_activity_assignments pa ON pa.project_id=p.id AND pa.activity_id=a.id AND pa.billable=TRUE
      JOIN project_billing_rates r ON r.project_id=p.id AND r.effective_from<=e.entry_date AND (r.effective_to IS NULL OR r.effective_to>=e.entry_date)
      ORDER BY e.entry_date,emp.id,e.id`)
    const invoiceSpecs=[['July 2026','ASTER','finalized'],['August 2026','HARBOR','finalized'],['September 2026','CEDAR','finalized'],['September 2026','MERIDIAN','finalized'],['October 2026','ASTER','ready'],['October 2026','HARBOR','draft']]
    for(let index=0;index<invoiceSpecs.length;index++) {
      const [label,clientCode,status]=invoiceSpecs[index], client=clients.get(clientCode)
      const lines=sources.filter(source=>source.period_label===label&&Number(source.client_id)===client.id).slice(0,Math.min(28,index<4?22:14))
      ensure(lines.length>0,`No eligible lines for ${label} ${clientCode}`)
      const invoiceId=await put(c,'INSERT INTO invoices (invoice_number,client_id,period_label,currency,status,created_by_user_id,finalized_by_user_id,ready_at,finalized_at) VALUES (?,?,?,?,?,?,?,?,?)',[
        `NS-DEMO-${202607+index}-${clientCode}`,client.id,label,client.currency,status,financeId,status==='finalized'?financeId:null,status==='draft'?null:'2026-10-22 13:00:00',status==='finalized'?'2026-10-22 14:00:00':null])
      let subtotal=0
      for(const line of lines) {
        const amount=Math.round(Number(line.hours)*Number(line.rate)*100)/100; subtotal+=amount
        await put(c,'INSERT INTO invoice_lines (invoice_id,timesheet_entry_id,billing_rate_id,project_id,entry_date,employee_name_snapshot,employee_code_snapshot,project_code_snapshot,project_name_snapshot,activity_name_snapshot,hours_snapshot,rate_snapshot,currency_snapshot,amount_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[
          invoiceId,line.id,line.rate_id,line.project_id,line.entry_date,line.employee_name,line.employee_code,line.project_code,line.project_name,line.activity_name,line.hours,line.rate,line.currency,amount])
      }
      await c.query('UPDATE invoices SET subtotal=? WHERE id=?',[subtotal,invoiceId])
      await put(c,'INSERT INTO finance_audit_events (actor_user_id,action,entity_type,entity_id,after_state) VALUES (?,?,?,?,?)',[financeId,status==='finalized'?'invoice_finalized':status==='ready'?'invoice_marked_ready':'invoice_draft_created','invoice',invoiceId,JSON.stringify({status,subtotal,currency:client.currency,lineCount:lines.length})])
    }
    for(let p=0;p<periods.length;p++) for(let d=0;d<departments.length;d++) {
      const [label]=periods[p], [code]=departments[d]
      if(p===3&&d>1) continue
      const status=p===3?(d===0?'submitted':'returned'):d===0&&p===2?'returned':d===1&&p===2?'submitted':'approved'
      const manager=managers[d]
      const submissionId=await put(c,'INSERT INTO department_submissions (department_id,period_label,status,submitted_by,decided_by,decided_at,return_reason) VALUES (?,?,?,?,?,?,?)',[
        depIds.get(code),label,status,manager.email,status==='submitted'?null:'elena.park@northstar.example',status==='submitted'?null:'2026-10-22 15:00:00',status==='returned'?'Please reconcile the department delivery summary before approval.':null])
      await put(c,'INSERT INTO audit_events (actor_name,actor_user_id,actor_role,action,target,entity_type,entity_id,after_state) VALUES (?,?,?,?,?,?,?,?)',[
        manager.name,manager.id,'manager','Department submitted for Director approval',`${code} - ${label}`,'department_submission',submissionId,JSON.stringify({status:'submitted'})])
      if(status!=='submitted') await put(c,'INSERT INTO audit_events (actor_name,actor_user_id,actor_role,action,target,entity_type,entity_id,after_state) VALUES (?,?,?,?,?,?,?,?)',[
        'Elena Park',directorId,'director',status==='approved'?'Department submission approved':'Department submission returned',`${code} - ${label}`,'department_submission',submissionId,JSON.stringify({status})])
    }
    for(const [title,message,recipient,read] of [
      ['Director review','Engineering October submission awaits a decision.','elena.park@northstar.example',null],
      ['Department returned','Quality Assurance October summary needs reconciliation.','elena.park@northstar.example','2026-10-22 16:00:00'],
      ['Billing queue','Approved October client work is ready for invoicing.','kabir.shah@northstar.example',null],
      ['Workforce update','Two reporting line changes were completed this quarter.','aisha.kapoor@northstar.example','2026-10-22 16:00:00'],
    ]) await put(c,'INSERT INTO notifications (title,message,notification_type,recipient_email,read_at) VALUES (?,?,?,?,?)',[title,message,'info',recipient,read])
    for(const employee of [employees[16],employees[34]]) await put(c,'INSERT INTO audit_events (actor_name,actor_user_id,actor_role,action,target,entity_type,entity_id,before_state,after_state) VALUES (?,?,?,?,?,?,?,?,?)',[
      'Aisha Kapoor',hrId,'hr','Employee reporting line updated',employee.name,'employee',employee.id,JSON.stringify({manager:'Interim lead'}),JSON.stringify({manager:employee.manager.name,department:employee.department})])
    await put(c,"INSERT INTO enterprise_demo_seed (seed_key) VALUES ('northstar-v1')")
    await c.commit()
    console.log('Enterprise demo seeded in pulseai_demo.')
  } catch(error) { await c.rollback(); throw error }
}
async function upgradeCurrentFinance(c) {
  await identity(c,database)
  const marker=await one(c,"SELECT seed_key FROM enterprise_demo_seed WHERE seed_key='northstar-finance-v2'")
  if(marker) return
  await c.beginTransaction()
  try {
    const finance=await one(c,"SELECT id FROM users WHERE email='kabir.shah@northstar.example'")
    const client=await one(c,"SELECT id,currency FROM clients WHERE code='CEDAR'")
    const [lines]=await c.query(`SELECT e.id,e.entry_date,e.hours,emp.name AS employee_name,emp.employee_code,p.id AS project_id,p.code AS project_code,p.name AS project_name,a.name AS activity_name,r.id AS rate_id,r.amount AS rate,r.currency
      FROM timesheet_entries e JOIN timesheets t ON t.id=e.timesheet_id AND t.status='approved' AND t.period_label='October 2026'
      JOIN employees emp ON emp.id=t.employee_id JOIN projects p ON p.id=e.project_id AND p.client_id=?
      JOIN activities a ON a.id=e.activity_id JOIN project_activity_assignments pa ON pa.project_id=p.id AND pa.activity_id=a.id AND pa.billable=TRUE
      JOIN project_billing_rates r ON r.project_id=p.id AND r.effective_from<=e.entry_date AND (r.effective_to IS NULL OR r.effective_to>=e.entry_date)
      LEFT JOIN invoice_lines il ON il.timesheet_entry_id=e.id WHERE il.id IS NULL ORDER BY e.entry_date,e.id LIMIT 20`,[client.id])
    ensure(lines.length>0,'No eligible current Cedar work for finalized invoice.')
    const invoiceId=await put(c,"INSERT INTO invoices (invoice_number,client_id,period_label,currency,status,created_by_user_id,finalized_by_user_id,ready_at,finalized_at) VALUES ('NS-DEMO-202610-CEDAR',?,'October 2026',?,'finalized',?,?,NOW(),NOW())",[client.id,client.currency,finance.id,finance.id])
    let subtotal=0
    for(const line of lines) {
      const amount=Math.round(Number(line.hours)*Number(line.rate)*100)/100;subtotal+=amount
      await put(c,'INSERT INTO invoice_lines (invoice_id,timesheet_entry_id,billing_rate_id,project_id,entry_date,employee_name_snapshot,employee_code_snapshot,project_code_snapshot,project_name_snapshot,activity_name_snapshot,hours_snapshot,rate_snapshot,currency_snapshot,amount_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[
        invoiceId,line.id,line.rate_id,line.project_id,line.entry_date,line.employee_name,line.employee_code,line.project_code,line.project_name,line.activity_name,line.hours,line.rate,line.currency,amount])
    }
    await c.query('UPDATE invoices SET subtotal=? WHERE id=?',[subtotal,invoiceId])
    await put(c,'INSERT INTO finance_audit_events (actor_user_id,action,entity_type,entity_id,after_state) VALUES (?,?,?,?,?)',[finance.id,'invoice_finalized','invoice',invoiceId,JSON.stringify({status:'finalized',subtotal,currency:client.currency,lineCount:lines.length})])
    await put(c,'INSERT INTO enterprise_demo_seed (seed_key) VALUES (?)',['northstar-finance-v2'])
    await c.commit()
    console.log('Current period finalized billing added.')
  } catch(error) { await c.rollback();throw error }
}
async function upgradeWorkforceDetails(c) {
  await identity(c,database)
  if(await one(c,"SELECT seed_key FROM enterprise_demo_seed WHERE seed_key='northstar-workforce-v3'")) return
  const [columns]=await c.query("SHOW COLUMNS FROM employees LIKE 'job_title'")
  if(!columns.length) await c.query('ALTER TABLE employees ADD COLUMN job_title VARCHAR(120) NULL')
  await c.beginTransaction()
  try {
    for(let d=0;d<departments.length;d++) for(let n=0;n<7;n++) {
      await c.query('UPDATE employees SET job_title=? WHERE employee_code=?',[titles[d][n],`NS${String(d*7+n+1).padStart(3,'0')}`])
    }
    const hr=await one(c,"SELECT id,name FROM users WHERE email='aisha.kapoor@northstar.example'")
    for(const [code,fromDepartment,toDepartment,fromManager,toManager] of [
      ['NS015','Operations','Product','Nikhil Rao','Ritu Sen'],
      ['NS036','Operations','Finance','Nikhil Rao','Omar Sethi'],
    ]) {
      const employee=await one(c,'SELECT id,name FROM employees WHERE employee_code=?',[code])
      await put(c,'INSERT INTO audit_events (actor_name,actor_user_id,actor_role,action,target,entity_type,entity_id,before_state,after_state) VALUES (?,?,?,?,?,?,?,?,?)',[
        hr.name,hr.id,'hr','Employee transferred',`${employee.name} · effective 2026-06-15`,'employee',employee.id,
        JSON.stringify({department:fromDepartment,manager:fromManager}),JSON.stringify({department:toDepartment,manager:toManager,effectiveDate:'2026-06-15'})])
    }
    await put(c,'INSERT INTO enterprise_demo_seed (seed_key) VALUES (?)',['northstar-workforce-v3'])
    await c.commit()
    console.log('Demo job titles and historical transfer events added.')
  } catch(error) { await c.rollback();throw error }
}
async function alignHistoricalDates(c) {
  await identity(c,database)
  if(await one(c,"SELECT seed_key FROM enterprise_demo_seed WHERE seed_key='northstar-history-v4'")) return
  await c.beginTransaction()
  try {
    await c.query("UPDATE users SET created_at='2026-06-01 10:00:00' WHERE email LIKE '%@northstar.example'")
    await c.query("UPDATE clients SET created_at='2026-06-10 10:00:00',updated_at='2026-06-10 10:00:00' WHERE code IN ('ASTER','HARBOR','CEDAR','MERIDIAN')")
    await c.query("UPDATE projects SET created_at='2026-06-15 10:00:00',updated_at='2026-06-15 10:00:00' WHERE code IN (?)",[projectDefs.map(item=>item[0])])
    await c.query("UPDATE project_billing_rates SET created_at=DATE_SUB(effective_from,INTERVAL 5 DAY)")
    await c.query("UPDATE timesheet_entries e JOIN timesheets t ON t.id=e.timesheet_id SET e.created_at=CONCAT(e.entry_date,' 18:00:00'),e.updated_at=CONCAT(e.entry_date,' 18:00:00') WHERE t.period_label<>'October 2026'")
    await c.query("UPDATE timesheets SET updated_at=COALESCE(approved_at,submitted_at) WHERE period_label<>'October 2026'")
    await c.query(`UPDATE timesheet_audit_events a JOIN timesheets t ON t.id=a.timesheet_id JOIN reporting_periods r ON r.id=t.reporting_period_id
      SET a.created_at=CASE a.event_type WHEN 'draft_saved' THEN DATE_SUB(r.ends_on,INTERVAL 4 DAY)
      WHEN 'submitted' THEN r.ends_on WHEN 'approved' THEN DATE_ADD(r.ends_on,INTERVAL 3 DAY)
      ELSE DATE_ADD(r.ends_on,INTERVAL 1 DAY) END WHERE t.period_label<>'October 2026'`)
    await c.query(`UPDATE invoices i JOIN reporting_periods r ON r.label=i.period_label
      SET i.created_at=DATE_ADD(r.ends_on,INTERVAL 2 DAY),i.ready_at=DATE_ADD(r.ends_on,INTERVAL 3 DAY),i.finalized_at=DATE_ADD(r.ends_on,INTERVAL 4 DAY)
      WHERE i.period_label<>'October 2026' AND i.status='finalized'`)
    await c.query("UPDATE finance_audit_events f JOIN invoices i ON i.id=f.entity_id AND f.entity_type='invoice' SET f.created_at=i.finalized_at WHERE i.period_label<>'October 2026'")
    await c.query(`UPDATE department_submissions s JOIN reporting_periods r ON r.label=s.period_label
      SET s.submitted_at=DATE_ADD(r.ends_on,INTERVAL 3 DAY),s.decided_at=CASE WHEN s.status='submitted' THEN NULL ELSE DATE_ADD(r.ends_on,INTERVAL 4 DAY) END
      WHERE s.period_label<>'October 2026'`)
    await c.query(`UPDATE audit_events a JOIN department_submissions s ON s.id=a.entity_id AND a.entity_type='department_submission'
      SET a.created_at=CASE WHEN a.action LIKE '%submitted%' THEN s.submitted_at ELSE s.decided_at END WHERE s.period_label<>'October 2026'`)
    await c.query("UPDATE audit_events SET created_at='2026-06-15 12:00:00' WHERE action='Employee transferred' AND target LIKE '%effective 2026-06-15%'")
    await put(c,'INSERT INTO enterprise_demo_seed (seed_key) VALUES (?)',['northstar-history-v4'])
    await c.commit()
    console.log('Historical timestamps aligned with reporting periods.')
  } catch(error) { await c.rollback();throw error }
}
async function addManagerHistory(c) {
  await identity(c,database)
  if(await one(c,"SELECT seed_key FROM enterprise_demo_seed WHERE seed_key='northstar-manager-history-v5'")) return
  await c.beginTransaction()
  try {
    const periodId=await put(c,"INSERT INTO reporting_periods (label,starts_on,ends_on,submission_deadline,standard_daily_hours,active) VALUES ('June 2026','2026-06-01','2026-06-30','2026-07-05',8,TRUE)")
    const activity=await one(c,"SELECT id FROM activities WHERE name='Team operations' AND category='internal'")
    for(let d=0;d<departments.length;d++) for(let n=0;n<2;n++) {
      const code=`NS${String(d*7+n+1).padStart(3,'0')}`
      const employee=await one(c,'SELECT id,name,user_id,manager_user_id FROM employees WHERE employee_code=?',[code])
      const status=n===0?'submitted':'returned'
      const timesheetId=await put(c,"INSERT INTO timesheets (employee_id,reporting_period_id,period_label,total_hours,status,submitted_at,returned_at,reviewer_user_id,assigned_manager_user_id,return_reason,remarks,version) VALUES (?,?,'June 2026',0,?,'2026-06-30 09:00:00',?,?,?,?,?,3)",[
        employee.id,periodId,status,status==='returned'?'2026-07-02 10:00:00':null,status==='returned'?employee.manager_user_id:null,employee.manager_user_id,
        status==='returned'?'Please add the missing operational handoff notes before resubmitting.':null,'June internal operations and onboarding work.'])
      const entries=dateList('2026-06-01','2026-06-15').slice(0,n===0?11:8).map(day=>[timesheetId,day,activity.id,7.5,'Completed team onboarding, support handoff, and process documentation.'])
      await c.query('INSERT INTO timesheet_entries (timesheet_id,entry_date,activity_id,hours,work_description) VALUES ?',[entries])
      await c.query('UPDATE timesheets SET total_hours=?,updated_at=? WHERE id=?',[entries.length*7.5,status==='returned'?'2026-07-02 10:00:00':'2026-06-30 09:00:00',timesheetId])
      for(const [event,actor,detail,date] of [
        ['draft_saved',employee.user_id,'June internal work recorded.','2026-06-15 18:00:00'],
        ['submitted',employee.user_id,'Submitted June internal work.','2026-06-30 09:00:00'],
        ...(status==='returned'?[['returned',employee.manager_user_id,'Operational handoff notes are incomplete.','2026-07-02 10:00:00']]:[]),
      ]) await put(c,'INSERT INTO timesheet_audit_events (timesheet_id,actor_user_id,event_type,detail,created_at) VALUES (?,?,?,?,?)',[timesheetId,actor,event,detail,date])
      if(status==='returned') await put(c,"INSERT INTO validation_findings (timesheet_id,severity,finding_type,message,created_at) VALUES (?,'warning','missing_workdays',?,'2026-07-02 10:00:00')",[timesheetId,'June handoff workdays have no recorded time.'])
    }
    await put(c,'INSERT INTO enterprise_demo_seed (seed_key) VALUES (?)',['northstar-manager-history-v5'])
    await c.commit()
    console.log('All Managers have historical submitted and returned work.')
  } catch(error) { await c.rollback();throw error }
}
async function addNovemberPeriod(c) {
  await identity(c,database)
  if(await one(c,"SELECT seed_key FROM enterprise_demo_seed WHERE seed_key='northstar-november-2026-v1'")) return
  await c.beginTransaction()
  try {
    const label='November 2026'
    let period=await one(c,'SELECT id FROM reporting_periods WHERE label=?',[label])
    if(!period) {
      const id=await put(c,'INSERT INTO reporting_periods (label,starts_on,ends_on,submission_deadline,standard_daily_hours,active) VALUES (?,?,?,?,8,TRUE)',[label,'2026-11-01','2026-11-30','2026-12-05'])
      period={id}
    }
    if(!await one(c,'SELECT id FROM billing_cycles WHERE period_label=?',[label])) {
      await put(c,'INSERT INTO billing_cycles (period_label,starts_on,ends_on,submission_deadline,current_stage) VALUES (?,?,?,?,?)',[label,'2026-11-01','2026-11-30','2026-12-05','manager_submission'])
    }
    const [employees]=await c.query('SELECT id,name,email,user_id,manager_user_id,department_id FROM employees WHERE employee_code LIKE ? AND active=TRUE ORDER BY employee_code',['NS%'])
    const activity=await one(c,"SELECT id FROM activities WHERE name='Team operations' AND category='internal'")
    ensure(activity,'Demo team operations activity is missing.')
    for(let index=0;index<employees.length;index++) {
      const employee=employees[index]
      if(await one(c,'SELECT id FROM timesheets WHERE employee_id=? AND reporting_period_id=?',[employee.id,period.id])) continue
      const onCall=index%7===0
      const status=onCall?'submitted':'draft'
      const timesheetId=await put(c,'INSERT INTO timesheets (employee_id,reporting_period_id,period_label,total_hours,status,submitted_at,assigned_manager_user_id,remarks,version) VALUES (?,?,?,?,?,?,?,?,?)',[
        employee.id,period.id,label,onCall?3:0,status,onCall?'2026-11-01 17:00:00':null,employee.manager_user_id,
        onCall?'November month-opening support and team handoff.':'Ready for November daily work entries.',onCall?2:1,
      ])
      if(onCall) {
        await put(c,'INSERT INTO timesheet_entries (timesheet_id,entry_date,activity_id,hours,work_description) VALUES (?,?,?,?,?)',[timesheetId,'2026-11-01',activity.id,3,'Handled month-opening on-call support and documented the team handoff.'])
        await put(c,'INSERT INTO timesheet_audit_events (timesheet_id,actor_user_id,event_type,detail,created_at) VALUES (?,?,?,?,?)',[timesheetId,employee.user_id,'submitted','Submitted November on-call work for Manager review.','2026-11-01 17:00:00'])
      }
    }
    await put(c,'INSERT INTO enterprise_demo_seed (seed_key) VALUES (?)',['northstar-november-2026-v1'])
    await c.commit()
    console.log('November reporting period and on-call work prepared.')
  } catch(error) { await c.rollback();throw error }
}
async function addNovemberFinance(c) {
  await identity(c,database)
  if(await one(c,"SELECT seed_key FROM enterprise_demo_seed WHERE seed_key='northstar-november-finance-v2'")) return
  await c.beginTransaction()
  try {
    const finance=await one(c,"SELECT id FROM users WHERE email='kabir.shah@northstar.example'")
    const activity=await one(c,"SELECT id,name FROM activities WHERE name='Client delivery' AND category='project'")
    ensure(finance&&activity,'Demo finance account or project activity is missing.')
    const specs=[
      ['NS001','ASTER-PORTAL','draft'],
      ['NS008','HARBOR-QA','ready'],
      ['NS015','HARBOR-INSIGHTS','finalized'],
      ['NS022','CEDAR-WORKFLOW',null],
    ]
    for(const [employeeCode,projectCode,invoiceStatus] of specs) {
      const row=await one(c,`SELECT t.id AS timesheet_id,t.status,e.name AS employee_name,e.employee_code,e.manager_user_id,
        p.id AS project_id,p.code AS project_code,p.name AS project_name,p.client_id,
        cl.code AS client_code,cl.currency,r.id AS rate_id,r.amount AS rate
        FROM timesheets t JOIN employees e ON e.id=t.employee_id
        JOIN projects p ON p.code=? JOIN clients cl ON cl.id=p.client_id
        JOIN project_billing_rates r ON r.project_id=p.id AND r.effective_from<='2026-11-01' AND (r.effective_to IS NULL OR r.effective_to>='2026-11-01')
        WHERE e.employee_code=? AND t.period_label='November 2026' LIMIT 1`,[projectCode,employeeCode])
      ensure(row&&row.status==='submitted',`Expected submitted November work for ${employeeCode}.`)
      const entryId=await put(c,'INSERT INTO timesheet_entries (timesheet_id,entry_date,project_id,activity_id,hours,work_description) VALUES (?,?,?,?,?,?)',[
        row.timesheet_id,'2026-11-01',row.project_id,activity.id,5,`Completed month-opening client delivery and documented the ${projectCode} handoff.`])
      await c.query("UPDATE timesheets SET total_hours=8,status='approved',approved_at='2026-11-01 18:00:00',reviewer_user_id=?,version=version+1 WHERE id=?",[row.manager_user_id,row.timesheet_id])
      await put(c,'INSERT INTO timesheet_audit_events (timesheet_id,actor_user_id,event_type,detail,created_at) VALUES (?,?,?,?,?)',[
        row.timesheet_id,row.manager_user_id,'approved','November month-opening work approved.','2026-11-01 18:00:00'])
      if(invoiceStatus) {
        const invoiceNumber=`NS-DEMO-202611-OVERVIEW-${row.project_code}`
        const invoiceId=await put(c,'INSERT INTO invoices (invoice_number,client_id,period_label,currency,status,subtotal,created_by_user_id,finalized_by_user_id,ready_at,finalized_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[
          invoiceNumber,row.client_id,'November 2026',row.currency,invoiceStatus,5*Number(row.rate),finance.id,
          invoiceStatus==='finalized'?finance.id:null,invoiceStatus==='draft'?null:'2026-11-01 18:30:00',invoiceStatus==='finalized'?'2026-11-01 19:00:00':null])
        await put(c,'INSERT INTO invoice_lines (invoice_id,timesheet_entry_id,billing_rate_id,project_id,entry_date,employee_name_snapshot,employee_code_snapshot,project_code_snapshot,project_name_snapshot,activity_name_snapshot,hours_snapshot,rate_snapshot,currency_snapshot,amount_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[
          invoiceId,entryId,row.rate_id,row.project_id,'2026-11-01',row.employee_name,row.employee_code,row.project_code,row.project_name,activity.name,5,row.rate,row.currency,5*Number(row.rate)])
        await put(c,'INSERT INTO finance_audit_events (actor_user_id,action,entity_type,entity_id,after_state) VALUES (?,?,?,?,?)',[
          finance.id,invoiceStatus==='draft'?'invoice_draft_created':invoiceStatus==='ready'?'invoice_marked_ready':'invoice_finalized','invoice',invoiceId,JSON.stringify({status:invoiceStatus,subtotal:5*Number(row.rate),currency:row.currency,lineCount:1})])
      }
    }
    await put(c,'INSERT INTO notifications (title,message,notification_type,recipient_email) VALUES (?,?,?,?)',[
      'November billing work ready','Approved November client work and sample invoices are ready for Finance review.','info','kabir.shah@northstar.example'])
    await put(c,'INSERT INTO enterprise_demo_seed (seed_key) VALUES (?)',['northstar-november-finance-v2'])
    await c.commit()
    console.log('November Finance overview and invoice pipeline prepared.')
  } catch(error) { await c.rollback();throw error }
}
async function main() {
  const env=demoEnvironment()
  ensure(['127.0.0.1','localhost','::1'].includes(env.DB_HOST||'127.0.0.1'),'Demo database creation is limited to local MySQL.')
  const bootstrap=await mysql.createConnection(config(env))
  try { await identity(bootstrap,null); await bootstrap.query('CREATE DATABASE IF NOT EXISTS `pulseai_demo`') }
  finally { await bootstrap.end() }
  const c=await mysql.createConnection({ ...config(env,database), dateStrings:true })
  try {
    await identity(c,database)
    const tables=Number((await one(c,"SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='timesheets'")).count)
    if(!tables) await schema(env)
    await seed(c,env); await upgradeCurrentFinance(c); await upgradeWorkforceDetails(c); await alignHistoricalDates(c); await addManagerHistory(c); await addNovemberPeriod(c); await addNovemberFinance(c)
  }
  finally { await c.end() }
}
main().catch(error=>{ console.error(error); process.exitCode=1 })
