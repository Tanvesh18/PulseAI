import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Check, ClipboardCheck, LogOut, RotateCcw } from 'lucide-react'
import './employee.css'

type User = { name: string; email: string; role: 'manager' }
const api = (path: string, token: string, method = 'GET', body?: object) => fetch(`/api/manager${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Unable to update timesheet.'); return data })

export function ManagerDashboard({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const token = localStorage.getItem('pulseai_token') || ''
  const [rows, setRows] = useState<any[]>([]); const [selected, setSelected] = useState<any>(null); const [reason, setReason] = useState(''); const [message, setMessage] = useState('')
  const load = useCallback(() => api('/timesheets', token).then(data => setRows(data.timesheets)).catch(error => setMessage(error.message)), [token])
  useEffect(() => { load() }, [load])
  const backToQueue = () => { setSelected(null); setReason(''); load() }
  const open = async (row: any) => { try { setSelected(await api(`/timesheets/${row.id}`, token)) } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to open timesheet.') } }
  const decide = async (decision: 'approve' | 'return') => { if (!selected) return; try { const result = await api(`/timesheets/${selected.timesheet.id}/${decision}`, token, 'POST', { version: selected.timesheet.version, ...(decision === 'return' ? { reason } : {}) }); setMessage(result.message); backToQueue() } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save decision.') } }
  return <main className="employee-app">
    <aside className="employee-sidebar">
      <div className="employee-logo"><span>P</span> pulse<span>AI</span></div><p>MANAGER WORKSPACE</p>
      <nav><button className="active" onClick={backToQueue}><ClipboardCheck size={17} />Review queue</button></nav>
      <div className="employee-user"><span>{user.name[0]}</span><div><strong>{user.name}</strong><small>Manager</small></div><button onClick={onSignOut} aria-label="Sign out"><LogOut size={16} /></button></div>
    </aside>
    <section className="employee-content">
      <header className="employee-header"><div><h1>{selected ? 'Review timesheet' : 'Review queue'}</h1><p>{selected ? 'Review entries before making a decision.' : 'Submitted timesheets from your assigned team'}</p></div>{selected ? <button className="employee-secondary manager-header-back" onClick={backToQueue}><ArrowLeft size={16} />Back to queue</button> : null}</header>
      {message && <div className="employee-message" role="status">{message}<button onClick={() => setMessage('')} aria-label="Dismiss message">x</button></div>}
      {selected ? <Review timesheet={selected} reason={reason} onReason={setReason} onBack={backToQueue} onDecide={decide} /> : <Queue rows={rows} onOpen={open} />}
    </section>
  </main>
}

function Queue({ rows, onOpen }: { rows: any[]; onOpen: (row: any) => void }) { return <section className="manager-queue"><div className="employee-section-heading"><h2>Awaiting your decision</h2><span>{rows.length} submitted</span></div>{rows.length ? <div className="history-table">{rows.map(row => <article key={row.id}><div><strong>{row.employeeName}</strong><span>{row.employeeCode} - {row.department}</span></div><b>{Number(row.totalHours).toFixed(1)}h</b><span className={`employee-state ${row.status}`}>{row.status}</span><button className="employee-secondary" onClick={() => onOpen(row)}>Review</button></article>)}</div> : <div className="overview-empty"><strong>Your review queue is clear</strong><p>Submitted timesheets from employees assigned to you will appear here.</p></div>}</section> }

function Review({ timesheet: data, reason, onReason, onBack, onDecide }: { timesheet: any; reason: string; onReason: (value: string) => void; onBack: () => void; onDecide: (decision: 'approve' | 'return') => void }) { const sheet = data.timesheet; return <section className="manager-review"><button className="back-link" onClick={onBack}><ArrowLeft size={15} />Back to queue</button><div className="editor-heading"><div><span className={`employee-state ${sheet.status}`}>{sheet.status}</span><h2>{sheet.employeeName}</h2><p>{sheet.employeeCode} - {sheet.periodLabel}</p></div><strong>{Number(sheet.totalHours).toFixed(1)} hours</strong></div><div className="employee-table-wrap"><table><thead><tr><th>Date</th><th>Project / activity</th><th>Hours</th><th>Description</th></tr></thead><tbody>{data.entries.map((entry: any, index: number) => <tr key={index}><td>{entry.entryDate}</td><td><strong>{entry.projectCode || 'Internal'}</strong><small>{entry.activityName}</small></td><td>{entry.hours}</td><td>{entry.workDescription || '-'}</td></tr>)}</tbody></table></div><div className="manager-decision"><label>Return reason<textarea value={reason} onChange={event => onReason(event.target.value)} placeholder="Required only if returning this timesheet." maxLength={500} /></label><div><button className="employee-secondary" disabled={!reason.trim()} onClick={() => onDecide('return')}><RotateCcw size={16} />Return for correction</button><button className="employee-primary" onClick={() => onDecide('approve')}><Check size={16} />Approve timesheet</button></div></div></section> }
