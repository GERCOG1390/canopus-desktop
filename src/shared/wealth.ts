// What a character is worth: assets and implants at what selling them fetches (blueprint copies count as nothing),
// sell orders at their own price but no more than that (a listing far above the market doesn't sell) and less the
// sales tax, buy orders by the ISK held in escrow. A part ESI refused stays null and out of
// the total, so a missing permission never reads as zero.

export interface WealthInput {
  wallet: number | null
  assets: { type_id: number; quantity: number; is_blueprint_copy?: boolean }[] | null
  orders: { type_id?: number; is_buy_order?: boolean; price: number; volume_remain: number; escrow?: number; is_corporation?: boolean }[] | null
  implants: number[] | null
  cloneImplants: number[] | null
  /** What selling each type fetches (lib/market saleOf) */
  prices: Map<number, number>
  /** Sales tax a sell order pays when it fills, a fraction */
  salesTax?: number
}

export interface Wealth {
  wallet: number | null
  assets: number | null
  sell: number | null
  escrow: number | null
  head: number | null
  clones: number | null
  total: number
  /** Kinds of item with no Jita price: counted as nothing, so the total is at least this far short */
  unpriced: number
  /** The most valuable items among the assets */
  top: { id: number; value: number }[]
}

export function computeWealth(w: WealthInput, topCount = 15): Wealth {
  const price = (id: number): number => w.prices.get(id) ?? 0
  const byType = new Map<number, number>()
  const unpriced = new Set<number>()
  // An order placed for the corporation is the corporation's money.
  const orders = w.orders?.filter((o) => !o.is_corporation) ?? null
  for (const a of w.assets ?? []) {
    if (a.is_blueprint_copy) continue
    if (!w.prices.has(a.type_id)) unpriced.add(a.type_id)
    const value = price(a.type_id) * a.quantity
    if (value > 0) byType.set(a.type_id, (byType.get(a.type_id) ?? 0) + value)
  }
  const sumImplants = (ids: number[] | null): number | null => (ids ? ids.reduce((s, id) => s + price(id), 0) : null)
  const parts = {
    wallet: w.wallet,
    assets: w.assets ? [...byType.values()].reduce((s, v) => s + v, 0) : null,
    sell: orders
      ? orders
          .filter((o) => !o.is_buy_order)
          .reduce((s, o) => s + Math.min(o.price, o.type_id !== undefined && w.prices.get(o.type_id) ? w.prices.get(o.type_id)! : o.price) * o.volume_remain, 0) * (1 - (w.salesTax ?? 0))
      : null,
    escrow: orders ? orders.filter((o) => o.is_buy_order).reduce((s, o) => s + (o.escrow ?? 0), 0) : null,
    head: sumImplants(w.implants),
    clones: sumImplants(w.cloneImplants)
  }
  return {
    ...parts,
    unpriced: unpriced.size,
    total: Object.values(parts).reduce<number>((s, v) => s + (v ?? 0), 0),
    top: [...byType].sort((a, b) => b[1] - a[1]).slice(0, topCount).map(([id, value]) => ({ id, value }))
  }
}
