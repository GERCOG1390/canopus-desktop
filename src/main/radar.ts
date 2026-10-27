// Live kill radar: follows zKillboard's live killmail feed (R2Z2) and keeps the player kills that happen
// near the pilot or on the route planned in Canopus, marking gate camps, bubbles and smartbombs.
// Polling follows zKillboard's rules: the next file every ~100 ms while there are kills, 6 s after a 404.

import type { RadarKill, RadarOrg, RadarSettings, RadarStatus } from '../shared/radar'
import { request } from './http'
import { groupName, groupOf, isLoaded, system as sdeSystem, systemsWithin, typeName } from './sde'
import { loadSettings } from './storage'

const FEED = 'https://r2z2.zkillboard.com/ephemeral'
const UA = 'Canopus (EVE Online companion; https://github.com/GERCOG1390/canopus-desktop)'
/** Interdictors and heavy interdictors (bubbles), smartbombs */
const BUBBLE_GROUPS = new Set([541, 894])
const SMARTBOMB_GROUP = 72
const KEEP_MS = 60 * 60_000
const CAMP_WINDOW_MS = 20 * 60_000

interface R2z2Kill {
  killmail_id: number
  sequence_id: number
  esi: {
    killmail_time: string
    solar_system_id: number
    victim: { ship_type_id: number; corporation_id?: number; alliance_id?: number }
    attackers: { ship_type_id?: number; weapon_type_id?: number; corporation_id?: number; alliance_id?: number }[]
  }
  zkb: { locationID?: number; totalValue?: number; npc?: boolean }
}

type Send = (kill: RadarKill, status: RadarStatus) => void

let here: { id: number; name: string } | null = null
let route: number[] = []
let watched = new Map<number, number>()
let routeSet = new Set<number>()
let kills: RadarKill[] = []
let seen = 0
let error: string | undefined
let running = false
let stopRequested = false
let onKill: Send | null = null
let onStatus: ((s: RadarStatus) => void) | null = null

const settings = (): RadarSettings => loadSettings().radar

export function status(): RadarStatus {
  const cutoff = Date.now() - KEEP_MS
  // Newest kill first by when it happened (late killmails arrive out of order).
  kills = kills.filter((k) => Date.parse(k.time) >= cutoff).sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
  return { enabled: settings().enabled, running, here, watched: watched.size, routeSystems: routeSet.size, seen, error, kills }
}

function rewatch(): void {
  const s = settings()
  watched = here && isLoaded() ? systemsWithin(here.id, Math.max(0, Math.min(10, s.radius))) : new Map()
  routeSet = s.route ? new Set(route) : new Set()
  onStatus?.(status())
  void rebuild()
}

/** The pilot moved (from the game log): watch the systems around the new one. */
export function setHere(systemId: number | null): void {
  const s = systemId ? sdeSystem(systemId) : null
  here = s ? { id: s.id, name: s.n } : null
  rewatch()
}

/** The route planned in Canopus (Map), in order. */
export function setRoute(ids: number[]): void {
  route = ids
  rewatch()
}

// ---------- Stargates (where a kill happened) ----------

const gateTarget = new Map<number, Promise<number | null>>()
const systemGates = new Map<number, Promise<Set<number>>>()

function gatesOf(systemId: number): Promise<Set<number>> {
  let p = systemGates.get(systemId)
  if (!p) {
    p = (request(`https://esi.evetech.net/latest/universe/systems/${systemId}/`) as Promise<{ stargates?: number[] }>).then((s) => new Set(s.stargates ?? [])).catch(() => new Set<number>())
    systemGates.set(systemId, p)
  }
  return p
}

function gateLeadsTo(gate: number): Promise<number | null> {
  let p = gateTarget.get(gate)
  if (!p) {
    p = (request(`https://esi.evetech.net/latest/universe/stargates/${gate}/`) as Promise<{ destination: { system_id: number } }>).then((g) => g.destination.system_id).catch(() => null)
    gateTarget.set(gate, p)
  }
  return p
}

// ---------- Names of alliances and corporations ----------

const orgNames = new Map<number, string>()

async function nameOrgs(ids: number[]): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => id && !orgNames.has(id))
  if (!missing.length) return
  try {
    const rows = (await request('https://esi.evetech.net/latest/universe/names/', { method: 'POST', body: missing.slice(0, 500) })) as { id: number; name: string }[]
    for (const r of rows) orgNames.set(r.id, r.name)
  } catch {
    // Names are a nicety: the logos still show.
  }
}

const org = (alliance?: number, corp?: number): RadarOrg | undefined =>
  alliance ? { id: alliance, kind: 'alliance', name: orgNames.get(alliance) ?? '' } : corp ? { id: corp, kind: 'corporation', name: orgNames.get(corp) ?? '' } : undefined

/** Counts of values, most common first. */
function tally(values: (number | undefined)[]): { id: number; n: number }[] {
  const m = new Map<number, number>()
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, n }))
}

// ---------- Feed ----------

async function getJson<T>(url: string): Promise<{ status: number; data?: T }> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (res.status !== 200) return { status: res.status }
  return { status: 200, data: (await res.json()) as T }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Every player kill of the last hour across New Eden (a few hundred): when the pilot jumps somewhere new,
 * what happened around there during the last hour shows at once.
 */
let recent: R2z2Kill[] = []

async function handle(k: R2z2Kill): Promise<void> {
  seen++
  // Killmails reach zKillboard late now and then (hours or days): only the last hour is news.
  if (k.zkb.npc || Date.now() - Date.parse(k.esi.killmail_time) > KEEP_MS) return
  recent.push(k)
  if (recent.length > 2000 || recent.length % 50 === 0) recent = recent.filter((x) => Date.now() - Date.parse(x.esi.killmail_time) <= KEEP_MS).slice(-2000)
  const kill = await build(k)
  if (kill) onKill?.(kill, status())
}

/** The radar entry for a kill in a watched system or on the route (null otherwise); added to the list. */
async function build(k: R2z2Kill): Promise<RadarKill | null> {
  const sys = k.esi.solar_system_id
  const jumps = watched.get(sys)
  const onRoute = routeSet.has(sys)
  if (jumps === undefined && !onRoute) return null
  const info = sdeSystem(sys)
  const attackers = k.esi.attackers
  const ships = new Map<number, number>()
  for (const a of attackers) if (a.ship_type_id) ships.set(a.ship_type_id, (ships.get(a.ship_type_id) ?? 0) + 1)
  let gate: RadarKill['gate']
  if (k.zkb.locationID && (await gatesOf(sys)).has(k.zkb.locationID)) {
    const to = await gateLeadsTo(k.zkb.locationID)
    if (to) gate = { to, toName: sdeSystem(to)?.n ?? String(to) }
  }
  const v = k.esi.victim
  // Who did it: each attacker's alliance, else corporation.
  const killerOrgs = tally(attackers.map((a) => a.alliance_id || a.corporation_id)).slice(0, 2)
  await nameOrgs([v.alliance_id ?? v.corporation_id ?? 0, ...killerOrgs.map((o) => o.id)])
  const killers = killerOrgs.map(({ id, n }) => {
    const a = attackers.find((x) => (x.alliance_id || x.corporation_id) === id)
    return { ...org(a?.alliance_id, a?.alliance_id ? undefined : a?.corporation_id)!, n }
  })
  const recentAtGate = gate ? kills.filter((x) => x.systemId === sys && x.gate?.to === gate!.to && Date.now() - Date.parse(x.time) < CAMP_WINDOW_MS).length : 0
  const kill: RadarKill = {
    id: k.killmail_id,
    time: k.esi.killmail_time,
    systemId: sys,
    system: info?.n ?? String(sys),
    security: info?.sec ?? 0,
    jumps,
    onRoute,
    victimShip: k.esi.victim.ship_type_id,
    victimShipName: typeName(k.esi.victim.ship_type_id),
    value: k.zkb.totalValue ?? 0,
    attackers: attackers.length,
    gate,
    bubbles: attackers.some((a) => a.ship_type_id && BUBBLE_GROUPS.has(groupOf(a.ship_type_id))),
    smartbombs: attackers.some((a) => a.weapon_type_id && groupOf(a.weapon_type_id) === SMARTBOMB_GROUP),
    camp: !!gate && (recentAtGate >= 1 || attackers.length >= 5),
    victimGroup: groupName(v.ship_type_id),
    victimOrg: org(v.alliance_id, v.corporation_id),
    killers,
    attackerTypes: tally(attackers.map((a) => a.ship_type_id)).slice(0, 6).map((x) => ({ ...x, name: typeName(x.id) })),
    weapons: tally(attackers.map((a) => (a.weapon_type_id && a.weapon_type_id !== a.ship_type_id ? a.weapon_type_id : undefined))).slice(0, 4).map((x) => ({ ...x, name: typeName(x.id) })),
    attackerShips: [...ships.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, n]) => (n > 1 ? `${n}× ${typeName(id)}` : typeName(id)))
  }
  // A camp found now marks the earlier kill at the same gate too.
  if (kill.camp && gate) for (const x of kills) if (x.systemId === sys && x.gate?.to === gate.to) x.camp = true
  kills = [kill, ...kills.filter((x) => x.id !== kill.id)].slice(0, 200)
  return kill
}

let rebuilding = 0
/** The watched area changed: the list is rebuilt from the last hour of kills (no alerts for them). */
async function rebuild(): Promise<void> {
  const run = ++rebuilding
  kills = []
  for (const k of [...recent].sort((a, b) => Date.parse(a.esi.killmail_time) - Date.parse(b.esi.killmail_time))) {
    if (run !== rebuilding) return
    await build(k)
  }
  onStatus?.(status())
}

async function loop(): Promise<void> {
  running = true
  error = undefined
  onStatus?.(status())
  let seq: number | null = null
  while (!stopRequested) {
    try {
      if (seq === null) {
        const s = await getJson<{ sequence: number }>(`${FEED}/sequence.json`)
        if (!s.data) throw new Error(`zKillboard ${s.status}`)
        seq = s.data.sequence
      }
      const r = await getJson<R2z2Kill>(`${FEED}/${seq}.json`)
      if (r.status === 200 && r.data) {
        if (error) {
          error = undefined
          onStatus?.(status())
        }
        await handle(r.data)
        seq++
        await sleep(100)
      } else if (r.status === 404) {
        // No newer kill yet: wait as the feed asks.
        await sleep(6000)
      } else if (r.status === 403 || r.status === 429) {
        throw new Error(`zKillboard просит подождать (${r.status})`)
      } else throw new Error(`zKillboard ${r.status}`)
    } catch (e) {
      error = (e as Error).message
      onStatus?.(status())
      seq = null
      await sleep(30_000)
    }
  }
  running = false
  stopRequested = false
  onStatus?.(status())
}

/** Starts or stops the feed to match the settings (and re-reads the radius). */
export function apply(send: { kill: Send; status: (s: RadarStatus) => void }): void {
  onKill = send.kill
  onStatus = send.status
  rewatch()
  if (settings().enabled && !running) void loop()
  else if (!settings().enabled && running) stopRequested = true
}
