import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FACILITIES, brokerPct, colonyIncome, reactionTimeFactor, rigBonus, securityBand, extractorPerHour, extractorValues, jobTimeFactor, salesTaxPct, transferTax } from './industryRules.ts'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)

test('fees follow the skills', () => {
  close(salesTaxPct(0), 7.5)
  close(salesTaxPct(5), 3.375)
  close(brokerPct(0), 3)
  close(brokerPct(5), 1.5)
})

test('engineering complexes have the bonuses of the SDE', () => {
  const by = Object.fromEntries(FACILITIES.map((f) => [f.id, f]))
  assert.equal(by.npc.me, 0)
  assert.deepEqual([by.raitaru.me, by.raitaru.cost, by.raitaru.time], [1, 3, 15])
  assert.deepEqual([by.azbel.me, by.azbel.cost, by.azbel.time], [1, 4, 20])
  assert.deepEqual([by.sotiyo.me, by.sotiyo.cost, by.sotiyo.time], [1, 5, 30])
})

test('job time: Industry V and Advanced Industry V take off 32%', () => {
  close(jobTimeFactor(5, 5), 0.8 * 0.85)
  close(jobTimeFactor(0, 0), 1)
})

test('moving intermediates costs an export and half an export again', () => {
  // Broadcast Node at 10%: 120 P2 and 18 P3 an hour between planets.
  close(transferTax([{ rate: 120, base: 7200 }, { rate: 18, base: 60000 }], 10), 86400 * 1.5 + 108000 * 1.5)
})

test('an extractor follows CCP’s published formula', () => {
  // By hand for the first 30-minute cycle of 6965: bar width 2, t = 1.
  const q = 6965
  const t = 1
  const decay = q / (1 + t * 0.012)
  const shift = q ** 0.7
  const sin = Math.max(0, (Math.cos(shift + t / 12) + Math.cos(shift / 2 + t * 0.2) + Math.cos(t * 0.5)) / 3)
  assert.equal(extractorValues(q, 1800, 1)[0], Math.floor(2 * decay * (1 + 0.8 * sin)))
})

test('over a real program it yields far more than qty per cycle-time', () => {
  // The naive reading is 6965 an hour·(3600/1800)/... ; a 30-minute program yields about half as much again.
  const naive = (6965 * 3600) / 1800
  const real = extractorPerHour(6965, 1800, 48)
  assert.ok(real > naive * 1.2 && real < naive * 2.2, `${real} vs ${naive}`)
  assert.equal(extractorPerHour(0, 1800, 48), 0)
})

// Audit 2026-11-16: the market tools used 1.5% for everyone; standings with the station owner lower it.
test('broker fee: Broker Relations and standings with the station owner, never under 1%', () => {
  assert.equal(brokerPct(5), 1.5)
  assert.equal(Number(brokerPct(5, 5, 5).toFixed(4)), 1.25)
  assert.equal(brokerPct(5, 10, 10), 1)
  assert.equal(brokerPct(0), 3)
})

// Audit 2026-11-16: two extractor planets shipping P1 to a factory planet counted the P1 and the P2 made from it.
test('PI income nets the colonies: hauled P1 counts once, as the P2 it becomes', () => {
  const P1 = 1
  const P2 = 2
  const extractorA = new Map([[P1, 3000]])
  const extractorB = new Map([[P1, 3000]])
  const factory = new Map([
    [P1, -6000],
    [P2, 750]
  ])
  const sale = (id) => (id === P2 ? 10_000 : 400)
  assert.equal(colonyIncome([extractorA, extractorB, factory], sale, sale), 750 * 10_000)
  // Short of P1: the rest is bought.
  assert.equal(colonyIncome([extractorA, factory], sale, sale), 750 * 10_000 - 3000 * 400)
})

// Audit 2026-11-16: only the hull's 1% counted; rigs and the security multiplier were missing.
test('rigs: Tech I/II material and time savings times the system multiplier', () => {
  assert.equal(rigBonus('me', 2, 'null'), 2.4 * 2.1)
  assert.equal(rigBonus('me', 1, 'low'), 2 * 1.9)
  assert.equal(rigBonus('me', 1, 'high'), 2)
  assert.equal(rigBonus('te', 2, 'high'), 24)
  assert.equal(rigBonus('me', 0, 'null'), 0)
  assert.equal(rigBonus('me', 2, 'null', true), 2.4 * 1.1)
  assert.equal(rigBonus('me', 1, 'high', true), 0)
  // A Sotiyo with a Tech II ME rig in null: 1 − 0.99 × (1 − 0.0504) = 5.99% saved.
  const saved = 1 - 0.99 * (1 - rigBonus('me', 2, 'null') / 100)
  assert.ok(Math.abs(saved - 0.059896) < 1e-6)
})

test('security bands as the game rounds them, and the Reactions skill', () => {
  assert.equal(securityBand(0.46), 'high')
  assert.equal(securityBand(0.44), 'low')
  assert.equal(securityBand(0.0), 'null')
  assert.equal(securityBand(-0.5), 'null')
  assert.equal(reactionTimeFactor(5), 0.8)
})
