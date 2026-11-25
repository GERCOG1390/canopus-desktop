import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buyPrice } from './fitPrice.ts'

test('one cheap order does not set the price: the cheapest 5% of what is on sale does', () => {
  // A single unit at 1 ISK among a thousand at about 1M (Fuzzwork: min 1, percentile 990K).
  const p = buyPrice({ best: 1, volume: 1000, orders: 40, percentile: 990_000 }, 5)
  assert.equal(p.unit, 990_000)
  assert.equal(p.short, false)
  assert.equal(p.thin, false)
})

test('not enough on sale for the whole fit: short; a handful: thin', () => {
  const short = buyPrice({ best: 5e6, volume: 3, orders: 2, percentile: 5e6 }, 5)
  assert.equal(short.short, true)
  assert.equal(short.available, 3)
  const thin = buyPrice({ best: 5e6, volume: 8, orders: 2, percentile: 5.1e6 }, 5)
  assert.equal(thin.short, false)
  assert.equal(thin.thin, true)
  assert.equal(buyPrice({ best: 5e6, volume: 900, orders: 30, percentile: 5.1e6 }, 1).thin, false)
})

test('nothing on sale has no price; a missing percentile falls back to the cheapest order', () => {
  assert.equal(buyPrice({ best: 0, volume: 0, orders: 0, percentile: 0 }, 1), undefined)
  assert.equal(buyPrice(undefined, 1), undefined)
  assert.equal(buyPrice({ best: 2e6, volume: 50, orders: 9, percentile: 0 }, 1).unit, 2e6)
})
