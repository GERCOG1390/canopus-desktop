// Boosters (combat drugs and their kin): what each one gives and what it may cost.
// The SDE lists a booster's side effects among its passive effects, with nothing to tell them apart but where their
// value comes from: a booster…Penalty attribute. In the game each strikes by chance, so the fit takes the bonus and
// only the side effects the pilot says struck.

import type { L10n } from './sde'

/** The slice of the SDE this needs. */
export interface BoosterDb {
  attributes: Record<number, { name: string; dn?: L10n; u?: number }>
  effects: Record<number, { name: string; cat: number; mods?: { func: string; domain?: string; src?: number }[] }>
  dogma: Record<number, { a: Record<number, number>; e: number[] } | undefined>
}

export interface BoosterLine {
  attr: number
  value: number
  name: L10n
  /** The value is a percentage */
  percent: boolean
}

export interface BoosterInfo {
  id: number
  /** Booster slot (boosterness): one booster per slot */
  slot: number
  /** Chance of each side effect, 0–1 */
  chance: number
  main: BoosterLine[]
  side: (BoosterLine & { effect: number })[]
  /** On the market, as against event and reward boosters */
  market?: boolean
}

const PERCENT_UNITS = new Set([105, 109, 111, 121, 124, 127])
const isPenalty = (name: string | undefined) => !!name && name.startsWith('booster') && name.includes('Penalty')
const attrIdByName = (db: BoosterDb, name: string) => Number(Object.entries(db.attributes).find(([, a]) => a.name === name)?.[0] ?? 0)

/** The booster's side effects, by effect id. */
export function boosterSideEffects(db: BoosterDb, typeId: number): number[] {
  return (db.dogma[typeId]?.e ?? []).filter((id) => db.effects[id]?.mods?.some((m) => m.src !== undefined && isPenalty(db.attributes[m.src]?.name)))
}

function lines(db: BoosterDb, typeId: number, effects: number[]): (BoosterLine & { effect: number })[] {
  const a = db.dogma[typeId]?.a ?? {}
  const out: (BoosterLine & { effect: number })[] = []
  for (const effect of effects)
    for (const m of db.effects[effect]?.mods ?? []) {
      if (m.src === undefined || a[m.src] === undefined || out.some((x) => x.attr === m.src)) continue
      const attr = db.attributes[m.src]
      out.push({ effect, attr: m.src, value: a[m.src], name: attr?.dn ?? [attr?.name ?? String(m.src), attr?.name ?? String(m.src)], percent: PERCENT_UNITS.has(attr?.u ?? 0) })
    }
  return out
}

export function boosterInfo(db: BoosterDb, typeId: number): BoosterInfo {
  const a = db.dogma[typeId]?.a ?? {}
  const side = boosterSideEffects(db, typeId)
  const main = (db.dogma[typeId]?.e ?? []).filter((e) => !side.includes(e))
  const chances = [1, 2, 3, 4, 5].map((n) => a[attrIdByName(db, `boosterEffectChance${n}`)] ?? 0)
  return {
    id: typeId,
    slot: a[attrIdByName(db, 'boosterness')] ?? 0,
    chance: Math.max(0, ...chances),
    main: lines(db, typeId, main).map(({ effect: _effect, ...l }) => l),
    side: lines(db, typeId, side)
  }
}

/**
 * Whether a booster does anything in a fight: something of its touches the ship, its modules, charges or drones.
 * Cerebral accelerators (character attributes) and the like don't.
 */
export function isCombatBooster(db: BoosterDb, typeId: number): boolean {
  const effects = db.dogma[typeId]?.e ?? []
  return effects.some((id) => db.effects[id]?.mods?.some((m) => m.domain === 'shipID' || m.func === 'OwnerRequiredSkillModifier' || m.func === 'LocationRequiredSkillModifier' || m.func === 'LocationGroupModifier' || m.func === 'LocationModifier'))
}
