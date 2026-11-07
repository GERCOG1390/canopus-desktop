// Invention: the chance of turning a T1 copy into a T2 blueprint, and what a T2 run comes to when the failed
// attempts are paid for too. Formulas as in EVE University's Invention article: chance = base × (1 + science
// skills / 30 + encryption / 40) × decryptor; an invented blueprint starts at ME 2, TE 4, the decryptor shifts
// them and its runs.

export const inventionChance = (base: number, sci1: number, sci2: number, enc: number, decryptor: number): number =>
  Math.min(1, base * (1 + (sci1 + sci2) / 30 + enc / 40) * decryptor)

export interface InventionInput {
  baseChance: number
  sci1: number
  sci2: number
  enc: number
  /** Datacores for one attempt */
  inventionMaterialCost: number
  /** The T1 copy one attempt uses */
  copyCost: number
  inventionJobCost: number
  /** Runs of a blueprint invented with no decryptor */
  baseRuns: number
  unitsPerRun: number
  /** T2 materials per run */
  materials: { quantity: number; price: number }[]
  /** Estimated item value of one T2 run (for the manufacturing job) */
  eivPerRun: number
  costIndex: number
  /** Facility tax + SCC surcharge, as fractions */
  taxRate: number
  /** Material bonus of the structure, percent */
  structureBonus: number
  productPrice: number
  /** Sales tax and fees, as a fraction */
  salesTax: number
}

export interface DecryptorEffect {
  price: number
  chance: number
  me: number
  te: number
  runs: number
}

export interface InventionRun {
  chance: number
  me: number
  te: number
  runs: number
  /** Everything spent on attempts per blueprint that succeeds */
  inventionCost: number
  materialCost: number
  jobCost: number
  units: number
  costPerUnit: number
  revenue: number
  profit: number
}

export function inventionRun(i: InventionInput, d: DecryptorEffect | null): InventionRun {
  const chance = inventionChance(i.baseChance, i.sci1, i.sci2, i.enc, d?.chance ?? 1)
  const me = 2 + (d?.me ?? 0)
  const te = 4 + (d?.te ?? 0)
  const runs = i.baseRuns + (d?.runs ?? 0)
  const inventionCost = (i.inventionMaterialCost + i.copyCost + i.inventionJobCost + (d?.price ?? 0)) / chance
  const materialCost = i.materials.reduce((s, m) => {
    const qty = Math.max(runs, Math.ceil(Number((m.quantity * runs * (1 - me / 100) * (1 - i.structureBonus / 100)).toFixed(2))))
    return s + qty * m.price
  }, 0)
  const jobCost = i.eivPerRun * runs * (i.costIndex + i.taxRate)
  const units = runs * i.unitsPerRun
  const total = inventionCost + materialCost + jobCost
  const revenue = units * i.productPrice * (1 - i.salesTax)
  return { chance, me, te, runs, inventionCost, materialCost, jobCost, units, costPerUnit: units ? total / units : 0, revenue, profit: revenue - total }
}
