import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lpOfferValue, tradedPrice } from './lpStore.ts'

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

// Found 2026-11-16 (the pilot's own sale): 'Lancer' LE-1001 was valued at its cheapest Jita sell order, 999 800,
// while it really traded at about 238 000, about 5 a day, and selling 162 at once got 100 800 each.
// The store showed 1 536 ISK/LP for it, about four times what it is worth.
const lancerHistory = [
  { date: '2026-11-02', average: 235_000, volume: 2 },
  { date: '2026-11-03', average: 238_000, volume: 17 },
  { date: '2026-11-04', average: 238_000, volume: 4 },
  { date: '2026-11-05', average: 238_000, volume: 2 },
  { date: '2026-11-06', average: 100_800, volume: 2 },
  { date: '2026-11-07', average: 237_983, volume: 6 },
  { date: '2026-11-08', average: 238_000, volume: 1 },
  { date: '2026-11-10', average: 100_800, volume: 1 },
  { date: '2026-11-13', average: 850_000, volume: 1 },
  { date: '2026-11-14', average: 900_000, volume: 1 }
]

test('the price things really trade at: the volume-weighted median of the last 30 days', () => {
  const t = tradedPrice(lancerHistory, '2026-11-16')
  assert.equal(t.price, 238_000)
  close(t.perDay, 37 / 30, 0.01)
})

test('a sell order far above what the item trades at is valued at the traded price', () => {
  const lancer = { type_id: 1, quantity: 1, lp_cost: 375, isk_cost: 375_000, required_items: [] }
  const v = lpOfferValue(lancer, () => ({ sell: 999_800, buy: 100_700, traded: 238_000 }), 'sell', 3.37, 1.5)
  assert.equal(v.unit, 238_000)
  assert.ok(v.perLp < 0, `${v.perLp}`)
  // A sell order under the traded price is what it sells for.
  assert.equal(lpOfferValue(lancer, () => ({ sell: 200_000, traded: 238_000 }), 'sell', 3.37, 1.5).unit, 200_000)
})

test('without a trade history the sell order still counts, marked as unchecked', () => {
  const v = lpOfferValue({ type_id: 1, quantity: 1, lp_cost: 100, isk_cost: 0, required_items: [] }, () => ({ sell: 1000 }), 'sell', 0, 0)
  assert.equal(v.unit, 1000)
  assert.equal(v.checked, false)
})

// Found 2026-11-16: DED's Cormorant Triglavian Twilight SKIN showed 388 364 ISK/LP (≈ 9.9 billion for 25 000 LP).
// Nothing had traded for 30 days, so the empty history counted as "not checked" and two lone 4.12 billion sell
// orders set the price; it last sold at 160 million.
test('no trades in 30 days: the last 90 days are used, and nothing in 90 days means no price', () => {
  const skin = [
    { date: '2026-09-12', average: 160_000_000, volume: 1 },
    { date: '2026-09-26', average: 160_000_000, volume: 2 },
    { date: '2026-10-07', average: 160_000_000, volume: 1 }
  ]
  const t = tradedPrice(skin, '2026-11-16')
  assert.equal(t.price, 160_000_000)
  assert.equal(t.days, 90)
  close(t.perDay, 4 / 90, 0.001)
  assert.deepEqual(tradedPrice([{ date: '2026-06-01', average: 5, volume: 1 }], '2026-11-16'), { price: 0, perDay: 0, days: 90 })
})

test('an item that has not traded is not worth its sell order', () => {
  const o = { type_id: 1, quantity: 1, lp_cost: 10_000, isk_cost: 25_000_000, required_items: [] }
  const v = lpOfferValue(o, () => ({ sell: 4_119_000_000, buy: 71_710_000, traded: 0 }), 'sell', 3.37, 1.5)
  assert.equal(v.priced, false)
  assert.equal(v.checked, true)
  assert.equal(v.unit, 0)
})
