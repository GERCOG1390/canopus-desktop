import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extremeRoll, isBetter, rolledValue } from './mutaplasmid.ts'

// Large Shield Extender II with a Decayed mutaplasmid, the numbers seen in the game's show info.
test('a roll lands between the multipliers of the module\'s own value', () => {
  assert.equal(rolledValue(45, 0.95, 1.25, 0), 42.75)
  assert.equal(rolledValue(45, 0.95, 1.25, 1), 56.25)
  assert.ok(Math.abs(rolledValue(2600, 0.95, 1.1, 0.5) - 2665) < 1e-6)
})

test('better follows the way the attribute wants to go', () => {
  assert.equal(isBetter(2665, 2600, true), true) // more shield
  assert.equal(isBetter(27.5, 25, false), false) // more signature
  assert.equal(isBetter(42.75, 45, false), true) // less CPU
  assert.equal(isBetter(45, 45, false), false)
})

test('best and worst rolls pick the right end', () => {
  assert.equal(extremeRoll(2600, true, true), 1)
  assert.equal(extremeRoll(2600, true, false), 0)
  assert.equal(extremeRoll(45, false, true), 0)
  assert.equal(extremeRoll(45, false, false), 1)
  // A negative base goes down as the multiplier goes up.
  assert.equal(extremeRoll(-10, true, true), 0)
  assert.equal(extremeRoll(-10, false, true), 1)
})
