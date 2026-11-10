import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capacitorStability, launchDrones } from './fitRules.ts'

const NO_REGEN = 1e9

test('a capacitor booster is counted with its reload', () => {
  const drain = { need: 50, cycle: 1 }
  const booster = { need: -800, cycle: 12 }
  // 800 per 12 s would be 66.7 GJ/s against a drain of 50: fine without reloads.
  assert.equal(capacitorStability(5000, NO_REGEN, [drain, booster]).stable, true)
  // One charge per load and 10 s to reload: 800 per 22 s, 36.4 GJ/s. It runs dry.
  const r = capacitorStability(5000, NO_REGEN, [drain, { ...booster, shots: 1, reloadSec: 10 }])
  assert.equal(r.stable, false)
  assert.ok(r.lastsSec > 0)
})

test('with no booster the stable level is the game formula', () => {
  // 10·C/T·(√s − s) = drain; C 1000, T 100 s, drain 10 GJ/s: √s = (1 + √(1 − 0.4))/2 ... s = 0.25·(1 + √0.6)²
  const r = capacitorStability(1000, 100, [{ need: 10, cycle: 1 }])
  assert.equal(r.stable, true)
  assert.ok(Math.abs(r.stableLevel - 0.25 * (1 + Math.sqrt(0.6)) ** 2) < 1e-9)
})

test('drones launched from an import stop at the bandwidth and at five', () => {
  // Gila: 20 Mbit/s, medium drones take 10 each.
  assert.deepEqual(launchDrones([{ count: 5, bandwidth: 10 }], 20, 5), [2])
  // Light drones: 5 at 5 Mbit/s in 25.
  assert.deepEqual(launchDrones([{ count: 10, bandwidth: 5 }], 25, 5), [5])
  // Two stacks share what's left.
  assert.deepEqual(launchDrones([{ count: 2, bandwidth: 10 }, { count: 5, bandwidth: 5 }], 25, 5), [2, 1])
  // Unknown bandwidth: nothing to go by, keep the old limit of five.
  assert.deepEqual(launchDrones([{ count: 8, bandwidth: 0 }], 0, 5), [5])
})
