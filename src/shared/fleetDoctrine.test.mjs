import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareFleet } from './fleetDoctrine.ts'

const FEROX = 37480, BASI = 11985, SCYTHE = 631, POD = 670
const member = (id, ship) => ({ character_id: id, ship_type_id: ship })

test('splits the fleet into doctrine hulls and the rest, every doctrine hull listed', () => {
  const r = compareFleet([member(1, FEROX), member(2, FEROX), member(3, SCYTHE), member(4, POD)], [FEROX, BASI, FEROX])
  assert.deepEqual(r.hulls, [{ type: FEROX, count: 2 }, { type: BASI, count: 0 }])
  assert.deepEqual(r.offDoctrine.map((m) => m.character_id), [3, 4])
  assert.equal(r.onDoctrine, 2)
  assert.equal(r.total, 4)
  assert.equal(r.share, 0.5)
})

test('an empty fleet has no share to divide', () => {
  const r = compareFleet([], [FEROX])
  assert.equal(r.share, 0)
  assert.deepEqual(r.hulls, [{ type: FEROX, count: 0 }])
})
