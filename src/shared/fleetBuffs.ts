// Fleet warfare buffs: bursts of the same kind don't add up, the strongest one applies — the largest value for
// buffs aggregated by maximum (shield HP +), the most negative for those by minimum (resistance bonuses are
// written as negative resonance changes).

import type { DbuffDef } from './sde'

export function strongestBuffs(list: { id: number; value: number }[], defs: Record<number, Pick<DbuffDef, 'agg'>>): Map<number, number> {
  const out = new Map<number, number>()
  for (const { id, value } of list) {
    const def = defs[id]
    if (!def || !value) continue
    const cur = out.get(id)
    if (cur === undefined || (def.agg === 'max' ? value > cur : value < cur)) out.set(id, value)
  }
  return out
}
