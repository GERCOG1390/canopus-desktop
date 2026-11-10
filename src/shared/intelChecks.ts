// Small verdicts for intel, routes and wormholes, where saying too much can cost a ship.

const CLEAR_RE = /(^|[^\p{L}])(clr|clear|чисто|клир)([^\p{L}]|$)/iu

/** A report that stands a system down. "nv" (no visual) only says the hostile was lost from sight; two systems are two reports. */
export const isClearReport = (message: string, systems: number): boolean => systems <= 1 && CLEAR_RE.test(message)

export type RouteVerdict = 'checking' | 'danger' | 'partial' | 'clean'

/** What may be said of a route after looking for kills: clean only if no system went unchecked. */
export function routeVerdict(c: { total: number; done: number; failed: number; running: boolean; found: number }): RouteVerdict {
  if (c.running) return 'checking'
  if (c.found > 0) return 'danger'
  return c.failed > 0 || c.done < c.total ? 'partial' : 'clean'
}

/** Which ships pass a wormhole with this per-jump mass limit (kg), from the hulls' real masses. Null when the hole has none. */
export function shipsThrough(jumpMass: number): string | null {
  if (jumpMass <= 0) return null
  if (jumpMass <= 5e6) return 'фрегаты и эсминцы'
  if (jumpMass <= 62e6) return 'до линейных крейсеров'
  if (jumpMass < 400e6) return 'до линкоров'
  if (jumpMass < 960e6) return 'до линкоров и Bowhead'
  if (jumpMass < 1.78e9) return 'до фрейтеров'
  if (jumpMass < 2.4e9) return 'капитальные, кроме титанов'
  return 'любые корабли'
}

export type JumpRisk = 'too-heavy' | 'closed' | 'cut-off' | 'may-close' | null

/** The risk of one jump: `lo` and `hi` are the hole's remaining mass after it, at worst and at best. */
export function jumpRisk(j: { mass: number; jumpMass: number; lo: number; hi: number; outsideAfter: boolean }): JumpRisk {
  if (j.mass > j.jumpMass) return 'too-heavy'
  if (j.hi <= 0) return 'closed'
  if (j.lo <= 0) return j.outsideAfter ? 'cut-off' : 'may-close'
  return null
}
