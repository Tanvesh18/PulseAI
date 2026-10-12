import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'

export interface ActiveReportingPeriod extends RowDataPacket {
  id: number
  label: string
  startsOn: string
  endsOn: string
  submissionDeadline: string | null
  standardDailyHours: number
  billingCycle: { periodLabel: string; startsOn: string; endsOn: string; submissionDeadline: string | null; currentStage: string } | null
}

export function businessDate(now = new Date(), timeZone = process.env.BUSINESS_TIME_ZONE || 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

export async function activeReportingPeriod(executor: Pick<Pool | PoolConnection, 'query'>, today = businessDate()) {
  const [rows] = await executor.query<RowDataPacket[]>(`SELECT p.id, p.label, DATE_FORMAT(p.starts_on, '%Y-%m-%d') AS startsOn, DATE_FORMAT(p.ends_on, '%Y-%m-%d') AS endsOn,
    DATE_FORMAT(p.submission_deadline, '%Y-%m-%d') AS submissionDeadline, p.standard_daily_hours AS standardDailyHours,
    b.period_label AS cyclePeriodLabel, b.current_stage AS cycleStage, DATE_FORMAT(b.starts_on, '%Y-%m-%d') AS cycleStartsOn,
    DATE_FORMAT(b.ends_on, '%Y-%m-%d') AS cycleEndsOn, DATE_FORMAT(b.submission_deadline, '%Y-%m-%d') AS cycleSubmissionDeadline
    FROM reporting_periods p LEFT JOIN billing_cycles b ON b.period_label = p.label
    WHERE p.active = TRUE AND p.starts_on <= ? AND p.ends_on >= ? ORDER BY p.starts_on DESC, p.id DESC LIMIT 1`, [today, today])
  const row = rows[0]
  if (!row) return null
  return { ...row, billingCycle: row.cyclePeriodLabel ? { periodLabel: row.cyclePeriodLabel, startsOn: row.cycleStartsOn, endsOn: row.cycleEndsOn, submissionDeadline: row.cycleSubmissionDeadline, currentStage: row.cycleStage } : null } as ActiveReportingPeriod
}
