// Skill points as an item: an extractor takes 500 000 SP from a character into an injector, and an injector
// gives that much only to a young character (EVE University, "Skill Injector"): less the more SP they have.

export const SP_PER_INJECTOR = 500_000

export function injectorGain(totalSp: number): number {
  if (totalSp < 5_000_000) return 500_000
  if (totalSp < 50_000_000) return 400_000
  if (totalSp < 80_000_000) return 300_000
  return 150_000
}

/** ISK for a million SP through injectors, for a pilot with this much SP. */
export const spCost = (injectorPrice: number, totalSp: number): number => (injectorPrice / injectorGain(totalSp)) * 1_000_000

export interface FarmInput {
  spPerHour: number
  days: number
  injectorPrice: number
  extractorPrice: number
  /** Fraction */
  salesTax: number
  plexPrice: number
  plexPerMonth: number
  /** Implants wearing out, boosters… per month */
  otherCost: number
}

export function farmMonth(f: FarmInput) {
  const sp = f.spPerHour * 24 * f.days
  const injectors = sp / SP_PER_INJECTOR
  const revenue = injectors * f.injectorPrice * (1 - f.salesTax)
  const extractors = injectors * f.extractorPrice
  const subscription = f.plexPrice * f.plexPerMonth
  return { sp, injectors, revenue, extractors, subscription, profit: revenue - extractors - subscription - f.otherCost }
}
