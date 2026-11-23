// What a module swap changes in the module itself. The optimizer's whole-fit numbers (DPS, EHP, speed…) miss
// everything else a module does: a scrambler's range, a web's strength, a neutralizer's amount. Here the two
// modules' own attributes are compared one by one.

import type { L10n } from './sde'

export interface AttrFacts {
  name: string
  pub: boolean
  /** The SDE's "high is good" */
  high: boolean
  cat?: number
  def: number
  dn?: L10n
  /** SDE unit id */
  u?: number
}

/** work: what the module does; cost: what fitting and running it takes; heat: overheating only */
export type AttrRole = 'work' | 'cost' | 'heat'

export interface AttrChange {
  attr: number
  name: string
  dn?: L10n
  role: AttrRole
  from: number
  to: number
  /** 1 for bonuses written as multipliers (1.05 = +5%), 0 otherwise: the bonus is the value minus this */
  base: number
  /** Relative change, better positive: −0.17 is 17% worse */
  change: number
  worse: boolean
}

/** Categories that say nothing about what the module does: required skills, NULL, graphics. */
const SKIP_CATS = new Set([8, 9, 31])
const SKIP_NAMES = new Set(['hp', 'techLevel', 'metaLevel', 'metaLevelOld', 'metaGroupID', 'mass', 'volume', 'capacity', 'radius', 'requiredThermoDynamicsSkill', 'chargeSize', 'maxGroupFitted', 'maxGroupActive', 'maxGroupOnline', 'maxTypeFitted', 'typeColorScheme', 'compressibleItemsTypeList'])
const SKIP_PREFIXES = ['canFitShip', 'requiredSkill', 'disallow', 'chargeGroup']
const COSTS = new Set(['cpu', 'power', 'capacitorNeed', 'upgradeCost'])

/**
 * Where the SDE's flag says "higher is better" but the module's value is a cut written as a negative number, so a
 * more negative value is the stronger module (checked against meta levels across every module family):
 * web strength, explosion radius cut, inertia cut, CPU need cut, capacitor recharge cut, ice cycle cut.
 * speedFactor is positive on afterburners and negative on webs: the bigger it is either way, the stronger.
 */
/** Units whose values are multipliers around 1: resonance (0.55 = 45% resist), modifier percent (1.05 = +5%), inversed (0.915 = −8.5%). */
const AROUND_ONE = new Set([108, 109, 111])

const MAGNITUDE = new Set(['speedFactor'])
const LOW_IS_GOOD = new Set(['aoeCloudSizeBonus', 'agilityBonus', 'cpuNeedBonus', 'rechargeratebonus', 'iceHarvestCycleBonus', 'signatureSuppressorSignatureRadiusBonusPassive', 'signatureSuppressorSignatureRadiusBonusActive'])

function roleOf(a: AttrFacts): AttrRole | null {
  if (!a.pub || (a.cat !== undefined && SKIP_CATS.has(a.cat)) || SKIP_NAMES.has(a.name) || SKIP_PREFIXES.some((p) => a.name.startsWith(p))) return null
  if (COSTS.has(a.name)) return 'cost'
  if (a.cat === 52 || a.name.startsWith('overload')) return 'heat'
  return 'work'
}

/** How much better `to` is than `from` for this attribute, relative, better positive. */
function betterBy(a: AttrFacts, from: number, to: number): number {
  const scale = Math.max(Math.abs(from), Math.abs(to))
  if (!scale) return 0
  if (MAGNITUDE.has(a.name)) return (Math.abs(to) - Math.abs(from)) / Math.max(Math.abs(from), 1e-9)
  const high = LOW_IS_GOOD.has(a.name) ? false : a.high
  const base = Math.abs(from) || scale
  return ((high ? to - from : from - to) / base)
}

/** Every attribute that differs between the two modules and says something about them. */
export function compareModules(from: Record<number, number>, to: Record<number, number>, attrs: Record<number, AttrFacts>): AttrChange[] {
  const out: AttrChange[] = []
  for (const id of new Set([...Object.keys(from), ...Object.keys(to)].map(Number))) {
    const a = attrs[id]
    if (!a) continue
    const role = roleOf(a)
    if (!role) continue
    const x = from[id] ?? a.def
    const y = to[id] ?? a.def
    if (x === y) continue
    const base = a.u !== undefined && AROUND_ONE.has(a.u) ? 1 : 0
    const change = betterBy(a, x - base, y - base)
    if (Math.abs(change) < 1e-9) continue
    out.push({ attr: id, name: a.name, dn: a.dn, role, from: x, to: y, base, change, worse: change < 0 })
  }
  return out.sort((p, q) => p.change - q.change)
}

/** The biggest loss in what the module does, as a share (0.17 = 17% worse); costs and heat don't count. */
export function workLoss(changes: AttrChange[]): number {
  return Math.max(0, ...changes.filter((c) => c.role === 'work' && c.worse).map((c) => -c.change))
}

/**
 * The change to show: how far the number itself moves, by size (CPU 30 → 36 is +20%, a web's −60% → −50% is −17%).
 * Whether that is worse or better is `worse`, shown by colour; `change` keeps "better positive" for the ranking.
 */
export function shownChange(c: AttrChange): number {
  const x = c.from - c.base
  const y = c.to - c.base
  return x ? (Math.abs(y) - Math.abs(x)) / Math.abs(x) : c.change
}
