// Fleet boosts: what a booster's command bursts give the fit. The booster (its ship, burst charges and mindlink)
// is worked out by the same dogma engine with every skill at V. As in the game, the charge hands its buff ids and
// multipliers to the burst module (effect chargeBonusWarfareCharge), and the module's buff values, raised by
// skills, ship bonuses and the mindlink, are what the fleet gets.

import type { FitSpec, FleetBoost } from '../../shared/fit'
import type { SdeDb } from '../../shared/sde'
import { CATEGORY, Dogma, dogmaOf } from './engine'

/** warfareBuffNID / warfareBuffNValue pairs of a burst module, once its charge is loaded. */
const BUFF_ATTRS: [number, number][] = [
  [2468, 2469],
  [2470, 2471],
  [2472, 2473],
  [2536, 2537]
]
/** chargeGroup1..5: the charge groups a module takes */
const CHARGE_GROUP_ATTRS = [604, 605, 606, 609, 610]
const COMMAND_BURST_GROUP_NAME = 'Command Burst'

const moduleCache = new WeakMap<SdeDb, Map<number, number | null>>()

/** The command burst module that fires a charge, Tech II if there is one. */
export function burstModuleFor(db: SdeDb, chargeTypeId: number): number | null {
  let cache = moduleCache.get(db)
  if (!cache) moduleCache.set(db, (cache = new Map()))
  if (cache.has(chargeTypeId)) return cache.get(chargeTypeId)!
  const chargeGroup = db.types[chargeTypeId]?.g
  const candidates = Object.values(db.types).filter((t) => {
    const g = db.groups[t.g]
    if (!t.pub || g?.c !== CATEGORY.MODULE || g.n[0] !== COMMAND_BURST_GROUP_NAME) return false
    const a = db.dogma[t.id]?.a ?? {}
    return CHARGE_GROUP_ATTRS.some((x) => a[x] === chargeGroup)
  })
  const pick = candidates.find((t) => t.meta === 2) ?? candidates[0]
  cache.set(chargeTypeId, pick?.id ?? null)
  return pick?.id ?? null
}

/** Combat command burst modules (shield, armor, information, skirmish), Tech II: mining and expedition bursts left out. */
function combatBurstModules(db: SdeDb) {
  return Object.values(db.types).filter((t) => {
    const g = db.groups[t.g]
    return t.pub && t.meta === 2 && g?.c === CATEGORY.MODULE && g.n[0] === COMMAND_BURST_GROUP_NAME && !/Mining|Expedition/.test(t.n[0])
  })
}

/** Burst charges the combat bursts load. */
export function burstCharges(db: SdeDb): number[] {
  const groups = new Set<number>()
  for (const t of combatBurstModules(db)) {
    const a = db.dogma[t.id]?.a ?? {}
    for (const x of CHARGE_GROUP_ATTRS) if (a[x]) groups.add(a[x])
  }
  return Object.values(db.types)
    .filter((t) => t.pub && groups.has(t.g))
    .map((t) => t.id)
}

/** Hulls that can fit a combat command burst (the modules' canFitShipGroup / canFitShipType lists). */
export function boosterShips(db: SdeDb): number[] {
  const attrs = Object.entries(db.attributes).filter(([, a]) => /^canFitShip(Group|Type)/.test(a.name))
  const groups = new Set<number>()
  const types = new Set<number>()
  for (const t of combatBurstModules(db)) {
    const a = db.dogma[t.id]?.a ?? {}
    for (const [id, attr] of attrs) {
      const v = a[Number(id)]
      if (v) (attr.name.startsWith('canFitShipGroup') ? groups : types).add(v)
    }
  }
  return Object.values(db.types)
    .filter((t) => t.pub && db.groups[t.g]?.c === CATEGORY.SHIP && (groups.has(t.g) || types.has(t.id)))
    .map((t) => t.id)
}

/** Implants that strengthen bursts (mindlinks): an effect raising a burst module's buff values. */
export function mindlinks(db: SdeDb): number[] {
  const values = new Set(BUFF_ATTRS.map(([, v]) => v))
  return Object.values(db.types)
    .filter((t) => t.pub && db.groups[t.g]?.c === CATEGORY.IMPLANT && (db.dogma[t.id]?.e ?? []).some((e) => db.effects[e]?.mods?.some((m) => values.has(m.attr))))
    .map((t) => t.id)
}

/** Each burst's buffs with their game names, for showing what the booster gives. */
export function burstDetails(db: SdeDb, fleet: FleetBoost): { charge: number; buffs: { id: number; value: number; n?: [string, string] }[] }[] {
  const d = boosterDogma(db, fleet)
  return d.modules.map((m) => ({
    charge: m.other?.typeId ?? 0,
    buffs: BUFF_ATTRS.map(([idAttr, valueAttr]) => ({ id: d.attr(m, idAttr), value: d.attr(m, valueAttr) }))
      .filter((b) => b.id)
      .map((b) => ({ ...b, n: db.dbuffs?.[b.id]?.n }))
  }))
}

function boosterDogma(db: SdeDb, fleet: FleetBoost): Dogma {
  const d = new Dogma(db, fleet.shipTypeId, { mode: 'all5' })
  fleet.bursts.forEach((charge, i) => {
    const module = burstModuleFor(db, charge)
    if (module) d.addModule(module, 'hi', 'active', charge, i)
  })
  fleet.implants?.forEach((id) => d.addImplant(id))
  d.link()
  return d
}

/** The warfare buffs (id and strength) the booster's bursts give. */
export function burstBuffs(db: SdeDb, fleet: FleetBoost): { id: number; value: number }[] {
  const d = boosterDogma(db, fleet)
  const out: { id: number; value: number }[] = []
  for (const m of d.modules) {
    for (const [idAttr, valueAttr] of BUFF_ATTRS) {
      const id = d.attr(m, idAttr)
      if (id) out.push({ id, value: d.attr(m, valueAttr) })
    }
  }
  return out
}

/** The command bursts a whole booster fit runs (its hull, mindlink, every skill at V), as warfare buffs. */
export function burstBuffsOfFit(db: SdeDb, spec: FitSpec): { id: number; value: number }[] {
  const d = dogmaOf(db, spec, { mode: 'all5' })
  d.link()
  const out: { id: number; value: number }[] = []
  for (const m of d.modules) {
    if (m.state !== 'active' && m.state !== 'overload') continue
    for (const [idAttr, valueAttr] of BUFF_ATTRS) {
      const id = d.attr(m, idAttr)
      if (id) out.push({ id, value: d.attr(m, valueAttr) })
    }
  }
  return out
}
