// Overheating, by the game's rules as EVE University's "Overheating" page gives them, with the hull's and modules'
// own attributes from the SDE:
//
// - A rack heats while any module in it is overheated: H(t) = 1 − e^(−t · heatGenerationMultiplier · Σ heatAbsorbtionRateModifier)
//   (heat as a share 0–1, the sum over the rack's overheated modules). With none overheated it cools: H(t) = H₀ · e^(−t · heatDissipationRate).
// - At the end of an overheated cycle each online module of that rack may take heat damage, with the chance
//   rack heat × (online modules / high+mid+low+rig slots) × heatAttenuation^(slots away from the overheated module).
//   A hit does the overheated module's heatDamage (Thermodynamics and hull bonuses applied) to the module's hit points.
// - A module whose hit points are gone burns out: it goes offline until repaired.
//
// The simulator flies averages, so a hit counts as its chance times the damage: the expected damage, the same
// every run. When the dice go badly in the game a module can burn out sooner.

export type Rack = 'hi' | 'med' | 'lo'

/** Rack heat after `dt` seconds: heating with these overheated modules, cooling with none. */
export function rackHeat(h: number, dt: number, generation: number, absorbSum: number, dissipation: number): number {
  if (absorbSum > 0) return 1 - (1 - h) * Math.exp(-dt * generation * absorbSum)
  return h * Math.exp(-dt * dissipation)
}

/** Seconds for a rack to heat from 0 to `h` with these modules overheated. */
export const secondsToHeat = (h: number, generation: number, absorbSum: number): number => -Math.log(1 - h) / (generation * absorbSum)

/** The chance a module takes heat damage at the end of an overheated cycle `distance` slots away. */
export function damageChance(heat: number, online: number, slots: number, attenuation: number, distance: number): number {
  if (slots <= 0) return 0
  return Math.min(1, heat * (online / slots) * attenuation ** distance)
}

export interface HeatModule {
  /** The module's index in the fit */
  index: number
  rack: Rack
  /** Its place in the rack, 0 first */
  pos: number
  hp: number
  /** Overheatable: rack heat it adds per second while overheated, and the damage one overheated cycle deals */
  absorb?: number
  damage?: number
}

export interface HeatSpec {
  generation: number
  racks: Record<Rack, { dissipation: number; attenuation: number }>
  slots: number
  modules: HeatModule[]
}

/** How the pilot runs heat: not at all, until something burns, or turning a rack off before it burns. */
export type HeatPolicy = 'off' | 'burn' | 'safe'

/** "Safe" heat: a rack is taken off overheat once any of its modules has lost this share of its hit points. */
export const SAFE_DAMAGE = 0.6

export class HeatState {
  readonly heat: Record<Rack, number> = { hi: 0, med: 0, lo: 0 }
  /** Damage taken per module index */
  readonly damage = new Map<number, number>()
  readonly burnt = new Set<number>()
  /** Racks the pilot took off overheat (safe heat) */
  readonly cooled = new Set<Rack>()

  readonly spec: HeatSpec
  readonly policy: HeatPolicy

  constructor(spec: HeatSpec, policy: HeatPolicy) {
    this.spec = spec
    this.policy = policy
  }

  private module(index: number): HeatModule | undefined {
    return this.spec.modules.find((m) => m.index === index)
  }

  /** Whether this module runs overheated now. */
  hot(index: number): boolean {
    if (this.policy === 'off' || this.burnt.has(index)) return false
    const m = this.module(index)
    return !!m?.absorb && !this.cooled.has(m.rack)
  }

  /** Heat up or cool down each rack over `dt`; `running`: modules cycling right now (overheated ones heat). */
  step(dt: number, running: (index: number) => boolean): void {
    for (const rack of ['hi', 'med', 'lo'] as const) {
      const sum = this.spec.modules.filter((m) => m.rack === rack && this.hot(m.index) && running(m.index)).reduce((s, m) => s + (m.absorb ?? 0), 0)
      this.heat[rack] = rackHeat(this.heat[rack], dt, this.spec.generation, sum, this.spec.racks[rack].dissipation)
    }
  }

  /** An overheated cycle of this module ended: heat damage to its rack. Returns modules that burnt out. */
  cycled(index: number): number[] {
    const src = this.module(index)
    if (!src || !this.hot(index) || !src.damage) return []
    const online = this.spec.modules.filter((m) => !this.burnt.has(m.index)).length
    const att = this.spec.racks[src.rack].attenuation
    const out: number[] = []
    for (const m of this.spec.modules) {
      if (m.rack !== src.rack || this.burnt.has(m.index)) continue
      const chance = damageChance(this.heat[src.rack], online, this.spec.slots, att, Math.abs(m.pos - src.pos))
      if (chance <= 0) continue
      const taken = (this.damage.get(m.index) ?? 0) + chance * src.damage
      this.damage.set(m.index, taken)
      if (taken >= m.hp) {
        this.burnt.add(m.index)
        out.push(m.index)
      } else if (this.policy === 'safe' && taken >= m.hp * SAFE_DAMAGE) {
        this.cooled.add(m.rack)
      }
    }
    return out
  }

  /** Highest rack heat, 0–1. */
  peak(): number {
    return Math.max(this.heat.hi, this.heat.med, this.heat.lo)
  }
}
