import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dealOf, pickContracts, sells } from './publicContracts.ts'

const NOW = Date.parse('2026-11-06T12:00:00Z')
const contract = (o) => ({ contract_id: 1, type: 'item_exchange', price: 100, date_issued: '2026-11-05T00:00:00Z', date_expired: '2026-11-20T00:00:00Z', ...o })
const all = { kind: 'any', minPrice: 0, maxPrice: 0, title: '', now: NOW }
const ids = (l) => l.map((c) => c.contract_id)

test('couriers and expired contracts are skipped, newest first', () => {
  const list = [
    contract({ contract_id: 1, date_issued: '2026-11-01T00:00:00Z' }),
    contract({ contract_id: 2, type: 'courier' }),
    contract({ contract_id: 3, date_expired: '2026-11-06T11:59:00Z' }),
    contract({ contract_id: 4, type: 'auction', date_issued: '2026-11-05T00:00:00Z' }),
    contract({ contract_id: 5, type: 'loan' })
  ]
  assert.deepEqual(ids(pickContracts(list, all)), [4, 1])
})

test('filters: kind, price range with no upper limit at 0, title in any case', () => {
  const list = [
    contract({ contract_id: 1, price: 50, title: 'Cheap STUFF' }),
    contract({ contract_id: 2, price: 500, type: 'auction' }),
    contract({ contract_id: 3, price: 5000 })
  ]
  assert.deepEqual(ids(pickContracts(list, { ...all, kind: 'auction' })), [2])
  assert.deepEqual(ids(pickContracts(list, { ...all, minPrice: 100 })).sort(), [2, 3])
  assert.deepEqual(ids(pickContracts(list, { ...all, maxPrice: 500 })).sort(), [1, 2])
  assert.deepEqual(ids(pickContracts(list, { ...all, title: 'stuff' })), [1])
})

test('a contract sells what it includes, not what it asks for', () => {
  const items = [{ type_id: 1, quantity: 1, is_included: true }, { type_id: 2, quantity: 1, is_included: false }]
  assert.equal(sells(items, 1), true)
  assert.equal(sells(items, 2), false)
})

test('the deal: items offered against the price and the items asked for', () => {
  const price = (id) => ({ 1: 100, 2: 50 })[id] ?? 0
  const d = dealOf(contract({ price: 300 }), [
    { type_id: 1, quantity: 5, is_included: true },
    { type_id: 2, quantity: 2, is_included: false }
  ], price)
  assert.equal(d.value, 500)
  assert.equal(d.asked, 100)
  assert.equal(d.cost, 400)
  assert.equal(d.gain, 100)
  assert.equal(d.unpriced, 0)
})

test('a blueprint copy has no price of its own, even when the original has one', () => {
  const d = dealOf(contract({ price: 10 }), [{ type_id: 1, quantity: 1, is_included: true, is_blueprint_copy: true }], () => 1000)
  assert.equal(d.value, 0)
  assert.equal(d.unpriced, 1)
  assert.equal(d.gain, -10)
})

test('an auction counts at its buyout when it has one, its opening bid otherwise', () => {
  const items = [{ type_id: 1, quantity: 1, is_included: true }]
  assert.equal(dealOf(contract({ type: 'auction', price: 10, buyout: 70 }), items, () => 100).gain, 30)
  assert.equal(dealOf(contract({ type: 'auction', price: 10 }), items, () => 100).gain, 90)
  // buyout means nothing on a plain exchange
  assert.equal(dealOf(contract({ price: 10, buyout: 70 }), items, () => 100).gain, 90)
})
