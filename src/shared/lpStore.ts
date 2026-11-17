// What an LP store offer is worth: the item sold at Jita, less the fees, the ISK and the items handed in.

export interface LpOfferInput {
  type_id: number
  quantity: number
  lp_cost: number
  isk_cost: number
  required_items: { type_id: number; quantity: number }[]
}

export interface LpPrice {
  /** Best Jita sell price (what buying costs and what a sell order gets) */
  sell?: number
  /** Best Jita buy price (what selling straight into buy orders gets) */
  buy?: number
  /** What it really trades at in The Forge lately (tradedPrice); a sell order above it doesn't fill. 0: it hasn't traded */
  traded?: number
}

export interface LpOfferValue {
  unit: number
  required: number
  value: number
  perLp: number
  /** The item and every handed-in item have a Jita price; otherwise value and perLp mean nothing. */
  priced: boolean
  /** The sale price was checked against the trade history (or sold into buy orders, which are real) */
  checked: boolean
}

/**
 * The price an item really trades at: the volume-weighted median of the daily averages of the last 30 days, and
 * how many trade a day. A lone sell order far above it (what the cheapest listing of a slow item often is) is
 * not what the item sells for.
 */
export function tradedPrice(history: { date: string; average: number; volume: number }[], today: string, span = 30): { price: number; perDay: number; days: number } {
  const from = new Date(Date.parse(today) - span * 86_400_000).toISOString().slice(0, 10)
  const days = history.filter((d) => d.date >= from && d.volume > 0 && d.average > 0)
  const total = days.reduce((s, d) => s + d.volume, 0)
  // A rare item (a SKIN) may not trade for a month: look back 90 days before calling it unsold.
  if (!total) return span < 90 ? tradedPrice(history, today, 90) : { price: 0, perDay: 0, days: span }
  let seen = 0
  let price = 0
  for (const d of [...days].sort((a, b) => a.average - b.average)) {
    seen += d.volume
    price = d.average
    if (seen >= total / 2) break
  }
  return { price, perDay: total / span, days: span }
}

/**
 * `basis` 'sell': a sell order at the Jita sell price, paying the sales tax and the broker's fee;
 * 'buy': straight into buy orders, sales tax only. Handed-in items are bought from sell orders (no fees).
 * A handed-in item without a Jita price used to count as free, which made such offers look best.
 */
export function lpOfferValue(o: LpOfferInput, price: (typeId: number) => LpPrice | undefined, basis: 'sell' | 'buy', taxPct: number, brokerPct: number): LpOfferValue {
  const p = price(o.type_id)
  // A sell order fills at what the item trades at, not above it.
  // Nothing traded lately: a sell order alone says nothing about what it would fetch.
  const unit = (basis === 'sell' ? (p?.traded === 0 ? 0 : p?.sell && p.traded ? Math.min(p.sell, p.traded) : (p?.sell ?? p?.traded)) : p?.buy) ?? 0
  let required = 0
  let requiredPriced = true
  for (const r of o.required_items) {
    const s = price(r.type_id)?.sell ?? 0
    if (s <= 0) requiredPriced = false
    required += s * r.quantity
  }
  const gross = unit * o.quantity * (1 - (taxPct + (basis === 'sell' ? brokerPct : 0)) / 100)
  const value = gross - o.isk_cost - required
  return { unit, required, value, perLp: o.lp_cost ? value / o.lp_cost : 0, priced: unit > 0 && requiredPriced, checked: basis === 'buy' || p?.traded !== undefined }
}
