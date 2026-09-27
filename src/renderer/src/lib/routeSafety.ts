// Recent player kills along a route (zKillboard + ESI killmails): gate camps, bubbles, smartbombs.

import { esi, systemInfo } from './esi'
import { getBasic, requestBasics } from './sde'

/** Interdictors and heavy interdictors (bubbles), smartbomb module group. */
const BUBBLE_GROUPS = new Set([541, 894])
const SMARTBOMB_GROUP = 72

export interface RecentKill {
  id: number
  time: number
  victimShip: number
  attackers: number
  value: number
  /** Stargate the kill happened at, and where that gate leads */
  gate?: { id: number; to: number }
  bubbles: boolean
  smartbombs: boolean
}

export interface SystemDanger {
  systemId: number
  kills: RecentKill[]
  /** Gates with 2+ kills in the last hour, or a fresh kill with a gang: a likely camp */
  camps: { gate: number; to: number; kills: number; lastAgo: number }[]
  bubbles: boolean
  smartbombs: boolean
}

interface ZkbKill {
  killmail_id: number
  zkb: { hash: string; locationID?: number; totalValue?: number; npc?: boolean }
}
interface Killmail {
  killmail_time: string
  victim: { ship_type_id: number }
  attackers: { ship_type_id?: number; weapon_type_id?: number }[]
}

const gateCache = new Map<number, Promise<number>>()
/** Destination system of a stargate. */
function gateDestination(gate: number): Promise<number> {
  let p = gateCache.get(gate)
  if (!p) {
    p = esi<{ destination: { system_id: number } }>(`/universe/stargates/${gate}/`).then((g) => g.destination.system_id)
    gateCache.set(gate, p)
  }
  return p
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Player kills in a system during the last hour (up to 12, newest first). */
export async function systemDanger(systemId: number): Promise<SystemDanger> {
  const list = (await window.api.request<ZkbKill[]>(`https://zkillboard.com/api/kills/systemID/${systemId}/pastSeconds/3600/`)).filter((k) => !k.zkb.npc).slice(0, 12)
  const sys = await systemInfo(systemId)
  const gates = new Set(sys.stargates ?? [])
  const mails = (await Promise.all(list.map((k) => esi<Killmail>(`/killmails/${k.killmail_id}/${k.zkb.hash}/`).catch(() => null)))).map((km, i) => ({ km, z: list[i] }))
  // Attacker ships and weapons tell bubbles (interdictors) and smartbombs apart: load their groups.
  const types = [...new Set(mails.flatMap(({ km }) => km?.attackers.flatMap((a) => [a.ship_type_id ?? 0, a.weapon_type_id ?? 0]) ?? []).filter(Boolean))]
  const basics = types.length ? await window.api.sde.basics(types) : {}
  requestBasics(mails.map(({ km }) => km?.victim.ship_type_id ?? 0).filter(Boolean))
  const groupOf = (id?: number) => (id ? (basics[id]?.g ?? getBasic(id)?.g) : undefined)

  const kills: RecentKill[] = []
  for (const { km, z } of mails) {
    if (!km) continue
    const loc = z.zkb.locationID
    kills.push({
      id: z.killmail_id,
      time: Date.parse(km.killmail_time),
      victimShip: km.victim.ship_type_id,
      attackers: km.attackers.length,
      value: z.zkb.totalValue ?? 0,
      gate: loc && gates.has(loc) ? { id: loc, to: await gateDestination(loc).catch(() => 0) } : undefined,
      // Interdiction bubbles only work in nullsec; elsewhere an interdictor is just another ship.
      bubbles: sys.security_status <= 0 && km.attackers.some((a) => BUBBLE_GROUPS.has(groupOf(a.ship_type_id) ?? -1)),
      smartbombs: km.attackers.some((a) => groupOf(a.weapon_type_id) === SMARTBOMB_GROUP)
    })
  }
  kills.sort((a, b) => b.time - a.time)

  const byGate = new Map<number, RecentKill[]>()
  for (const k of kills) if (k.gate) byGate.set(k.gate.id, [...(byGate.get(k.gate.id) ?? []), k])
  const camps = [...byGate.entries()]
    .filter(([, ks]) => ks.length >= 2 || (ks[0].attackers >= 3 && Date.now() - ks[0].time < 20 * 60_000))
    .map(([gate, ks]) => ({ gate, to: ks[0].gate!.to, kills: ks.length, lastAgo: Date.now() - ks[0].time }))
  return { systemId, kills, camps, bubbles: kills.some((k) => k.bubbles), smartbombs: kills.some((k) => k.smartbombs) }
}

/** Checks route systems one after another (zKillboard asks for gentle request rates). */
export async function routeDanger(systemIds: number[], onSystem: (d: SystemDanger) => void, cancelled: () => boolean): Promise<void> {
  for (const id of systemIds) {
    if (cancelled()) return
    try {
      onSystem(await systemDanger(id))
    } catch {
      // zKillboard unavailable for this system: skip it
    }
    await sleep(400)
  }
}
