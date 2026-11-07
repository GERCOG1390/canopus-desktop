import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cheapestMix, planOres, splitTrailingQty, resolveListLines } from './orePlan.ts'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)

test('one ore, one need', () => {
  const x = cheapestMix([1000], [{ cost: 5, yields: [100] }])
  close(x[0], 10)
})

test('the cheaper source wins', () => {
  const x = cheapestMix([100], [{ cost: 10, yields: [10] }, { cost: 3, yields: [10] }])
  close(x[0], 0)
  close(x[1], 10)
})

// By hand: A gives 10/0, B 0/10, C 10/10. Each single at 3, C at 5: 5 per pair beats 6.
test('an ore covering two needs beats two ores when it is cheaper', () => {
  const x = cheapestMix([100, 100], [{ cost: 3, yields: [10, 0] }, { cost: 3, yields: [0, 10] }, { cost: 5, yields: [10, 10] }])
  close(x[2], 10)
  close(x[0], 0)
  close(x[1], 0)
})

// Needs 100/40. C (10/10 at 5) covers both up to 40; A (10/0 at 3) the rest: 4×5 + 6×3 = 38.
test('a mix when the needs differ', () => {
  const x = cheapestMix([100, 40], [{ cost: 3, yields: [10, 0] }, { cost: 5, yields: [10, 10] }])
  close(x[0], 6)
  close(x[1], 4)
})

test('a need no ore can cover gives no answer', () => {
  assert.equal(cheapestMix([100, 5], [{ cost: 3, yields: [10, 0] }]), null)
})

const ores = [
  { id: 1, portion: 100, price: 2, volume: 0.001, yields: [[34, 400]] }, // Veldspar-like
  { id: 2, portion: 100, price: 9, volume: 0.0035, yields: [[34, 175], [36, 70]] }
]

test('whole batches, refining yield, surplus and the comparison with buying minerals', () => {
  const p = planOres([{ id: 34, qty: 1000 }], ores, 0.5, new Map([[34, 5]]))
  // 400 × 0.5 = 200 per batch: 5 batches of ore 1 at 200 ISK each.
  assert.deepEqual(p.lines.map((l) => [l.id, l.batches, l.units, l.cost]), [[1, 5, 500, 1000]])
  assert.equal(p.oreCost, 1000)
  assert.equal(p.mineralCost, 5000)
  assert.deepEqual(p.covered, true)
  assert.deepEqual(p.surplus, [])
})

test('rounding up shows as surplus and a game-rounded yield is never overstated', () => {
  const p = planOres([{ id: 34, qty: 1001 }], ores, 0.5, new Map())
  assert.equal(p.lines[0].batches, 6)
  assert.deepEqual(p.surplus, [{ id: 34, qty: 199 }])
})

test('an empty list and missing prices are not plans', () => {
  assert.equal(planOres([], ores, 0.5, new Map()).lines.length, 0)
  const none = planOres([{ id: 99, qty: 5 }], ores, 0.5, new Map())
  assert.equal(none.covered, false)
})

test('a trailing number is split off only when asked: "Tritanium 2 000 000"', () => {
  assert.deepEqual(splitTrailingQty('Tritanium 2000000'), { name: 'Tritanium', qty: 2000000 })
  assert.deepEqual(splitTrailingQty('Tritanium 2 000 000'), { name: 'Tritanium', qty: 2000000 })
  assert.deepEqual(splitTrailingQty('Tritanium 2,000,000'), { name: 'Tritanium', qty: 2000000 })
  assert.equal(splitTrailingQty('Tritanium'), null)
  assert.equal(splitTrailingQty('2000000'), null)
})

test('a list line: the real name wins over a number at its end', () => {
  const known = new Set(['Tritanium', 'Navy Cap Booster 800'])
  const parsed = [
    { name: 'Tritanium 500', qty: 1 },
    { name: 'Navy Cap Booster 800', qty: 3 },
    { name: 'Nonsense 5', qty: 1 }
  ]
  assert.deepEqual(resolveListLines(parsed, (n) => known.has(n)), {
    lines: [
      { name: 'Tritanium', qty: 500 },
      { name: 'Navy Cap Booster 800', qty: 3 }
    ],
    unknown: ['Nonsense 5']
  })
})
