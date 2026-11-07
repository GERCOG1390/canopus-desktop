import assert from 'node:assert/strict'
import { test } from 'node:test'
import { injectorGain, spCost, farmMonth, SP_PER_INJECTOR } from './skillFarm.ts'

test('an injector gives less the more SP the pilot has', () => {
  assert.equal(injectorGain(1_000_000), 500_000)
  assert.equal(injectorGain(4_999_999), 500_000)
  assert.equal(injectorGain(5_000_000), 400_000)
  assert.equal(injectorGain(49_596_000), 400_000)
  assert.equal(injectorGain(50_000_000), 300_000)
  assert.equal(injectorGain(79_999_999), 300_000)
  assert.equal(injectorGain(80_000_000), 150_000)
})

test('the price of a million SP follows the gain', () => {
  assert.equal(spCost(800_000_000, 49_596_000), 2_000_000_000)
  assert.ok(Math.abs(spCost(800_000_000, 90_000_000) - 800_000_000 / 0.15) < 1)
  assert.equal(spCost(0, 1), 0)
})

test('a month of farming: injectors made, less extractors, tax and the subscription', () => {
  const m = farmMonth({ spPerHour: 2700, days: 30, injectorPrice: 800_000_000, extractorPrice: 300_000_000, salesTax: 0.03, plexPrice: 5_000_000, plexPerMonth: 500, otherCost: 10_000_000 })
  assert.equal(m.sp, 1_944_000)
  assert.equal(m.injectors, 1_944_000 / SP_PER_INJECTOR)
  assert.equal(m.revenue, m.injectors * 800_000_000 * 0.97)
  assert.equal(m.extractors, m.injectors * 300_000_000)
  assert.equal(m.subscription, 2_500_000_000)
  assert.equal(m.profit, m.revenue - m.extractors - 2_500_000_000 - 10_000_000)
})
