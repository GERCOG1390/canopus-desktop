import assert from 'node:assert/strict'
import { test } from 'node:test'
import { courierCost, haulSeconds, planHaul } from './haulPlan.ts'

const item = (id, qty, volume, unit) => ({ id, qty, volume, unit })

test('everything fits in one trip', () => {
  const p = planHaul([item(1, 10, 10, 100), item(2, 5, 20, 50)], 1000)
  assert.equal(p.trips.length, 1)
  assert.equal(p.trips[0].volume, 200)
  assert.equal(p.trips[0].value, 1250)
  assert.equal(p.volume, 200)
  assert.equal(p.value, 1250)
})

test('a stack splits across trips by volume, down to whole units', () => {
  // 25 units of 10 m³ in a 100 m³ hold: 10, 10, 5.
  const p = planHaul([item(1, 25, 10, 1)], 100)
  assert.deepEqual(p.trips.map((t) => t.lines[0].qty), [10, 10, 5])
  // 105 m³ doesn't take an 11th unit.
  assert.deepEqual(planHaul([item(1, 25, 10, 1)], 105).trips.map((t) => t.lines[0].qty), [10, 10, 5])
})

test('the dearest per m³ goes first, the rest fills what is left', () => {
  const p = planHaul([item(1, 8, 10, 1), item(2, 5, 10, 1000)], 100)
  assert.deepEqual(p.trips[0].lines, [{ id: 2, qty: 5 }, { id: 1, qty: 5 }])
  assert.deepEqual(p.trips[1].lines, [{ id: 1, qty: 3 }])
})

test('tiny volumes that fill the hold exactly are not counted as overfull', () => {
  // 0.01 × 30000 is a hair over 300 in floating point.
  const p = planHaul([item(1, 30000, 0.01, 1)], 300)
  assert.equal(p.trips.length, 1)
})

test('the value limit splits trips even with room in the hold', () => {
  const p = planHaul([item(1, 10, 1, 100)], 1000, 300)
  assert.deepEqual(p.trips.map((t) => t.lines[0].qty), [3, 3, 3, 1])
  assert.ok(p.trips.every((t) => t.value <= 300 && !t.overLimit))
})

test('one unit over the value limit goes alone and is marked', () => {
  const p = planHaul([item(1, 2, 1, 500), item(2, 2, 1, 10)], 1000, 300)
  assert.deepEqual(p.trips.map((t) => [t.lines, t.overLimit]), [
    [[{ id: 1, qty: 1 }], true],
    [[{ id: 1, qty: 1 }], true],
    [[{ id: 2, qty: 2 }], false]
  ])
})

test('what a ship can never carry is set apart, not lost', () => {
  const p = planHaul([item(1, 1, 5000, 100), item(2, 1, 10, 1)], 100)
  assert.deepEqual(p.unfit.map((i) => i.id), [1])
  assert.equal(p.trips.length, 1)
  // Totals cover the whole list: a courier takes what this ship can't.
  assert.equal(p.volume, 5010)
  assert.equal(p.value, 101)
})

test('the plan leaves the given items untouched', () => {
  const items = [item(1, 25, 10, 1)]
  planHaul(items, 100)
  assert.equal(items[0].qty, 25)
})

test('a zero volume or price, and nothing at all', () => {
  assert.equal(planHaul([item(1, 5, 0, 10)], 100).trips.length, 1)
  assert.equal(planHaul([item(1, 5, 1, 0)], 100, 300).trips.length, 1)
  assert.deepEqual(planHaul([], 100).trips, [])
})

test('time: out and back for all but the last trip', () => {
  assert.equal(haulSeconds(10, 1, 60), 600)
  assert.equal(haulSeconds(10, 3, 60), 3000) // 5 legs
  assert.equal(haulSeconds(10, 0, 60), 0)
})

test('a courier: rate per m³ plus the collateral share', () => {
  assert.equal(courierCost(1000, 2_000_000, 500, 1), 520_000)
})
