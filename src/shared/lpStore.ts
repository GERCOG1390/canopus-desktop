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
}

export interface LpOfferValue {
  unit: number
  required: number
  value: number
  perLp: number
  /** The item and every handed-in item have a Jita price; otherwise value and perLp mean nothing. */
  priced: boolean
}

/**
 * `basis` 'sell': a sell order at the Jita sell price, paying the sales tax and the broker's fee;
 * 'buy': straight into buy orders, sales tax only. Handed-in items are bought from sell orders (no fees).
 * A handed-in item without a Jita price used to count as free, which made such offers look best.
 */
export function lpOfferValue(o: LpOfferInput, price: (typeId: number) => LpPrice | undefined, basis: 'sell' | 'buy', taxPct: number, brokerPct: number): LpOfferValue {
  const p = price(o.type_id)
  const unit = (basis === 'sell' ? p?.sell : p?.buy) ?? 0
  let required = 0
  let requiredPriced = true
  for (const r of o.required_items) {
    const s = price(r.type_id)?.sell ?? 0
    if (s <= 0) requiredPriced = false
    required += s * r.quantity
  }
  const gross = unit * o.quantity * (1 - (taxPct + (basis === 'sell' ? brokerPct : 0)) / 100)
  const value = gross - o.isk_cost - required
  return { unit, required, value, perLp: o.lp_cost ? value / o.lp_cost : 0, priced: unit > 0 && requiredPriced }
}
