import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addScenario, decodeScenario, encodeScenario, removeScenario } from './combatScenario.ts'

const pilot = (ship, name) => ({ skills: { mode: 'all5' }, fit: { shipTypeId: ship, name, modules: [{ typeId: 2873, slot: 'hi', state: 'active', chargeTypeId: 12608 }], drones: [], implants: [] } })
const scenario = (name) => ({
  name,
  savedAt: '2026-11-22T10:00:00.000Z',
  attacker: pilot(587, 'Рифтер «кайт»'),
  setup: { sc: { distance: 7500, speedA: 1000, headingA: 0, speedB: 900, headingB: 90, behaviorA: 'orbit', heatA: 'safe' }, ammoA: { 2873: 12625 }, defender: pilot(603, 'Merlin') }
})

test('a scenario goes through one line of text and comes back the same, Cyrillic included', () => {
  const s = scenario('Рифтер против Мерлина в упор')
  const line = encodeScenario(s)
  assert.match(line, /^canopus-sim:1:[A-Za-z0-9+/=]+$/)
  assert.deepEqual(decodeScenario(line), s)
  // Pasted from a chat: wrapped and padded.
  assert.deepEqual(decodeScenario(`  ${line.slice(0, 30)}\n${line.slice(30)}  `), s)
})

test('anything else pasted is not a scenario', () => {
  assert.equal(decodeScenario('[Rifter, Smoke Rifter]'), null)
  assert.equal(decodeScenario('canopus-sim:1:not base64 at all!'), null)
  assert.equal(decodeScenario('canopus-sim:1:' + btoa('{"name":"x"}')), null)
  const noShip = scenario('x')
  noShip.attacker = { skills: {}, fit: { modules: [] } }
  assert.equal(decodeScenario(encodeScenario(noShip)), null)
})

test('the library: newest first, the same name replaces the old one, delete by name', () => {
  let lib = addScenario([], scenario('A'))
  lib = addScenario(lib, scenario('B'))
  lib = addScenario(lib, { ...scenario('A'), savedAt: '2026-11-23T00:00:00.000Z' })
  assert.deepEqual(lib.map((s) => s.name), ['A', 'B'])
  assert.equal(lib[0].savedAt, '2026-11-23T00:00:00.000Z')
  assert.deepEqual(removeScenario(lib, 'A').map((s) => s.name), ['B'])
})
