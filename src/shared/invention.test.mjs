import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inventionChance, inventionRun } from './invention.ts'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)

test('chance from the skills and the decryptor', () => {
  close(inventionChance(0.3, 5, 5, 5, 1), 0.4375) // a T2 frigate with every skill at V
  close(inventionChance(0.3, 0, 0, 0, 1), 0.3)
  close(inventionChance(0.3, 5, 5, 5, 1.8), 0.7875) // Attainment
  close(inventionChance(0.26, 4, 5, 3, 1.2), 0.26 * (1 + 9 / 30 + 3 / 40) * 1.2)
  assert.equal(inventionChance(0.9, 5, 5, 5, 1.9), 1) // never above certain
})

const base = {
  baseChance: 0.3,
  sci1: 5,
  sci2: 5,
  enc: 5,
  inventionMaterialCost: 1_000_000,
  copyCost: 50_000,
  inventionJobCost: 100_000,
  baseRuns: 10,
  unitsPerRun: 1,
  materials: [{ quantity: 100, price: 1000 }],
  eivPerRun: 80_000,
  costIndex: 0.05,
  taxRate: 0.0025 + 0.04,
  structureBonus: 0,
  productPrice: 200_000,
  salesTax: 0.03
}

test('no decryptor: ME 2, TE 4, the base runs', () => {
  const r = inventionRun(base, null)
  assert.equal(r.me, 2)
  assert.equal(r.te, 4)
  assert.equal(r.runs, 10)
  close(r.chance, 0.4375)
  close(r.inventionCost, 1_150_000 / 0.4375) // the attempts it takes on average
  assert.equal(r.materialCost, 980 * 1000) // 100 × 10 runs × 0.98
  close(r.jobCost, 800_000 * (0.05 + 0.0425))
  close(r.revenue, 2_000_000 * 0.97)
  close(r.profit, r.revenue - r.inventionCost - r.materialCost - r.jobCost)
  close(r.costPerUnit, (r.inventionCost + r.materialCost + r.jobCost) / 10)
})

test('a decryptor changes the chance, the blueprint and pays for itself', () => {
  const r = inventionRun(base, { price: 500_000, chance: 1.8, me: -1, te: 4, runs: 4 })
  assert.equal(r.me, 1)
  assert.equal(r.te, 8)
  assert.equal(r.runs, 14)
  close(r.chance, 0.7875)
  close(r.inventionCost, 1_650_000 / 0.7875)
  assert.equal(r.materialCost, 1386 * 1000) // 100 × 14 × 0.99
})

test('materials round up and stay at one per run at least', () => {
  const r = inventionRun({ ...base, materials: [{ quantity: 1, price: 10 }] }, { price: 0, chance: 1, me: 3, te: 0, runs: 0 })
  assert.equal(r.materialCost, 100) // 1 × 10 × 0.95 = 9.5 → max(10 runs, 10)
})
