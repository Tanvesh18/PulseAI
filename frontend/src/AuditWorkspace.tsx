import { useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'

type AuditFilters = { search: string; role: string; entity: string }
type AuditEvent = {
  id: number | string
  actor: string
  actorRole?: string | null
  action: string
  target: string
  entityType?: string | null
  entityId?: number | null
  beforeState?: Record<string, unknown> | null
  afterState?: Record<string, unknown> | null
  createdAt: string
}
type AuditData = { events?: AuditEvent[]; pagination?: { page: number; pageSize: number; total: number; totalPages: number } }

const roleOptions = [['', 'All roles'], ['director', 'Director'], ['manager', 'Manager'], ['employee', 'Employee'], ['hr', 'HR'], ['finance', 'Finance']]
const entityOptions = [['', 'All entities'], ['employee', 'Employee'], ['leave', 'Leave'], ['holiday', 'Holiday'], ['project', 'Project'], ['timesheet', 'Timesheet'], ['department_submission', 'Department submission']]

export function AuditWorkspace({ data, filters, onFilter, onPage }: { data: AuditData | null; filters: AuditFilters; onFilter: (next: Partial<AuditFilters>) => void; onPage: (page: number) => void }) {
  const [expanded, setExpanded] = useState<number | string | null>(null)
  const events = data?.events || []
  const pagination = data?.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 1 }
  return <section className="audit-workspace" aria-labelledby="audit-title">
    <div className="audit-intro">
      <div><h2 id="audit-title">Audit trail</h2><p>Trace material workflow changes across people, timesheets, and controls.</p></div>
      <span>{pagination.total} events</span>
    </div>
    <div className="audit-toolbar" role="search">
      <label className="audit-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search audit events</span><input value={filters.search} onChange={event => onFilter({ search: event.target.value })} placeholder="Search actor, action, or target" /></label>
      <label><span className="sr-only">Filter by role</span><select value={filters.role} onChange={event => onFilter({ role: event.target.value })}>{roleOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label><span className="sr-only">Filter by entity</span><select value={filters.entity} onChange={event => onFilter({ entity: event.target.value })}>{entityOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    </div>
    {events.length ? <div className="audit-list">{events.map(event => <AuditEventRow event={event} expanded={expanded === event.id} onToggle={() => setExpanded(expanded === event.id ? null : event.id)} key={event.id} />)}</div> : <div className="audit-empty"><strong>No audit events match these filters.</strong><p>Try clearing the search or selecting a different role or entity.</p></div>}
    {pagination.totalPages > 1 && <nav className="audit-pagination" aria-label="Audit pages"><button type="button" onClick={() => onPage(pagination.page - 1)} disabled={pagination.page <= 1}>Previous</button><span>Page {pagination.page} of {pagination.totalPages}</span><button type="button" onClick={() => onPage(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}>Next</button></nav>}
  </section>
}

function AuditEventRow({ event, expanded, onToggle }: { event: AuditEvent; expanded: boolean; onToggle: () => void }) {
  const before = formatState(event.beforeState)
  const after = formatState(event.afterState)
  const hasDetails = before.length > 0 || after.length > 0
  return <article className={`audit-event ${expanded ? 'is-expanded' : ''}`}>
    <div className="audit-event-main"><span className="audit-event-icon" aria-hidden="true">{hasDetails ? (expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />) : <span />}</span><div className="audit-event-copy"><div className="audit-event-heading"><strong>{event.action}</strong>{event.entityType && <span className="audit-entity">{formatLabel(event.entityType)}</span>}</div><p>{event.target}</p><small>{event.actor}{event.actorRole ? ` · ${formatLabel(event.actorRole)}` : ''} · {new Date(event.createdAt).toLocaleString()}</small></div>{hasDetails && <button type="button" className="audit-details-toggle" onClick={onToggle} aria-expanded={expanded}>{expanded ? 'Hide change' : 'View change'}</button>}</div>
    {expanded && hasDetails && <div className="audit-change"><ChangeBlock label="Before" value={before} empty="No previous state recorded." /><ChangeBlock label="After" value={after} empty="No resulting state recorded." /></div>}
  </article>
}

function ChangeBlock({ label, value, empty }: { label: string; value: string; empty: string }) { return <div><h3>{label}</h3><pre>{value || empty}</pre></div> }
function formatLabel(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()) }
function formatState(value?: Record<string, unknown> | null) { return value ? JSON.stringify(value, null, 2) : '' }
