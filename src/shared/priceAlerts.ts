// Price alerts at Jita: a line on an item's best sell or buy order. An alert fires once when the price reaches
// the line and re-arms when the price goes back, so it speaks at each crossing, not at every check.

export interface PriceAlert {
  id: string
  typeId: number
  name: string
  side: 'sell' | 'buy'
  dir: 'below' | 'above'
  price: number
}

export const alertKey = (a: PriceAlert): string => `price-${a.id}`

/** A best price of 0 means no orders on that side: not a real price. */
export const isTriggered = (a: PriceAlert, best: number): boolean => best > 0 && (a.dir === 'below' ? best <= a.price : best >= a.price)

export function evaluateAlerts(
  alerts: PriceAlert[],
  prices: Map<number, { sell: number; buy: number }>,
  alreadyFired: (key: string) => boolean
): { fire: { alert: PriceAlert; best: number }[]; rearm: string[] } {
  const fire: { alert: PriceAlert; best: number }[] = []
  const rearm: string[] = []
  for (const alert of alerts) {
    const best = prices.get(alert.typeId)?.[alert.side] ?? 0
    if (best <= 0) continue
    const key = alertKey(alert)
    if (isTriggered(alert, best)) {
      if (!alreadyFired(key)) fire.push({ alert, best })
    } else if (alreadyFired(key)) {
      rearm.push(key)
    }
  }
  return { fire, rearm }
}
