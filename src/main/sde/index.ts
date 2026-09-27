import { app, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  BlueprintActivity,
  DogmaEffect,
  InfoModifier,
  InfoAttribute,
  InfoBundle,
  L10n,
  MarketLevel,
  MarketNode,
  ReqNode,
  SdeDb,
  SdeStatus,
  SkillCatalogGroup,
  SkillReq,
  SystemBasic,
  TypeBasic
} from '../../shared/sde'
import type { FittableType } from '../../shared/fit'
import { SDE_FORMAT } from '../../shared/sde'
import { buildSde, latestBuild } from './build'

/** requiredSkillN attribute → requiredSkillNLevel attribute */
export const REQUIRED_SKILL_ATTRS: [number, number][] = [
  [182, 277],
  [183, 278],
  [184, 279],
  [1285, 1286],
  [1289, 1287],
  [1290, 1288]
]
const ATTR_SKILL_RANK = 275
const ATTR_PRIMARY = 180
const ATTR_SECONDARY = 181
const SKILL_CATEGORY = 16

let db: SdeDb | null = null
let descriptions: Record<number, L10n> | null = null
let status: SdeStatus = { state: 'idle' }

const sdeDir = (): string => join(app.getPath('userData'), 'sde')

function setStatus(next: SdeStatus): void {
  status = next
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('sde:status', status)
}

export const getStatus = (): SdeStatus => status

/** True once a database with the stargate graph (current format) is loaded. */
export const isLoaded = (): boolean => db?.format === SDE_FORMAT

function need(): SdeDb {
  if (!db) throw new Error('База SDE ещё не загружена')
  return db
}

/** The loaded database, for the dogma engine. Throws if the SDE is missing or predates the fitting data. */
export function sdeForDogma(): SdeDb {
  const d = need()
  if (d.format !== SDE_FORMAT) throw new Error('База SDE обновляется для фитинга — подождите минуту')
  return d
}

// ---------------- Loading ----------------

interface SearchEntry {
  id: number
  en: string
  ru: string
  /** Group and category names (both languages), so "имплант" or "frigate" finds whole groups. */
  groupText: string
}
let searchIndex: SearchEntry[] = []
let productToBp = new Map<number, { bp: number; activity: string }>()
let requiredForIndex: Map<number, [number, number][]> | null = null
let usedInIndex: Map<number, InfoBundle['usedIn']> | null = null
let variationIndex: Map<number, number[]> | null = null
let typesByGroup: Map<number, number[]> | null = null

async function load(build: number): Promise<void> {
  const next: SdeDb = JSON.parse(await readFile(join(sdeDir(), `sde-${build}.json`), 'utf8'))
  db = next
  descriptions = null
  requiredForIndex = usedInIndex = variationIndex = typesByGroup = null
  fittables = null
  fitRuleAttrs = null
  fittableCache.clear()
  nameIndex = null
  intelIndex = null
  marketIndex = null
  marketFilters.clear()
  distanceCache.clear()

  searchIndex = Object.values(next.types)
    .filter((t) => t.pub)
    .map((t) => {
      const g = next.groups[t.g]
      const c = g ? next.categories[g.c] : undefined
      const groupText = [...(g?.n ?? []), ...(c?.n ?? [])].join(' ').toLowerCase()
      return { id: t.id, en: t.n[0].toLowerCase(), ru: t.n[1].toLowerCase(), groupText }
    })

  productToBp = new Map()
  for (const [bp, data] of Object.entries(next.blueprints)) {
    for (const activity of ['manufacturing', 'reaction']) {
      for (const [product] of data.act[activity]?.prod ?? []) {
        if (!productToBp.has(product) || next.types[Number(bp)]?.pub) productToBp.set(product, { bp: Number(bp), activity })
      }
    }
  }
}

function localBuilds(): number[] {
  if (!existsSync(sdeDir())) return []
  return readdirSync(sdeDir())
    .map((f) => /^sde-(\d+)\.json$/.exec(f)?.[1])
    .filter((b): b is string => !!b)
    .map(Number)
    .sort((a, b) => b - a)
}

let updating: Promise<void> | null = null

/** Loads the newest local SDE, then checks CCP for a newer build and rebuilds in the background. */
export function initSde(): Promise<void> {
  if (updating) return updating
  updating = (async () => {
    mkdirSync(sdeDir(), { recursive: true })
    const local = localBuilds()
    if (local[0] && !db) {
      try {
        await load(local[0])
        setStatus({ state: 'ready', build: db!.build, releaseDate: db!.releaseDate })
      } catch (err) {
        console.error('Failed to load local SDE', err)
      }
    }
    try {
      if (!db) setStatus({ state: 'checking' })
      const latest = await latestBuild()
      if (db && db.build >= latest.buildNumber && db.format === SDE_FORMAT) {
        setStatus({ state: 'ready', build: db.build, releaseDate: db.releaseDate })
        return
      }
      await buildSde(sdeDir(), latest, (state, progress, message) => setStatus({ state, progress, message, build: db?.build }))
      await load(latest.buildNumber)
      setStatus({ state: 'ready', build: db!.build, releaseDate: db!.releaseDate })
      for (const old of localBuilds().filter((b) => b !== latest.buildNumber)) {
        await rm(join(sdeDir(), `sde-${old}.json`), { force: true })
        await rm(join(sdeDir(), `sde-${old}-descriptions.json`), { force: true })
      }
    } catch (err) {
      console.error('SDE update failed', err)
      if (db) setStatus({ state: 'ready', build: db.build, releaseDate: db.releaseDate, message: 'Не удалось проверить обновления SDE' })
      else setStatus({ state: 'error', message: (err as Error).message })
    }
  })().finally(() => (updating = null))
  return updating
}

// ---------------- Lazy indexes ----------------

function getRequiredForIndex(): Map<number, [number, number][]> {
  if (requiredForIndex) return requiredForIndex
  const d = need()
  requiredForIndex = new Map()
  for (const [id, dogma] of Object.entries(d.dogma)) {
    if (!d.types[Number(id)]?.pub) continue
    for (const [sa, la] of REQUIRED_SKILL_ATTRS) {
      const skill = dogma.a[sa]
      if (!skill) continue
      const list = requiredForIndex.get(skill) ?? []
      list.push([Number(id), dogma.a[la] ?? 1])
      requiredForIndex.set(skill, list)
    }
  }
  return requiredForIndex
}

function getUsedInIndex(): Map<number, InfoBundle['usedIn']> {
  if (usedInIndex) return usedInIndex
  const d = need()
  usedInIndex = new Map()
  for (const [bp, data] of Object.entries(d.blueprints)) {
    if (!d.types[Number(bp)]?.pub) continue
    for (const activity of ['manufacturing', 'reaction']) {
      const a = data.act[activity]
      const product = a?.prod?.[0]?.[0]
      if (!a?.mat || !product) continue
      for (const [mat, qty] of a.mat) {
        const list = usedInIndex.get(mat) ?? []
        list.push({ bp: Number(bp), product, qty, activity })
        usedInIndex.set(mat, list)
      }
    }
  }
  return usedInIndex
}

function getVariationIndex(): Map<number, number[]> {
  if (variationIndex) return variationIndex
  variationIndex = new Map()
  for (const t of Object.values(need().types)) {
    if (!t.pub || !t.vp) continue
    const list = variationIndex.get(t.vp) ?? []
    list.push(t.id)
    variationIndex.set(t.vp, list)
  }
  return variationIndex
}

function getTypesByGroup(): Map<number, number[]> {
  if (typesByGroup) return typesByGroup
  typesByGroup = new Map()
  for (const t of Object.values(need().types)) {
    const list = typesByGroup.get(t.g) ?? []
    list.push(t.id)
    typesByGroup.set(t.g, list)
  }
  return typesByGroup
}

// ---------------- Queries ----------------

export function basics(ids: number[]): Record<number, TypeBasic> {
  const d = need()
  const out: Record<number, TypeBasic> = {}
  for (const id of ids) {
    const t = d.types[id]
    if (!t) continue
    out[id] = { id, n: t.n, g: t.g, c: d.groups[t.g]?.c ?? 0, meta: t.meta, pub: t.pub, v: t.pvol ?? t.vol }
  }
  return out
}

export function search(query: string, opts: { limit?: number; marketOnly?: boolean; categories?: number[] } = {}): TypeBasic[] {
  const d = need()
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const scored: [number, number][] = []
  for (const e of searchIndex) {
    let score = -1
    for (const name of [e.en, e.ru]) {
      if (name === q) score = Math.max(score, 100)
      else if (name.startsWith(q)) score = Math.max(score, 80)
      else if (name.includes(' ' + q)) score = Math.max(score, 60)
      else if (name.includes(q)) score = Math.max(score, 40)
    }
    if (score < 0 && q.length >= 3 && e.groupText.includes(q)) score = 20
    if (score < 0) continue
    const t = d.types[e.id]
    if (opts.marketOnly && !t.mg) continue
    if (opts.categories && !opts.categories.includes(d.groups[t.g]?.c)) continue
    scored.push([e.id, score * 1000 - Math.min(999, e.en.length)])
  }
  scored.sort((a, b) => b[1] - a[1])
  return Object.values(basics(scored.slice(0, opts.limit ?? 40).map(([id]) => id))).sort(
    (a, b) => scored.findIndex((s) => s[0] === a.id) - scored.findIndex((s) => s[0] === b.id)
  )
}

export function searchSystems(query: string, limit = 20): SystemBasic[] {
  const d = need()
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: [SystemBasic, number][] = []
  for (const [id, s] of Object.entries(d.systems)) {
    const name = s.n.toLowerCase()
    const score = name === q ? 3 : name.startsWith(q) ? 2 : name.includes(q) ? 1 : 0
    if (score) hits.push([{ id: Number(id), n: s.n, sec: s.sec, region: d.regions[s.r] ?? ['', ''] }, score])
  }
  return hits
    .sort((a, b) => b[1] - a[1] || a[0].n.localeCompare(b[0].n))
    .slice(0, limit)
    .map(([s]) => s)
}

export function system(id: number): SystemBasic | null {
  const s = need().systems[id]
  return s ? { id, n: s.n, sec: s.sec, region: need().regions[s.r] ?? ['', ''] } : null
}

function requirementTree(typeId: number, depth = 0): ReqNode[] {
  const dogma = need().dogma[typeId]
  if (!dogma || depth > 12) return []
  const out: ReqNode[] = []
  for (const [sa, la] of REQUIRED_SKILL_ATTRS) {
    const skill = dogma.a[sa]
    if (!skill) continue
    const sa2 = need().dogma[skill]?.a ?? {}
    out.push({
      skill,
      level: dogma.a[la] ?? 1,
      rank: sa2[ATTR_SKILL_RANK] ?? 1,
      primary: sa2[ATTR_PRIMARY] ?? 0,
      secondary: sa2[ATTR_SECONDARY] ?? 0,
      children: requirementTree(skill, depth + 1)
    })
  }
  return out
}

/** All skills (with prerequisites) needed for the given types, highest level per skill. */
export function requiredSkills(typeIds: number[]): Record<number, SkillReq> {
  const out: Record<number, SkillReq> = {}
  const walk = (nodes: ReqNode[]): void => {
    for (const n of nodes) {
      if ((out[n.skill]?.level ?? 0) < n.level) out[n.skill] = { level: n.level, rank: n.rank, primary: n.primary, secondary: n.secondary }
      walk(n.children)
    }
  }
  for (const id of new Set(typeIds)) walk(requirementTree(id))
  return out
}

export function dogmaAttrs(ids: number[], attrIds: number[]): Record<number, Record<number, number>> {
  const d = need()
  const out: Record<number, Record<number, number>> = {}
  for (const id of ids) {
    const a = d.dogma[id]?.a ?? {}
    out[id] = Object.fromEntries(attrIds.map((x) => [x, a[x] ?? d.attributes[x]?.def ?? 0]))
  }
  return out
}

export function blueprintForProduct(productId: number): InfoBundle['producedBy'] | null {
  const d = need()
  const hit = productToBp.get(productId)
  if (!hit) return null
  const bp = d.blueprints[hit.bp]
  return { bp: hit.bp, activity: hit.activity, data: bp.act[hit.activity], maxRuns: bp.max }
}

export function skillCatalog(): SkillCatalogGroup[] {
  const d = need()
  const byGroup = getTypesByGroup()
  return Object.entries(d.groups)
    .filter(([, g]) => g.c === SKILL_CATEGORY && g.pub)
    .map(([gid, g]) => ({
      id: Number(gid),
      n: g.n,
      skills: (byGroup.get(Number(gid)) ?? [])
        .map((id) => d.types[id])
        .filter((t) => t.pub)
        .map((t) => {
          const a = d.dogma[t.id]?.a ?? {}
          return { id: t.id, n: t.n, rank: a[ATTR_SKILL_RANK] ?? 1, primary: a[ATTR_PRIMARY] ?? 0, secondary: a[ATTR_SECONDARY] ?? 0, pub: t.pub }
        })
        .sort((a, b) => a.n[0].localeCompare(b.n[0]))
    }))
    .filter((g) => g.skills.length)
    .sort((a, b) => a.n[0].localeCompare(b.n[0]))
}

export function groupNames(ids: number[]): Record<number, L10n> {
  const d = need()
  return Object.fromEntries(ids.filter((id) => d.groups[id]).map((id) => [id, d.groups[id].n]))
}

let nameIndex: Map<string, number> | null = null

/** Exact, case-insensitive type name (English or Russian) → type ID. Published types win. */
export function resolveTypeNames(names: string[]): Record<string, number> {
  const d = need()
  if (!nameIndex) {
    nameIndex = new Map()
    for (const t of Object.values(d.types)) {
      for (const n of t.n) {
        const key = n.toLowerCase()
        if (!nameIndex.has(key) || t.pub) nameIndex.set(key, t.id)
      }
    }
  }
  const out: Record<string, number> = {}
  for (const name of names) {
    const id = nameIndex.get(name.trim().toLowerCase())
    if (id) out[name] = id
  }
  return out
}

/** attributeID → iconID for every attribute that has an icon. */
export function attributeIcons(): Record<number, number> {
  const out: Record<number, number> = {}
  for (const [id, a] of Object.entries(need().attributes)) if (a.icon) out[Number(id)] = a.icon
  return out
}

/** Client resource path of an icon, or null. */
export function iconPath(iconId: number): string | null {
  return db?.icons?.[iconId] ?? null
}

// ---------------- Fitting ----------------

const SLOT_EFFECTS: [number, FittableType['slot']][] = [
  [12, 'hi'],
  [13, 'med'],
  [11, 'lo'],
  [2663, 'rig'],
  [3772, 'sub']
]
const CHARGE_GROUP_ATTRS = [604, 605, 606, 609, 610, 2076, 2077, 2078]
const CHARGE_SIZE_ATTR = 128
let fittables: FittableType[] | null = null

/** Every published module, rig, subsystem, drone and implant with its slot. */
export function fittingCatalog(): FittableType[] {
  if (fittables) return fittables
  const d = sdeForDogma()
  const out: FittableType[] = []
  const attrId = (name: string) => Number(Object.entries(d.attributes).find(([, a]) => a.name === name)?.[0] ?? 0)
  const noRepeatAttr = attrId('disallowRepeatingActivation')
  for (const t of Object.values(d.types)) {
    if (!t.pub || !t.mg) continue
    const cat = d.groups[t.g]?.c
    const dogma = d.dogma[t.id]
    let slot: FittableType['slot'] | undefined
    if (cat === 18) slot = 'drone'
    else if (cat === 20 && dogma?.a[331]) slot = 'implant'
    else if (cat === 7 || cat === 32) slot = SLOT_EFFECTS.find(([e]) => dogma?.e.includes(e))?.[1]
    if (!slot) continue
    const effects = (dogma?.e ?? []).map((e) => d.effects[e]).filter(Boolean)
    out.push({
      id: t.id,
      slot,
      g: t.g,
      mg: t.mg,
      meta: t.meta,
      turret: dogma?.e.includes(42),
      launcher: dogma?.e.includes(40),
      act: effects.some((e) => (e.cat === 1 || e.cat === 2) && !!e.dur),
      oh: effects.some((e) => e.cat === 5),
      burst: !!(noRepeatAttr && dogma?.a[noRepeatAttr]),
      charges: CHARGE_GROUP_ATTRS.some((x) => dogma?.a[x])
    })
  }
  fittables = out
  return out
}

interface FitRuleAttrs {
  groups: number[]
  types: number[]
  fitsToType: number
  rigSize: number
  isCapital: number
}

let fitRuleAttrs: FitRuleAttrs | null = null
const fittableCache = new Map<number, number[]>()

function getFitRuleAttrs(d: SdeDb): FitRuleAttrs {
  if (fitRuleAttrs) return fitRuleAttrs
  const byName = new Map(Object.entries(d.attributes).map(([id, a]) => [a.name, Number(id)]))
  const all = [...byName.entries()]
  fitRuleAttrs = {
    groups: all.filter(([n]) => /^canFitShipGroup\d+$/.test(n)).map(([, id]) => id),
    types: all.filter(([n]) => /^canFitShipType\d+$/.test(n)).map(([, id]) => id),
    fitsToType: byName.get('fitsToShipType') ?? 1380,
    rigSize: byName.get('rigSize') ?? 1547,
    isCapital: byName.get('isCapitalSize') ?? 1785
  }
  return fitRuleAttrs
}

/** Modules larger than this are capital-size: only ships with isCapitalSize can fit them. */
const CAPITAL_MODULE_VOLUME = 3500

/**
 * Items from the fitting catalog that this hull can take at all, by the game's static rules:
 * ship group / type restrictions (canFitShipGroup / canFitShipType), subsystems for their own hull,
 * rig size, capital-size modules on capitals only.
 * Slot counts, hardpoints and the drone bay depend on the fit (T3 subsystems) and are checked in the UI.
 */
export function fittableFor(shipTypeId: number): number[] {
  const cached = fittableCache.get(shipTypeId)
  if (cached) return cached
  const d = sdeForDogma()
  const ship = d.types[shipTypeId]
  if (!ship) return []
  const r = getFitRuleAttrs(d)
  const sa = d.dogma[shipTypeId]?.a ?? {}
  const out: number[] = []
  for (const f of fittingCatalog()) {
    const a = d.dogma[f.id]?.a ?? {}
    const t = d.types[f.id]
    if (f.slot === 'implant') {
      out.push(f.id)
      continue
    }
    // Drone bay size depends on the fit (T3 subsystems add one): checked in the UI.
    if (f.slot === 'drone') {
      out.push(f.id)
      continue
    }
    const groups = r.groups.map((x) => a[x]).filter(Boolean)
    const types = r.types.map((x) => a[x]).filter(Boolean)
    if ((groups.length || types.length) && !groups.includes(ship.g) && !types.includes(shipTypeId)) continue
    if (f.slot === 'sub' && a[r.fitsToType] !== shipTypeId) continue
    if (f.slot === 'rig' && (a[r.rigSize] ?? 0) !== (sa[r.rigSize] ?? -1)) continue
    if ((t.vol ?? 0) > CAPITAL_MODULE_VOLUME && !sa[r.isCapital]) continue
    out.push(f.id)
  }
  if (fittableCache.size > 30) fittableCache.clear()
  fittableCache.set(shipTypeId, out)
  return out
}

/** Charges that fit a module: matching charge group, charge size and capacity. */
export function chargesFor(moduleTypeId: number): number[] {
  const d = sdeForDogma()
  const a = d.dogma[moduleTypeId]?.a ?? {}
  const groups = new Set(CHARGE_GROUP_ATTRS.map((x) => a[x]).filter(Boolean))
  if (!groups.size) return []
  const size = a[CHARGE_SIZE_ATTR]
  const capacity = d.types[moduleTypeId]?.cap ?? Infinity
  const byGroup = getTypesByGroup()
  return [...groups]
    .flatMap((g) => byGroup.get(g) ?? [])
    .filter((id) => {
      const t = d.types[id]
      if (!t?.pub) return false
      if (size && d.dogma[id]?.a[CHARGE_SIZE_ATTR] !== size) return false
      return (t.vol ?? 0) <= capacity
    })
    .sort((x, y) => d.types[x].n[0].localeCompare(d.types[y].n[0]))
}

async function getDescriptions(): Promise<Record<number, L10n>> {
  if (!descriptions) {
    descriptions = JSON.parse(await readFile(join(sdeDir(), `sde-${need().build}-descriptions.json`), 'utf8'))
  }
  return descriptions!
}

const SKILL_LEVEL_ATTR = 280
const EFFECT_STATE: Record<number, InfoModifier['state']> = { 0: 'passive', 4: 'online', 1: 'active', 5: 'overload' }
const ITEM_TARGET: Record<string, InfoModifier['target']> = { itemID: 'self', shipID: 'ship', charID: 'char', otherID: 'other' }
/** Client-coded skill effects (no modifiers in the SDE) — the same set the dogma engine implements. */
const SELF_SKILL_EFFECTS: Record<string, { attr: number; src: number }> = {
  missileEMDmgBonus: { attr: 114, src: 292 },
  missileExplosiveDmgBonus: { attr: 116, src: 292 },
  missileThermalDmgBonus: { attr: 118, src: 292 },
  missileKineticDmgBonus2: { attr: 117, src: 292 },
  selfRof: { attr: 51, src: 293 },
  droneDmgBonus: { attr: 64, src: 292 }
}

/** Translates a type's dogma effects into readable "what changes" lines. */
function describeModifiers(typeId: number): { list: InfoModifier[]; boostsHull: boolean } {
  const d = need()
  const dogma = d.dogma[typeId]
  const list: InfoModifier[] = []
  let boostsHull = false
  if (!dogma || d.format < 2) return { list, boostsHull }

  const effects = dogma.e.map((id) => d.effects[id]).filter((e): e is DogmaEffect => !!e && typeof e === 'object')
  // Attributes the item multiplies by its own skill level are "per level" bonuses.
  const perLevel = new Set<number>()
  for (const e of effects) for (const m of e.mods ?? []) if (m.domain === 'itemID' && m.src === SKILL_LEVEL_ATTR && m.op === 0) perLevel.add(m.attr)

  const valueOf = (attr: number) => dogma.a[attr] ?? d.attributes[attr]?.def ?? 0
  const attrInfo = (attr: number) => {
    const a = d.attributes[attr]
    return { attrName: a?.dn ?? ([a?.name ?? String(attr), a?.name ?? String(attr)] as L10n), attrIcon: a?.icon, unit: a?.u, unitName: a?.u ? d.units[a.u] : undefined }
  }

  for (const e of effects) {
    if (e.name === 'skillEffect') continue
    const state = EFFECT_STATE[e.cat]
    if (!state) continue
    if (e.name === 'moduleBonusMicrowarpdrive' || e.name === 'moduleBonusAfterburner') {
      list.push({ state, target: 'ship', attr: 37, ...attrInfo(37), op: 6, value: valueOf(20), note: 'фактический прирост зависит от массы корабля' })
      list.push({ state, target: 'ship', attr: 4, ...attrInfo(4), op: 2, value: valueOf(796) })
      if (e.name === 'moduleBonusMicrowarpdrive') list.push({ state, target: 'ship', attr: 552, ...attrInfo(552), op: 6, value: valueOf(554) })
      continue
    }
    const self = SELF_SKILL_EFFECTS[e.name]
    if (self) {
      list.push({ state, target: 'selfSkill', attr: self.attr, ...attrInfo(self.attr), op: 6, value: valueOf(self.src), perLevel: true })
      continue
    }
    for (const m of e.mods ?? []) {
      if (m.src === SKILL_LEVEL_ATTR) {
        if (m.domain === 'shipID') boostsHull = true
        continue
      }
      if (!['itemID', 'shipID', 'charID', 'otherID'].includes(m.domain)) continue
      let target: InfoModifier['target'] | undefined
      if (m.func === 'ItemModifier') target = ITEM_TARGET[m.domain]
      else if (m.func === 'LocationGroupModifier') target = 'group'
      else if (m.func === 'LocationRequiredSkillModifier' || m.func === 'OwnerRequiredSkillModifier') target = 'skill'
      else if (m.func === 'LocationModifier') target = 'location'
      if (!target) continue
      // Skills modifying their own bonus attribute are bookkeeping, not an effect on anything.
      if (target === 'self' && perLevel.has(m.attr)) continue
      const value = valueOf(m.src)
      if (value === 0 && m.op !== 7 && m.op !== -1) continue
      list.push({
        state,
        target,
        group: m.group,
        skill: m.skill === -1 ? typeId : m.skill,
        attr: m.attr,
        ...attrInfo(m.attr),
        op: m.op,
        value,
        // Hull bonus attributes are scaled by the ship skill's level (see the skills' PreMul effects).
        perLevel: perLevel.has(m.src) || /^(shipBonus|eliteBonus)/.test(d.attributes[m.src]?.name ?? '')
      })
    }
  }
  const seen = new Set<string>()
  return {
    list: list.filter((x) => {
      const k = `${x.state}|${x.target}|${x.group}|${x.skill}|${x.attr}|${x.op}|${x.value}`
      return seen.has(k) ? false : (seen.add(k), true)
    }),
    boostsHull
  }
}

export async function info(typeId: number): Promise<InfoBundle> {
  const d = need()
  const type = d.types[typeId]
  if (!type) throw new Error(`Тип ${typeId} не найден в SDE`)
  const group = d.groups[type.g] ?? { n: ['?', '?'] as L10n, c: 0, pub: false }
  const category = d.categories[group.c] ?? { n: ['?', '?'] as L10n, pub: false }
  const dogma = d.dogma[typeId] ?? { a: {}, e: [] }
  const refIds = new Set<number>()

  const marketPath: L10n[] = []
  for (let mg = type.mg, guard = 0; mg && guard < 10; guard++) {
    const g = d.marketGroups[mg]
    if (!g) break
    marketPath.unshift(g.n)
    mg = g.p
  }

  const reqAttrIds = new Set(REQUIRED_SKILL_ATTRS.flat())
  const attributes: InfoAttribute[] = []
  const unitIds = new Set<number>()
  const groupIds = new Set<number>()
  const attrIds = new Set<number>()
  for (const [aid, value] of Object.entries(dogma.a)) {
    const meta = d.attributes[Number(aid)]
    if (!meta?.pub || !meta.dn?.[0] || reqAttrIds.has(Number(aid)) || value === 0) continue
    attributes.push({ id: Number(aid), n: meta.dn, tt: meta.tt, cat: d.attrCategories[meta.cat ?? 0] ?? 'Other', value, unit: meta.u, high: meta.high, icon: meta.icon })
    if (meta.u) unitIds.add(meta.u)
    if (meta.u === 116) refIds.add(value)
    if (meta.u === 115) groupIds.add(value)
    if (meta.u === 119) attrIds.add(value)
  }

  const bonusRow = d.bonuses[typeId]
  const traits = bonusRow
    ? { role: bonusRow.role, misc: bonusRow.misc, skills: bonusRow.skills?.map(([skill, bonuses]) => ({ skill, bonuses })) }
    : undefined
  traits?.skills?.forEach((s) => refIds.add(s.skill))

  const requirements = requirementTree(typeId)
  const walk = (nodes: ReqNode[]): void => nodes.forEach((n) => (refIds.add(n.skill), walk(n.children)))
  walk(requirements)

  let skill: InfoBundle['skill']
  let requiredFor: InfoBundle['requiredFor']
  if (group.c === SKILL_CATEGORY) {
    skill = { rank: dogma.a[ATTR_SKILL_RANK] ?? 1, primary: dogma.a[ATTR_PRIMARY] ?? 0, secondary: dogma.a[ATTR_SECONDARY] ?? 0 }
    const list = getRequiredForIndex().get(typeId) ?? []
    requiredFor = [1, 2, 3, 4, 5]
      .map((level) => ({ level, types: list.filter(([, l]) => l === level).map(([id]) => id) }))
      .filter((x) => x.types.length)
    list.forEach(([id]) => refIds.add(id))
  }

  const parent = type.vp ?? typeId
  const variations = [parent, ...(getVariationIndex().get(parent) ?? [])].filter((id, i, arr) => arr.indexOf(id) === i && d.types[id]?.pub)
  variations.sort((a, b) => (d.types[a].ml ?? 0) - (d.types[b].ml ?? 0) || (d.types[a].meta ?? 0) - (d.types[b].meta ?? 0))
  if (variations.length > 1) variations.forEach((id) => refIds.add(id))

  const collectActivity = (a?: BlueprintActivity): void => {
    a?.mat?.forEach(([id]) => refIds.add(id))
    a?.prod?.forEach(([id]) => refIds.add(id))
    a?.skills?.forEach(([id]) => refIds.add(id))
  }
  const producedBy = blueprintForProduct(typeId) ?? undefined
  if (producedBy) {
    refIds.add(producedBy.bp)
    collectActivity(producedBy.data)
  }
  const bpRow = d.blueprints[typeId]
  const blueprint = bpRow ? { maxRuns: bpRow.max, act: bpRow.act } : undefined
  if (blueprint) Object.values(blueprint.act).forEach(collectActivity)

  const usedIn = (getUsedInIndex().get(typeId) ?? []).slice(0, 300)
  usedIn.forEach((u) => (refIds.add(u.bp), refIds.add(u.product)))

  const reprocess = d.reprocess[typeId]
  reprocess?.forEach(([id]) => refIds.add(id))

  let masteries: InfoBundle['masteries']
  const masteryRow = d.masteries[typeId]
  if (masteryRow) {
    masteries = masteryRow.map((certIds, level) => ({
      level: level + 1,
      certs: certIds
        .map((cid) => d.certificates[cid])
        .filter(Boolean)
        .map((cert, i) => ({
          id: certIds[i],
          n: cert.n,
          skills: cert.skills.map((s) => [s[0], s[1 + level]] as [number, number]).filter(([, lvl]) => lvl > 0)
        }))
    }))
    masteries.forEach((m) => m.certs.forEach((c) => c.skills.forEach(([id]) => refIds.add(id))))
  }

  const described = describeModifiers(typeId)
  for (const m of described.list) {
    if (m.skill) refIds.add(m.skill)
    if (m.group) groupIds.add(m.group)
  }

  const description = (await getDescriptions())[typeId]
  const linkRe = /showinfo:(\d+)/g
  const scanLinks = (text?: string): void => {
    for (const m of text?.matchAll(linkRe) ?? []) refIds.add(Number(m[1]))
  }
  description?.forEach(scanLinks)
  ;[...(traits?.role ?? []), ...(traits?.misc ?? []), ...(traits?.skills?.flatMap((s) => s.bonuses) ?? [])].forEach((b) => b.t.forEach(scanLinks))

  return {
    type,
    group: { id: type.g, n: group.n },
    category: { id: group.c, n: category.n },
    marketPath,
    meta: type.meta ? d.metaGroups[type.meta] : undefined,
    race: type.race ? d.races[type.race] : undefined,
    faction: type.faction ? d.factions[type.faction] : undefined,
    description,
    attributes,
    // Databases built before format 2 stored effect names as plain strings.
    effects: dogma.e.map((e) => { const ef = d.effects[e] as unknown; return typeof ef === 'string' ? ef : (ef as { name?: string } | undefined)?.name }).filter((x): x is string => !!x),
    modifiers: described.list,
    boostsHullBonuses: described.boostsHull,
    traits,
    requirements,
    skill,
    requiredFor,
    variations: variations.length > 1 ? variations : [],
    producedBy,
    blueprint,
    usedIn,
    reprocess,
    masteries,
    refs: basics([...refIds]),
    units: Object.fromEntries([...unitIds].map((u) => [u, d.units[u] ?? ['', '']])),
    groupNames: Object.fromEntries([...groupIds].map((g) => [g, d.groups[g]?.n ?? ['?', '?']])),
    attrNames: Object.fromEntries([...attrIds].map((a) => [a, d.attributes[a]?.dn ?? [d.attributes[a]?.name ?? '?', d.attributes[a]?.name ?? '?']]))
  }
}

// ---------------- Intel channel messages ----------------

const SHIP_CATEGORY = 6

interface IntelIndex {
  /** lower-case system name → system ID */
  systems: Map<string, number>
  /** lower-case ship name (English or Russian) → type ID */
  ships: Map<string, number>
  /** Names made of several words, so n-grams are only tried when needed. */
  maxWords: number
  /** Nullsec-style names ("1DQ1-A"), for abbreviations like "1DQ". */
  coded: [string, number][]
}

let intelIndex: IntelIndex | null = null

function getIntelIndex(): IntelIndex {
  if (intelIndex) return intelIndex
  const d = need()
  const systems = new Map<string, number>()
  const coded: [string, number][] = []
  let maxWords = 1
  for (const [id, s] of Object.entries(d.systems)) {
    const key = s.n.toLowerCase()
    systems.set(key, Number(id))
    maxWords = Math.max(maxWords, key.split(' ').length)
    if (/[0-9-]/.test(key)) coded.push([key, Number(id)])
  }
  const ships = new Map<string, number>()
  for (const t of Object.values(d.types)) {
    if (!t.pub || d.groups[t.g]?.c !== SHIP_CATEGORY) continue
    for (const n of t.n) {
      const key = n.toLowerCase()
      if (!key || systems.has(key)) continue
      ships.set(key, t.id)
      maxWords = Math.max(maxWords, key.split(' ').length)
    }
  }
  intelIndex = { systems, ships, maxWords: Math.min(maxWords, 4), coded }
  return intelIndex
}

/**
 * Systems and ships mentioned in an intel channel message, in the order they appear.
 * Players paste full names ("1DQ1-A", "Jita") or abbreviate nullsec names ("1DQ"),
 * so an unambiguous prefix of a coded name (3+ characters with a digit or dash) counts too.
 */
export function parseIntelMessage(text: string): { systems: number[]; ships: number[] } {
  if (!db) return { systems: [], ships: [] }
  const idx = getIntelIndex()
  const words = text
    .split(/[\s,;:!?()[\]{}<>"*|/\\]+/)
    .map((w) => w.replace(/^[.'-]+|[.']+$/g, ''))
    .filter(Boolean)
  const systems: number[] = []
  const ships: number[] = []
  for (let i = 0; i < words.length; ) {
    let matched = 0
    for (let n = Math.min(idx.maxWords, words.length - i); n >= 1 && !matched; n--) {
      const phrase = words.slice(i, i + n).join(' ').toLowerCase()
      const sys = idx.systems.get(phrase)
      const ship = sys ? undefined : idx.ships.get(phrase)
      if (sys) systems.push(sys)
      else if (ship) ships.push(ship)
      else if (n === 1 && phrase.length >= 3 && /[0-9-]/.test(phrase) && /[a-z]/.test(phrase)) {
        const hits = idx.coded.filter(([name]) => name.startsWith(phrase))
        if (hits.length === 1) systems.push(hits[0][1])
        else continue
      } else continue
      matched = n
    }
    i += matched || 1
  }
  return { systems: [...new Set(systems)], ships: [...new Set(ships)] }
}

const distanceCache = new Map<number, Map<number, number>>()

/** Jumps by stargate from one system to others (breadth-first, up to `max` jumps; farther ones are omitted). */
export function jumpsFrom(fromId: number, targets: number[], max = 40): Record<number, number> {
  const d = need()
  if (!d.jumps) return {}
  let dist = distanceCache.get(fromId)
  if (!dist) {
    dist = new Map([[fromId, 0]])
    let frontier = [fromId]
    for (let depth = 1; depth <= max && frontier.length; depth++) {
      const next: number[] = []
      for (const s of frontier)
        for (const n of d.jumps[s] ?? []) {
          if (dist.has(n)) continue
          dist.set(n, depth)
          next.push(n)
        }
      frontier = next
    }
    if (distanceCache.size > 50) distanceCache.clear()
    distanceCache.set(fromId, dist)
  }
  const out: Record<number, number> = {}
  for (const t of targets) {
    const j = dist.get(t)
    if (j !== undefined) out[t] = j
  }
  return out
}

export function systemIdByName(name: string): number | null {
  if (!db) return null
  return getIntelIndex().systems.get(name.trim().toLowerCase()) ?? null
}

// ---------------- Market group tree (market browser, ship browser) ----------------

interface MarketIndex {
  /** parent market group (0 = root) → child groups */
  children: Map<number, number[]>
  /** market group → published types in it */
  types: Map<number, number[]>
  count: Map<number, number>
}

let marketIndex: MarketIndex | null = null

function getMarketIndex(): MarketIndex {
  if (marketIndex) return marketIndex
  const d = need()
  const children = new Map<number, number[]>()
  for (const [key, g] of Object.entries(d.marketGroups)) {
    const parent = g.p ?? 0
    const list = children.get(parent) ?? []
    list.push(Number(key))
    children.set(parent, list)
  }
  const types = new Map<number, number[]>()
  for (const t of Object.values(d.types)) {
    if (!t.pub || !t.mg) continue
    const list = types.get(t.mg) ?? []
    list.push(t.id)
    types.set(t.mg, list)
  }
  const count = new Map<number, number>()
  const countOf = (id: number): number => {
    let n = count.get(id)
    if (n === undefined) {
      n = (types.get(id)?.length ?? 0) + (children.get(id) ?? []).reduce((s, c) => s + countOf(c), 0)
      count.set(id, n)
    }
    return n
  }
  for (const id of Object.keys(d.marketGroups)) countOf(Number(id))
  marketIndex = { children, types, count }
  return marketIndex
}

/** Ship classes by hull size, like the game's ship browser (market group IDs). */
const SHIP_CLASS_ORDER = [391, 1815, 1361, 1372, 1367, 1374, 1376, 1381, 1382, 1384, 1612]

/**
 * One level of the market tree: subgroups (empty ones left out) and the items directly in the group.
 * 'name' sorts like the in-game market; 'size' puts ship classes in hull-size order and
 * "Standard …" groups before advanced / faction ones, like the fitting ship browser.
 */
const LATIN_LOOKALIKES: Record<string, string> = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у' }

/** Sort key: some Russian SDE names contain Latin look-alike letters ("Cооружения"), which would sort them first. */
function sortKey(text: string): string {
  return /[а-яё]/i.test(text) ? text.replace(/[ABCEHKMOPTXacepoxy]/g, (ch) => LATIN_LOOKALIKES[ch]) : text
}

/** Tech I, Tech II, Storyline, Faction, Deadspace, Officer, Tech III — the in-game order of meta groups. */
const META_ORDER: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 6: 4, 5: 5, 14: 6 }
const metaRank = (meta?: number) => (meta === undefined ? 0 : META_ORDER[meta] ?? 7)

interface MarketFilter {
  items: Set<number>
  /** Allowed items per market group subtree */
  count: Map<number, number>
}

/** Item filters for the tree, registered by the UI under a key (e.g. "what fits this hull's mid slots"). */
const marketFilters = new Map<string, MarketFilter>()

export function setMarketFilter(key: string, ids: number[]): void {
  const d = need()
  const idx = getMarketIndex()
  const items = new Set(ids)
  const count = new Map<number, number>()
  const countOf = (id: number): number => {
    let n = count.get(id)
    if (n === undefined) {
      n = (idx.types.get(id) ?? []).filter((t) => items.has(t)).length + (idx.children.get(id) ?? []).reduce((s, c) => s + countOf(c), 0)
      count.set(id, n)
    }
    return n
  }
  for (const id of Object.keys(d.marketGroups)) countOf(Number(id))
  if (marketFilters.size > 20) marketFilters.clear()
  marketFilters.set(key, { items, count })
}

export function marketChildren(parent: number | null, order: 'name' | 'size' = 'name', lang: 0 | 1 = 0, filterKey?: string): MarketLevel {
  const d = need()
  const idx = getMarketIndex()
  const filter = filterKey ? marketFilters.get(filterKey) : undefined
  const countOf = (id: number) => (filter ? filter.count.get(id) : idx.count.get(id)) ?? 0
  const name = (n: [string, string]) => sortKey(n[lang] || n[0])
  const rank = (id: number) => {
    if (order !== 'size') return 0
    const i = SHIP_CLASS_ORDER.indexOf(id)
    if (i >= 0) return i - 100
    return /^Standard/i.test(d.marketGroups[id].n[0]) ? -1 : 0
  }
  const groups: MarketNode[] = (idx.children.get(parent ?? 0) ?? [])
    .filter((id) => countOf(id) > 0)
    .sort((a, b) => rank(a) - rank(b) || name(d.marketGroups[a].n).localeCompare(name(d.marketGroups[b].n)))
    .map((id) => ({ id, n: d.marketGroups[id].n, icon: d.marketGroups[id].icon, count: countOf(id) }))
  const ids = (parent === null ? [] : (idx.types.get(parent) ?? [])).filter((id) => !filter || filter.items.has(id))
  // Like the game: Tech I, Tech II, storyline, faction… and by meta level inside each.
  const types = Object.values(basics(ids)).sort(
    (a, b) => metaRank(a.meta) - metaRank(b.meta) || (d.types[a.id].ml ?? 0) - (d.types[b.id].ml ?? 0) || name(a.n).localeCompare(name(b.n))
  )
  return { groups, types }
}

/** Market groups from the root down to the item's own group (to open the browser at an item). */
export function marketPath(typeId: number): number[] {
  const d = need()
  const path: number[] = []
  for (let g = d.types[typeId]?.mg; g !== undefined && path.length < 12; g = d.marketGroups[g]?.p) path.unshift(g)
  return path
}
