// A battle from zKillboard's related page: its two sides, what each brought and lost.

export interface RelatedPilot {
  shipTypeID?: number
  characterID?: number
  groupID?: number
  groupName?: string
  isVictim?: boolean
  killID?: number
  characterName?: string
  corporationName?: string
  allianceName?: string
}

export interface RelatedKill {
  dttm?: { $date?: { $numberLong?: string } }
  zkb?: { totalValue?: number }
}

export interface RelatedTeam {
  list: RelatedPilot[]
  kills: Record<string, RelatedKill> | RelatedKill[]
  totals: { total_price?: number; total_dropped?: number; totalShips?: number; pilotCount?: number }
  entities: Record<string, { name: string; type: string }> | unknown[]
}

export interface Related {
  systemID: number
  systemName: string
  regionName?: string
  startTime?: string
  endTime?: string
  relatedTime?: number
  summary: { teamA: RelatedTeam; teamB: RelatedTeam }
}

export interface BattleLoss {
  killId: number
  shipTypeId: number
  pilot: string
  corporation: string
  value: number
}

export interface BattleSide {
  entities: { id: number; name: string; type: string }[]
  pilots: number
  shipsLost: number
  iskLost: number
  iskDropped: number
  /** Share of all the ISK destroyed in the fight that this side's enemies lost, 0–1 */
  efficiency: number
  /** What the side flew, pods aside, biggest class first */
  fielded: { groupId: number; group: string; count: number; lost: number }[]
  losses: BattleLoss[]
}

export interface BattleReport {
  systemId: number
  systemName: string
  regionName: string
  sides: [BattleSide, BattleSide]
  /** First and last kill, ms; null with no kills */
  first: number | null
  last: number | null
  iskDestroyed: number
}

const CAPSULE_GROUP = 29

const killTime = (k: RelatedKill): number | null => {
  const t = Number(k.dttm?.$date?.$numberLong)
  return Number.isFinite(t) && t > 0 ? t : null
}

// PHP encodes an empty map as a list.
const entries = <T>(v: Record<string, T> | unknown): [string, T][] => (v && !Array.isArray(v) ? Object.entries(v as Record<string, T>) : [])

function side(team: RelatedTeam, enemyLost: number): BattleSide {
  const kills = new Map(entries<RelatedKill>(team.kills).map(([id, k]) => [Number(id), k]))
  const lost = team.totals.total_price ?? 0
  // A pilot appears once per ship: flying and then losing the same ship isn't two.
  const ships = new Map<string, RelatedPilot>()
  for (const p of team.list) {
    if (p.groupID === CAPSULE_GROUP) continue
    const key = `${p.characterID ?? `npc${p.shipTypeID}`}:${p.shipTypeID}`
    if (!ships.has(key) || p.isVictim) ships.set(key, p)
  }
  const fielded = new Map<string, { groupId: number; group: string; count: number; lost: number }>()
  for (const p of ships.values()) {
    const group = p.groupName ?? '—'
    const row = fielded.get(group) ?? { groupId: p.groupID ?? 0, group, count: 0, lost: 0 }
    row.count++
    if (p.isVictim) row.lost++
    fielded.set(group, row)
  }
  const losses = team.list
    .filter((p) => p.isVictim && p.killID)
    .map((p) => ({
      killId: p.killID as number,
      shipTypeId: p.shipTypeID ?? 0,
      pilot: p.characterName ?? '—',
      corporation: p.corporationName ?? '',
      value: kills.get(p.killID as number)?.zkb?.totalValue ?? 0
    }))
    .sort((a, b) => b.value - a.value)
  return {
    entities: entries<{ name: string; type: string }>(team.entities).map(([id, e]) => ({ id: Number(id), name: e.name, type: e.type })),
    pilots: team.totals.pilotCount ?? new Set(team.list.map((p) => p.characterID)).size,
    shipsLost: team.totals.totalShips ?? losses.length,
    iskLost: lost,
    iskDropped: team.totals.total_dropped ?? 0,
    efficiency: lost + enemyLost > 0 ? enemyLost / (lost + enemyLost) : 0,
    fielded: [...fielded.values()].sort((a, b) => b.count - a.count || a.group.localeCompare(b.group)),
    losses
  }
}

export function summarizeBattle(r: Related): BattleReport {
  const a = r.summary.teamA
  const b = r.summary.teamB
  const lostA = a.totals.total_price ?? 0
  const lostB = b.totals.total_price ?? 0
  const times = [...entries<RelatedKill>(a.kills), ...entries<RelatedKill>(b.kills)].map(([, k]) => killTime(k)).filter((t): t is number => t !== null)
  return {
    systemId: r.systemID,
    systemName: r.systemName,
    regionName: r.regionName ?? '',
    sides: [side(a, lostB), side(b, lostA)],
    first: times.length ? Math.min(...times) : null,
    last: times.length ? Math.max(...times) : null,
    iskDestroyed: lostA + lostB
  }
}

export type BattleQuery = { systemId: number; stamp: string } | { killId: number }

/** A zKillboard related or kill link, or a bare kill number. */
export function parseBattleQuery(text: string): BattleQuery | null {
  const t = text.trim()
  const related = t.match(/related\/(\d+)\/(\d{12})/)
  if (related) return { systemId: Number(related[1]), stamp: related[2] }
  const kill = t.match(/kill\/(\d+)/) ?? t.match(/^(\d{6,})$/)
  return kill ? { killId: Number(kill[1]) } : null
}

/** zKillboard's time for a related page: to the hour, UTC. */
export function battleStamp(iso: string): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2})/)
  return m ? `${m[1]}${m[2]}${m[3]}${m[4]}00` : null
}
