import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FitSpec, FitStats, SavedFit, SkillSource } from '../../shared/fit'
import { sdeForDogma } from '../sde'
import { calculate } from './stats'

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
