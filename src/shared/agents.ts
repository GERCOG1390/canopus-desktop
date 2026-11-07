// Filtering mission agents: by level, division or locators, highsec, a name in either language; nearest first.

import type { L10n, SdeAgent } from './sde'

export interface AgentQuery {
  level: number
  /** Division id, 0 for any */
  division: number
  locators: boolean
  highsec: boolean
  q: string
  /** System to count jumps from */
  from?: number
  limit: number
}

export interface AgentContext {
  sec: (system: number) => number
  corpName: (corp: number) => L10n
  /** Gate jumps per system from the origin */
  jumps?: Map<number, number>
}

export function filterAgents(agents: SdeAgent[], q: AgentQuery, ctx: AgentContext): { total: number; list: SdeAgent[] } {
  const text = q.q.trim().toLowerCase()
  const hit = agents.filter((a) => {
    if (a.l !== q.level) return false
    if (q.locators ? !a.loc : q.division && a.d !== q.division) return false
    // The game shows security rounded: 0.45 and up reads 0.5, which is highsec.
    if (q.highsec && ctx.sec(a.s) < 0.45) return false
    if (!text) return true
    const corp = ctx.corpName(a.c)
    return a.n.toLowerCase().includes(text) || corp[0].toLowerCase().includes(text) || corp[1].toLowerCase().includes(text)
  })
  const distance = (a: SdeAgent): number => ctx.jumps?.get(a.s) ?? Number.MAX_SAFE_INTEGER
  hit.sort((a, b) => distance(a) - distance(b) || ctx.corpName(a.c)[0].localeCompare(ctx.corpName(b.c)[0]) || a.n.localeCompare(b.n))
  return { total: hit.length, list: hit.slice(0, q.limit) }
}
