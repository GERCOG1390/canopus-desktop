// What each next skill level would change on a fit (the "what to learn" tool). Pure: reads the SDE through
// ../sde, so the iOS app (Canopus Tools/dogma-js) bundles the same function.

import type { FitSpec } from '../../shared/fit'
import { sdeForDogma } from '../sde'
import { calculate } from './stats'

export interface SkillGain {
  skill: number
  /** Level the character has now */
  from: number
  dps: number
  ehp: number
  activeTank: number
  speed: number
  /** Seconds (negative = faster align) */
  align: number
  capacitor: number
  lockRange: number
}

/**
 * What each next skill level would change on this fit: the fit is recalculated with one skill a level
 * higher, for every published skill the character hasn't maxed; skills that change nothing are left out.
 */
export function skillGains(spec: FitSpec, levels: Record<number, number>): SkillGain[] {
  const db = sdeForDogma()
  const base = calculate(db, spec, { mode: 'char', levels })
  const out: SkillGain[] = []
  for (const t of Object.values(db.types)) {
    if (!t.pub || db.groups[t.g]?.c !== 16) continue
    const from = levels[t.id] ?? 0
    if (from >= 5) continue
    const s = calculate(db, spec, { mode: 'char', levels: { ...levels, [t.id]: from + 1 } })
    const g: SkillGain = {
      skill: t.id,
      from,
      dps: s.offense.totalDps - base.offense.totalDps,
      ehp: s.defense.ehp - base.defense.ehp,
      activeTank: s.defense.activeTankEhp - base.defense.activeTankEhp,
      speed: s.navigation.maxVelocity - base.navigation.maxVelocity,
      align: s.navigation.alignSec - base.navigation.alignSec,
      capacitor: (s.capacitor.stable ? 1000 + (s.capacitor.stableLevel ?? 0) * 100 : (s.capacitor.lastsSec ?? 0) / 60) - (base.capacitor.stable ? 1000 + (base.capacitor.stableLevel ?? 0) * 100 : (base.capacitor.lastsSec ?? 0) / 60),
      lockRange: s.targeting.maxRange - base.targeting.maxRange
    }
    const tiny = (v: number, eps: number) => Math.abs(v) < eps
    if (tiny(g.dps, 0.05) && tiny(g.ehp, 1) && tiny(g.activeTank, 0.05) && tiny(g.speed, 0.05) && tiny(g.align, 0.005) && tiny(g.capacitor, 0.05) && tiny(g.lockRange, 1)) continue
    out.push(g)
  }
  return out
}
