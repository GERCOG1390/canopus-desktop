// Fees, facilities and planets: figures from the SDE, EVE University and CCP's developer documentation.

/** Sales tax, percent: 7.5 less 11% per level of Accounting. */
export const salesTaxPct = (accounting: number): number => 7.5 * (1 - 0.11 * accounting)

/** Broker fee at an NPC station with no standing, percent: 3 less 0.3 per level of Broker Relations. */
export const brokerPct = (brokerRelations: number): number => 3 - 0.3 * brokerRelations

export interface Facility {
  id: 'npc' | 'raitaru' | 'azbel' | 'sotiyo'
  name: string
  /** Material saving, cost-index saving and time saving, percent (the hull's role bonuses, rigs apart) */
  me: number
  cost: number
  time: number
}

export const FACILITIES: Facility[] = [
  { id: 'npc', name: 'NPC-станция', me: 0, cost: 0, time: 0 },
  { id: 'raitaru', name: 'Raitaru', me: 1, cost: 3, time: 15 },
  { id: 'azbel', name: 'Azbel', me: 1, cost: 4, time: 20 },
  { id: 'sotiyo', name: 'Sotiyo', me: 1, cost: 5, time: 30 }
]

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
