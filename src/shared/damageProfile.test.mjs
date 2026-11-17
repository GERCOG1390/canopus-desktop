import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layerEhp, normalized, npcDps, passThrough, tankAgainst } from './damageProfile.ts'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)
// A typical armor layer: low explosive and EM, high kinetic and thermal.
const armor = { hp: 10_000, resist: [0.5, 0.7, 0.8, 0.4], ehp: 0 }
const shield = { hp: 2_000, resist: [0, 0.2, 0.4, 0.5], ehp: 0 }
const hull = { hp: 3_000, resist: [0.33, 0.33, 0.33, 0.33], ehp: 0 }
const defense = { shield, armor, hull, shieldBoost: 0, armorRepair: 100, hullRepair: 0, passiveShieldRegen: 10 }

test('omni is the plain average the fitting always showed', () => {
  const avgPass = (0.5 + 0.3 + 0.2 + 0.6) / 4
  close(layerEhp(armor, [1, 1, 1, 1]), 10_000 / avgPass)
})

test('one damage type: HP over that type alone', () => {
  close(layerEhp(armor, [0, 0, 0, 1]), 10_000 / 0.6)
  close(layerEhp(armor, [0, 0, 1, 0]), 10_000 / 0.2)
})

test('shares are scaled to 1, and an empty or broken profile counts as omni', () => {
  assert.deepEqual(normalized([2, 2, 0, 0]), [0.5, 0.5, 0, 0])
  assert.deepEqual(normalized([0, 0, 0, 0]), [0.25, 0.25, 0.25, 0.25])
  assert.deepEqual(normalized([NaN, -1, 0, 0]), [0.25, 0.25, 0.25, 0.25])
  close(passThrough(armor, [55, 45, 0, 0]), 0.55 * 0.5 + 0.45 * 0.3)
})

test('a repairer is worth more against what the layer resists', () => {
  const kin = tankAgainst(defense, [0, 0, 1, 0])
  const exp = tankAgainst(defense, [0, 0, 0, 1])
  close(kin.activeTank, 100 / 0.2)
  close(exp.activeTank, 100 / 0.6)
  close(kin.ehp, kin.shield + kin.armor + kin.hull)
  close(kin.withRegen - kin.activeTank, 10 / 0.6)
})

// Found checking the Guristas profile (2026-11-15): it came out 100% kinetic, because NPCs without launchers
// carry a 1 ms launch duration and their placeholder missile was counted a thousand times a second.
test('an NPC with a placeholder launch duration has no missile damage', () => {
  const cruise = { 117: 300, 118: 0 }
  const turretOnly = { 51: 2500, 64: 2, 117: 10, 118: 10, 506: 1, 507: 203 }
  assert.deepEqual(npcDps(turretOnly, cruise), [0, 8, 8, 0])
})

test('an NPC launcher counts its missile per launch, scaled by its multiplier', () => {
  const pith = { 51: 2750, 64: 2.75, 117: 20, 118: 16, 506: 6650, 507: 203, 212: 1.33 }
  const d = npcDps(pith, { 117: 300 })
  close(d[1], (16 * 2.75) / 2.75)
  close(d[2], (20 * 2.75) / 2.75 + (300 * 1.33) / 6.65)
})

// Review 2026-11-15: the tank against a profile left the reactive armor hardener at its starting 15% each, while
// in the game it shifts to the damage taken within a few cycles (and Pyfa adapts it to the damage pattern).
test('a reactive armor hardener settles to the chosen profile', () => {
  const rah = { index: 0, cycle: 10, shift: 0.06, start: [0.85, 0.85, 0.85, 0.85], rest: [0.5, 0.5, 0.5, 0.5], peers: [[], [], [], []] }
  const armorWithRah = { hp: 10_000, resist: [1 - 0.5 * 0.85, 1 - 0.5 * 0.85, 1 - 0.5 * 0.85, 1 - 0.5 * 0.85], ehp: 0 }
  const d = { ...defense, armor: armorWithRah, rah }
  const kin = tankAgainst(d, [0, 0, 1, 0])
  close(kin.armor, 10_000 / (0.5 * 0.4), 1)
  // Omni: the RAH stays spread, about 15% each.
  const omni = tankAgainst(d, [1, 1, 1, 1])
  close(omni.armor, 10_000 / (0.5 * 0.85), 300)
})
