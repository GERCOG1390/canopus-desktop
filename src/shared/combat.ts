// Combat simulator: two fits against each other at a given geometry (distance, speeds, headings).

import type { FitSpec, SkillSource } from './fit'

export interface CombatPilot {
  fit: FitSpec
  skills: SkillSource
}

/**
 * Geometry of the engagement. Headings are the angle between a ship's velocity and the line from
 * "you" to the opponent, in degrees (0 = straight at the opponent / away from you, 90 = sideways).
 * Two ships moving sideways in opposite directions (90 and 270) add up their transversal speed.
 */
export interface CombatScenario {
  /** Distance between the ships, m */
  distance: number
  /** Your speed, m/s */
  speedA: number
  headingA: number
  /** Opponent's speed, m/s */
  speedB: number
  headingB: number
  /** Signature radius overrides (e.g. a painted target), m; undefined = from the fit */
  sigA?: number
  sigB?: number
}

/** One weapon group as it applies against the target. */
export interface AppliedWeapon {
  typeId: number
  chargeTypeId?: number
  kind: 'turret' | 'missile' | 'drone' | 'smartbomb'
  count: number
  /** Paper DPS */
  dps: number
  /** DPS that lands, before the target's resists */
  applied: number
  /** applied / dps */
  factor: number
  /** Why application is reduced ("out of range", "tracking", "explosion radius"...) */
  limit?: string
}

export interface CombatDirection {
  weapons: AppliedWeapon[]
  paperDps: number
  /** Landing DPS per damage type (em, thermal, kinetic, explosive), before resists */
  appliedByType: [number, number, number, number]
  applied: number
  /** DPS after the target's resists, per layer */
  effective: { shield: number; armor: number; hull: number }
  /** Target's repairs per layer (HP/s): shield boost + passive regen, armor and hull repair */
  repair: { shield: number; armor: number; hull: number }
  /** Seconds to strip each layer; Infinity when the damage doesn't beat the repair */
  time: { shield: number; armor: number; hull: number }
  timeToKill: number
  /** Target's repairs need a capacitor that runs out: they are counted only while it lasts */
  capWarning?: string
}

export interface CombatSideInfo {
  shipTypeId: number
  name: string
  maxVelocity: number
  signature: number
  ehp: number
  hp: { shield: number; armor: number; hull: number }
  resist: { shield: number[]; armor: number[]; hull: number[] }
  /** Weapon reach: turret optimal (+ falloff) or missile flight range, m */
  ranges: { kind: 'turret' | 'missile'; typeId: number; optimal: number; falloff?: number }[]
}

export interface CombatResult {
  a: CombatSideInfo
  b: CombatSideInfo
  /** You → opponent */
  ab: CombatDirection
  /** Opponent → you */
  ba: CombatDirection
  angularVelocity: number
  transversal: number
  /** Applied DPS (before resists) over distance, for the chart */
  curve: { distance: number[]; ab: number[]; ba: number[] }
}
