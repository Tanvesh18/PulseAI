import { useCallback, useEffect, useRef, useState } from 'react'
import './director.css'
import './director-refine.css'
import './director-ops.css'
import { AlertTriangle, Bell, CircleAlert, Clock3, FileClock, Flag, Info, LayoutDashboard, LogOut, type LucideIcon, X } from 'lucide-react'

type User = { name: string; email: string; role: 'director' }
type Tab = 'overview' | 'exceptions' | 'reports' | 'audit'
const api = (path: string, token: string) => fetch(`/api/director${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => {
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Unable to load data.')
  return data
})

export function DirectorDashboard({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [dashboard, setDashboard] = useState<any>(null)
  const [data, setData] = useState<any>(null)
  const [selectedDepartment, setSelectedDepartment] = useState<any>(null)
  const [error, setError] = useState('')
  const token = localStorage.getItem('pulseai_token') || ''

  const loadDashboard = useCallback(() => api('/dashboard', token).then((result) => { setDashboard(result); setError('') }).catch((err) => setError(err.message)), [token])
  useEffect(() => { loadDashboard() }, [loadDashboard])
  useEffect(() => {
    if (tab === 'overview') return
    const routes: Record<Exclude<Tab, 'overview'>, string> = { exceptions: '/exceptions', reports: '/reports', audit: '/audit-events' }
    api(routes[tab], token).then(setData).catch((err) => setError(err.message))
  }, [tab, token])

  const openDepartment = async (id: number) => { try { setSelectedDepartment(await api(`/departments/${id}`, token)) } catch (err) { setError(err instanceof Error ? err.message : 'Unable to open department.') } }
  const metrics = dashboard?.metrics || {}
  const nav: Array<[Tab, string, LucideIcon]> = [['overview', 'Overview', LayoutDashboard], ['exceptions', 'Exceptions', AlertTriangle], ['reports', 'Reports', Flag], ['audit', 'Audit trail', Clock3]]

  return <main className="director-app">
    <aside className="director-sidebar"><div className="director-logo"><span>P</span> pulse<span>AI</span></div><p className="workspace-label">DIRECTOR WORKSPACE</p>
      <nav>{nav.map(([id, label, Icon]) => <button className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setSelectedDepartment(null) }} key={id}><b><Icon size={17} /></b>{label}{id === 'exceptions' && metrics.exceptions > 0 && <i>{metrics.exceptions}</i>}</button>)}</nav>
      <div className="sidebar-footer"><div className="avatar">{user.name[0]}</div><div><strong>{user.name}</strong><small>Director</small></div><button onClick={onSignOut} aria-label="Sign out"><LogOut size={16} /></button></div>
    </aside>
    <section className="director-content"><header className="content-header"><div><h1>{tab === 'overview' ? 'Executive overview' : tab[0].toUpperCase() + tab.slice(1)}</h1><p className="header-subtitle">{dashboard?.period || 'Current reporting period'} snapshot</p></div><div className="notification-status" aria-label={`${dashboard?.notifications?.length || 0} unread notifications`}><Bell size={18} /><span>{dashboard?.notifications?.length || 0}</span></div></header>
      {error && <div className="director-error"><span>{error}</span><button onClick={loadDashboard}>Try again</button></div>}
      {!dashboard && !error && <div className="director-loading">Loading your organization workspace…</div>}
      {tab === 'overview' && dashboard && <Overview dashboard={dashboard} onDepartment={openDepartment} />}
      {tab === 'exceptions' && <Exceptions rows={data?.exceptions || []} />}
      {tab === 'reports' && <Reports data={data} onDepartment={openDepartment} />}
      {tab === 'audit' && <Audit events={data?.events || []} />}
      {selectedDepartment && <DepartmentPanel data={selectedDepartment} onClose={() => setSelectedDepartment(null)} />}
    </section>
  </main>
}

function Overview({ dashboard, onDepartment }: { dashboard: any; onDepartment: (id: number) => void }) {
  const metrics: Array<[string, number]> = [['Active employees', dashboard.metrics.employees], ['Approved', dashboard.metrics.approved], ['Awaiting action', dashboard.metrics.pending], ['Open exceptions', dashboard.metrics.exceptions]]
  return <><dl className="metrics-strip">{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <section className="action-ledger"><div className="section-heading"><div><h2>Exceptions requiring review</h2><p>Priority items across the current reporting period</p></div><span>{dashboard.exceptions.length} open</span></div>{dashboard.exceptions.length ? <div className="exception-list">{dashboard.exceptions.map((item: any) => <article className="exception-row" key={item.id}><span className={`exception-marker ${item.severity}`} aria-label={item.severity}>{item.severity === 'critical' ? <CircleAlert size={16} /> : <Info size={16} />}</span><div className="exception-person"><strong>{item.employeeName}</strong><small>{item.department}</small></div><p>{item.message}</p><span className={`workflow-state ${item.status}`}>{item.status}</span></article>)}</div> : <p className="empty-copy">No open workflow exceptions for this reporting period.</p>}</section>
    <section className="compliance-section"><div className="section-heading"><div><h2>Department compliance</h2><p>Submission and approval position by team</p></div><span>September 2026</span></div><DepartmentTable rows={dashboard.departments} onDepartment={onDepartment} /></section>
    <section className="notifications-section"><div className="section-heading"><div><h2>Notifications</h2></div><span>{dashboard.notifications.length} unread</span></div>{dashboard.notifications.length ? dashboard.notifications.map((notice: any) => <div className="notice" key={notice.id}><span className={`notice-dot ${notice.type}`} /><div><strong>{notice.title}</strong><p>{notice.message}</p></div></div>) : <p className="empty-copy">No unread notifications.</p>}</section></>
}

function DepartmentTable({ rows, onDepartment }: { rows: any[]; onDepartment: (id: number) => void }) { return <div className="table-wrap"><table className="compliance-table"><thead><tr><th>Department</th><th>Headcount</th><th>Approved</th><th>Awaiting</th><th>Exceptions</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map((row) => { const status = row.flaggedCount > 0 ? 'Needs review' : row.pendingCount > 0 ? 'In progress' : 'Complete'; const tone = row.flaggedCount > 0 ? 'review' : row.pendingCount > 0 ? 'progress' : 'complete'; return <tr key={row.id}><td><strong>{row.name}</strong><small>{row.code}</small></td><td>{row.employeeCount}</td><td>{row.approvedCount}</td><td>{row.pendingCount}</td><td>{row.flaggedCount || '—'}</td><td><span className={`table-state ${tone}`}>{status}</span></td><td><button className="table-action" onClick={() => onDepartment(row.id)}>Review team</button></td></tr> })}</tbody></table></div> }
function Exceptions({ rows }: { rows: any[] }) { return <section className="director-card full-table"><div className="card-heading"><div><h2>Open exceptions</h2><p>Items needing leadership visibility or escalation</p></div></div><div className="table-wrap"><table><thead><tr><th>Severity</th><th>Employee</th><th>Department</th><th>Hours</th><th>Issue</th><th>Workflow status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className={`severity-label ${row.severity}`}>{row.severity}</span></td><td><strong>{row.employeeName}</strong><small>{row.employeeCode}</small></td><td>{row.department}</td><td>{row.hours || '—'}</td><td>{row.message}</td><td><span className="status-pill">{row.status}</span></td></tr>)}</tbody></table></div></section> }
function Reports({ data, onDepartment }: { data: any; onDepartment: (id: number) => void }) { const rows = data?.departments || []; const max = Math.max(...rows.map((x: any) => Number(x.averageHours)), 1); return <><section className="report-intro"><div><h2>{data?.period || 'September 2026'} performance</h2></div><span className="period-chip">Reporting period</span></section><section className="director-card chart-card"><h2>Average reported hours</h2><div className="bar-chart">{rows.map((row: any) => <button onClick={() => onDepartment(row.id)} key={row.id} aria-label={`Open ${row.name} department`}><i style={{ height: `${Math.max(8, Number(row.averageHours) / max * 100)}%` }} /><strong>{row.averageHours}</strong><span>{row.name}</span></button>)}</div></section><section className="director-card full-table"><DepartmentTable rows={rows.map((row: any) => ({ ...row, employeeCount: row.employees, approvedCount: row.approved, pendingCount: row.pending, flaggedCount: 0, code: 'REPORT' }))} onDepartment={onDepartment} /></section></> }
function Audit({ events }: { events: any[] }) { return <section className="director-card audit-card"><div className="card-heading"><div><h2>Audit trail</h2><p>Recent material actions from the workforce workflow</p></div></div>{events.length ? events.map((event) => <div className="audit-row" key={event.id}><span><FileClock size={15} /></span><div><strong>{event.action}</strong><p>{event.target}</p><small>{event.actor} · {new Date(event.createdAt).toLocaleString()}</small></div></div>) : <p className="empty-copy">No audit events are available for this period.</p>}</section> }
function DepartmentPanel({ data, onClose }: { data: any; onClose: () => void }) { const closeRef = useRef<HTMLButtonElement>(null); useEffect(() => { closeRef.current?.focus(); const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onClose]); return <div className="panel-overlay"><aside className="department-panel" role="dialog" aria-modal="true" aria-labelledby="department-title"><button className="panel-close" ref={closeRef} onClick={onClose} aria-label="Close department details"><X size={18} /></button><p className="panel-label">Department drill-down</p><h2 id="department-title">{data.department.name}</h2><p className="header-subtitle">{data.department.code} · September 2026</p><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Manager</th><th>Hours</th><th>Status</th></tr></thead><tbody>{data.employees.map((employee: any) => <tr key={employee.employeeCode}><td><strong>{employee.name}</strong><small>{employee.employeeCode}</small></td><td>{employee.managerName}</td><td>{employee.hours ?? '—'}</td><td><span className="status-pill">{employee.status || 'No entry'}</span></td></tr>)}</tbody></table></div></aside></div> }
