import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareModules, shownChange, workLoss } from './moduleCompare.ts'

// Attribute facts and module values from the SDE (build 3720952): name, published, "high is good", category.
const ATTRS = {
  6: { name: 'capacitorNeed', pub: true, high: false, cat: 5, def: 0 },
  9: { name: 'hp', pub: true, high: true, cat: 4, def: 0 },
  20: { name: 'speedFactor', pub: true, high: true, cat: 28, def: 0 },
  30: { name: 'power', pub: true, high: false, cat: 1, def: 0 },
  50: { name: 'cpu', pub: true, high: false, cat: 1, def: 0 },
  54: { name: 'maxRange', pub: true, high: true, cat: 29, def: 0 },
  73: { name: 'duration', pub: true, high: false, cat: 7, def: 0 },
  97: { name: 'energyNeutralizerAmount', pub: true, high: true, cat: 22, def: 0 },
  105: { name: 'warpScrambleStrength', pub: true, high: true, cat: 27, def: 0 },
  169: { name: 'agilityMultiplier', pub: true, high: false, cat: 7, def: 0 },
  182: { name: 'requiredSkill1', pub: true, high: true, cat: 8, def: 0 },
  422: { name: 'techLevel', pub: true, high: true, cat: 7, def: 0 },
  554: { name: 'signatureRadiusBonus', pub: true, high: false, cat: 21, def: 0 },
  633: { name: 'metaLevelOld', pub: true, high: true, cat: 7, def: 0 },
  848: { name: 'aoeCloudSizeBonus', pub: true, high: true, cat: 37, def: 0 },
  1180: { name: 'heatAbsorbtionRateModifier', pub: false, high: true, cat: 52, def: 0 },
  1211: { name: 'heatDamage', pub: true, high: false, cat: 52, def: 0 },
  1222: { name: 'overloadRangeBonus', pub: true, high: true, cat: 7, def: 0 },
  2044: { name: 'falloffEffectiveness', pub: true, high: true, cat: 29, def: 0 }
}
const SCRAM_II = { 6: 6, 9: 40, 30: 1, 50: 36, 54: 9000, 73: 5000, 105: 2, 182: 3435, 422: 2, 633: 5, 1180: 0.02, 1211: 5, 1222: 20 }
const SCRAM_I = { 6: 5, 9: 40, 30: 1, 50: 30, 54: 7500, 73: 5000, 105: 2, 182: 3435, 422: 1, 633: 0, 1180: 0.01, 1211: 5, 1222: 20 }
const WEB_II = { 6: 6, 9: 40, 20: -60, 30: 1, 50: 30, 54: 10000, 73: 5000, 422: 2, 633: 5, 1211: 5, 1222: 30, 2044: 0 }
const WEB_I = { 6: 5, 9: 40, 20: -50, 30: 1, 50: 25, 54: 10000, 73: 5000, 422: 1, 633: 0, 1211: 5, 1222: 30, 2044: 0 }
const NEUT_II = { 6: 150, 30: 200, 50: 20, 54: 10000, 73: 12000, 97: 180, 2044: 5000 }
const NEUT_I = { 6: 150, 30: 175, 50: 20, 54: 8000, 73: 12000, 97: 150, 2044: 4000 }
const STAB_II = { 169: -20, 554: 11, 633: 5 }
const STAB_I = { 169: -16.75, 554: 10, 633: 0 }

const by = (list, name) => list.find((c) => c.name === name)

test('a cheaper scrambler loses range: the whole-fit numbers never showed it', () => {
  const c = compareModules(SCRAM_II, SCRAM_I, ATTRS)
  const range = by(c, 'maxRange')
  assert.equal(range.role, 'work')
  assert.equal(range.worse, true)
  assert.ok(Math.abs(range.change - -1 / 6) < 1e-9)
  // Fitting and activation cost are costs, not losses of what the module does; meta and tech level are not compared.
  assert.equal(by(c, 'cpu').role, 'cost')
  assert.equal(by(c, 'cpu').worse, false)
  assert.equal(by(c, 'capacitorNeed').role, 'cost')
  assert.equal(by(c, 'metaLevelOld'), undefined)
  assert.equal(by(c, 'techLevel'), undefined)
  assert.equal(by(c, 'heatAbsorbtionRateModifier'), undefined)
  assert.ok(Math.abs(workLoss(c) - 1 / 6) < 1e-9)
})

test('a web slows by more when its factor is more negative, though the SDE says higher is better', () => {
  const c = compareModules(WEB_II, WEB_I, ATTRS)
  const f = by(c, 'speedFactor')
  assert.equal(f.worse, true)
  assert.ok(Math.abs(f.change - -1 / 6) < 1e-9)
  // And the other way round it is a gain.
  assert.equal(by(compareModules(WEB_I, WEB_II, ATTRS), 'speedFactor').worse, false)
})

test('a neutralizer: less energy and shorter reach', () => {
  const c = compareModules(NEUT_II, NEUT_I, ATTRS)
  assert.equal(by(c, 'energyNeutralizerAmount').worse, true)
  assert.equal(by(c, 'maxRange').worse, true)
  assert.equal(by(c, 'falloffEffectiveness').worse, true)
  assert.equal(by(c, 'power').worse, false)
  assert.ok(Math.abs(workLoss(c) - 0.2) < 1e-9)
})

test('an inertia stabilizer: a smaller inertia cut is a loss, a smaller signature penalty a gain', () => {
  const c = compareModules(STAB_II, STAB_I, ATTRS)
  assert.equal(by(c, 'agilityMultiplier').worse, true)
  assert.equal(by(c, 'signatureRadiusBonus').worse, false)
})

test('a missile rig: a bigger explosion radius cut is better, though the SDE flag says otherwise', () => {
  const c = compareModules({ 848: -15 }, { 848: -10 }, ATTRS)
  assert.equal(by(c, 'aoeCloudSizeBonus').worse, true)
})

test('heat is shown apart and does not block a swap; the same module changes nothing', () => {
  const c = compareModules({ 1211: 5, 1222: 30 }, { 1211: 6, 1222: 20 }, ATTRS)
  assert.ok(c.every((x) => x.role === 'heat'))
  assert.equal(workLoss(c), 0)
  assert.deepEqual(compareModules(SCRAM_II, SCRAM_II, ATTRS), [])
})

test('the shown figure is how the number itself moves; worse or better is told by colour', () => {
  // A cost that grows reads as a rise (CPU 30 → 36 is +20%), not as "−17%", though it is a loss.
  const cpu = by(compareModules(SCRAM_I, SCRAM_II, ATTRS), 'cpu')
  assert.equal(cpu.worse, true)
  assert.ok(Math.abs(shownChange(cpu) - 0.2) < 1e-9)
  // A weaker web: the slow goes from 60% to 50%, shown −17%.
  assert.ok(Math.abs(shownChange(by(compareModules(WEB_II, WEB_I, ATTRS), 'speedFactor')) - -1 / 6) < 1e-9)
  // A smaller explosion radius cut: 15% to 10% is −33%.
  assert.ok(Math.abs(shownChange(by(compareModules({ 848: -15 }, { 848: -10 }, ATTRS), 'aoeCloudSizeBonus')) - -1 / 3) < 1e-9)
  // Shorter range reads as it is.
  assert.ok(Math.abs(shownChange(by(compareModules(SCRAM_II, SCRAM_I, ATTRS), 'maxRange')) - -1 / 6) < 1e-9)
})

test('bonuses written as multipliers compare by the bonus: +5% against +4.5% is a tenth weaker, not 0.5%', () => {
  // Power Diagnostic System II against Mark I Compact (SDE units: 109 modifier percent, 111 inversed, 108 resonance).
  const A = {
    134: { name: 'shieldRechargeRateMultiplier', pub: true, high: false, cat: 7, def: 1, u: 111 },
    146: { name: 'shieldCapacityMultiplier', pub: true, high: true, cat: 7, def: 1, u: 109 },
    109: { name: 'kineticDamageResonance', pub: true, high: false, cat: 7, def: 1, u: 108 }
  }
  const c = compareModules({ 134: 0.915, 146: 1.05, 109: 0.55 }, { 134: 0.92, 146: 1.045, 109: 0.6 }, A)
  const cap = by(c, 'shieldCapacityMultiplier')
  assert.equal(cap.worse, true)
  assert.ok(Math.abs(cap.change - -0.1) < 1e-9)
  assert.ok(Math.abs(shownChange(cap) - -0.1) < 1e-9)
  const rech = by(c, 'shieldRechargeRateMultiplier')
  assert.equal(rech.worse, true)
  assert.ok(Math.abs(rech.change - -0.005 / 0.085) < 1e-9)
  // A hardener: 45% resist down to 40% is a ninth less resist.
  const res = by(c, 'kineticDamageResonance')
  assert.equal(res.worse, true)
  assert.ok(Math.abs(res.change - -1 / 9) < 1e-9)
  assert.ok(workLoss(c) > 0.1)
})
