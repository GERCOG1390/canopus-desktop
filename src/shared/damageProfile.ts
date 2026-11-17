// Tank against a damage profile: EHP and active tank when the incoming damage isn't an even split of the four
// types (Pyfa's damage patterns). Omni is the even split, the figure the fitting has always shown.

import type { FitStats, LayerStats } from './fit'
import { adaptRah, rahResist } from './combatTimeline.ts'

/** Shares of EM, thermal, kinetic, explosive damage (any scale) */
export type DamageWeights = [number, number, number, number]

export interface DamageProfile {
  id: string
  w: DamageWeights
}

export const BASIC_PROFILES: DamageProfile[] = [
  { id: 'omni', w: [1, 1, 1, 1] },
  { id: 'em', w: [1, 0, 0, 0] },
  { id: 'thermal', w: [0, 1, 0, 0] },
  { id: 'kinetic', w: [0, 0, 1, 0] },
  { id: 'explosive', w: [0, 0, 0, 1] }
]

/** The shares summing to 1; an empty profile counts as omni. */
export function normalized(w: readonly number[]): DamageWeights {
  const clean = w.map((x) => (Number.isFinite(x) && x > 0 ? x : 0))
  const sum = clean.reduce((a, b) => a + b, 0)
  return (sum > 0 ? clean.map((x) => x / sum) : [0.25, 0.25, 0.25, 0.25]) as DamageWeights
}

/** Share of the incoming damage a layer lets through, for this profile. */
export function passThrough(l: LayerStats, w: readonly number[]): number {
  const n = normalized(w)
  return l.resist.reduce((s, r, i) => s + n[i] * (1 - r), 0)
}

export const layerEhp = (l: LayerStats, w: readonly number[]): number => {
  const p = passThrough(l, w)
  return p > 0 ? l.hp / p : l.hp
}

export interface ProfileTank {
  shield: number
  armor: number
  hull: number
  ehp: number
  /** Effective repairs per second (the fit's active repairers) */
  activeTank: number
  /** The same with passive shield regeneration added */
  withRegen: number
}

/**
 * Armor with a running reactive armor hardener settled to the incoming damage: its cycles are stepped until it
 * stops moving, and where it keeps swinging between two states (the game's RAH does), the last cycles are averaged.
 */
export function armorAgainst(d: FitStats['defense'], w: readonly number[]): LayerStats {
  const rah = d.rah
  if (!rah) return d.armor
  const n = normalized(w)
  let vector = [...rah.start]
  const tail: number[][] = []
  for (let i = 0; i < 120; i++) {
    const resist = rahResist(rah, vector)
    vector = adaptRah(vector, n.map((x, k) => x * (1 - resist[k])), rah.shift)
    if (i >= 100) tail.push(vector)
  }
  const avg = vector.map((_, k) => tail.reduce((s, v) => s + v[k], 0) / tail.length)
  return { ...d.armor, resist: rahResist(rah, avg) as LayerStats['resist'] }
}

export function tankAgainst(d: FitStats['defense'], w: readonly number[]): ProfileTank {
  const shield = layerEhp(d.shield, w)
  const armorLayer = armorAgainst(d, w)
  const armor = layerEhp(armorLayer, w)
  const hull = layerEhp(d.hull, w)
  const eff = (hp: number, l: LayerStats) => {
    const p = passThrough(l, w)
    return p > 0 ? hp / p : 0
  }
  const activeTank = eff(d.shieldBoost, d.shield) + eff(d.armorRepair, armorLayer) + eff(d.hullRepair, d.hull)
  return { shield, armor, hull, ehp: shield + armor + hull, activeTank, withRegen: activeTank + eff(d.passiveShieldRegen, d.shield) }
}

/**
 * Damage per second an NPC deals by type (EM, thermal, kinetic, explosive), from its SDE attributes: turrets as
 * damage × damageMultiplier per rate of fire, missiles as its missile's damage × missileDamageMultiplier per
 * launch duration. NPCs without launchers carry a placeholder launch duration of 1 ms that would count a missile
 * a thousand times a second: under a second it isn't a launcher.
 */
export function npcDps(a: Record<number, number>, missile?: Record<number, number>): DamageWeights {
  // emDamage, thermalDamage, kineticDamage, explosiveDamage
  const TYPES = [114, 118, 117, 116]
  const out: DamageWeights = [0, 0, 0, 0]
  const rof = (a[51] ?? 0) / 1000
  if (rof > 0) TYPES.forEach((attr, i) => (out[i] += ((a[attr] ?? 0) * (a[64] || 1)) / rof))
  const launch = (a[506] ?? 0) / 1000
  if (missile && launch >= 1) TYPES.forEach((attr, i) => (out[i] += ((missile[attr] ?? 0) * (a[212] || 1)) / launch))
  return out
}
