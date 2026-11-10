// Rules of a fit that hold without the rest of the engine.

export interface CapDrain {
  need: number
  cycle: number
  occasional?: boolean
  /** Capacitor boosters: cycles a load lasts, and the reload after it */
  shots?: number
  reloadSec?: number
}

/**
 * EVE capacitor: regeneration dC/dt = (10·Cmax/τ)·(√(C/Cmax) − C/Cmax), which between two moments
 * solves to C(t) = Cmax·(1 + (√(C0/Cmax) − 1)·e^(−5t/τ))². Modules take their whole cost at the
 * start of each cycle. Events are simulated in order: the capacitor runs out when a module can't
 * pay for its next cycle; surviving six hours counts as stable, at the lowest level reached
 * after the first hour (just before an activation, as the game shows it).
 */
export function capacitorStability(capacity: number, rechargeSec: number, drains: CapDrain[]): { peakRecharge: number; stable: boolean; stableLevel?: number; lastsSec?: number } {
  const peakRecharge = rechargeSec ? (2.5 * capacity) / rechargeSec : 0
  // Occasional modules (micro jump drives) are spread over their window as the game's fitting window
  // averages them, instead of one big bite at the start of every window.
  const mods = drains
    .filter((d) => d.need && d.cycle > 0)
    .map((d) => {
      if (!d.occasional) return d
      const parts = Math.max(1, Math.ceil(d.cycle / 10))
      return { ...d, need: d.need / parts, cycle: d.cycle / parts }
    })
  const left = mods.map((d) => d.shots ?? 0)
  if (!mods.some((d) => d.need > 0) || !capacity || !rechargeSec) return { peakRecharge, stable: true, stableLevel: 1 }
  const regen = (c: number, dt: number) => {
    const r = 1 + (Math.sqrt(Math.max(0, c) / capacity) - 1) * Math.exp((-5 * dt) / rechargeSec)
    return capacity * r * r
  }
  const LIMIT = 6 * 3600
  const next = mods.map(() => 0)
  let c = capacity
  let t = 0
  let low = capacity
  for (let guard = 0; guard < 2_000_000; guard++) {
    const at = Math.min(...next)
    if (at > LIMIT) break
    c = regen(c, at - t)
    t = at
    for (let i = 0; i < mods.length; i++) {
      if (next[i] > t + 1e-9) continue
      if (t >= 3600) low = Math.min(low, c)
      if (mods[i].need > 0 && c < mods[i].need) {
        // A micro jump drive that can't jump yet waits; the capacitor is out when the modules that run all the time can't cycle.
        if (mods[i].occasional) {
          next[i] += mods[i].cycle
          continue
        }
        return { peakRecharge, stable: false, lastsSec: t }
      }
      // Capacitor boosters (negative need) can't fill past the maximum.
      c = Math.min(capacity, c - mods[i].need)
      next[i] += mods[i].cycle
      // A capacitor booster's load runs out, and it stands idle while it reloads.
      if (mods[i].shots && --left[i] <= 0) {
        left[i] = mods[i].shots as number
        next[i] += mods[i].reloadSec ?? 0
      }
    }
  }
  // The level shown is the game's own: where the average drain meets the recharge curve,
  // 10·C/T·(√s − s) = drain. The simulation's lowest dip after activations sits a few percent lower.
  const drain = mods.reduce((sum, d) => sum + (d.shots ? (d.need * d.shots) / (d.shots * d.cycle + (d.reloadSec ?? 0)) : d.need / d.cycle), 0)
  const k = 1 - (4 * drain * rechargeSec) / (10 * capacity)
  const level = drain <= 0 ? 1 : k >= 0 ? 0.25 * (1 + Math.sqrt(k)) ** 2 : low / capacity
  return { peakRecharge, stable: true, stableLevel: level }
}

/**
 * How many drones of each stack to launch when a fit comes in from outside: as bandwidth and the limit allow,
 * first stack first. With no bandwidth known, only the limit counts.
 */
export function launchDrones(stacks: { count: number; bandwidth: number }[], bandwidth: number, limit: number): number[] {
  let room = bandwidth
  let left = limit
  return stacks.map((d) => {
    const fit = d.bandwidth > 0 ? Math.floor((room + 1e-9) / d.bandwidth) : d.count
    const n = Math.max(0, Math.min(d.count, left, fit))
    left -= n
    room -= n * d.bandwidth
    return n
  })
}
