// What a character is worth: assets and implants at Jita sell (blueprint copies count as nothing), sell
// orders at their own price, buy orders by the ISK held in escrow. A part ESI refused stays null and out of
// the total, so a missing permission never reads as zero.

export interface WealthInput {
  wallet: number | null
  assets: { type_id: number; quantity: number; is_blueprint_copy?: boolean }[] | null
  orders: { is_buy_order?: boolean; price: number; volume_remain: number; escrow?: number }[] | null
  implants: number[] | null
  cloneImplants: number[] | null
  /** Jita sell per type */
  prices: Map<number, number>
}

export interface Wealth {
  wallet: number | null
  assets: number | null
  sell: number | null
  escrow: number | null
  head: number | null
  clones: number | null
  total: number
  /** The most valuable items among the assets */
  top: { id: number; value: number }[]
}

export function computeWealth(w: WealthInput, topCount = 15): Wealth {
  const price = (id: number): number => w.prices.get(id) ?? 0
  const byType = new Map<number, number>()
  for (const a of w.assets ?? []) {
    if (a.is_blueprint_copy) continue
    const value = price(a.type_id) * a.quantity
    if (value > 0) byType.set(a.type_id, (byType.get(a.type_id) ?? 0) + value)
  }
  const sumImplants = (ids: number[] | null): number | null => (ids ? ids.reduce((s, id) => s + price(id), 0) : null)
  const parts = {
    wallet: w.wallet,
    assets: w.assets ? [...byType.values()].reduce((s, v) => s + v, 0) : null,
    sell: w.orders ? w.orders.filter((o) => !o.is_buy_order).reduce((s, o) => s + o.price * o.volume_remain, 0) : null,
    escrow: w.orders ? w.orders.filter((o) => o.is_buy_order).reduce((s, o) => s + (o.escrow ?? 0), 0) : null,
    head: sumImplants(w.implants),
    clones: sumImplants(w.cloneImplants)
  }
  return {
    ...parts,
    total: Object.values(parts).reduce<number>((s, v) => s + (v ?? 0), 0),
    top: [...byType].sort((a, b) => b[1] - a[1]).slice(0, topCount).map(([id, value]) => ({ id, value }))
  }
}
