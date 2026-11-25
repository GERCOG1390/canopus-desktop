// What buying a fit's modules in Jita really costs. The cheapest sell order alone misleads: one unit listed low
// (or a scam order) makes a module look cheap that can't be bought for that. Fuzzwork's percentile is the average
// price of the cheapest 5% of the volume on sale, the same figure Pyfa uses.

export interface SellSide {
  best: number
  volume: number
  orders: number
  percentile: number
}

export interface BuyPrice {
  /** ISK per unit */
  unit: number
  /** Units on sale */
  available: number
  /** Fewer on sale than the fit needs */
  short: boolean
  /** Only a few on sale: the price may jump once they are bought */
  thin: boolean
}

export function buyPrice(s: SellSide | undefined, qty: number): BuyPrice | undefined {
  if (!s || !(s.best > 0) || !(s.volume > 0)) return undefined
  const unit = Math.max(s.best, s.percentile > 0 ? s.percentile : 0)
  return { unit, available: s.volume, short: s.volume < qty, thin: s.orders < 3 || s.volume < qty * 3 }
}
