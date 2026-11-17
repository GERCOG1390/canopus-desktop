// What a trade across two order books really makes: buying up the cheapest sell orders at one place and selling
// into the best buy orders at another (or into a sell price the market there takes), level by level, while each
// unit still makes money after the fees. The best order alone overstates it; averages over the book understate it.

export interface Level {
  price: number
  volume: number
  /** A buy order's minimum volume: it takes no smaller sale (a classic bait at a high price) */
  min?: number
}

export interface Walk {
  units: number
  /** ISK made after fees */
  profit: number
  /** Average price paid and got per unit */
  avgBuy: number
  avgSell: number
}

/**
 * `asks`: sell orders where we buy; `bids`: buy orders where we sell (instantly), or one level — the sale price
 * and how many the market takes — when selling by order. `keep`: share of the sale price kept after fees.
 * `maxUnits`: no more than this many (what fits in the cargo hold), the best of the book first.
 */
export function walkBooks(asks: Level[], bids: Level[], keep: number, maxUnits = Infinity): Walk {
  const a = asks.filter((x) => x.volume > 0 && x.price > 0).sort((x, y) => x.price - y.price).map((x) => ({ ...x }))
  const b = bids.filter((x) => x.volume > 0 && x.price > 0).sort((x, y) => y.price - x.price).map((x) => ({ ...x }))
  let i = 0
  let j = 0
  let units = 0
  let paid = 0
  let got = 0
  while (i < a.length && j < b.length && units < maxUnits && b[j].price * keep > a[i].price) {
    // A buy order with a minimum volume we can't reach (with what is still worth buying for it) is skipped.
    const need = b[j].min ?? 1
    if (need > 1) {
      const worth = a.slice(i).filter((x) => b[j].price * keep > x.price).reduce((s, x) => s + x.volume, 0)
      if (Math.min(worth, maxUnits - units) < need) {
        j++
        continue
      }
    }
    const n = Math.min(a[i].volume, b[j].volume, maxUnits - units)
    units += n
    paid += n * a[i].price
    got += n * b[j].price
    a[i].volume -= n
    b[j].volume -= n
    if (!a[i].volume) i++
    if (!b[j].volume) j++
  }
  return { units, profit: got * keep - paid, avgBuy: units ? paid / units : 0, avgSell: units ? got / units : 0 }
}

/**
 * What buying `qty` costs from sell orders, cheapest first: the total, the average, and how many the book
 * doesn't have (a batch of materials runs past the best order).
 */
export function fillCost(asks: Level[], qty: number): { total: number; avg: number; filled: number; short: number } {
  let left = Math.max(0, qty)
  let total = 0
  for (const a of asks.filter((x) => x.volume > 0 && x.price > 0).sort((x, y) => x.price - y.price)) {
    if (!left) break
    const n = Math.min(left, a.volume)
    total += n * a.price
    left -= n
  }
  const filled = qty - left
  return { total, avg: filled ? total / filled : 0, filled, short: left }
}

/**
 * Filling a cargo hold from several deals on one route: the most ISK per m³ first, each up to what it has, until
 * the hold is full. Greedy by profit density — what a trader does by hand.
 */
export function loadHold(deals: { id: number; perUnit: number; volume: number; units: number }[], hold: number): { picks: { id: number; units: number; profit: number }[]; profit: number; used: number } {
  let left = hold
  const picks: { id: number; units: number; profit: number }[] = []
  for (const d of [...deals].filter((x) => x.perUnit > 0 && x.volume > 0 && x.units > 0).sort((a, b) => b.perUnit / b.volume - a.perUnit / a.volume)) {
    const units = Math.min(d.units, Math.floor(left / d.volume + 1e-9))
    if (units <= 0) continue
    picks.push({ id: d.id, units, profit: units * d.perUnit })
    left -= units * d.volume
  }
  return { picks, profit: picks.reduce((s, p) => s + p.profit, 0), used: hold - left }
}
