import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ecmJamChance, neutBite } from './projectedRules.ts'

// Review 2026-11-15: a Capital Energy Neutralizer II drained a cruiser in full; its 8000 m signature resolution
// lets only signature / 8000 of it through on a small ship.
test('a capital neutralizer barely touches a cruiser', () => {
  assert.equal(neutBite(4400, 1, 120, 8000), 4400 * (120 / 8000))
})

test('a big enough ship takes it all; a sub-capital neut has no signature resolution', () => {
  assert.equal(neutBite(4400, 1, 9000, 8000), 4400)
  assert.equal(neutBite(600, 1, 120), 600)
})

test('the ship resists energy warfare on top', () => {
  assert.equal(neutBite(600, 0.5, 120), 300)
})

test('ECM: each jammer rolls on its own against the sensor strength', () => {
  assert.equal(ecmJamChance([5], 1, 20), 0.25)
  // Two at 25%: 1 − 0.75² = 43.75%
  assert.equal(ecmJamChance([5, 5], 1, 20), 1 - 0.75 * 0.75)
  assert.equal(ecmJamChance([5], 0.5, 20), 0.125)
  assert.equal(ecmJamChance([50], 1, 20), 1)
  assert.equal(ecmJamChance([], 1, 20), 0)
})
