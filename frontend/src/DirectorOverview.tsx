import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, FileText, ReceiptText, Users, WalletCards } from 'lucide-react'

type Tab = 'overview' | 'approvals' | 'exceptions' | 'reports' | 'audit'
type Props = { dashboard: any; financial: any; auditEvents: any[]; onDepartment: (id: number, trigger: HTMLElement) => void; onNavigate: (tab: Tab) => void }

type HealthKey = 'draft' | 'submitted' | 'returned' | 'approved'
const healthLabels: Array<[HealthKey, string]> = [['draft', 'Draft'], ['submitted', 'Submitted'], ['returned', 'Returned'], ['approved', 'Approved']]

export function DirectorOverview({ dashboard, financial, auditEvents, onDepartment, onNavigate }: Props) {
  const metrics = dashboard.metrics || {}
  const employeeCount = Number(metrics.employees || 0)
  const distribution = metrics.timesheetDistribution || { draft: 0, submitted: 0, returned: 0, approved: 0 }
  const coveredCount = Number(metrics.completedCount || 0)
  const completionRate = employeeCount ? Math.round(coveredCount / employeeCount * 100) : 0
  const approvedHours = Number(metrics.approvedHours || 0)
  const totalHours = Number(metrics.totalHours || 0)
  const finalizedInvoices = (financial?.invoices || []).reduce((total: number, item: any) => total + Number(item.count || 0), 0)
  const finalizedAmounts = summarizeCurrencies(financial?.invoices || [])
  const billedHours = (financial?.hours || []).reduce((total: number, item: any) => total + Number(item.billed || 0), 0)
  const unbilledHours = (financial?.hours || []).reduce((total: number, item: any) => total + Number(item.unbilled || 0), 0)
  const openExceptions = Number(metrics.exceptions || 0)

  return <div className="director-overview">
    <section className="overview-summary" aria-labelledby="summary-title">
      <div className="overview-section-heading"><div><span className="overview-kicker">Executive readout</span><h2 id="summary-title">Organizational health</h2><p>{dashboard.period} · the few numbers that need a Director’s attention first.</p></div><span className="overview-period">Live current period</span></div>
      <div className="summary-grid">
        <SummaryMetric icon={<Users size={17} />} label="Active workforce" value={employeeCount.toLocaleString()} detail="active employee records" />
        <SummaryMetric icon={<Clock3 size={17} />} label="Recorded hours" value={formatHours(totalHours)} detail={`${formatHours(approvedHours)} approved`} />
        <SummaryMetric icon={<CheckCircle2 size={17} />} label="Completion" value={`${completionRate}%`} detail={`${coveredCount} of ${employeeCount} records covered`} />
        <SummaryMetric icon={<ReceiptText size={17} />} label="Finalized billing" value={String(finalizedInvoices)} detail={finalizedAmounts || 'no finalized invoices'} />
      </div>
    </section>

    <div className="overview-primary-grid">
      <section className="overview-section health-section" aria-labelledby="health-title">
        <div className="overview-section-heading"><div><span className="overview-kicker">Timesheet health</span><h2 id="health-title">Current distribution</h2><p>Every active employee in the current reporting period.</p></div><span className="section-total">{employeeCount} records</span></div>
        <HealthBar distribution={distribution} total={employeeCount} />
      </section>
      <section className="overview-section attention-section" aria-labelledby="attention-title">
        <div className="overview-section-heading"><div><span className="overview-kicker">Needs attention</span><h2 id="attention-title">Open work</h2></div><button type="button" className="text-action" onClick={() => onNavigate('exceptions')}>View all <ArrowUpRight size={14} /></button></div>
        <div className="attention-summary"><strong>{openExceptions}</strong><span>open exceptions</span><span className="attention-divider" /><strong>{Number(metrics.pending || 0)}</strong><span>awaiting action</span></div>
        <div className="overview-attention-list">{dashboard.exceptions?.length ? dashboard.exceptions.slice(0, 4).map((item: any) => <button type="button" className="overview-attention-row" key={item.id} onClick={() => onNavigate('exceptions')}><span className={`attention-dot ${item.severity}`}><AlertTriangle size={14} /></span><span><strong>{item.employeeName}</strong><small>{item.message}</small></span><ArrowUpRight size={15} /></button>) : <p className="overview-empty">No open exceptions for this period.</p>}</div>
      </section>
    </div>

    <section className="overview-section department-section" aria-labelledby="department-title">
      <div className="overview-section-heading"><div><span className="overview-kicker">Department performance</span><h2 id="department-title">Coverage by team</h2><p>Submitted coverage and approved records across active departments.</p></div><button type="button" className="text-action" onClick={() => onNavigate('reports')}>Open reports <ArrowUpRight size={14} /></button></div>
      <div className="department-compact-table" role="table" aria-label="Department performance"><div className="department-compact-row department-compact-header" role="row"><span>Department</span><span>People</span><span>Coverage</span><span>Approved</span><span>Exceptions</span><span /></div>{(dashboard.departments || []).map((row: any) => <DepartmentRow row={row} key={row.id} onDepartment={onDepartment} />)}</div>
    </section>

    <div className="overview-secondary-grid">
      <section className="overview-section finance-section" aria-labelledby="finance-title">
        <div className="overview-section-heading"><div><span className="overview-kicker">Financial snapshot</span><h2 id="finance-title">Approved work to billing</h2></div><WalletCards size={18} className="section-icon" /></div>
        <div className="finance-summary-grid"><div><strong>{formatHours(billedHours + unbilledHours)}</strong><span>approved billable hours</span></div><div><strong>{formatHours(unbilledHours)}</strong><span>uninvoiced approved hours</span></div></div>
        <div className="finance-ledger"><div><span>Finalized invoices</span><strong>{finalizedInvoices}</strong></div><div><span>Finalized totals</span><strong>{finalizedAmounts || '—'}</strong></div></div>
        <p className="data-note">Draft and ready invoice counts are not exposed by the Director Finance report.</p>
      </section>
      <section className="overview-section activity-section" aria-labelledby="activity-title">
        <div className="overview-section-heading"><div><span className="overview-kicker">Recent activity</span><h2 id="activity-title">Organizational record</h2></div><button type="button" className="text-action" onClick={() => onNavigate('audit')}>Audit trail <ArrowUpRight size={14} /></button></div>
        <div className="activity-list">{auditEvents.length ? auditEvents.slice(0, 4).map((event: any) => <div className="activity-row" key={event.id}><span className="activity-icon"><FileText size={14} /></span><div><strong>{event.action}</strong><p>{event.target}</p><small>{event.actor} · {new Date(event.createdAt).toLocaleDateString()}</small></div></div>) : <p className="overview-empty">No recent organizational activity.</p>}</div>
      </section>
    </div>

    {dashboard.billingCycle && <div className="overview-cycle-strip"><span className="cycle-marker" /><div><strong>{formatCycleLabel(dashboard.billingCycle.currentStage)}</strong><span>{dashboard.billingCycle.periodLabel} cycle in progress</span></div><span className="cycle-deadline">Deadline {formatDate(dashboard.billingCycle.submissionDeadline)}</span></div>}
  </div>
}

function SummaryMetric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) { return <div className="summary-metric"><span className="summary-icon">{icon}</span><div><dt>{label}</dt><dd>{value}</dd><small>{detail}</small></div></div> }
function HealthBar({ distribution, total }: { distribution: Record<HealthKey, number>; total: number }) { return <div className="health-visual"><div className="health-stack" aria-label={healthLabels.map(([key, label]) => `${label}: ${distribution[key]}`).join(', ')}>{healthLabels.map(([key]) => <span className={`health-segment ${key}`} style={{ width: `${total ? Math.max(distribution[key] / total * 100, distribution[key] ? 2 : 0) : 0}%` }} key={key} />)}</div><div className="health-legend">{healthLabels.map(([key, label]) => <div key={key}><span className={`legend-dot ${key}`} /><strong>{distribution[key]}</strong><span>{label}</span></div>)}</div></div> }
function DepartmentRow({ row, onDepartment }: { row: any; onDepartment: (id: number, trigger: HTMLElement) => void }) { const people = Number(row.employeeCount || 0); const submitted = Number(row.submittedCount || 0); const approved = Number(row.approvedCount || 0); const coverage = people ? Math.round(submitted / people * 100) : 0; return <div className="department-compact-row" role="row"><button type="button" className="department-name" onClick={event => onDepartment(Number(row.id), event.currentTarget)}><strong>{row.name}</strong><small>{row.code}</small></button><span>{people}</span><span className="department-coverage"><i><b style={{ width: `${coverage}%` }} /></i><strong>{coverage}%</strong></span><span>{approved}</span><span className={Number(row.flaggedCount || 0) ? 'has-exceptions' : ''}>{Number(row.flaggedCount || 0) || '—'}</span><button type="button" className="row-review" onClick={event => onDepartment(Number(row.id), event.currentTarget)}>Review</button></div> }
function summarizeCurrencies(rows: any[]) { const totals = new Map<string, number>(); rows.forEach(row => totals.set(String(row.currency || ''), (totals.get(String(row.currency || '')) || 0) + Number(row.amount || 0))); return [...totals].filter(([currency]) => currency).map(([currency, amount]) => `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`).join(' · ') }
function formatHours(value: number) { return `${value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h` }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(value)) }
function formatCycleLabel(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()) }
