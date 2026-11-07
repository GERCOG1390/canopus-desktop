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
