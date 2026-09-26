// A data-driven dogma engine: evaluates item attributes from the SDE's effect modifiers,
// the same way the game client does (modifier domains, functions, operations, stacking penalties).

import type { ModuleState, SkillSource, Slot } from '../../shared/fit'
import type { DogmaEffect, DogmaModifier, SdeDb } from '../../shared/sde'

export const CATEGORY = { SHIP: 6, MODULE: 7, CHARGE: 8, SKILL: 16, DRONE: 18, IMPLANT: 20, SUBSYSTEM: 32 }
/** Modifiers from these categories are never stacking-penalized. */
const PENALTY_EXEMPT = new Set([CATEGORY.SHIP, CATEGORY.CHARGE, CATEGORY.SKILL, CATEGORY.IMPLANT, CATEGORY.SUBSYSTEM])
const REQUIRED_SKILL_ATTRS = [182, 183, 184, 1285, 1289, 1290]
/** Base character attributes live on the "Character" type. */
const CHARACTER_TYPE = 1373
const SKILL_LEVEL_ATTR = 280
/** Computes skillLevel from skill points; we set the level directly instead. */
const SKILL_EFFECT = 132

/** Effect categories: 0 passive, 1 active, 4 online, 5 overload. */
const STATE_RANK: Record<ModuleState, number> = { offline: 0, online: 1, active: 2, overload: 3 }

export type ItemKind = 'char' | 'ship' | 'module' | 'charge' | 'drone' | 'implant' | 'skill'

interface Modifier {
  source: Item
  srcAttr: number
  op: number
  /** Computed value instead of reading srcAttr (special-cased effects). */
  value?: () => number
  noPenalty?: boolean
}

export interface Item {
  kind: ItemKind
  typeId: number
  category: number
  group: number
  base: Record<number, number>
  effects: number[]
  state: ModuleState
  slot?: Slot
  /** module ↔ charge link used by the otherID domain */
  other?: Item
  reqSkills: Set<number>
  mods: Map<number, Modifier[]>
  cache: Map<number, number>
  /** Index in the fit's module/drone list */
  index?: number
  count?: number
  active?: number
}

export class Dogma {
  readonly char: Item
  readonly ship: Item
  readonly modules: Item[] = []
  readonly charges: Item[] = []
  readonly drones: Item[] = []
  readonly implants: Item[] = []
  readonly skills: Item[] = []
  private readonly evaluating = new Set<string>()

  constructor(
    readonly db: SdeDb,
    shipTypeId: number,
    skills: SkillSource
  ) {
    this.char = this.makeItem('char', CHARACTER_TYPE)
    this.ship = this.makeItem('ship', shipTypeId)

    const levels: [number, number][] =
      skills.mode === 'all5'
        ? Object.values(db.types)
            .filter((t) => t.pub && db.groups[t.g]?.c === CATEGORY.SKILL)
            .map((t) => [t.id, 5])
        : Object.entries(skills.levels).map(([id, lvl]) => [Number(id), lvl])
    for (const [id, level] of levels) {
      if (!db.types[id] || level <= 0) continue
      const skill = this.makeItem('skill', id)
      skill.base[SKILL_LEVEL_ATTR] = level
      this.skills.push(skill)
    }
  }

  // ---------------- Building ----------------

  makeItem(kind: ItemKind, typeId: number, state: ModuleState = 'online'): Item {
    const t = this.db.types[typeId]
    const dogma = this.db.dogma[typeId] ?? { a: {}, e: [] }
    const reqSkills = new Set<number>()
    for (const a of REQUIRED_SKILL_ATTRS) if (dogma.a[a]) reqSkills.add(dogma.a[a])
    const base = { ...dogma.a }
    // Type-level fields that are also dogma attributes.
    if (t?.mass !== undefined && base[4] === undefined) base[4] = t.mass
    if (t?.cap !== undefined && base[38] === undefined) base[38] = t.cap
    if (t?.vol !== undefined && base[161] === undefined) base[161] = t.vol
    return {
      kind,
      typeId,
      category: t ? (this.db.groups[t.g]?.c ?? 0) : 0,
      group: t?.g ?? 0,
      base,
      effects: dogma.e,
      state,
      reqSkills,
      mods: new Map(),
      cache: new Map()
    }
  }

  addModule(typeId: number, slot: Slot, state: ModuleState, chargeTypeId: number | undefined, index: number): Item {
    const m = this.makeItem('module', typeId, state)
    m.slot = slot
    m.index = index
    this.modules.push(m)
    if (chargeTypeId) {
      const c = this.makeItem('charge', chargeTypeId, state)
      c.other = m
      m.other = c
      c.index = index
      this.charges.push(c)
    }
    return m
  }

  addDrone(typeId: number, count: number, active: number, index: number): Item {
    const d = this.makeItem('drone', typeId, active > 0 ? 'active' : 'offline')
    d.count = count
    d.active = active
    d.index = index
    this.drones.push(d)
    return d
  }

  addImplant(typeId: number): void {
    this.implants.push(this.makeItem('implant', typeId))
  }

  effect(id: number): DogmaEffect | undefined {
    return this.db.effects[id]
  }

  /** The effect a module runs when activated: the SDE default, else the first timed active one. */
  defaultEffect(item: Item): DogmaEffect | undefined {
    const de = this.db.dogma[item.typeId]?.de ?? item.effects.find((e) => [1, 2].includes(this.db.effects[e]?.cat ?? -1) && this.db.effects[e]?.dur)
    return de === undefined ? undefined : this.db.effects[de]
  }

  /** Effects that are currently applying their modifiers. */
  runningEffects(item: Item): number[] {
    return item.effects.filter((id) => {
      const e = this.db.effects[id]
      if (!e || id === SKILL_EFFECT) return false
      switch (item.kind) {
        case 'module':
        case 'charge': {
          const rank = STATE_RANK[item.kind === 'charge' ? (item.other?.state ?? 'online') : item.state]
          if (e.cat === 0) return true
          if (e.cat === 4) return rank >= 1
          if (e.cat === 1) return rank >= 2
          if (e.cat === 5) return rank >= 3
          return false
        }
        default:
          return e.cat === 0
      }
    })
  }

  private locatedIn(domain: 'ship' | 'char'): Item[] {
    return domain === 'ship' ? [...this.modules, ...this.charges] : [...this.implants]
  }

  private ownedByChar(): Item[] {
    return [...this.modules, ...this.charges, ...this.drones, ...this.implants]
  }

  private targets(mod: DogmaModifier, source: Item): Item[] {
    let domainItem: Item | undefined
    let location: 'ship' | 'char' | null = null
    switch (mod.domain) {
      case 'itemID':
        domainItem = source
        break
      case 'shipID':
        domainItem = this.ship
        location = 'ship'
        break
      case 'charID':
        domainItem = this.char
        location = 'char'
        break
      case 'otherID':
        domainItem = source.other
        break
      default:
        return []
    }
    const skill = mod.skill === -1 ? source.typeId : mod.skill
    switch (mod.func) {
      case 'ItemModifier':
        return domainItem ? [domainItem] : []
      case 'LocationModifier':
        return location ? this.locatedIn(location) : []
      case 'LocationGroupModifier':
        return location ? this.locatedIn(location).filter((i) => i.group === mod.group) : []
      case 'LocationRequiredSkillModifier':
        return location && skill ? this.locatedIn(location).filter((i) => i.reqSkills.has(skill)) : []
      case 'OwnerRequiredSkillModifier':
        return skill ? this.ownedByChar().filter((i) => i.reqSkills.has(skill)) : []
      default:
        return []
    }
  }

  private addModifier(target: Item, attr: number, m: Modifier): void {
    const list = target.mods.get(attr) ?? []
    list.push(m)
    target.mods.set(attr, list)
  }

  /** Collects every running effect's modifiers onto their target items. */
  link(): void {
    const all = [this.char, this.ship, ...this.skills, ...this.implants, ...this.modules, ...this.charges, ...this.drones]
    for (const item of all) {
      item.mods.clear()
      item.cache.clear()
    }
    for (const source of all) {
      for (const effectId of this.runningEffects(source)) {
        const e = this.db.effects[effectId]
        for (const mod of e.mods ?? []) {
          for (const target of this.targets(mod, source)) {
            this.addModifier(target, mod.attr, { source, srcAttr: mod.src, op: mod.op })
          }
        }
        this.specialEffect(source, e)
      }
    }
  }

  /** Effects whose behaviour isn't described by modifiers in the SDE. */
  private specialEffect(source: Item, e: DogmaEffect): void {
    if (e.name === 'moduleBonusMicrowarpdrive' || e.name === 'moduleBonusAfterburner') {
      this.addModifier(this.ship, 4, { source, srcAttr: 796, op: 2 })
      if (e.name === 'moduleBonusMicrowarpdrive') this.addModifier(this.ship, 552, { source, srcAttr: 554, op: 6, noPenalty: true })
      // Speed boost % = speedFactor × thrust / ship mass
      this.addModifier(this.ship, 37, {
        source,
        srcAttr: 20,
        op: 6,
        noPenalty: true,
        value: () => (this.attr(source, 20) * this.attr(source, 567)) / this.attr(this.ship, 4)
      })
    }
  }

  // ---------------- Evaluation ----------------

  attr(item: Item, attrId: number): number {
    const cached = item.cache.get(attrId)
    if (cached !== undefined) return cached
    const key = `${item.kind}:${item.typeId}:${item.index ?? ''}:${attrId}`
    const meta = this.db.attributes[attrId]
    const base = item.base[attrId] ?? meta?.def ?? 0
    if (this.evaluating.has(key)) return base
    this.evaluating.add(key)
    try {
      const mods = item.mods.get(attrId)
      const value = mods?.length ? this.apply(base, mods, meta?.stack ?? true) : base
      item.cache.set(attrId, value)
      return value
    } finally {
      this.evaluating.delete(key)
    }
  }

  private apply(base: number, mods: Modifier[], stackable: boolean): number {
    const valueOf = (m: Modifier) => (m.value ? m.value() : this.attr(m.source, m.srcAttr))
    let v = base
    const byOp = (op: number) => mods.filter((m) => m.op === op)

    const preAssign = byOp(-1)
    if (preAssign.length) v = valueOf(preAssign[preAssign.length - 1])

    const penalized: number[] = []
    const multiply = (mult: number, m: Modifier) => {
      if (!stackable && !m.noPenalty && !PENALTY_EXEMPT.has(m.source.category)) penalized.push(mult)
      else v *= mult
    }

    for (const m of byOp(0)) multiply(valueOf(m), m)
    for (const m of byOp(1)) {
      const d = valueOf(m)
      if (d) multiply(1 / d, m)
    }
    for (const m of byOp(2)) v += valueOf(m)
    for (const m of byOp(3)) v -= valueOf(m)
    for (const m of byOp(4)) multiply(valueOf(m), m)
    for (const m of byOp(5)) {
      const d = valueOf(m)
      if (d) multiply(1 / d, m)
    }
    for (const m of byOp(6)) multiply(1 + valueOf(m) / 100, m)

    if (penalized.length) v *= stackingProduct(penalized)

    const postAssign = byOp(7)
    if (postAssign.length) v = valueOf(postAssign[postAssign.length - 1])
    return v
  }
}

/** EVE stacking penalty: the n-th strongest modifier is scaled by exp(-(n / 2.67)²). */
export function stackingProduct(mults: number[]): number {
  const up = mults.filter((m) => m > 1).sort((a, b) => b - a)
  const down = mults.filter((m) => m < 1).sort((a, b) => a - b)
  let product = 1
  for (const list of [up, down]) {
    list.forEach((m, i) => {
      product *= 1 + (m - 1) * Math.exp(-Math.pow(i / 2.67, 2))
    })
  }
  return product
}
