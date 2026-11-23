// Saved simulator scenarios: both fits and everything set up for the fight, under a name. Kept on this computer,
// and passed to a corpmate as one line of text (no server: the line carries the whole scenario).

import type { CombatPilot, CombatScenario } from './combat'
import type { FitBooster, FitSpec, FleetBoost } from './fit'

export interface ScenarioSetup {
  sc: CombatScenario
  /** Your weapons' ammo chosen in the simulator (module type → charge) */
  ammoA: Record<number, number | undefined>
  boostA?: FitBooster[]
  fleetA?: { fleet?: FleetBoost; boosterFits?: FitSpec[] }
  defender: CombatPilot | null
}

export interface SavedScenario {
  name: string
  /** ISO time */
  savedAt: string
  attacker: CombatPilot
  setup: ScenarioSetup
}

const PREFIX = 'canopus-sim:1:'

const toBase64 = (text: string): string => {
  let bin = ''
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
  return btoa(bin)
}
const fromBase64 = (b64: string): string => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))

/** One line to paste anywhere. */
export function encodeScenario(s: SavedScenario): string {
  return PREFIX + toBase64(JSON.stringify(s))
}

const isPilot = (p: unknown): p is CombatPilot => {
  const x = p as CombatPilot | null
  return !!x && typeof x === 'object' && !!x.fit && typeof x.fit.shipTypeId === 'number' && Array.isArray(x.fit.modules) && !!x.skills && typeof x.skills === 'object'
}

/** The scenario in a pasted line (spaces and line breaks around it are fine), or null when it isn't one. */
export function decodeScenario(text: string): SavedScenario | null {
  const t = text.replace(/\s+/g, '')
  if (!t.startsWith(PREFIX)) return null
  try {
    const s = JSON.parse(fromBase64(t.slice(PREFIX.length))) as SavedScenario
    if (typeof s?.name !== 'string' || !isPilot(s.attacker) || !s.setup || typeof s.setup.sc?.distance !== 'number') return null
    if (s.setup.defender !== null && !isPilot(s.setup.defender)) return null
    return { name: s.name.slice(0, 80), savedAt: typeof s.savedAt === 'string' ? s.savedAt : new Date(0).toISOString(), attacker: s.attacker, setup: { ...s.setup, ammoA: s.setup.ammoA ?? {} } }
  } catch {
    return null
  }
}

/** The library with this scenario added: one of the same name is replaced; newest first. */
export function addScenario(list: SavedScenario[], s: SavedScenario): SavedScenario[] {
  return [s, ...list.filter((x) => x.name !== s.name)]
}

export function removeScenario(list: SavedScenario[], name: string): SavedScenario[] {
  return list.filter((x) => x.name !== name)
}
