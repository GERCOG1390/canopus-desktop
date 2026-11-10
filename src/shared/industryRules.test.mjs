import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FACILITIES, brokerPct, extractorPerHour, extractorValues, jobTimeFactor, salesTaxPct, transferTax } from './industryRules.ts'

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
