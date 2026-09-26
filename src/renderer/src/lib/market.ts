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
