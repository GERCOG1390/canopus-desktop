import type { Threat } from '../../../shared/intel'
import { esi, resolveIds } from './esi'

export interface ZkbSummary {
  kills: number
  losses: number
  danger: number
  gang: number
  soloKills: number
  /** Kills in the last 7 days */
  activeWeek: number
  /** zKillboard's "recent" window (about 3 months) */
  recentKills: number
  recentLosses: number
  recentSolo: number
  recentShips: { typeId: number; kills: number; losses: number }[]
  lastActive?: string
  avgGang?: number
}

export type Relation = 'self' | 'corp' | 'alliance' | 'blue' | 'red' | 'neutral'

export interface PilotIntel {
  id: number
  name: string
  corpId?: number
  allianceId?: number
  corpName?: string
  corpTicker?: string
  allianceName?: string
  allianceTicker?: string
  birthday?: string
  relation: Relation
  standing?: number
  /** undefined = still loading, null = zKillboard has nothing */
  zkb?: ZkbSummary | null
  threat: Threat
  source: 'local' | 'chat'
}

export const THREAT_ORDER: Threat[] = ['hostile', 'high', 'medium', 'unknown', 'low', 'friendly']
export const THREAT_LABEL: Record<Threat, string> = {
  hostile: 'Враг',
  high: 'Опасен',
  medium: 'Внимание',
  low: 'Спокоен',
  friendly: 'Свой',
  unknown: '…'
}

// ---------------- Lookups (cached for the session) ----------------

const corpCache = new Map<number, Promise<{ name: string; ticker: string }>>()
const allianceCache = new Map<number, Promise<{ name: string; ticker: string }>>()
const charCache = new Map<number, Promise<{ birthday: string }>>()
const zkbCache = new Map<number, { at: number; data: Promise<ZkbSummary | null> }>()
const ZKB_TTL = 30 * 60_000

const corp = (id: number) => {
  if (!corpCache.has(id)) corpCache.set(id, esi<{ name: string; ticker: string }>(`/corporations/${id}/`).catch(() => ({ name: `#${id}`, ticker: '?' })))
  return corpCache.get(id)!
}
const alliance = (id: number) => {
  if (!allianceCache.has(id)) allianceCache.set(id, esi<{ name: string; ticker: string }>(`/alliances/${id}/`).catch(() => ({ name: `#${id}`, ticker: '?' })))
  return allianceCache.get(id)!
}
const character = (id: number) => {
  if (!charCache.has(id)) charCache.set(id, esi<{ birthday: string }>(`/characters/${id}/`).catch(() => ({ birthday: '' })))
  return charCache.get(id)!
}

interface RawZkb {
  shipsDestroyed?: number
  shipsLost?: number
  dangerRatio?: number
  gangRatio?: number
  soloKills?: number
  avgGangSize?: number
  activepvp?: { kills?: { count?: number } }
  recentLabels?: Record<string, { shipsDestroyed?: number; shipsLost?: number }>
  recentShips?: { shipTypeID: number; kills: number; losses: number }[]
  months?: Record<string, unknown>
}

export function zkbSummary(id: number): Promise<ZkbSummary | null> {
  const hit = zkbCache.get(id)
  if (hit && Date.now() - hit.at < ZKB_TTL) return hit.data
  const data = window.api
    .request<RawZkb | null>(`https://zkillboard.com/api/stats/characterID/${id}/`)
    .then((s): ZkbSummary | null => {
      if (!s || (!s.shipsDestroyed && !s.shipsLost)) return null
      const labels = s.recentLabels ?? {}
      return {
        kills: s.shipsDestroyed ?? 0,
        losses: s.shipsLost ?? 0,
        danger: s.dangerRatio ?? 0,
        gang: s.gangRatio ?? 0,
        soloKills: s.soloKills ?? 0,
        avgGang: s.avgGangSize,
        activeWeek: s.activepvp?.kills?.count ?? 0,
        recentKills: labels.pvp?.shipsDestroyed ?? 0,
        recentLosses: labels.pvp?.shipsLost ?? 0,
        recentSolo: labels.solo?.shipsDestroyed ?? 0,
        recentShips: (s.recentShips ?? []).slice(0, 5).map((r) => ({ typeId: r.shipTypeID, kills: r.kills, losses: r.losses })),
        lastActive: Object.keys(s.months ?? {}).sort().pop()
      }
    })
    .catch(() => null)
  zkbCache.set(id, { at: Date.now(), data })
  return data
}

// ---------------- Standings ----------------

export interface Me {
  id: number
  corpId?: number
  allianceId?: number
  standings: Map<number, number>
}

/** Merges personal, corporation and alliance contacts; personal standings win. */
export async function loadMe(characterId: number): Promise<Me> {
  const info = await esi<{ corporation_id: number; alliance_id?: number }>(`/characters/${characterId}/`).catch(() => null)
  const standings = new Map<number, number>()
  const add = (list: { contact_id: number; standing: number }[] | null) => list?.forEach((c) => !standings.has(c.contact_id) && standings.set(c.contact_id, c.standing))
  const auth = { characterId, allPages: true }
  add(await esi<{ contact_id: number; standing: number }[]>(`/characters/${characterId}/contacts/`, auth).catch(() => null))
  if (info) add(await esi<{ contact_id: number; standing: number }[]>(`/corporations/${info.corporation_id}/contacts/`, auth).catch(() => null))
  if (info?.alliance_id) add(await esi<{ contact_id: number; standing: number }[]>(`/alliances/${info.alliance_id}/contacts/`, auth).catch(() => null))
  return { id: characterId, corpId: info?.corporation_id, allianceId: info?.alliance_id, standings }
}

function relationOf(p: PilotIntel, me: Me | null): { relation: Relation; standing?: number } {
  if (!me) return { relation: 'neutral' }
  if (p.id === me.id) return { relation: 'self' }
  if (p.corpId && p.corpId === me.corpId) return { relation: 'corp' }
  if (p.allianceId && p.allianceId === me.allianceId) return { relation: 'alliance' }
  const standing = [p.id, p.corpId, p.allianceId].map((x) => (x ? me.standings.get(x) : undefined)).find((s) => s !== undefined)
  if (standing !== undefined && standing > 0) return { relation: 'blue', standing }
  if (standing !== undefined && standing < 0) return { relation: 'red', standing }
  return { relation: 'neutral', standing }
}

/** Heuristic danger rating from standings and recent zKillboard activity. */
export function threatOf(p: PilotIntel): Threat {
  if (['self', 'corp', 'alliance', 'blue'].includes(p.relation)) return 'friendly'
  if (p.relation === 'red') return 'hostile'
  if (p.zkb === undefined) return 'unknown'
  const z = p.zkb
  if (!z) return 'low'
  if ((z.activeWeek >= 3 || z.recentKills >= 15) && z.danger >= 50) return 'high'
  if (z.activeWeek >= 1 || z.recentKills >= 3 || (z.kills >= 100 && z.danger >= 60)) return 'medium'
  return 'low'
}

// ---------------- Scan ----------------

async function affiliations(ids: number[]): Promise<Map<number, { corporation_id: number; alliance_id?: number }>> {
  const out = new Map<number, { corporation_id: number; alliance_id?: number }>()
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await esi<{ character_id: number; corporation_id: number; alliance_id?: number }[]>('/characters/affiliation/', {
      method: 'POST',
      body: ids.slice(i, i + 1000)
    })
    rows.forEach((r) => out.set(r.character_id, r))
  }
  return out
}

/**
 * Scans pilots by name. Calls `onUpdate` as data arrives: first identities and affiliations,
 * then zKillboard stats (a few requests at a time — zKillboard asks to be gentle).
 */
export async function scanPilots(
  names: string[],
  source: PilotIntel['source'],
  me: Me | null,
  onUpdate: (pilots: PilotIntel[]) => void,
  isCancelled: () => boolean
): Promise<{ pilots: PilotIntel[]; unknown: string[] }> {
  const ids = await resolveIds(names)
  const chars = ids.characters ?? []
  const known = new Set(chars.map((c) => c.name.toLowerCase()))
  const unknown = names.filter((n) => !known.has(n.toLowerCase()))
  const aff = await affiliations(chars.map((c) => c.id))

  const pilots: PilotIntel[] = chars.map((c) => {
    const a = aff.get(c.id)
    const p: PilotIntel = { id: c.id, name: c.name, corpId: a?.corporation_id, allianceId: a?.alliance_id, relation: 'neutral', threat: 'unknown', source }
    Object.assign(p, relationOf(p, me))
    p.threat = threatOf(p)
    return p
  })
  const emit = () => !isCancelled() && onUpdate(pilots.map((p) => ({ ...p })))
  emit()

  await Promise.all([
    ...[...new Set(pilots.map((p) => p.corpId).filter(Boolean) as number[])].map((id) =>
      corp(id).then((c) => pilots.filter((p) => p.corpId === id).forEach((p) => ((p.corpName = c.name), (p.corpTicker = c.ticker))))
    ),
    ...[...new Set(pilots.map((p) => p.allianceId).filter(Boolean) as number[])].map((id) =>
      alliance(id).then((a) => pilots.filter((p) => p.allianceId === id).forEach((p) => ((p.allianceName = a.name), (p.allianceTicker = a.ticker))))
    )
  ])
  emit()

  // Friendlies don't need a threat lookup; everyone else, a few at a time.
  const queue = pilots.filter((p) => p.threat !== 'friendly')
  let lastEmit = Date.now()
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let p = queue.shift(); p && !isCancelled(); p = queue.shift()) {
        const [z, c] = await Promise.all([zkbSummary(p.id), character(p.id)])
        p.zkb = z
        p.birthday = c.birthday
        p.threat = threatOf(p)
        if (Date.now() - lastEmit > 300) {
          lastEmit = Date.now()
          emit()
        }
      }
    })
  )
  pilots.filter((p) => p.threat === 'friendly').forEach((p) => (p.zkb = p.zkb ?? null))
  emit()
  return { pilots, unknown }
}

export const parseLocalList = (text: string): string[] => [
  ...new Set(
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  )
]

export function sortPilots(list: PilotIntel[]): PilotIntel[] {
  return [...list].sort(
    (a, b) =>
      THREAT_ORDER.indexOf(a.threat) - THREAT_ORDER.indexOf(b.threat) ||
      (b.zkb?.recentKills ?? 0) - (a.zkb?.recentKills ?? 0) ||
      a.name.localeCompare(b.name)
  )
}

// ---------------- D-scan & fleet ----------------

export interface ScanRow {
  typeId: number
  name: string
  typeName: string
  /** km; null when off grid / unknown */
  distanceKm: number | null
}

/** "11190\tName\tSabre\t1 234 km" rows; distances use the client's locale. */
export function parseDscan(text: string): ScanRow[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 3 && /^\d+$/.test(c[0].trim()))
    .map((c) => ({ typeId: Number(c[0]), name: c[1]?.trim() ?? '', typeName: c[2]?.trim() ?? '', distanceKm: parseDistance(c[3] ?? '') }))
}

function parseDistance(raw: string): number | null {
  const m = /([\d\s.,  ]+)\s*(km|км|m|м|AU|а\.\s?е\.)/i.exec(raw.trim())
  if (!m) return null
  const num = Number(m[1].replace(/[\s  ]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'))
  if (Number.isNaN(num)) return null
  const unit = m[2].toLowerCase()
  if (unit === 'km' || unit === 'км') return num
  if (unit === 'm' || unit === 'м') return num / 1000
  return num * 149_597_870.7
}

/** Grid is roughly 8 000 km across. */
export const ON_GRID_KM = 8000
