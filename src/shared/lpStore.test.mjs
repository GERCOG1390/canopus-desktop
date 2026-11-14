import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lpOfferValue } from './lpStore.ts'

const close = (a, b, eps = 1) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)

// The Caldari Navy EM Shield Amplifier offer as the store showed it on 2026-11-13.
const offer = { type_id: 1, quantity: 1, lp_cost: 9000, isk_cost: 3_600_000, required_items: [{ type_id: 2, quantity: 1 }, { type_id: 3, quantity: 23 }, { type_id: 4, quantity: 40 }] }

test('sell order: Jita sell less tax and broker, less ISK and handed-in items', () => {
  const prices = { 1: { sell: 47_760_000 }, 2: { sell: 210_000 }, 3: { sell: 500_000 }, 4: { sell: 362_500 } }
  const v = lpOfferValue(offer, (id) => prices[id], 'sell', 3.37, 1.5)
  close(v.required, 26_210_000)
  close(v.value, 47_760_000 * (1 - 0.0487) - 3_600_000 - 26_210_000)
  close(v.perLp, v.value / 9000, 0.01)
  assert.equal(v.priced, true)
})

test('into buy orders: no broker fee', () => {
  const v = lpOfferValue({ ...offer, required_items: [] }, () => ({ sell: 10_000_000, buy: 9_000_000 }), 'buy', 3.37, 1.5)
  close(v.value, 9_000_000 * (1 - 0.0337) - 3_600_000)
})

test('a handed-in item without a Jita price is not free: the offer is unpriced', () => {
  const prices = { 1: { sell: 47_760_000 }, 2: { sell: 210_000 }, 3: { sell: 500_000 } }
  const v = lpOfferValue(offer, (id) => prices[id], 'sell', 3.37, 1.5)
  assert.equal(v.priced, false)
})
