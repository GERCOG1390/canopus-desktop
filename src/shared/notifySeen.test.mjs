import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forgetOld } from './notifySeen.ts'

const DAY = 86400_000
const NOW = Date.UTC(2026, 10, 7)

test('old one-off notifications are forgotten after a month', () => {
  const seen = { 'skillq-1-2026-09-01': NOW - 40 * DAY, 'pi-1-77': NOW - 2 * DAY }
  assert.deepEqual(forgetOld(seen, NOW), { 'pi-1-77': NOW - 2 * DAY })
})

test('a fired price alert stays fired however long the price stays past it: it re-arms only when the price crosses back', () => {
  const seen = { 'price-abc': NOW - 45 * DAY }
  assert.deepEqual(forgetOld(seen, NOW), { 'price-abc': NOW - 45 * DAY })
})
