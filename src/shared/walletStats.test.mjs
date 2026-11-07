import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dailyFlows, journalCsv } from './walletStats.ts'

const NOW = Date.parse('2026-11-06T20:00:00Z')

test('every day of the period is there, income and expense apart, in UTC (EVE time)', () => {
  const days = dailyFlows(
    [
      { date: '2026-11-06T01:00:00Z', amount: 100 },
      { date: '2026-11-06T23:59:00Z', amount: -30 },
      { date: '2026-11-04T00:00:00Z', amount: 50 },
      { date: '2026-11-04T10:00:00Z' }, // an entry with no amount
      { date: '2026-10-01T10:00:00Z', amount: 999 } // older than the period
    ],
    3,
    NOW
  )
  assert.deepEqual(days, [
    { day: '2026-11-04', income: 50, expense: 0, net: 50 },
    { day: '2026-11-05', income: 0, expense: 0, net: 0 },
    { day: '2026-11-06', income: 100, expense: -30, net: 70 }
  ])
})

test('CSV: a header, quotes doubled, line breaks kept inside quotes', () => {
  const csv = journalCsv([{ date: '2026-11-06T01:00:00Z', ref_type: 'bounty_prizes', amount: 12.5, balance: 100, description: 'A "big", one\nline', reason: '' }], (t) => t)
  assert.equal(csv, 'date,type,amount,balance,description,reason\r\n2026-11-06T01:00:00Z,bounty_prizes,12.5,100,"A ""big"", one\nline",\r\n')
})

// Descriptions and reasons are written by other players; a spreadsheet would run "=…" as a formula.
test('CSV: text that a spreadsheet would run as a formula is defused', () => {
  const csv = journalCsv([{ date: 'd', ref_type: 't', amount: -5, description: '=HYPERLINK("http://x")', reason: '+1' }], (t) => t)
  const line = csv.split('\r\n')[1]
  assert.ok(line.includes(`"'=HYPERLINK(""http://x"")"`), line)
  assert.ok(line.endsWith(`,'+1`), line)
  assert.ok(line.includes(',-5,'), 'numbers stay numbers')
})
