import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boosterInfo, boosterSideEffects, isCombatBooster } from './boosters.ts'

// Standard Blue Pill Booster and Synth Drop Booster as the SDE has them, cut down to what matters.
const db = {
  attributes: {
    548: { name: 'shieldBoostMultiplier', dn: ['Shield Boost Bonus', 'Повышение эффективности накачки щитов'], u: 121 },
    767: { name: 'trackingSpeedBonus', dn: ['Tracking Speed Bonus', 'Бонус скорости наводки'], u: 105 },
    1087: { name: 'boosterness' },
    1089: { name: 'boosterEffectChance1' },
    1143: { name: 'boosterShieldCapacityPenalty', dn: ['Shield Capacity Penalty', 'Штраф к запасу прочности щитов'], u: 105 },
    1150: { name: 'boosterCapacitorCapacityPenalty', dn: ['Capacitor Capacity Penalty', 'Штраф к ёмкости накопителя'], u: 105 },
    175: { name: 'intelligenceBonus', dn: ['Intelligence', 'Интеллект'], u: 0 }
  },
  effects: {
    2737: { name: 'boosterShieldCapacityPenalty', cat: 0, mods: [{ func: 'ItemModifier', domain: 'shipID', attr: 263, src: 1143, op: 6 }] },
    2745: { name: 'boosterCapacitorCapacityPenalty', cat: 0, mods: [{ func: 'ItemModifier', domain: 'shipID', attr: 482, src: 1150, op: 6 }] },
    4951: { name: 'shieldBoostAmplifierPassiveBooster', cat: 0, mods: [{ func: 'LocationRequiredSkillModifier', domain: 'shipID', attr: 68, src: 548, op: 6, skill: 21802 }, { func: 'LocationRequiredSkillModifier', domain: 'shipID', attr: 68, src: 548, op: 6, skill: 3416 }] },
    2847: { name: 'trackingSpeedBonusPassive', cat: 0, mods: [{ func: 'LocationRequiredSkillModifier', domain: 'shipID', attr: 160, src: 767, op: 6, skill: 3300 }] },
    9001: { name: 'accelerator', cat: 0, mods: [{ func: 'ItemModifier', domain: 'charID', attr: 165, src: 175, op: 2 }] }
  },
  dogma: {
    9950: { a: { 548: 20, 1087: 1, 1089: 0.2, 1143: -20, 1150: -20 }, e: [2737, 2745, 4951] },
    28674: { a: { 767: 6, 1087: 2 }, e: [2847] },
    40000: { a: { 175: 10, 1087: 1 }, e: [9001] }
  }
}

test('side effects are the ones that draw on a booster penalty attribute', () => {
  assert.deepEqual(boosterSideEffects(db, 9950), [2737, 2745])
  assert.deepEqual(boosterSideEffects(db, 28674), [])
})

test('a booster described: its slot, its bonus, each side effect with its chance', () => {
  const b = boosterInfo(db, 9950)
  assert.equal(b.slot, 1)
  assert.equal(b.chance, 0.2)
  // The bonus counted once, though two skills carry it.
  assert.deepEqual(b.main, [{ attr: 548, value: 20, name: ['Shield Boost Bonus', 'Повышение эффективности накачки щитов'], percent: true }])
  assert.deepEqual(
    b.side.map((s) => [s.effect, s.value]),
    [
      [2737, -20],
      [2745, -20]
    ]
  )
})

test('only boosters that change the ship or its weapons count for a fight: not a cerebral accelerator', () => {
  assert.equal(isCombatBooster(db, 9950), true)
  assert.equal(isCombatBooster(db, 28674), true)
  assert.equal(isCombatBooster(db, 40000), false)
})
