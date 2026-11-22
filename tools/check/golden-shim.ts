// Stands in for the engine's main-process modules (main/dogma/index.ts, main/sde) in the golden check: the SDE
// comes from a file instead of the running app. The file: CANOPUS_SDE, else the newest SDE the app has built.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { FitSpec, FitStats, SkillSource } from '../../src/shared/fit'
import type { SdeDb } from '../../src/shared/sde'
import { calculate } from '../../src/main/dogma/stats'

function sdeFile(): string {
  if (process.env.CANOPUS_SDE) return process.env.CANOPUS_SDE
  const dirs = [
    join(homedir(), 'Library/Application Support/canopus/sde'),
    join(process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'canopus/sde'),
    join(homedir(), '.config/canopus/sde')
  ]
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const builds = readdirSync(dir)
      .map((f) => /^sde-(\d+)\.json$/.exec(f)?.[1])
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => b - a)
    if (builds.length) return join(dir, `sde-${builds[0]}.json`)
  }
  throw new Error('No SDE found: open Canopus once so it builds one, or set CANOPUS_SDE to an sde-<build>.json file.')
}

export const db: SdeDb = JSON.parse(readFileSync(sdeFile(), 'utf8'))

export const calculateFit = (spec: FitSpec, skills: SkillSource, extra?: number[]): FitStats => calculate(db, spec, skills, extra)

/** Charges a launcher or gun takes: not needed by the golden fights (they don't search for ammo). */
export const chargesFor = (_typeId: number): number[] => []
