// What ore covers a list of minerals most cheaply: a covering linear program (minimise cost so every mineral
// is covered), solved exactly through its dual with the simplex method, then rounded up to whole batches.

export interface OreSource {
  cost: number
  yields: number[]
}

/**
 * min Σ cost·x with Σ yield·x ≥ need, x ≥ 0. The dual (max Σ need·y with Σ yield·y ≤ cost, y ≥ 0) starts feasible
 * at zero, so plain tableau simplex works; x are the dual prices of its rows. Null when a need can't be covered.
 */
export function cheapestMix(needs: number[], ores: OreSource[]): number[] | null {
  const m = ores.length
  const n = needs.length
  if (needs.some((need, j) => need > 0 && !ores.some((o) => (o.yields[j] ?? 0) > 0))) return null
  // Rows: ores; columns: needs, slacks, right side. Last row: objective.
  const t: number[][] = ores.map((o, i) => [...needs.map((_, j) => o.yields[j] ?? 0), ...ores.map((_, k) => (k === i ? 1 : 0)), o.cost])
  t.push([...needs.map((v) => -v), ...ores.map(() => 0), 0])
  const EPS = 1e-9
  for (let guard = 0; guard < 20000; guard++) {
    // Bland's rule: the first improving column, so it can't cycle.
    let col = -1
    for (let j = 0; j < n + m; j++) {
      if (t[m][j] < -EPS) {
        col = j
        break
      }
    }
    if (col < 0) break
    let row = -1
    let best = Infinity
    for (let i = 0; i < m; i++) {
      if (t[i][col] > EPS) {
        const ratio = t[i][n + m] / t[i][col]
        if (ratio < best - EPS) {
          best = ratio
          row = i
        }
      }
    }
    if (row < 0) return null
    const p = t[row][col]
    t[row] = t[row].map((v) => v / p)
    for (let i = 0; i <= m; i++) {
      if (i === row) continue
      const f = t[i][col]
      if (f) t[i] = t[i].map((v, j) => v - f * t[row][j])
    }
  }
  return ores.map((_, i) => Math.max(0, t[m][n + i]))
}

export interface OreInfo {
  id: number
  /** Units in one reprocessing batch */
  portion: number
  /** ISK per unit */
  price: number
  volume: number
  /** [mineral, quantity per batch] */
  yields: [number, number][]
}

export interface OreLine {
  id: number
  batches: number
  units: number
  volume: number
  cost: number
}

export function planOres(needs: { id: number; qty: number }[], ores: OreInfo[], refineYield: number, mineralPrices: Map<number, number>) {
  const usable = ores.filter((o) => o.price > 0)
  const wanted = needs.filter((x) => x.qty > 0)
  const per = (o: OreInfo, mineral: number): number => Math.floor((o.yields.find(([id]) => id === mineral)?.[1] ?? 0) * refineYield)
  const mineralCost = wanted.reduce((s, x) => s + x.qty * (mineralPrices.get(x.id) ?? 0), 0)
  const mix = wanted.length
    ? cheapestMix(
        wanted.map((x) => x.qty),
        usable.map((o) => ({ cost: o.price * o.portion, yields: wanted.map((x) => per(o, x.id)) }))
      )
    : null
  if (!mix) return { lines: [] as OreLine[], oreCost: 0, mineralCost, volume: 0, covered: false, surplus: [] as { id: number; qty: number }[] }

  const counts = usable.map((_, i) => Math.ceil(mix[i] - 1e-7))
  // Whole batches can overshoot where the mix shared them: drop whatever is no longer needed, dearest first.
  const got = (id: number): number => usable.reduce((s, o, i) => s + counts[i] * per(o, id), 0)
  const enough = (): boolean => wanted.every((x) => got(x.id) >= x.qty)
  const byCost = usable.map((o, i) => ({ i, cost: o.price * o.portion })).sort((a, b) => b.cost - a.cost)
  for (const { i } of byCost) {
    while (counts[i] > 0) {
      counts[i]--
      if (enough()) continue
      counts[i]++
      break
    }
  }
  const lines = usable
    .map((o, i) => ({ id: o.id, batches: counts[i], units: counts[i] * o.portion, volume: counts[i] * o.portion * o.volume, cost: counts[i] * o.portion * o.price }))
    .filter((l) => l.batches > 0)
    .sort((a, b) => b.cost - a.cost)
  const surplus = wanted.map((x) => ({ id: x.id, qty: got(x.id) - x.qty })).filter((s) => s.qty > 0)
  return { lines, oreCost: lines.reduce((s, l) => s + l.cost, 0), mineralCost, volume: lines.reduce((s, l) => s + l.volume, 0), covered: enough(), surplus }
}

/** "Tritanium 2 000 000" as a name and a quantity; null when the text doesn't end in a number after a name. */
export function splitTrailingQty(text: string): { name: string; qty: number } | null {
  const m = text.trim().match(/^(.*\D)\s+(\d[\d\s,.]*)$/)
  if (!m) return null
  const qty = Number(m[2].replace(/[\s,.]/g, ''))
  return qty > 0 ? { name: m[1].trim(), qty } : null
}

/**
 * Parsed list lines to items. The shared parser leaves "Name 10" whole because a number can belong to the
 * name ("Navy Cap Booster 800"), so the whole text is tried first and only then a trailing quantity.
 */
export function resolveListLines(parsed: { name: string; qty: number }[], isKnown: (name: string) => boolean): { lines: { name: string; qty: number }[]; unknown: string[] } {
  const lines: { name: string; qty: number }[] = []
  const unknown: string[] = []
  for (const p of parsed) {
    const split = isKnown(p.name) ? null : splitTrailingQty(p.name)
    if (isKnown(p.name)) lines.push(p)
    else if (split && isKnown(split.name)) lines.push(split)
    else unknown.push(p.name)
  }
  return { lines, unknown }
}
