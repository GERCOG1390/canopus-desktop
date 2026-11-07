// The whole production chain of an item: what to run and what to buy, deciding at each step whether building
// a component beats its market price. Needs from every level are added up before a batch is rounded, so a
// component two parents share is one job and not two half-used ones.

export interface Recipe {
  product: number
  /** Units per run */
  portion: number
  mats: [number, number][]
  /** Seconds per run */
  time: number
  activity: 'manufacturing' | 'reaction'
}

export interface ChainOptions {
  /** Material efficiency of the item's own blueprint, % */
  rootMe: number
  /** Material efficiency of component blueprints, % */
  compMe: number
  /** Structure material bonus, %; reactions take none of these */
  structure: number
  /** Time efficiency of the blueprints, % */
  te: number
  /** Share of the estimated item value a job costs (cost index, facility tax, SCC) */
  rate: { manufacturing: number; reaction: number }
}

export type Decision = 'build' | 'buy'

export interface ChainJob {
  id: number
  activity: Recipe['activity']
  runs: number
  made: number
  surplus: number
  jobCost: number
  time: number
  buildUnit: number
  marketUnit: number
  /** Chosen by the user rather than by price */
  forced: boolean
}

export interface ChainBuy {
  id: number
  qty: number
  unit: number
  total: number
  /** What a unit would cost to build instead, when it can be built */
  buildUnit: number | null
  forced: boolean
}

export interface ChainPlan {
  jobs: ChainJob[]
  buys: ChainBuy[]
  materialCost: number
  jobCost: number
  total: number
  time: number
  /** Bought items with no market price: their cost is missing from the total */
  unpriced: number[]
  /** What the leftovers of the batches would fetch at the market; not taken off the total */
  surplusValue: number
  /** The finished items at the market, 0 when it has no price */
  marketCost: number
  made: number
}

/** Materials a job takes: EVE rounds up per job, and never below one per run. */
export function jobMaterial(perRun: number, runs: number, me: number, structure: number): number {
  return Math.max(runs, Math.ceil(Number((perRun * runs * (1 - me / 100) * (1 - structure / 100)).toFixed(2))))
}

export function planChain(args: {
  root: number
  runs: number
  recipes: Record<number, Recipe>
  price: (id: number) => number
  adjusted: (id: number) => number
  options: ChainOptions
  overrides?: Map<number, Decision>
}): ChainPlan | null {
  const { root, recipes, price, adjusted, options: o } = args
  const overrides = args.overrides ?? new Map<number, Decision>()
  const top = recipes[root]
  if (!top) return null
  const runsTop = Math.max(1, Math.floor(args.runs))

  const me = (id: number, r: Recipe): number => (r.activity === 'reaction' ? 0 : id === root ? o.rootMe : o.compMe)
  const bonus = (r: Recipe): number => (r.activity === 'reaction' ? 0 : o.structure)
  const jobPerRun = (r: Recipe): number => r.mats.reduce((s, [m, q]) => s + q * adjusted(m), 0) * o.rate[r.activity]

  // What a unit costs at best; a component that loops back to itself is bought at that point.
  const best = new Map<number, number>()
  const building = new Map<number, number>()
  const visiting = new Set<number>()
  const unitCost = (id: number): number => {
    const known = best.get(id)
    if (known !== undefined) return known
    const r = recipes[id]
    if (!r || visiting.has(id)) return price(id)
    visiting.add(id)
    const mats = r.mats.reduce((s, [m, q]) => s + q * (1 - me(id, r) / 100) * (1 - bonus(r) / 100) * unitCost(m), 0)
    visiting.delete(id)
    const build = (mats + jobPerRun(r)) / r.portion
    building.set(id, build)
    const market = price(id)
    const forced = overrides.get(id)
    const value = forced === 'buy' ? market : forced === 'build' || market <= 0 ? build : Math.min(build, market)
    best.set(id, value)
    return value
  }
  unitCost(root)

  // Parents before children, so a component's need is complete when its turn comes.
  const order: number[] = []
  const done = new Set<number>()
  const onPath = new Set<number>()
  const loops = new Set<string>()
  const visit = (id: number): void => {
    done.add(id)
    onPath.add(id)
    for (const [m] of recipes[id].mats) {
      if (onPath.has(m)) loops.add(`${id}:${m}`)
      else if (!done.has(m) && recipes[m]) visit(m)
    }
    onPath.delete(id)
    order.unshift(id)
  }
  visit(root)

  // Decided with the need known: a run makes a whole batch and all of it has to be paid for.
  const builds = (id: number, need: number): boolean => {
    if (id === root) return true
    const forced = overrides.get(id)
    if (forced) return forced === 'build'
    const market = price(id)
    if (market <= 0) return true
    const r = recipes[id]
    return Math.ceil(need / r.portion) * r.portion * (building.get(id) ?? Infinity) < need * market
  }

  const needs = new Map<number, number>([[root, runsTop * top.portion]])
  const bought = new Map<number, number>()
  const jobs: ChainJob[] = []
  for (const id of order) {
    const need = needs.get(id) ?? 0
    if (need <= 0) continue
    if (!builds(id, need)) {
      bought.set(id, (bought.get(id) ?? 0) + need)
      continue
    }
    const r = recipes[id]
    const runs = Math.ceil(need / r.portion)
    for (const [m, q] of r.mats) {
      const qty = jobMaterial(q, runs, me(id, r), bonus(r))
      const target = recipes[m] && !loops.has(`${id}:${m}`) ? needs : bought
      target.set(m, (target.get(m) ?? 0) + qty)
    }
    jobs.push({
      id,
      activity: r.activity,
      runs,
      made: runs * r.portion,
      surplus: runs * r.portion - need,
      jobCost: jobPerRun(r) * runs,
      time: r.time * runs * (r.activity === 'reaction' ? 1 : 1 - o.te / 100),
      buildUnit: building.get(id) ?? 0,
      marketUnit: price(id),
      forced: overrides.has(id)
    })
  }

  const buys: ChainBuy[] = [...bought].map(([id, qty]) => ({
    id,
    qty,
    unit: price(id),
    total: qty * price(id),
    buildUnit: recipes[id] ? (building.get(id) ?? null) : null,
    forced: overrides.has(id)
  }))
  buys.sort((a, b) => b.total - a.total)
  const materialCost = buys.reduce((s, b) => s + b.total, 0)
  const jobCost = jobs.reduce((s, j) => s + j.jobCost, 0)
  const made = runsTop * top.portion
  return {
    jobs,
    buys,
    materialCost,
    jobCost,
    total: materialCost + jobCost,
    time: jobs.reduce((s, j) => s + j.time, 0),
    unpriced: buys.filter((b) => b.unit <= 0).map((b) => b.id),
    surplusValue: jobs.reduce((s, j) => s + j.surplus * j.marketUnit, 0),
    marketCost: made * price(root),
    made
  }
}
