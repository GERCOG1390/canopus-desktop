// Abyssal Deadspace planner: a fit in a filament's weather against the abyssal NPCs (see main/dogma/abyss.ts).

export type AbyssWeather = 'electrical' | 'dark' | 'exotic' | 'firestorm' | 'gamma'
export const ABYSS_WEATHERS: AbyssWeather[] = ['electrical', 'dark', 'exotic', 'firestorm', 'gamma']

/** Weather celestials by penalty strength (30 / 50 / 70%); their warfare buffs are the weather. */
export const WEATHER_CELESTIAL: Record<AbyssWeather, Record<number, number>> = {
  electrical: { 30: 47381, 50: 47382, 70: 47383 },
  dark: { 30: 47378, 50: 47379, 70: 47380 },
  exotic: { 30: 47384, 50: 47385, 70: 47386 },
  firestorm: { 30: 47390, 50: 47391, 70: 47392 },
  gamma: { 30: 47387, 50: 47388, 70: 47389 }
}

/** The damage type whose resistance the weather cuts (em 0, thermal 1, kinetic 2, explosive 3); Dark cuts turret range. */
export const WEATHER_HOLE: Record<AbyssWeather, number | null> = { electrical: 0, firestorm: 1, exotic: 2, gamma: 3, dark: null }

/** Penalty strengths a tier rolls between (EVE University): 30 or 50% through tier 3, 50 or 70% above. */
export const tierStrengths = (tier: number): [number, number] => (tier >= 4 ? [50, 70] : [30, 50])

export const ABYSS_TIERS = ['Tranquil', 'Calm', 'Agitated', 'Fierce', 'Raging', 'Chaotic', 'Cataclysmic']

export type AbyssFaction = 'triglavian' | 'drifter' | 'sleeper' | 'rogue_drone' | 'sansha' | 'angel' | 'edencom'
export const ABYSS_FACTIONS: AbyssFaction[] = ['triglavian', 'drifter', 'sleeper', 'rogue_drone', 'sansha', 'angel', 'edencom']

export interface AbyssNpc {
  id: number
  name: string
  hp: number
  sig: number
  /** Seconds to kill it through its resists and repairs (Infinity = the fit can't out-damage its repairs) */
  ttk: number
  /** Share of the fit's paper DPS that lands */
  application: number
  /** Its DPS on paper (disintegrators fully spooled), and what gets through the fit's tank layer */
  dps: number
  taken: number
  /** Damage split em, thermal, kinetic, explosive (DPS) */
  types: [number, number, number, number]
  /** Energy neutralized, GJ/s */
  neut: number
  /** What else it does: web, paint, scram, damp, track, guide, remote, chain */
  ewar: string[]
}

export interface AbyssFactionResult {
  faction: AbyssFaction
  npcs: AbyssNpc[]
  /** Median seconds to kill one */
  ttkMedian: number
  /** Heaviest single DPS after the fit's resists */
  worstTaken: number
}

export interface AbyssFitSide {
  dps: number
  ehp: number
  /** Resists of the layer that tanks (fractions em, thermal, kinetic, explosive) */
  resist: [number, number, number, number]
  /** Repairs, HP/s (active + passive shield regen) */
  repair: number
  capStable: boolean
  capLevel?: number
  capLasts?: number
  speed: number
  /** Farthest turret / missile reach, m */
  reach: number
}

export interface AbyssReport {
  weather: AbyssWeather
  strength: number
  layer: 'shield' | 'armor' | 'hull'
  /** The fit in normal space and in the weather */
  normal: AbyssFitSide
  inWeather: AbyssFitSide
  factions: AbyssFactionResult[]
  note: string
}
