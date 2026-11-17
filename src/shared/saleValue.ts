// What selling an item really fetches. The cheapest sell order of a slow item is often a lone listing nobody
// takes (a 4-billion SKIN that last sold at 160 million); valuing output, loot or assets at it shows profits that
// aren't there. A tight market (buy and sell orders close) prices honestly; a wide one is checked against what
// the item actually traded at (lpStore.ts tradedPrice).

/** Sell over buy above this: the sell order alone can't be trusted. */
export const SUSPICIOUS_SPREAD = 1.25

/** Whether the item's sell price needs checking against its trade history. */
export function needsHistory(sell: number, buy: number): boolean {
  return sell > 0 && (buy <= 0 || sell / buy > SUSPICIOUS_SPREAD)
}

export interface Sale {
  /** ISK per unit a sell order would really get (0: it doesn't sell) */
  unit: number
  /** Checked against the trade history */
  checked: boolean
  /** Units traded a day (when checked) */
  perDay?: number
}

/**
 * The sale price: the sell order where the market is tight; where it isn't, no more than what the item traded
 * at (`traded`: 0 when nothing traded in 90 days, undefined when the history couldn't be loaded).
 */
export function saleUnit(sell: number, buy: number, traded?: { price: number; perDay: number }): Sale {
  if (!needsHistory(sell, buy)) return { unit: sell, checked: true }
  if (!traded) return { unit: sell, checked: false }
  if (traded.price <= 0) return { unit: 0, checked: true, perDay: 0 }
  return { unit: Math.min(sell, traded.price), checked: true, perDay: traded.perDay }
}
