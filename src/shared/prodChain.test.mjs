import assert from 'node:assert/strict'
import { test } from 'node:test'
import { jobMaterial, planChain } from './prodChain.ts'

const ROOT = 1, A = 2, B = 3, T = 10, U = 11
const recipe = (product, portion, mats, activity = 'manufacturing', time = 100) => ({ product, portion, mats, time, activity })
const plain = { rootMe: 0, compMe: 0, structure: 0, te: 0, rate: { manufacturing: 0, reaction: 0 } }
const prices = (o) => (id) => o[id] ?? 0
const plan = (recipes, price, extra = {}) =>
  planChain({ root: ROOT, runs: 1, recipes, price: prices(price), adjusted: () => 0, options: plain, ...extra })
const job = (p, id) => p.jobs.find((j) => j.id === id)
const buy = (p, id) => p.buys.find((b) => b.id === id)

test('materials per job: rounded up per job, never under one per run', () => {
  assert.equal(jobMaterial(10, 1, 10, 0), 9)
  assert.equal(jobMaterial(11, 2, 10, 0), 20) // 19.8
  assert.equal(jobMaterial(1, 3, 10, 0), 3) // 2.7 → 3
  assert.equal(jobMaterial(1, 10, 50, 0), 10) // 5, but one per run
  assert.equal(jobMaterial(100, 1, 10, 1), 90) // 89.1 → 90
})

test('a cheaper component is built, and shared materials add up', () => {
  // A costs 11×2/5 = 4.4 a unit to build against 20 on the market.
  const p = plan({ [ROOT]: recipe(ROOT, 1, [[A, 10], [T, 100]]), [A]: recipe(A, 5, [[T, 11]]) }, { [T]: 2, [A]: 20, [ROOT]: 1000 })
  assert.equal(job(p, A).runs, 2)
  assert.equal(job(p, A).surplus, 0)
  assert.equal(buy(p, T).qty, 122) // 100 + 2×11
  assert.equal(p.materialCost, 244)
  assert.equal(p.marketCost, 1000)
  assert.equal(buy(p, A), undefined)
})

test('a dearer component is bought', () => {
  const p = plan({ [ROOT]: recipe(ROOT, 1, [[A, 10]]), [A]: recipe(A, 1, [[T, 10]]) }, { [T]: 2, [A]: 5 })
  assert.equal(job(p, A), undefined)
  assert.equal(buy(p, A).qty, 10)
  assert.equal(buy(p, A).buildUnit, 20)
  assert.equal(p.total, 50)
})

test('the choice can be overruled either way', () => {
  const recipes = { [ROOT]: recipe(ROOT, 1, [[A, 10]]), [A]: recipe(A, 1, [[T, 10]]) }
  const built = plan(recipes, { [T]: 2, [A]: 5 }, { overrides: new Map([[A, 'build']]) })
  assert.equal(job(built, A).runs, 10)
  assert.equal(built.total, 200)
  assert.equal(job(built, A).forced, true)
  const boughtPlan = plan(recipes, { [T]: 1, [A]: 50 }, { overrides: new Map([[A, 'buy']]) })
  assert.equal(job(boughtPlan, A), undefined)
  assert.equal(boughtPlan.total, 500)
})

test('a batch is rounded once, after every parent has asked', () => {
  // Root takes 2 of A and 1 of B; B takes 2 of A: 4 of A in all, one run of 5, not two.
  const recipes = {
    [ROOT]: recipe(ROOT, 1, [[A, 2], [B, 1]]),
    [B]: recipe(B, 1, [[A, 2]]),
    [A]: recipe(A, 5, [[T, 5]])
  }
  const p = plan(recipes, { [T]: 1, [A]: 100, [B]: 1000 })
  assert.equal(job(p, A).runs, 1)
  assert.equal(job(p, A).made, 5)
  assert.equal(job(p, A).surplus, 1)
  assert.equal(buy(p, T).qty, 5)
  // Parents come before their components.
  const ids = p.jobs.map((j) => j.id)
  assert.ok(ids.indexOf(B) < ids.indexOf(A))
})

test('efficiency: own and component blueprints differ, reactions take none', () => {
  const recipes = {
    [ROOT]: recipe(ROOT, 1, [[A, 100], [B, 100]]),
    [A]: recipe(A, 1, [[T, 10]]),
    [B]: recipe(B, 1, [[U, 10]], 'reaction')
  }
  const p = plan(recipes, { [T]: 1, [U]: 1, [A]: 1000, [B]: 1000 }, { options: { ...plain, rootMe: 2, compMe: 10 } })
  assert.equal(job(p, A).runs, 98) // 100 at ME 2
  assert.equal(buy(p, T).qty, 882) // 98×10×0.9
  assert.equal(buy(p, U).qty, 980) // no ME on a reaction
})

test('job cost: base materials at adjusted price × the activity rate × runs', () => {
  const recipes = { [ROOT]: recipe(ROOT, 1, [[A, 10]]), [A]: recipe(A, 1, [[T, 10]], 'reaction') }
  const p = plan(recipes, { [T]: 1, [A]: 1000 }, {
    runs: 2,
    adjusted: (id) => ({ [A]: 50, [T]: 2 })[id] ?? 0,
    options: { ...plain, rootMe: 50, rate: { manufacturing: 0.1, reaction: 0.2 } }
  })
  // Root: 10×50×0.1 per run, ME doesn't lower the value; A: 10 needed, 10×2×0.2 per run.
  assert.equal(job(p, ROOT).jobCost, 100)
  assert.equal(job(p, A).runs, 10)
  assert.equal(job(p, A).jobCost, 40)
})

test('time: te applies to manufacturing only and jobs add up', () => {
  const recipes = { [ROOT]: recipe(ROOT, 1, [[A, 2]], 'manufacturing', 100), [A]: recipe(A, 1, [[T, 1]], 'reaction', 60) }
  const p = plan(recipes, { [T]: 1, [A]: 1000 }, { options: { ...plain, te: 20 } })
  assert.equal(job(p, ROOT).time, 80)
  assert.equal(job(p, A).time, 120)
  assert.equal(p.time, 200)
})

test('no market price: a component is built, a raw material is flagged', () => {
  const p = plan({ [ROOT]: recipe(ROOT, 1, [[A, 1], [U, 1]]), [A]: recipe(A, 1, [[T, 1]]) }, { [T]: 1 })
  assert.ok(job(p, A))
  assert.deepEqual(p.unpriced, [U])
})

test('several runs and a portion on the item itself', () => {
  const p = plan({ [ROOT]: recipe(ROOT, 100, [[T, 3]]) }, { [T]: 1, [ROOT]: 2 }, { runs: 4 })
  assert.equal(p.made, 400)
  assert.equal(buy(p, T).qty, 12)
  assert.equal(p.marketCost, 800)
})

test('a recipe that loops back ends, buying at the loop', () => {
  const recipes = { [ROOT]: recipe(ROOT, 1, [[A, 1]]), [A]: recipe(A, 1, [[ROOT, 1], [T, 1]]) }
  const p = plan(recipes, { [T]: 1, [ROOT]: 2, [A]: 100 })
  assert.ok(p)
  assert.equal(buy(p, ROOT).qty, 1)
  assert.equal(buy(p, T).qty, 1)
})

test('something with no recipe has no plan', () => {
  assert.equal(plan({}, {}), null)
})

test('a whole batch has to pay off: one drone does not run a 10 000 unit reaction', () => {
  // A unit of A is 1 to build and 2 on the market, but a run makes 10 000 and costs 10 000 in all.
  const recipes = (need) => ({ [ROOT]: recipe(ROOT, 1, [[A, need]]), [A]: recipe(A, 10000, [[T, 10]], 'reaction') })
  const prices = { [T]: 1000, [A]: 2 }
  const few = plan(recipes(28), prices)
  assert.equal(job(few, A), undefined)
  assert.equal(buy(few, A).qty, 28)
  assert.equal(few.total, 56)
  // 9 000 at 2 is 18 000: now the 10 000 batch is worth it, with a thousand left over.
  const many = plan(recipes(9000), prices)
  assert.equal(job(many, A).runs, 1)
  assert.equal(job(many, A).surplus, 1000)
  assert.equal(many.total, 10000)
  assert.equal(many.surplusValue, 2000)
})

test('what a bought parent no longer needs is not built', () => {
  const recipes = { [ROOT]: recipe(ROOT, 1, [[A, 1]]), [A]: recipe(A, 1, [[B, 1]]), [B]: recipe(B, 1, [[T, 1]]) }
  const p = plan(recipes, { [T]: 1, [A]: 1000, [B]: 1000 }, { overrides: new Map([[A, 'buy']]) })
  assert.deepEqual(p.jobs.map((j) => j.id), [ROOT])
  assert.deepEqual(p.buys.map((b) => b.id), [A])
})
