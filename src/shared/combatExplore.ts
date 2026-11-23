// Beyond the one fight on the map: how the same setup ends at every distance, and which single change to it moves
// the outcome most. The main process runs the fights (main/dogma/combat.ts explore); this file holds the shapes
// and the parts that can be checked without a fit: grouping distances into bands and ranking the levers.

import type { FightSummary } from './combatCompare.ts'
import type { HeatPolicy } from './heat.ts'

/** How a fight ends for you: won, lost, both dead, nobody dead though hurt, or nobody reaches anybody. */
export type OutcomeKind = 'win' | 'lose' | 'both' | 'draw' | 'idle'

export interface DistancePoint {
  /** Starting distance, m */
  distance: number
  kind: OutcomeKind
  /** When it ended, s */
  end: number
}

export interface OutcomeBand {
  kind: OutcomeKind
  /** m */
  from: number
  to: number
}

/** One change to your side of the setup, each tried on its own. */
export type Lever =
  | { kind: 'ammo'; weapon: number; from: number; charge: number }
  | { kind: 'heat'; policy: HeatPolicy }
  | { kind: 'prop'; on: boolean; typeId: number }
  | { kind: 'range'; behavior: 'orbit' | 'keep'; range: number }

export interface LeverResult {
  lever: Lever
  summary: FightSummary
  /** Better (+) or worse (−) than the fight as set up, on the advice's scale (combatAdvice rate) */
  delta: number
}

export interface CombatExplore {
  byDistance: DistancePoint[]
  /** The setup's own fight, to compare the levers with */
  current: FightSummary
  levers: LeverResult[]
  /** Fights run */
  tried: number
}

export function outcomeKind(winner: 'a' | 'b' | 'both' | null, dealtA: number, dealtB: number): OutcomeKind {
  if (winner === 'a') return 'win'
  if (winner === 'b') return 'lose'
  if (winner === 'both') return 'both'
  return dealtA > 0 || dealtB > 0 ? 'draw' : 'idle'
}

/** Neighbouring distances with the same outcome as one band; a band reaches halfway to the next point. */
export function outcomeBands(points: DistancePoint[]): OutcomeBand[] {
  const pts = [...points].sort((x, y) => x.distance - y.distance)
  const bands: OutcomeBand[] = []
  pts.forEach((p, i) => {
    const from = i === 0 ? p.distance : (pts[i - 1].distance + p.distance) / 2
    const to = i === pts.length - 1 ? p.distance : (p.distance + pts[i + 1].distance) / 2
    const last = bands[bands.length - 1]
    if (last && last.kind === p.kind) last.to = to
    else bands.push({ kind: p.kind, from, to })
  })
  return bands
}

/**
 * The levers worth showing: those that change the fight beyond rounding, at most `max`. The best improvements
 * first, then the worst mistakes (at least two of them when there are, so the pilot also sees what not to do).
 */
export function rankLevers(levers: LeverResult[], max = 6): LeverResult[] {
  const moving = levers.filter((l) => Math.abs(l.delta) > 0.005)
  const better = moving.filter((l) => l.delta > 0).sort((x, y) => y.delta - x.delta)
  const worse = moving.filter((l) => l.delta < 0).sort((x, y) => x.delta - y.delta)
  const nWorse = Math.min(worse.length, Math.max(2, max - better.length))
  const nBetter = Math.min(better.length, max - nWorse)
  return [...better.slice(0, nBetter), ...worse.slice(0, nWorse)]
}
