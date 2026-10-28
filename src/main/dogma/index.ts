import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FitMetrics, FitSpec, FitStats, FitVariant, SavedFit, SkillSource } from '../../shared/fit'
import { fittableFor, requiredSkills, sdeForDogma, variantsOf } from '../sde'
import { Dogma, shipModes } from './engine'
import { calculate } from './stats'
import { fitMetrics } from './metrics'

export { fitMetrics }

/** Explains one attribute of one item in a fit: target is 'ship', 'char', or `${kind}:${index}`. */
export function explainAttr(spec: FitSpec, skills: SkillSource, target: string, attrId: number) {
  const d = new Dogma(sdeForDogma(), spec.shipTypeId, skills)
  spec.modules.forEach((m, i) => d.addModule(m.typeId, m.slot, m.state, m.chargeTypeId, i))
  spec.drones.forEach((x, i) => d.addDrone(x.typeId, x.count, Math.min(x.active, x.count), i))
  spec.implants.forEach((id) => d.addImplant(id))
  const mode = spec.mode ?? shipModes(sdeForDogma(), spec.shipTypeId)[0]?.id
  if (mode) d.setMode(mode)
  if (spec.environment) d.setEnvironment(spec.environment)
  d.link()
  const [kind, idx] = target.split(':')
  const item =
    kind === 'ship' ? d.ship : kind === 'char' ? d.char : [...d.modules, ...d.charges, ...d.drones].find((i) => i.kind === kind && i.index === Number(idx))
  if (!item) throw new Error('Нет такого предмета')
  return d.explain(item, attrId)
}

/** A tactical destroyer's modes, Defense first (empty for other hulls). */
export const modesOf = (shipTypeId: number) => shipModes(sdeForDogma(), shipTypeId)

export function calculateFit(spec: FitSpec, skills: SkillSource, extraShipAttrs?: number[]): FitStats {
  return calculate(sdeForDogma(), spec, skills, extraShipAttrs)
}

// ---------- Locally saved fits ----------

const fitsPath = (): string => join(app.getPath('userData'), 'fits.json')

export function listFits(): SavedFit[] {
  try {
    return existsSync(fitsPath()) ? JSON.parse(readFileSync(fitsPath(), 'utf8')) : []
  } catch {
    return []
  }
}

export function saveFit(fit: FitSpec & { id?: string }): SavedFit {
  const fits = listFits()
  const saved: SavedFit = { ...fit, id: fit.id ?? randomUUID(), updated: new Date().toISOString() }
  const next = fits.filter((f) => f.id !== saved.id).concat(saved)
  writeFileSync(fitsPath(), JSON.stringify(next, null, 2), 'utf8')
  return saved
}

export function deleteFit(id: string): void {
  writeFileSync(fitsPath(), JSON.stringify(listFits().filter((f) => f.id !== id), null, 2), 'utf8')
}

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
/**
 * The fit with each fitted module type (all modules of that type at once) and each drone type swapped for
 * every other version of it the hull can take, and the resulting numbers. Prices are added in the renderer.
 */
export function fitVariants(spec: FitSpec, skills: SkillSource): { base: FitMetrics; options: FitVariant[] } {
  const db = sdeForDogma()
  const base = fitMetrics(calculate(db, spec, skills))
  const allowed = new Set(fittableFor(spec.shipTypeId))
  const lacks = (id: number) => skills.mode === 'char' && Object.entries(requiredSkills([id])).some(([sk, r]) => (skills.levels[Number(sk)] ?? 0) < r.level)
  const options: FitVariant[] = []
  for (const from of new Set(spec.modules.map((m) => m.typeId))) {
    const count = spec.modules.filter((m) => m.typeId === from).length
    for (const to of variantsOf(from)) {
      if (!allowed.has(to)) continue
      const next = { ...spec, modules: spec.modules.map((m) => (m.typeId === from ? { ...m, typeId: to } : m)) }
      options.push({ from, to, kind: 'module', count, metrics: fitMetrics(calculate(db, next, skills)), missingSkills: lacks(to) })
    }
  }
  for (const d of spec.drones) {
    for (const to of variantsOf(d.typeId)) {
      if (!allowed.has(to) || spec.drones.some((x) => x.typeId === to)) continue
      const next = { ...spec, drones: spec.drones.map((x) => (x.typeId === d.typeId ? { ...x, typeId: to } : x)) }
      options.push({ from: d.typeId, to, kind: 'drone', count: d.count, metrics: fitMetrics(calculate(db, next, skills)), missingSkills: lacks(to) })
    }
  }
  return { base, options }
}

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
