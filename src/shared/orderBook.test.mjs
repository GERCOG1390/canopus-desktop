import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fillCost, loadHold, walkBooks } from './orderBook.ts'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)

// Found 2026-11-16: Thorium Charge M Jita → Dodixie showed 5.74 ISK a unit and 426 727 available, yet 0 total;
// the total came from 5%-of-the-book averages, the units from the whole book.
test('the walk stops where a unit no longer makes money after fees', () => {
  const asks = [
    { price: 27.11, volume: 10_000 },
    { price: 30, volume: 50_000 },
    { price: 40, volume: 400_000 }
  ]
  const bids = [
    { price: 34, volume: 25_000 },
    { price: 31, volume: 100_000 }
  ]
  const keep = 1 - 0.0337
  const w = walkBooks(asks, bids, keep)
  // 10 000 at 27.11 → 34, 15 000 at 30 → 34; then 30 vs 31 × 0.9663 = 29.96: no longer worth it.
  assert.equal(w.units, 25_000)
  close(w.profit, (10_000 * 34 + 15_000 * 34) * keep - (10_000 * 27.11 + 15_000 * 30), 1e-3)
  close(w.avgBuy, (10_000 * 27.11 + 15_000 * 30) / 25_000)
})

test('nothing to make: no units, no profit', () => {
  const w = walkBooks([{ price: 100, volume: 5 }], [{ price: 100, volume: 5 }], 0.95)
  assert.deepEqual(w, { units: 0, profit: 0, avgBuy: 0, avgSell: 0 })
})

test('selling by order: one level, the sale price and what the market takes', () => {
  const w = walkBooks([{ price: 10, volume: 1_000 }], [{ price: 15, volume: 70 }], 0.9513)
  assert.equal(w.units, 70)
  close(w.profit, 70 * 15 * 0.9513 - 700)
})

// Audit 2026-11-16: materials and LP hand-ins were costed at the best sell order whatever the quantity.
test('a batch runs up the book; what the book lacks is reported', () => {
  const asks = [
    { price: 10, volume: 100 },
    { price: 12, volume: 50 },
    { price: 20, volume: 10 }
  ]
  assert.deepEqual(fillCost(asks, 120), { total: 100 * 10 + 20 * 12, avg: (1000 + 240) / 120, filled: 120, short: 0 })
  const all = fillCost(asks, 200)
  assert.equal(all.filled, 160)
  assert.equal(all.short, 40)
  assert.deepEqual(fillCost([], 5), { total: 0, avg: 0, filled: 0, short: 5 })
})

// 2026-11-16, the pilot: a cargo hold of a given size, the profit of one trip.
test('a trip carries no more than the hold takes, the best of the book first', () => {
  const asks = [
    { price: 10, volume: 100 },
    { price: 14, volume: 100 }
  ]
  const bids = [{ price: 20, volume: 1_000 }]
  const w = walkBooks(asks, bids, 1, 150)
  assert.equal(w.units, 150)
  close(w.profit, 150 * 20 - (100 * 10 + 50 * 14))
})

test('the hold takes the most ISK per m³ first, then what still fits', () => {
  const deals = [
    { id: 1, perUnit: 100, volume: 10, units: 5 }, // 10 ISK/m³
    { id: 2, perUnit: 30, volume: 1, units: 1000 }, // 30 ISK/m³
    { id: 3, perUnit: 500, volume: 100, units: 3 } // 5 ISK/m³
  ]
  const r = loadHold(deals, 600)
  assert.deepEqual(r.picks, [
    { id: 2, units: 600, profit: 18_000 }
  ])
  // 1 000 m³ of the best, 50 m³ of the next; the third needs 100 m³ and only 50 are left.
  const r2 = loadHold(deals, 1_100)
  assert.deepEqual(
    r2.picks.map((p) => [p.id, p.units]),
    [
      [2, 1000],
      [1, 5]
    ]
  )
  assert.equal(r2.used, 1000 + 50)
})

// Audit 2026-11-16: a buy order taking no less than 1 000 at a high price counted for a 1-unit sale.
test('a buy order with a minimum volume out of reach is skipped', () => {
  const asks = [{ price: 10, volume: 50 }]
  const bids = [
    { price: 100, volume: 5_000, min: 1_000 },
    { price: 12, volume: 100 }
  ]
  const w = walkBooks(asks, bids, 1)
  assert.equal(w.units, 50)
  close(w.avgSell, 12)
  // Enough to sell at once: it counts.
  assert.equal(walkBooks([{ price: 10, volume: 2_000 }], bids, 1).avgSell, 100)
})
