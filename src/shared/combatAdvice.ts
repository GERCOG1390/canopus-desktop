// What to do in a fight: tries ranges, flying modes, ammo and propulsion by running the fight itself, and says what
// holds the fit back. The fight comes in as a function, so the search can be checked with fights of known outcome.

import type { CombatDirection, CombatSideInfo } from './combat'
import type { Timeline } from './combatTimeline'

export interface Candidate {
  behavior: 'orbit' | 'keep'
  /** m */
  range: number
  /** Weapon module type → charge */
  ammo: Record<number, number>
  prop: boolean
}

export interface Rated {
  candidate: Candidate
  score: number
  winner: Timeline['winner']
  end: number
  /** Toughness left at the end, 0–1 */
  leftA: number
  leftB: number
}

export interface HpWeights {
  a: { shield: number; armor: number; hull: number }
  b: { shield: number; armor: number; hull: number }
}

const LONGEST_SEC = 900

const toughness = (hp: HpWeights['a'], left: Timeline['a']['left']): number => {
  const total = hp.shield + hp.armor + hp.hull
  return total ? (left.s * hp.shield + left.a * hp.armor + left.h * hp.hull) / total : 0
}

/** Win above a stalemate above both dying above losing; within each, the better of it. */
export function rate(candidate: Candidate, tl: Timeline, hp: HpWeights): Rated {
  const leftA = toughness(hp.a, tl.a.left)
  const leftB = toughness(hp.b, tl.b.left)
  let score: number
  if (tl.winner === 'a') score = 3 + 0.7 * leftA + 0.3 * (1 - tl.end / LONGEST_SEC)
  else if (tl.winner === null) score = 2 + (leftA - leftB + 1) / 2
  else if (tl.winner === 'both') score = 1.5
  else score = (1 - leftB) * 0.9 + 0.1 * Math.min(1, tl.end / LONGEST_SEC)
  return { candidate, score, winner: tl.winner, end: tl.end, leftA, leftB }
}

export const candidateKey = (c: Candidate): string =>
  `${c.behavior}|${c.range}|${c.prop}|${Object.entries(c.ammo)
    .sort((x, y) => Number(x[0]) - Number(y[0]))
    .map(([k, v]) => `${k}:${v}`)
    .join(',')}`

export interface SearchInput {
  start: Candidate
  /** Ranges worth trying with this ammo, m */
  rangesFor: (ammo: Record<number, number>) => number[]
  /** Charges a weapon module can load */
  charges: Record<number, number[]>
  canProp: boolean
  fight: (c: Candidate) => Timeline
  hp: HpWeights
  /** Lets the window breathe during a long search */
  pause?: () => Promise<void>
}

export interface SearchResult {
  best: Rated
  /** Other good choices, each of a different range or mode */
  alternatives: Rated[]
  tried: number
}

const MODES: Candidate['behavior'][] = ['orbit', 'keep']

export async function searchAdvice(input: SearchInput): Promise<SearchResult> {
  const seen = new Map<string, Rated>()
  const judge = async (c: Candidate): Promise<Rated> => {
    const key = candidateKey(c)
    const known = seen.get(key)
    if (known) return known
    const rated = rate(c, input.fight(c), input.hp)
    seen.set(key, rated)
    if (input.pause && seen.size % 8 === 0) await input.pause()
    return rated
  }
  const better = (x: Rated, y: Rated): Rated => (x.score > y.score ? x : y)

  // Where and how to fly with the ammo as loaded.
  const sweep = async (ammo: Record<number, number>, prop: boolean): Promise<Rated[]> => {
    const out: Rated[] = []
    for (const range of input.rangesFor(ammo)) for (const behavior of MODES) out.push(await judge({ behavior, range, ammo, prop }))
    return out.sort((x, y) => y.score - x.score)
  }
  const first = await sweep(input.start.ammo, input.start.prop)
  if (!first.length) throw new Error('no ranges to try')

  // Ammo, weapon by weapon, each charge over its own ranges: a long-range charge shines where the loaded one found nothing.
  let ammo = input.start.ammo
  for (const [weapon, charges] of Object.entries(input.charges)) {
    let bestCharge: Rated | null = null
    for (const charge of charges) {
      const tryAmmo = { ...ammo, [weapon]: charge }
      for (const range of input.rangesFor(tryAmmo)) {
        const tried = await judge({ behavior: 'keep', range, ammo: tryAmmo, prop: input.start.prop })
        bestCharge = bestCharge ? better(tried, bestCharge) : tried
      }
    }
    if (bestCharge) ammo = bestCharge.candidate.ammo
  }

  // Back to where to fly, now with that ammo, and then the propulsion.
  const second = await sweep(ammo, input.start.prop)
  let best = second.reduce(better, first.reduce(better))
  if (input.canProp) {
    const flipped = await sweep(best.candidate.ammo, !input.start.prop)
    best = flipped.reduce(better, best)
  }

  const places2 = [...seen.values()].sort((x, y) => y.score - x.score)
  const alternatives: Rated[] = []
  const used = new Set([`${best.candidate.behavior}|${best.candidate.range}`])
  for (const r of places2) {
    const place = `${r.candidate.behavior}|${r.candidate.range}`
    if (used.has(place)) continue
    used.add(place)
    alternatives.push(r)
    if (alternatives.length === 3) break
  }
  return { best, alternatives, tried: seen.size }
}

export type Problem =
  | { code: 'application'; typeId: number; limit: string; percent: number }
  | { code: 'weakResist'; layer: 'shield' | 'armor' | 'hull'; damage: number; share: number; resist: number }
  | { code: 'capEmpty'; t: number }
  | { code: 'reload'; t: number }
  | { code: 'propBlocked'; t: number }
  | { code: 'lostRange'; t: number }
  | { code: 'outgunned'; mine: number; theirs: number }
  | { code: 'lessTank'; mine: number; theirs: number }

export interface CombatAdvice {
  current: Rated
  best: Rated
  /** The best is no better than what's flown now */
  alreadyBest: boolean
  alternatives: Rated[]
  /** The best choice against other things the opponent might do */
  ifOpponent: { rushes: Rated; kites: Rated; kiteRange: number }
  problems: Problem[]
  tried: number
}

const LAYERS = ['shield', 'armor', 'hull'] as const

/** What holds this side back in this fight: only what the fight's own numbers show. */
export function fightProblems(r: { a: CombatSideInfo; b: CombatSideInfo; ab: CombatDirection; ba: CombatDirection; timeline: Timeline }): Problem[] {
  const out: Problem[] = []
  const worst = [...r.ab.weapons].filter((w) => w.limit && w.factor < 0.7 && w.dps > 0).sort((x, y) => y.dps - y.applied - (x.dps - x.applied))[0]
  if (worst?.limit) out.push({ code: 'application', typeId: worst.typeId, limit: worst.limit, percent: Math.round(worst.factor * 100) })

  // The damage coming in, against the layer it does most of its work on.
  const total = r.ba.appliedByType.reduce((s, v) => s + v, 0)
  if (total > 0) {
    const damage = r.ba.appliedByType.indexOf(Math.max(...r.ba.appliedByType))
    const share = r.ba.appliedByType[damage] / total
    const hpTotal = r.a.hp.shield + r.a.hp.armor + r.a.hp.hull
    const layer = LAYERS.reduce((x, y) => (r.a.hp[y] > r.a.hp[x] ? y : x))
    // A RAH has moved by the end of the fight: judge what it became, not how it was fitted.
    const resists = (layer === 'armor' && r.timeline.a?.armorResist) || r.a.resist[layer]
    const resist = resists[damage]
    const avg = resists.reduce((s: number, v: number) => s + v, 0) / 4
    // Hull is where nobody tanks: bare resists there say nothing about the fit.
    if (share >= 0.4 && layer !== 'hull' && hpTotal > 0 && resist < avg - 0.05 && resist < 0.6) {
      out.push({ code: 'weakResist', layer, damage, share: Math.round(share * 100), resist: Math.round(resist * 100) })
    }
  }

  const firstOf = (kind: Timeline['events'][number]['kind']): number | undefined => r.timeline.events.find((e) => e.side === 'a' && e.kind === kind)?.t
  const cap = firstOf('capEmpty')
  if (cap !== undefined) out.push({ code: 'capEmpty', t: cap })
  const blocked = firstOf('propBlocked')
  if (blocked !== undefined) out.push({ code: 'propBlocked', t: blocked })
  const lost = firstOf('lostRange')
  if (lost !== undefined) out.push({ code: 'lostRange', t: lost })
  const reload = firstOf('reload')
  if (reload !== undefined) out.push({ code: 'reload', t: reload })

  if (r.ba.applied >= 1.5 * r.ab.applied && r.ba.applied > 0) out.push({ code: 'outgunned', mine: Math.round(r.ab.applied), theirs: Math.round(r.ba.applied) })
  if (r.b.ehp >= 1.5 * r.a.ehp) out.push({ code: 'lessTank', mine: Math.round(r.a.ehp), theirs: Math.round(r.b.ehp) })
  return out
}
