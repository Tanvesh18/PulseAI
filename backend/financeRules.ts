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
  return (from === 'draft' && to === 'ready') || (from === 'ready' && to === 'finalized')
}

export function calculateLineAmount(hours: number, rate: number) {
  return Math.round((hours * rate + Number.EPSILON) * 100) / 100
}

export function validCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value)
}

export function csvCell(value: unknown) {
  const text = String(value ?? '')
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}
