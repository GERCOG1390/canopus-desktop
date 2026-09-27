import type { RequestOptions } from '../../../shared/types'

export const ESI = 'https://esi.evetech.net/latest'

export function esi<T>(path: string, options?: RequestOptions): Promise<T> {
  return window.api.request<T>(ESI + path, options)
}

export const imageUrl = {
  portrait: (characterId: number, size = 128) => `https://images.evetech.net/characters/${characterId}/portrait?size=${size}`,
  typeIcon: (typeId: number, size = 32) => `https://images.evetech.net/types/${typeId}/icon?size=${size}`,
  typeRender: (typeId: number, size = 128) => `https://images.evetech.net/types/${typeId}/render?size=${size}`,
  corpLogo: (corpId: number, size = 64) => `https://images.evetech.net/corporations/${corpId}/logo?size=${size}`,
  allianceLogo: (allianceId: number, size = 64) => `https://images.evetech.net/alliances/${allianceId}/logo?size=${size}`
}

// ---------- ID <-> name resolution ----------

const nameCache = new Map<number, string>()

/** Resolves any mix of EVE IDs to names. Unknown IDs are skipped. */
export async function resolveNames(ids: Iterable<number>): Promise<Map<number, string>> {
  const unique = [...new Set(ids)].filter((id) => id > 0)
  const missing = unique.filter((id) => !nameCache.has(id))
  for (let i = 0; i < missing.length; i += 1000) {
    const chunk = missing.slice(i, i + 1000)
    try {
      const rows = await esi<{ id: number; name: string }[]>('/universe/names/', { method: 'POST', body: chunk })
      rows.forEach((r) => nameCache.set(r.id, r.name))
    } catch {
      // One invalid ID fails the whole batch (e.g. player structures); fall back to one by one.
      await Promise.all(
        chunk.map((id) =>
          esi<{ id: number; name: string }[]>('/universe/names/', { method: 'POST', body: [id] })
            .then((rows) => rows.forEach((r) => nameCache.set(r.id, r.name)))
            .catch(() => {})
        )
      )
    }
  }
  return new Map(unique.filter((id) => nameCache.has(id)).map((id) => [id, nameCache.get(id)!]))
}

export interface IdsResult {
  characters?: { id: number; name: string }[]
  corporations?: { id: number; name: string }[]
  alliances?: { id: number; name: string }[]
  inventory_types?: { id: number; name: string }[]
  systems?: { id: number; name: string }[]
  stations?: { id: number; name: string }[]
  regions?: { id: number; name: string }[]
}

/** Exact (case-insensitive) name to ID lookup. */
export async function resolveIds(names: string[]): Promise<IdsResult> {
  const result: IdsResult = {}
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  for (let i = 0; i < unique.length; i += 500) {
    const part = await esi<IdsResult>('/universe/ids/', { method: 'POST', body: unique.slice(i, i + 500) })
    for (const [k, v] of Object.entries(part) as [keyof IdsResult, { id: number; name: string }[]][]) {
      result[k] = (result[k] ?? []).concat(v)
    }
  }
  return result
}

const structureCache = new Map<number, string>()

/**
 * Names for location IDs of any kind: NPC stations and systems via /universe/names,
 * player structures (IDs above 1e12) via the authenticated structure endpoint.
 */
export async function resolveLocations(ids: Iterable<number>, characterId: number | null): Promise<Map<number, string>> {
  const unique = [...new Set(ids)].filter((id) => id > 0)
  const out = await resolveNames(unique.filter((id) => id < 1e12))
  await Promise.all(
    unique
      .filter((id) => id >= 1e12)
      .map(async (id) => {
        if (!structureCache.has(id)) {
          const name = characterId
            ? await esi<{ name: string }>(`/universe/structures/${id}/`, { characterId })
                .then((s) => s.name)
                .catch(() => `Структура ${id}`)
            : `Структура ${id}`
          structureCache.set(id, name)
        }
        out.set(id, structureCache.get(id)!)
      })
  )
  if (unique.includes(2004)) out.set(2004, 'Asset Safety')
  return out
}

const locationSystemCache = new Map<number, Promise<number | null>>()

/** Solar system of a location: a system itself, an NPC station or a player structure (needs docking access). */
export function locationSystem(id: number, characterId: number | null): Promise<number | null> {
  if (id >= 30_000_000 && id < 33_000_000) return Promise.resolve(id)
  let pending = locationSystemCache.get(id)
  if (!pending) {
    if (id >= 60_000_000 && id < 64_000_000) {
      pending = esi<{ system_id: number }>(`/universe/stations/${id}/`).then((s) => s.system_id)
    } else if (id >= 1e12 && characterId) {
      pending = esi<{ solar_system_id: number }>(`/universe/structures/${id}/`, { characterId }).then((s) => s.solar_system_id)
    } else {
      pending = Promise.resolve(null)
    }
    pending = pending.catch(() => null)
    locationSystemCache.set(id, pending)
  }
  return pending
}

// ---------- Static-ish universe data ----------

export interface TypeInfo {
  type_id: number
  name: string
  description: string
  group_id: number
  volume?: number
  packaged_volume?: number
  market_group_id?: number
}

export interface SystemInfo {
  system_id: number
  name: string
  security_status: number
  constellation_id: number
  star_id?: number
  stargates?: number[]
  stations?: number[]
}

const typeCache = new Map<number, Promise<TypeInfo>>()
const systemCache = new Map<number, Promise<SystemInfo>>()

export function typeInfo(typeId: number): Promise<TypeInfo> {
  if (!typeCache.has(typeId)) typeCache.set(typeId, esi<TypeInfo>(`/universe/types/${typeId}/`))
  return typeCache.get(typeId)!
}

export function systemInfo(systemId: number): Promise<SystemInfo> {
  if (!systemCache.has(systemId)) systemCache.set(systemId, esi<SystemInfo>(`/universe/systems/${systemId}/`))
  return systemCache.get(systemId)!
}

export async function systemRegion(systemId: number): Promise<string> {
  const sys = await systemInfo(systemId)
  const constellation = await esi<{ region_id: number }>(`/universe/constellations/${sys.constellation_id}/`)
  return (await resolveNames([constellation.region_id])).get(constellation.region_id) ?? ''
}

// ---------- Search ----------

/**
 * Item search. With a logged-in character we use the authenticated fuzzy search;
 * otherwise only an exact name match is possible (the public search endpoint was retired).
 */
export async function searchTypes(query: string, characterId: number | null): Promise<{ id: number; name: string }[]> {
  const q = query.trim()
  if (q.length < 3) return []
  if (characterId) {
    try {
      const res = await esi<{ inventory_type?: number[] }>(
        `/characters/${characterId}/search/?categories=inventory_type&strict=false&search=${encodeURIComponent(q)}`,
        { characterId }
      )
      const ids = (res.inventory_type ?? []).slice(0, 200)
      const names = await resolveNames(ids)
      return ids
        .filter((id) => names.has(id))
        .map((id) => ({ id, name: names.get(id)! }))
        .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
        .slice(0, 30)
    } catch {
      // Fall through to exact lookup.
    }
  }
  return (await resolveIds([q])).inventory_types ?? []
}

export async function searchSystems(query: string, characterId: number | null): Promise<{ id: number; name: string }[]> {
  const q = query.trim()
  if (q.length < 2) return []
  if (characterId && q.length >= 3) {
    try {
      const res = await esi<{ solar_system?: number[] }>(
        `/characters/${characterId}/search/?categories=solar_system&strict=false&search=${encodeURIComponent(q)}`,
        { characterId }
      )
      const ids = (res.solar_system ?? []).slice(0, 50)
      const names = await resolveNames(ids)
      return ids.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })).slice(0, 20)
    } catch {
      // Fall through to exact lookup.
    }
  }
  return (await resolveIds([q])).systems ?? []
}
