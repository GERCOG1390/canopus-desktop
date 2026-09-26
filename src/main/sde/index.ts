import { app, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  BlueprintActivity,
  InfoAttribute,
  InfoBundle,
  L10n,
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
    attributes.push({ id: Number(aid), n: meta.dn, tt: meta.tt, cat: d.attrCategories[meta.cat ?? 0] ?? 'Other', value, unit: meta.u, high: meta.high })
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
