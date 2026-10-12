import test from 'node:test'
import assert from 'node:assert/strict'
import { activeReportingPeriod, businessDate } from '../reportingPeriod.js'

function fakePeriod(startsOn: string, endsOn: string) {
  let selectedDate = ''
  const executor = { query: async (_sql: string, values: unknown[]) => {
    selectedDate = String(values[0])
    assert.equal(values[1], selectedDate)
    const inside = selectedDate >= startsOn && selectedDate <= endsOn
    return [[...(inside ? [{ id: 7, label: 'October 2026', startsOn, endsOn, cyclePeriodLabel: 'October 2026', cycleStage: 'timesheet_entry' }] : [])], []]
  } }
  return { executor, getSelectedDate: () => selectedDate }
}

test('shared active period includes both boundary dates and its billing cycle', async () => {
  for (const date of ['2026-10-01', '2026-10-12', '2026-10-31']) {
    const fixture = fakePeriod('2026-10-01', '2026-10-31')
    const period = await activeReportingPeriod(fixture.executor as any, date)
    assert.equal(fixture.getSelectedDate(), date)
    assert.equal(period?.id, 7)
    assert.equal(period?.billingCycle?.currentStage, 'timesheet_entry')
  }
})

test('shared active period returns null before and after its dates', async () => {
  const fixture = fakePeriod('2026-10-01', '2026-10-31')
  assert.equal(await activeReportingPeriod(fixture.executor as any, '2026-09-30'), null)
  assert.equal(await activeReportingPeriod(fixture.executor as any, '2026-11-01'), null)
})

test('business date honors time-zone boundary near UTC midnight', () => {
  const instant = new Date('2026-10-11T20:00:00Z')
  assert.equal(businessDate(instant, 'Asia/Kolkata'), '2026-10-12')
  assert.equal(businessDate(instant, 'America/Los_Angeles'), '2026-10-11')
})
