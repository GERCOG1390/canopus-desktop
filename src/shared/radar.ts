// Live kill radar: player kills from zKillboard's live feed near the pilot and on the planned route.

export interface RadarSettings {
  enabled: boolean
  /** Watch systems up to this many jumps from where the active character is (0 = only the current one) */
  radius: number
  /** Also watch the route planned in Canopus (Map) */
  route: boolean
  /** Desktop notification for camps, bubbles and smartbombs; every nearby kill otherwise */
  notify: 'danger' | 'all' | 'off'
  sound: boolean
  /** Post the same alerts to the intel Discord webhook */
  discord: boolean
}

export const DEFAULT_RADAR: RadarSettings = { enabled: false, radius: 3, route: true, notify: 'danger', sound: true, discord: false }

export interface RadarKill {
  id: number
  /** Kill time, ISO */
  time: string
  systemId: number
  system: string
  security: number
  /** Jumps from the pilot (undefined when only on the route) */
  jumps?: number
  onRoute: boolean
  victimShip: number
  victimShipName: string
  value: number
  attackers: number
  /** The kill happened at a stargate: where the gate leads */
  gate?: { to: number; toName: string }
  bubbles: boolean
  smartbombs: boolean
  /** Several kills at the same gate within 20 minutes, or a big gang there */
  camp: boolean
  /** Attackers' ships, most common first */
  attackerShips: string[]
  /** The victim's ship class ("Battleship") */
  victimGroup?: string
  /** The victim's alliance, else corporation */
  victimOrg?: RadarOrg
  /** The attackers' alliances / corporations, most pilots first (up to 2) */
  killers?: (RadarOrg & { n: number })[]
  /** Attackers' ship types with how many flew each, most common first */
  attackerTypes?: { id: number; n: number; name: string }[]
  /** Weapons used (by attackers with a weapon other than their ship), most common first */
  weapons?: { id: number; n: number; name: string }[]
}

export interface RadarOrg {
  id: number
  kind: 'alliance' | 'corporation'
  name: string
}

export interface RadarStatus {
  enabled: boolean
  running: boolean
  /** The system the pilot is in, as Canopus last saw it */
  here: { id: number; name: string } | null
  /** Systems being watched */
  watched: number
  routeSystems: number
  /** Kills checked since the radar started */
  seen: number
  error?: string
  /** Newest first, last hour */
  kills: RadarKill[]
}
