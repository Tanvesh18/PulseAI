import type mysql from 'mysql2/promise'

export async function createTestPeriod(db: mysql.Connection, suffix: string, offsetDays = 0) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.BUSINESS_TIME_ZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const startsOn = new Date(`${today}T00:00:00Z`)
  startsOn.setUTCDate(startsOn.getUTCDate() - offsetDays)
  const endsOn = new Date(`${today}T00:00:00Z`)
  endsOn.setUTCDate(endsOn.getUTCDate() + 14)
  const label = `Integration ${suffix}${offsetDays ? ` ${offsetDays}` : ''}`
  const [result] = await db.query<mysql.ResultSetHeader>('INSERT INTO reporting_periods (label,starts_on,ends_on,submission_deadline,active) VALUES (?,?,?,?,TRUE)', [label, startsOn.toISOString().slice(0, 10), endsOn.toISOString().slice(0, 10), endsOn.toISOString().slice(0, 10)])
  return { id: result.insertId, label, startsOn: startsOn.toISOString().slice(0, 10), endsOn: endsOn.toISOString().slice(0, 10) }
}
