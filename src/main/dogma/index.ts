import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FitSpec, FitStats, SavedFit, SkillSource } from '../../shared/fit'
import { sdeForDogma } from '../sde'
import { Dogma } from './engine'
import { calculate } from './stats'

/** Explains one attribute of one item in a fit: target is 'ship', 'char', or `${kind}:${index}`. */
export function explainAttr(spec: FitSpec, skills: SkillSource, target: string, attrId: number) {
  const d = new Dogma(sdeForDogma(), spec.shipTypeId, skills)
  spec.modules.forEach((m, i) => d.addModule(m.typeId, m.slot, m.state, m.chargeTypeId, i))
  spec.drones.forEach((x, i) => d.addDrone(x.typeId, x.count, Math.min(x.active, x.count), i))
  spec.implants.forEach((id) => d.addImplant(id))
  d.link()
  const [kind, idx] = target.split(':')
  const item =
    kind === 'ship' ? d.ship : kind === 'char' ? d.char : [...d.modules, ...d.charges, ...d.drones].find((i) => i.kind === kind && i.index === Number(idx))
  if (!item) throw new Error('Нет такого предмета')
  return d.explain(item, attrId)
}

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
