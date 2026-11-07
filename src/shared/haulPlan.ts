// Hauling a list of items: how it splits into trips, by what the ship holds and how much ISK you'd carry at once
// (what makes you worth ganking), how long that takes, and what a courier would ask.

export interface HaulItem {
  id: number
  qty: number
  /** Packaged volume per unit, m³ */
  volume: number
  /** Value per unit */
  unit: number
}

export interface TripLine {
  id: number
  qty: number
}

export interface Trip {
  lines: TripLine[]
  volume: number
  value: number
  /** A single unit worth more than the limit: it has to go alone, over it */
  overLimit: boolean
}

export interface HaulPlan {
  trips: Trip[]
  /** Items of which a single unit doesn't fit in the ship */
  unfit: HaulItem[]
  /** The whole list, what doesn't fit included: a courier takes that too */
  volume: number
  value: number
}

// Volumes like 0.01 don't add up exactly in floating point; this keeps a full hold from counting as overfull.
const EPS = 1e-9

/**
 * Dearest per m³ first, so the value goes out as early as possible and the bulk fills what's left. maxValue 0
 * means no limit. Stacks split freely; one unit doesn't.
 */
export function planHaul(items: HaulItem[], capacity: number, maxValue = 0): HaulPlan {
  const fits = items.filter((i) => i.volume <= capacity + EPS)
  const unfit = items.filter((i) => i.volume > capacity + EPS)
  const density = (i: HaulItem): number => (i.volume > 0 ? i.unit / i.volume : Infinity)
  const queue = fits.filter((i) => i.qty > 0).map((i) => ({ ...i })).sort((a, b) => density(b) - density(a) || a.id - b.id)

  const trips: Trip[] = []
  let trip: Trip = { lines: [], volume: 0, value: 0, overLimit: false }
  const close = (): void => {
    if (trip.lines.length) trips.push(trip)
    trip = { lines: [], volume: 0, value: 0, overLimit: false }
  }
  const put = (i: HaulItem, qty: number): void => {
    const line = trip.lines.find((l) => l.id === i.id)
    if (line) line.qty += qty
    else trip.lines.push({ id: i.id, qty })
    trip.volume += qty * i.volume
    trip.value += qty * i.unit
    i.qty -= qty
  }
  for (const i of queue) {
    while (i.qty > 0) {
      const byVolume = i.volume > 0 ? Math.floor((capacity - trip.volume + EPS) / i.volume) : i.qty
      const byValue = maxValue > 0 && i.unit > 0 ? Math.floor((maxValue - trip.value + EPS) / i.unit) : i.qty
      const qty = Math.min(i.qty, byVolume, byValue)
      if (qty > 0) {
        put(i, qty)
      } else if (trip.lines.length) {
        close()
      } else {
        // An empty ship and it still won't take one: only the value limit can do that.
        put(i, 1)
        trip.overLimit = true
        close()
      }
    }
  }
  close()
  return {
    trips,
    unfit,
    volume: items.reduce((s, i) => s + i.qty * i.volume, 0),
    value: items.reduce((s, i) => s + i.qty * i.unit, 0)
  }
}

/** Seconds to get everything there: every trip out, and back for all but the last. */
export function haulSeconds(jumps: number, trips: number, secondsPerJump: number): number {
  return trips > 0 ? (2 * trips - 1) * jumps * secondsPerJump : 0
}

/** A courier's price: per m³ plus a share of the collateral, which is the value of the goods. */
export function courierCost(volume: number, value: number, perM3: number, collateralPercent: number): number {
  return volume * perM3 + (value * collateralPercent) / 100
}
