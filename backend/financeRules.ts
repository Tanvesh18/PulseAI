export type InvoiceStatus = 'draft' | 'ready' | 'finalized' | 'cancelled'

export function financeCanProcessTimesheet(status: string) {
  return status === 'approved'
}

export function financeEntryCanBeInvoiced(input: {
  timesheetStatus: string
  billable: boolean | null
  hasClient: boolean
  hasRate: boolean
  alreadyLinked: boolean
}) {
  return financeCanProcessTimesheet(input.timesheetStatus)
    && input.billable === true
    && input.hasClient
    && input.hasRate
    && !input.alreadyLinked
}

export function invoiceTransitionAllowed(from: InvoiceStatus, to: InvoiceStatus) {
  return (from === 'draft' && to === 'ready') || (from === 'ready' && (to === 'draft' || to === 'finalized'))
}

export function calculateLineAmount(hours: number, rate: number) {
  return Math.round((hours * rate + Number.EPSILON) * 100) / 100
}

export function validCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value)
}

export function validRateDate(value: unknown) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number(value.slice(0, 4)) >= 1000
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

export function csvCell(value: unknown) {
  const text = String(value ?? '')
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}
