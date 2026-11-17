// Damage over distance: what a fit lands on a target of a given size and speed at every range, with the game's
// turret, missile and drone formulas (combatTimeline.ts). Pyfa's main graph; here the fit's own webs and
// painters can be counted at each distance, since how far they reach decides the curve.

import type { FitStats, WeaponStats } from './fit'
import { application, stackedMultiplier, type Tactical } from './combatTimeline.ts'

export interface GraphTarget {
  /** Signature radius, m */
  sig: number
  /** Top speed, m/s */
  speed: number
  /** Angle between the target's heading and the line from the shooter, degrees: 0 flies straight away, 90 sideways */
  angle: number
  /** Count the shooter's own webs and painters (strength falls off with their range) */
  ownEwar: boolean
  /** The shooter's speed, m/s, and heading against the line to the target: 0 flies at it, 90 sideways */
  shooterSpeed?: number
  shooterAngle?: number
}

export type WeaponKind = WeaponStats['kind']

export interface GraphPoint {
  /** m */
  distance: number
  dps: number
  /** Applied DPS of each weapon kind */
  byKind: Partial<Record<WeaponKind, number>>
  /** The target's speed and signature at this distance (after the shooter's webs and painters) */
  speed: number
  sig: number
}

/**
 * Common targets, sizes and speeds of an ordinary fit of the class, or a still ideal target. A microwarpdrive II
 * blooms the signature by 475% (×5.75); an afterburner doesn't.
 */
export const TARGET_PRESETS: { id: string; sig: number; speed: number }[] = [
  { id: 'ideal', sig: 100_000, speed: 0 },
  { id: 'frigate', sig: 35, speed: 400 },
  { id: 'frigateAb', sig: 35, speed: 1000 },
  { id: 'frigateMwd', sig: 200, speed: 2500 },
  { id: 'destroyer', sig: 70, speed: 300 },
  { id: 'cruiser', sig: 130, speed: 230 },
  { id: 'cruiserMwd', sig: 750, speed: 1300 },
  { id: 'battlecruiser', sig: 280, speed: 160 },
  { id: 'battleship', sig: 420, speed: 110 },
  { id: 'structure', sig: 10_000, speed: 0 }
]

function ewarModules(stats: FitStats): Tactical[] {
  return stats.modules.filter((m) => m.tactical && (m.tactical.kind === 'web' || m.tactical.kind === 'paint')).map((m) => ({ typeId: 0, t: m.tactical! }))
}

/** Applied DPS at one distance. */
export function appliedAt(stats: FitStats, target: GraphTarget, distance: number): GraphPoint {
  const mods = target.ownEwar ? ewarModules(stats) : []
  const speed = target.speed * stackedMultiplier(mods, 'web', distance)
  const sig = target.sig * stackedMultiplier(mods, 'paint', distance)
  // Velocities along the line from shooter to target (x) and across it (y): what the target gains on the shooter
  // is the receding speed, the sideways difference is the transversal.
  const rad = (deg: number) => (Math.max(0, Math.min(180, deg)) * Math.PI) / 180
  const tx = speed * Math.cos(rad(target.angle))
  const ty = speed * Math.sin(rad(target.angle))
  const own = target.shooterSpeed ?? 0
  const sx = own * Math.cos(rad(target.shooterAngle ?? 0))
  const sy = own * Math.sin(rad(target.shooterAngle ?? 0))
  const geometry = {
    distance,
    transversal: Math.abs(ty - sy),
    targetSpeed: speed,
    targetSig: sig,
    receding: tx - sx
  }
  const byKind: GraphPoint['byKind'] = {}
  let dps = 0
  for (const w of stats.offense.weapons) {
    // Drones obey only within control range (sentries too: they shoot what the pilot tells them).
    if (w.kind === 'drone' && distance > stats.targeting.droneControlRange) continue
    const v = w.dps * application(w, geometry).factor
    byKind[w.kind] = (byKind[w.kind] ?? 0) + v
    dps += v
  }
  return { distance, dps, byKind, speed, sig }
}

/** How far the graph should reach: past the longest weapon and drone control range, to the next round number. */
export function graphReach(list: FitStats[]): number {
  let far = 10_000
  for (const s of list) {
    for (const w of s.offense.weapons) {
      const reach = w.kind === 'drone' ? s.targeting.droneControlRange : w.kind === 'turret' ? (w.optimal ?? 0) + 2.5 * (w.falloff ?? 0) : (w.optimal ?? 0)
      far = Math.max(far, reach)
    }
  }
  const step = far > 100_000 ? 20_000 : far > 40_000 ? 10_000 : 5_000
  return Math.min(300_000, Math.ceil((far * 1.1) / step) * step)
}

export function dpsCurve(stats: FitStats, target: GraphTarget, reach: number, steps = 240): GraphPoint[] {
  return Array.from({ length: steps + 1 }, (_, i) => appliedAt(stats, target, (i / steps) * reach))
}

/** Where a curve still lands at least half of its best: the useful range, m (0 when it never shoots). */
export function effectiveRange(curve: GraphPoint[]): number {
  const best = Math.max(0, ...curve.map((p) => p.dps))
  if (!best) return 0
  let last = 0
  for (const p of curve) if (p.dps >= best / 2) last = p.distance
  return last
}

/** Axis marks at a round step (1, 2, 2.5 or 5 × a power of ten km) with at most `max` intervals. */
export function distanceTicks(reach: number, max = 7): number[] {
  const raw = reach / max
  const p = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p
  return Array.from({ length: Math.floor(reach / step + 1e-9) + 1 }, (_, i) => i * step)
}

export type GraphAxis = 'distance' | 'speed' | 'sig'

/** Applied DPS along the target's speed or signature (0 → max) at one distance. */
export function curveAlong(stats: FitStats, target: GraphTarget, axis: Exclude<GraphAxis, 'distance'>, max: number, distance: number, steps = 200): { x: number; dps: number }[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const x = (i / steps) * max
    // A signature of 0 lands nothing; start the signature axis at 1 m.
    const t = axis === 'speed' ? { ...target, speed: x } : { ...target, sig: Math.max(1, x) }
    return { x, dps: appliedAt(stats, t, distance).dps }
  })
}
