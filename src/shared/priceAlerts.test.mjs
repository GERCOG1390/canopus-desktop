import assert from 'node:assert/strict'
import { test } from 'node:test'
import { alertKey, evaluateAlerts, isTriggered } from './priceAlerts.ts'

const below = { id: 'a', typeId: 34, name: 'Tritanium', side: 'sell', dir: 'below', price: 5 }
const above = { id: 'b', typeId: 35, name: 'Pyerite', side: 'buy', dir: 'above', price: 10 }

test('a threshold counts when reached, and no orders never count', () => {
  assert.equal(isTriggered(below, 5), true)
  assert.equal(isTriggered(below, 4.9), true)
  assert.equal(isTriggered(below, 5.1), false)
  assert.equal(isTriggered(above, 10), true)
  assert.equal(isTriggered(above, 9), false)
  assert.equal(isTriggered(below, 0), false) // Fuzzwork gives 0 when the side has no orders
})

const prices = (sell34, buy35) => new Map([[34, { sell: sell34, buy: 0 }], [35, { sell: 0, buy: buy35 }]])

test('fires once, while the price stays past the line nothing repeats', () => {
  const fired = new Set()
  let r = evaluateAlerts([below], prices(4, 0), (k) => fired.has(k))
  assert.deepEqual(r.fire.map((f) => [f.alert.id, f.best]), [['a', 4]])
  fired.add(alertKey(below))
  r = evaluateAlerts([below], prices(3, 0), (k) => fired.has(k))
  assert.equal(r.fire.length, 0)
  assert.equal(r.rearm.length, 0)
})

test('going back re-arms, so the next crossing fires again', () => {
  const r = evaluateAlerts([below], prices(6, 0), () => true)
  assert.equal(r.fire.length, 0)
  assert.deepEqual(r.rearm, [alertKey(below)])
})

test('a missing price or an empty side changes nothing', () => {
  assert.deepEqual(evaluateAlerts([below], new Map(), () => true), { fire: [], rearm: [] })
  assert.deepEqual(evaluateAlerts([below], prices(0, 0), () => true), { fire: [], rearm: [] })
  assert.deepEqual(evaluateAlerts([below], prices(0, 0), () => false), { fire: [], rearm: [] })
})
