// Mission NPCs: how a fit's damage lands on them (see main/dogma/npc.ts).

export type NpcFaction =
  | 'guristas'
  | 'serpentis'
  | 'blood_raiders'
  | 'sansha'
  | 'angel'
  | 'rogue_drones'
  | 'amarr'
  | 'caldari'
  | 'gallente'
  | 'minmatar'
  | 'khanid'
  | 'thukker'
  | 'mordu'
  | 'concord'

export const NPC_FACTIONS: NpcFaction[] = ['guristas', 'serpentis', 'blood_raiders', 'sansha', 'angel', 'rogue_drones', 'amarr', 'caldari', 'gallente', 'minmatar', 'khanid', 'thukker', 'mordu', 'concord']

export interface NpcClassResult {
  cls: string
  /** NPC types of this class in the SDE */
  count: number
  /** Median share of the paper DPS that lands (before resists) */
  application: number
  appliedDps: number
  /** Median seconds to kill one (through resists and repairs) */
  ttkMedian: number
  fastest: { name: string; ttk: number }
  slowest: { name: string; ttk: number }
  /** NPCs whose repairs the fit can't out-damage */
  unkillable: number
  /** They orbit beyond the weapons' reach: the pilot has to fly in */
  approach: boolean
  /** What holds the damage back ("explosion radius", "tracking", "out of range"…) */
  limits: string[]
  typical: { hp: number; sig: number; speed: number; orbit: number }
}

export interface NpcReport {
  faction: NpcFaction
  paperDps: number
  classes: NpcClassResult[]
  /** A typical level 4 room: count per class, and the seconds to clear it at the medians */
  room: { composition: Record<string, number>; seconds: number }
  /** Farthest weapon reach used for the engagement distance, m */
  weaponReach: number
  note: string
}
