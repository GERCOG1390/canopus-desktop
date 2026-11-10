import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accruedSp, langFor } from './characterRules.ts'
import { computeWealth } from './wealth.ts'

const queue = [{ skill_id: 7, start_date: '2026-11-10T00:00:00Z', finish_date: '2026-11-20T00:00:00Z', level_start_sp: 1000, level_end_sp: 3000, training_start_sp: 1000 }]

test('the skill in training has the SP it has built up, not those of when it started', () => {
  const now = Date.parse('2026-11-15T00:00:00Z')
  assert.equal(accruedSp(7, 1000, queue, now), 2000)
})

test('it never goes down, and other skills stay as they are', () => {
  const now = Date.parse('2026-11-15T00:00:00Z')
  assert.equal(accruedSp(7, 2500, queue, now), 2500)
  assert.equal(accruedSp(8, 500, queue, now), 500)
  // A queue entry yet to start, or an empty queue, adds nothing.
  assert.equal(accruedSp(7, 1000, queue, Date.parse('2026-11-01T00:00:00Z')), 1000)
  assert.equal(accruedSp(7, 1000, null, Date.parse('2026-11-15T00:00:00Z')), 1000)
})

test('the first start follows the system language', () => {
  assert.equal(langFor('ru-RU'), 'ru')
  assert.equal(langFor('en-US'), 'en')
  assert.equal(langFor('de'), 'en')
  assert.equal(langFor(undefined), 'en')
})

test('net worth counts items without a price instead of hiding them, and leaves corporation orders out', () => {
  const w = computeWealth({
    wallet: 0,
    assets: [{ type_id: 1, quantity: 1 }, { type_id: 99, quantity: 5 }, { type_id: 98, quantity: 1, is_blueprint_copy: true }],
    orders: [{ price: 10, volume_remain: 2 }, { price: 1000, volume_remain: 2, is_corporation: true }, { is_buy_order: true, price: 5, volume_remain: 1, escrow: 700, is_corporation: true }],
    implants: [],
    cloneImplants: [],
    prices: new Map([[1, 100]])
  })
  assert.equal(w.unpriced, 1)
  assert.equal(w.sell, 20)
  assert.equal(w.escrow, 0)
})
