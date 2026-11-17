// Modules other ships run on the fit (Pyfa's projected effects): webs, target painters, remote shield and armor
// repairers, energy neutralizers. Each is worked out with every skill at V on the hull that carries it — a
// Guardian's repair bonus, a Curse's neutralizer bonus — or on a capsule when no hull is chosen.

import type { FitSpec, ProjectedKind } from '../../shared/fit'
import type { SdeDb } from '../../shared/sde'
import { CATEGORY, Dogma, dogmaOf } from './engine'

/** A capsule: a hull with no bonuses to carry the module. */
const CAPSULE = 670
/** energyNeutralizerSignatureResolution */
const ATTR_NEUT_SIG_RES = 2451
const EFFECT_KIND: Record<string, ProjectedKind> = {
  remoteWebifierFalloff: 'web',
  remoteTargetPaintFalloff: 'paint',
  shipModuleRemoteShieldBooster: 'shieldRep',
  shipModuleRemoteArmorRepairer: 'armorRep',
  energyNeutralizerFalloff: 'neut',
  remoteSensorDampFalloff: 'damp',
  shipModuleTrackingDisruptor: 'td',
  shipModuleGuidanceDisruptor: 'gd',
  remoteECMFalloff: 'ecm'
}

/** What each e-war kind changes on the fit: module attribute → the fit's attribute it changes. */
export const EWAR_BONUS: Partial<Record<ProjectedKind, [number, number][]>> = {
  // maxTargetRangeBonus → maxTargetRange, scanResolutionBonus → scanResolution
  damp: [
    [309, 76],
    [566, 564]
  ],
  // maxRangeBonus → maxRange, falloffBonus → falloff, trackingSpeedBonus → trackingSpeed (turrets)
  td: [
    [351, 54],
    [349, 158],
    [767, 160]
  ],
  // missileVelocityBonus → maxVelocity, explosionDelayBonus → explosionDelay, aoeVelocityBonus, aoeCloudSizeBonus (missiles)
  gd: [
    [547, 37],
    [596, 281],
    [847, 653],
    [848, 654]
  ],
  // ECM strength against gravimetric, ladar, magnetometric, radar sensors
  ecm: [
    [238, 238],
    [239, 239],
    [240, 240],
    [241, 241]
  ]
}

export interface ProjectedValue {
  kind: ProjectedKind
  /** Web speed change or painter signature change, %; HP or GJ per cycle for the rest */
  amount: number
  /** Seconds per cycle */
  cycle: number
  /** Neutralizers' signature resolution, m (capital ones): smaller ships take less */
  sigRes?: number
  /** E-war: module attribute → value (with its script loaded) */
  bonuses?: Record<number, number>
}

const cache = new WeakMap<SdeDb, Map<string, ProjectedValue | null>>()

/** The attribute that holds a kind's strength. */
const STRENGTH_ATTR: Record<ProjectedKind, number> = { web: 20, paint: 554, shieldRep: 68, armorRep: 84, neut: 97, damp: 309, td: 351, gd: 847, ecm: 238 }

export function projectedValue(db: SdeDb, typeId: number, shipTypeId = CAPSULE, chargeTypeId?: number): ProjectedValue | null {
  let byType = cache.get(db)
  if (!byType) cache.set(db, (byType = new Map()))
  const key = `${typeId}|${shipTypeId}|${chargeTypeId ?? ''}`
  if (byType.has(key)) return byType.get(key)!
  const d = new Dogma(db, shipTypeId, { mode: 'all5' })
  const m = d.addModule(typeId, 'med', 'active', chargeTypeId, 0)
  d.link()
  const e = d.defaultEffect(m)
  const kind = e ? EFFECT_KIND[e.name] : undefined
  let out: ProjectedValue | null = null
  if (e && kind) {
    const a = (id: number) => d.attr(m, id)
    const cycle = e.dur ? a(e.dur) / 1000 : 0
    const amount = a(STRENGTH_ATTR[kind])
    const sigRes = kind === 'neut' ? a(ATTR_NEUT_SIG_RES) || undefined : undefined
    const bonuses = EWAR_BONUS[kind] ? Object.fromEntries(EWAR_BONUS[kind]!.map(([src]) => [src, a(src)])) : undefined
    out = { kind, amount, cycle, ...(sigRes ? { sigRes } : {}), ...(bonuses ? { bonuses } : {}) }
  }
  byType.set(key, out)
  return out
}

/** Tech II modules of each kind that can be put on the fit (published, Tech II), for the picker. */
export function projectedOptions(db: SdeDb): { typeId: number; kind: ProjectedKind; amount: number; cycle: number }[] {
  const out: { typeId: number; kind: ProjectedKind; amount: number; cycle: number }[] = []
  for (const t of Object.values(db.types)) {
    if (!t.pub || t.meta !== 2 || db.groups[t.g]?.c !== CATEGORY.MODULE) continue
    const de = db.dogma[t.id]?.de
    if (de === undefined || !EFFECT_KIND[db.effects[de]?.name ?? '']) continue
    const v = projectedValue(db, t.id)
    if (v) out.push({ typeId: t.id, ...v })
  }
  return out
}

/**
 * Hulls whose bonuses make this module stronger (a bonus to its strength attribute for modules needing its skill,
 * or of its group), with the strength each gives, strongest first.
 */
export function carrierHulls(db: SdeDb, typeId: number): { shipTypeId: number; amount: number }[] {
  const base = projectedValue(db, typeId)
  if (!base) return []
  const attr = STRENGTH_ATTR[base.kind]
  const group = db.types[typeId]?.g
  const skills = new Set([182, 183, 184].map((x) => db.dogma[typeId]?.a[x]).filter(Boolean))
  const out: { shipTypeId: number; amount: number }[] = []
  for (const t of Object.values(db.types)) {
    if (!t.pub || db.groups[t.g]?.c !== CATEGORY.SHIP) continue
    const bonus = (db.dogma[t.id]?.e ?? []).some((e) =>
      db.effects[e]?.mods?.some((m) => m.attr === attr && ((m.func === 'LocationRequiredSkillModifier' && m.skill !== undefined && skills.has(m.skill)) || (m.func === 'LocationGroupModifier' && m.group === group)))
    )
    if (!bonus) continue
    const v = projectedValue(db, typeId, t.id)
    if (v && Math.abs(v.amount) > Math.abs(base.amount) + 1e-9) out.push({ shipTypeId: t.id, amount: v.amount })
  }
  return out.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))
}

/**
 * What a whole fit (a logistics cruiser, a recon) puts on another ship: each of its running webs, painters, remote
 * repairers and neutralizers, with its hull bonuses, implants and every skill at V.
 */
export function projectedFromFit(db: SdeDb, spec: FitSpec): ProjectedValue[] {
  const d = dogmaOf(db, spec, { mode: 'all5' })
  d.link()
  const out: ProjectedValue[] = []
  for (const m of d.modules) {
    if (m.state !== 'active' && m.state !== 'overload') continue
    const e = d.defaultEffect(m)
    const kind = e ? EFFECT_KIND[e.name] : undefined
    if (!e || !kind) continue
    const sigRes = kind === 'neut' ? d.attr(m, ATTR_NEUT_SIG_RES) || undefined : undefined
    const bonuses = EWAR_BONUS[kind] ? Object.fromEntries(EWAR_BONUS[kind]!.map(([src]) => [src, d.attr(m, src)])) : undefined
    out.push({ kind, amount: d.attr(m, STRENGTH_ATTR[kind]), cycle: e.dur ? d.attr(m, e.dur) / 1000 : 0, ...(sigRes ? { sigRes } : {}), ...(bonuses ? { bonuses } : {}) })
  }
  return out
}
