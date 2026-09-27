// Fittings saved in the game client (ESI), shared by the character page and the combat simulator.

import { esi } from './esi'
import { getBasic, requestBasics, tn, type Lang } from './sde'

export interface GameFitting {
  fitting_id: number
  name: string
  description: string
  ship_type_id: number
  items: { type_id: number; flag: string | number; quantity: number }[]
}

const cache = new Map<number, Promise<GameFitting[]>>()

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }
const decodeEntities = (s: string): string => (s ?? '').replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e: string) => ENTITIES[e])

/** The character's saved fittings (needs esi-fittings.read_fittings.v1); cached for the session. */
export function loadGameFits(characterId: number, reload = false): Promise<GameFitting[]> {
  let pending = reload ? undefined : cache.get(characterId)
  if (!pending) {
    pending = esi<GameFitting[]>(`/characters/${characterId}/fittings/`, { characterId }).then((fits) => {
      requestBasics(fits.map((f) => f.ship_type_id))
      // The game stores names HTML-escaped ("&lt;" for "<").
      return fits.map((f) => ({ ...f, name: decodeEntities(f.name), description: decodeEntities(f.description) }))
    })
    pending.catch(() => cache.delete(characterId))
    cache.set(characterId, pending)
  }
  return pending
}

export interface ShipGroup<T> {
  shipTypeId: number
  fits: T[]
}

/** Fits grouped by hull, hulls sorted by name and each hull's fits by name. */
export function groupByShip<T>(fits: T[], ship: (f: T) => number, name: (f: T) => string, lang: Lang): ShipGroup<T>[] {
  const groups = new Map<number, T[]>()
  for (const f of fits) {
    const list = groups.get(ship(f)) ?? []
    list.push(f)
    groups.set(ship(f), list)
  }
  const shipName = (id: number) => tn(getBasic(id)?.n, lang) || String(id)
  return [...groups.entries()]
    .map(([shipTypeId, list]) => ({ shipTypeId, fits: list.sort((a, b) => name(a).localeCompare(name(b))) }))
    .sort((a, b) => shipName(a.shipTypeId).localeCompare(shipName(b.shipTypeId)))
}
