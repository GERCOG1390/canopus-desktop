import assert from 'node:assert/strict'
import { test } from 'node:test'
import { needsHistory, saleUnit } from './saleValue.ts'

// Found 2026-11-16 in the LP store, the same everywhere a profit is shown: a slow item's cheapest sell order.
test('a tight market is priced at its sell order, no history needed', () => {
  assert.equal(needsHistory(1_000, 990), false)
  assert.deepEqual(saleUnit(1_000, 990), { unit: 1_000, checked: true })
})

test("the 'Lancer' implant: a lone 999 800 listing, really trading at 238 000", () => {
  assert.equal(needsHistory(999_800, 100_700), true)
  assert.deepEqual(saleUnit(999_800, 100_700, { price: 238_000, perDay: 5 }), { unit: 238_000, checked: true, perDay: 5 })
})

test('the Cormorant SKIN: nothing traded in 90 days is worth nothing as a sale', () => {
  assert.deepEqual(saleUnit(4_119_000_000, 71_710_000, { price: 0, perDay: 0 }), { unit: 0, checked: true, perDay: 0 })
})

test('no buy orders at all is suspicious; an unloaded history leaves the order price, marked unchecked', () => {
  assert.equal(needsHistory(500, 0), true)
  assert.deepEqual(saleUnit(500, 0), { unit: 500, checked: false })
})

test('a sell order under the traded price is what it sells for', () => {
  assert.equal(saleUnit(200, 100, { price: 238, perDay: 3 }).unit, 200)
})
