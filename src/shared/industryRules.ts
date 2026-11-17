// Fees, facilities and planets: figures from the SDE, EVE University and CCP's developer documentation.

/** Sales tax, percent: 7.5 less 11% per level of Accounting. */
export const salesTaxPct = (accounting: number): number => 7.5 * (1 - 0.11 * accounting)

/**
 * Broker fee at an NPC station, percent: 3 less 0.3 per level of Broker Relations, less 0.03 per point of the
 * pilot's standing with the station owner's faction and 0.02 with the owner corporation (raw standings, as EVE
 * University gives the formula), never under 1.
 */
export const brokerPct = (brokerRelations: number, factionStanding = 0, corpStanding = 0): number =>
  Math.max(1, 3 - 0.3 * brokerRelations - 0.03 * factionStanding - 0.02 * corpStanding)

export interface Facility {
  id: 'npc' | 'raitaru' | 'azbel' | 'sotiyo' | 'athanor' | 'tatara'
  name: string
  /** Runs reactions (refineries) rather than manufacturing */
  reactions?: boolean
  /** Material saving, cost-index saving and time saving, percent (the hull's role bonuses, rigs apart) */
  me: number
  cost: number
  time: number
}

export const FACILITIES: Facility[] = [
  { id: 'npc', name: 'NPC-станция', me: 0, cost: 0, time: 0 },
  { id: 'raitaru', name: 'Raitaru', me: 1, cost: 3, time: 15 },
  { id: 'azbel', name: 'Azbel', me: 1, cost: 4, time: 20 },
  { id: 'sotiyo', name: 'Sotiyo', me: 1, cost: 5, time: 30 },
  // Refineries: only they run reactions; a Tatara cuts their time by a quarter (strReactionTimeMultiplier 0.75).
  { id: 'athanor', name: 'Athanor', me: 0, cost: 0, time: 0, reactions: true },
  { id: 'tatara', name: 'Tatara', me: 0, cost: 0, time: 25, reactions: true }
]

export type SecurityBand = 'high' | 'low' | 'null'

/** The band a system's security puts it in (shown rounded: 0.45 reads 0.5, high-sec). */
export const securityBand = (security: number): SecurityBand => (security >= 0.45 ? 'high' : security > 0 ? 'low' : 'null')

/**
 * What an engineering or reaction rig saves, percent of materials (ME) or time (TE): Tech I 2 / 20, Tech II 2.4 / 24,
 * times the system's multiplier — manufacturing rigs 1 in high-sec, 1.9 in low-sec, 2.1 in null and wormholes;
 * reaction rigs 1 in low-sec, 1.1 in null (reactions don't run in high-sec). From the SDE's Standup rig attributes.
 */
export function rigBonus(kind: 'me' | 'te', tier: 0 | 1 | 2, band: SecurityBand, reaction = false): number {
  if (!tier) return 0
  const base = kind === 'me' ? (tier === 2 ? 2.4 : 2) : tier === 2 ? 24 : 20
  const mult = reaction ? { high: 0, low: 1, null: 1.1 }[band] : { high: 1, low: 1.9, null: 2.1 }[band]
  return base * mult
}

/** What Reactions (4% a level) leaves of a reaction job's time. */
export const reactionTimeFactor = (reactions: number): number => 1 - 0.04 * reactions

/** What Industry (4% a level) and Advanced Industry (3% a level) leave of a manufacturing job's time. */
export const jobTimeFactor = (industry: number, advanced: number): number => (1 - 0.04 * industry) * (1 - 0.03 * advanced)

/** Customs tax an hour on goods carried between planets: leaving one (the export rate) and entering the next (half of it). */
export const transferTax = (goods: { rate: number; base: number }[], taxPct: number): number => goods.reduce((sum, g) => sum + g.rate * g.base * (taxPct / 100) * 1.5, 0)

const DECAY = 0.012
const NOISE = 0.8

/** What an extractor yields each cycle, by the formula in CCP's developer documentation. */
export function extractorValues(qtyPerCycle: number, cycleSec: number, cycles: number): number[] {
  const width = cycleSec / 900
  const shift = qtyPerCycle ** 0.7
  return Array.from({ length: cycles }, (_, i) => {
    const t = (i + 0.5) * width
    const decay = qtyPerCycle / (1 + t * DECAY)
    const sin = Math.max(0, (Math.cos(shift + t / 12) + Math.cos(shift / 2 + t * 0.2) + Math.cos(t * 0.5)) / 3)
    return Math.floor(width * decay * (1 + NOISE * sin))
  })
}

/** Average yield an hour over an extractor's whole program. */
export function extractorPerHour(qtyPerCycle: number, cycleSec: number, cycles: number): number {
  if (qtyPerCycle <= 0 || cycleSec <= 0 || cycles <= 0) return 0
  return (extractorValues(qtyPerCycle, cycleSec, cycles).reduce((a, b) => a + b, 0) / (cycles * cycleSec)) * 3600
}

/**
 * A pilot's PI worth an hour across all colonies: each planet's net (made less used) added up per item first, so
 * what one planet ships to another's factories counts once — as the factory's product — and what the colonies
 * use more of than they make is bought (`buyPrice`). Valuing each planet's surplus alone counted the P1 hauled to a
 * factory planet and the P2 made from it.
 */
export function colonyIncome(nets: Map<number, number>[], salePrice: (id: number) => number, buyPrice: (id: number) => number): number {
  const total = new Map<number, number>()
  for (const n of nets) for (const [id, q] of n) total.set(id, (total.get(id) ?? 0) + q)
  let isk = 0
  for (const [id, q] of total) {
    if (q > 0.01) isk += q * salePrice(id)
    else if (q < -0.01) isk += q * buyPrice(id)
  }
  return isk
}
