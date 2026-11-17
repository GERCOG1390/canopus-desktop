import assert from 'node:assert/strict'
import { test } from 'node:test'
import { strongestBuffs } from './fleetBuffs.ts'

// Shield Harmonizing (10) is aggregated by minimum, Shield Extension (12) by maximum, as in the SDE.
const defs = { 10: { agg: 'min' }, 12: { agg: 'max' } }

test('two bursts of the same kind: only the strongest applies', () => {
  const m = strongestBuffs(
    [
      { id: 10, value: -15 },
      { id: 10, value: -21.5625 },
      { id: 12, value: 15 },
      { id: 12, value: 21.5625 }
    ],
    defs
  )
  assert.equal(m.get(10), -21.5625)
  assert.equal(m.get(12), 21.5625)
})

test('unknown buffs and empty values are left out', () => {
  const m = strongestBuffs(
    [
      { id: 999, value: 5 },
      { id: 12, value: 0 }
    ],
    defs
  )
  assert.equal(m.size, 0)
})
