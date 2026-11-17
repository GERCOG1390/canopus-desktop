import { needsHistory, saleUnit, type Sale } from '../../../shared/saleValue.ts'
import { tradedPrice } from '../../../shared/lpStore'
import { fillCost } from '../../../shared/orderBook.ts'
export interface Hub {
  name: string
  stationId: number
  regionId: number
  systemId: number
}

export const HUBS: Hub[] = [
  { name: 'Jita', stationId: 60003760, regionId: 10000002, systemId: 30000142 },
  { name: 'Amarr', stationId: 60008494, regionId: 10000043, systemId: 30002187 },
  { name: 'Dodixie', stationId: 60011866, regionId: 10000032, systemId: 30002659 },
  { name: 'Rens', stationId: 60004588, regionId: 10000030, systemId: 30002510 },
  { name: 'Hek', stationId: 60005686, regionId: 10000042, systemId: 30002053 }
]

export interface PriceSide {
  best: number
  volume: number
  orders: number
  percentile: number
}

export interface Price {
  buy: PriceSide
  sell: PriceSide
  /** What selling it really fetches (withSales): the sell order, or less for a slow item */
  sale?: Sale
}

type RawSide = Record<'weightedAverage' | 'max' | 'min' | 'volume' | 'orderCount' | 'percentile', string>

/** Aggregated best buy/sell for a station from Fuzzwork (backed by ESI order snapshots). */
export async function hubPrices(stationId: number, typeIds: number[]): Promise<Map<number, Price>> {
  const out = new Map<number, Price>()
  const unique = [...new Set(typeIds)]
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200)
    const raw = await window.api.request<Record<string, { buy: RawSide; sell: RawSide }>>(
      `https://market.fuzzwork.co.uk/aggregates/?station=${stationId}&types=${chunk.join(',')}`
    )
    for (const [id, p] of Object.entries(raw)) {
      out.set(Number(id), {
        buy: { best: +p.buy.max, volume: +p.buy.volume, orders: +p.buy.orderCount, percentile: +p.buy.percentile },
        sell: { best: +p.sell.min, volume: +p.sell.volume, orders: +p.sell.orderCount, percentile: +p.sell.percentile }
      })
    }
  }
  return out
}

export const jitaPrices = (typeIds: number[]): Promise<Map<number, Price>> => hubPrices(HUBS[0].stationId, typeIds)

/** Parses pasted item lists: EVE inventory copy (tab separated), "Name x 10", "10 x Name", "10 Name". */
export function parseItemList(text: string): { name: string; qty: number }[] {
  const merged = new Map<string, { name: string; qty: number }>()
  const num = (s: string): number => Number(s.replace(/[\s,.'  ]/g, '')) || 0

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    let name = line
    let qty = 1

    const tabs = line.split('\t')
    let m: RegExpMatchArray | null
    if (tabs.length > 1) {
      name = tabs[0].trim()
      qty = tabs[1].trim() ? num(tabs[1]) || 1 : 1
    } else if ((m = line.match(/^(.+?)\s+x\s*([\d\s,.]+)$/i))) {
      name = m[1]
      qty = num(m[2]) || 1
    } else if ((m = line.match(/^([\d\s,.]+?)\s*x?\s+(.+)$/i))) {
      name = m[2]
      qty = num(m[1]) || 1
    }
    name = name.replace(/\*$/, '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    const prev = merged.get(key)
    merged.set(key, { name, qty: (prev?.qty ?? 0) + qty })
  }
  return [...merged.values()]
}

/** Daily trade history of an item in a region (ESI), remembered for the day; null when it couldn't be loaded. */
const historyCache = new Map<string, Promise<{ date: string; average: number; volume: number }[] | null>>()
export function marketHistory(regionId: number, typeId: number): Promise<{ date: string; average: number; volume: number }[] | null> {
  const key = `${regionId}|${typeId}|${new Date().toISOString().slice(0, 10)}`
  if (!historyCache.has(key)) {
    historyCache.set(
      key,
      window.api
        .request<{ date: string; average: number; volume: number }[]>(`https://esi.evetech.net/latest/markets/${regionId}/history/?type_id=${typeId}`)
        .then((h) => (Array.isArray(h) ? h : null))
        .catch(() => {
          // A failed load is not "never traded": try again next time.
          historyCache.delete(key)
          return null
        })
    )
  }
  return historyCache.get(key)!
}

/**
 * Adds what selling each item really fetches (shared/saleValue.ts): items whose buy and sell orders are far apart
 * are checked against their trade history in the hub's region — the most valuable first, up to `limit` of them.
 * Buying stays at the sell order; only what is sold or held is valued with `saleOf`.
 */
export async function withSales(prices: Map<number, Price>, regionId = HUBS[0].regionId, ids?: number[], limit = 400): Promise<Map<number, Price>> {
  const today = new Date().toISOString().slice(0, 10)
  const wanted = (ids ?? [...prices.keys()]).filter((id) => prices.has(id))
  const suspect = wanted
    .filter((id) => needsHistory(prices.get(id)!.sell.best, prices.get(id)!.buy.best))
    .sort((a, b) => prices.get(b)!.sell.best - prices.get(a)!.sell.best)
    .slice(0, limit)
  const traded = new Map<number, { price: number; perDay: number }>()
  let next = 0
  const worker = async () => {
    while (next < suspect.length) {
      const id = suspect[next++]
      const h = await marketHistory(regionId, id)
      if (h) traded.set(id, tradedPrice(h, today))
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  for (const id of wanted) {
    const p = prices.get(id)!
    p.sale = saleUnit(p.sell.best, p.buy.best, traded.get(id))
  }
  return prices
}

/** ISK per unit selling it really gets: the checked sale price, else the sell order. */
export const saleOf = (p: Price | undefined): number => p?.sale?.unit ?? p?.sell.best ?? 0

/** The sell orders of an item in a hub's station (ESI), remembered for five minutes. */
const asksCache = new Map<string, { at: number; p: Promise<{ price: number; volume: number }[]> }>()
export function stationAsks(hub: Hub, typeId: number): Promise<{ price: number; volume: number }[]> {
  const key = `${hub.stationId}|${typeId}`
  const hit = asksCache.get(key)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.p
  const p = window.api
    .request<{ price: number; volume_remain: number; location_id: number }[]>(`https://esi.evetech.net/latest/markets/${hub.regionId}/orders/?type_id=${typeId}&order_type=sell`, { allPages: true })
    .then((o) => o.filter((x) => x.location_id === hub.stationId).map((x) => ({ price: x.price, volume: x.volume_remain })))
    .catch(() => {
      asksCache.delete(key)
      return [] as { price: number; volume: number }[]
    })
  asksCache.set(key, { at: Date.now(), p })
  return p
}

/** What buying each batch costs up the hub's sell orders: average per unit, and how many the hub lacks. */
export async function batchCost(items: { typeId: number; qty: number }[], hub: Hub = HUBS[0]): Promise<Map<number, { avg: number; short: number }>> {
  const out = new Map<number, { avg: number; short: number }>()
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++]
      const c = fillCost(await stationAsks(hub, it.typeId), it.qty)
      out.set(it.typeId, { avg: c.avg, short: c.short })
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return out
}
