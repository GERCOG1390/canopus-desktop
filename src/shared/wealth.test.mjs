import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeWealth } from './wealth.ts'

const prices = new Map([[1, 100], [2, 1000], [10, 5000], [11, 7000]])

test('every part is valued by its own rule', () => {
  const w = computeWealth({
    wallet: 500,
    assets: [
      { type_id: 1, quantity: 3 },
      { type_id: 2, quantity: 1, is_blueprint_copy: true }, // copies count as nothing
      { type_id: 99, quantity: 5 } // no market price
    ],
    orders: [
      { is_buy_order: false, price: 10, volume_remain: 4 },
      { is_buy_order: true, price: 9, volume_remain: 100, escrow: 250 },
      { price: 2, volume_remain: 5 } // a sell order has no is_buy_order at all
    ],
    implants: [10],
    cloneImplants: [10, 11],
    prices
  })
  assert.equal(w.assets, 300)
  assert.equal(w.sell, 50)
  assert.equal(w.escrow, 250)
  assert.equal(w.head, 5000)
  assert.equal(w.clones, 12000)
  assert.equal(w.total, 500 + 300 + 50 + 250 + 5000 + 12000)
  assert.deepEqual(w.top, [{ id: 1, value: 300 }])
})

test('a part ESI refused stays unknown and out of the total', () => {
  const w = computeWealth({ wallet: 100, assets: null, orders: null, implants: null, cloneImplants: null, prices: new Map() })
  assert.equal(w.assets, null)
  assert.equal(w.sell, null)
  assert.equal(w.head, null)
  assert.equal(w.total, 100)
})

// Audit 2026-11-16: a sell order counted at its own price — a SKIN listed at 4 billion that last sold at
// 160 million added 4 billion to the net worth, and the sales tax it would pay wasn't taken off.
test('a sell order is worth no more than the item really sells for, less the sales tax', () => {
  const w = computeWealth({
    wallet: 0,
    assets: [],
    orders: [
      { type_id: 7, is_buy_order: false, price: 4_119_000_000, volume_remain: 1 },
      { type_id: 8, is_buy_order: false, price: 100, volume_remain: 10 }
    ],
    implants: [],
    cloneImplants: [],
    prices: new Map([
      [7, 160_000_000],
      [8, 120]
    ]),
    salesTax: 0.0337
  })
  assert.equal(Math.round(w.sell), Math.round((160_000_000 + 100 * 10) * (1 - 0.0337)))
})
