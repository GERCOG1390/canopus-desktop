// Combat simulator: applied damage of one fit against another at a given geometry,
// using the game's published formulas (turret hit chance, missile application), and the
// time each side needs to strip the other's shield, armor and hull through resists and repairs.

import type { AppliedWeapon, CombatDirection, CombatEffect, CombatPilot, CombatResult, CombatScenario, CombatSideInfo } from '../../shared/combat'
import type { FitStats, LayerStats, TacticalModule, WeaponStats } from '../../shared/fit'
import { calculateFit } from './index'

/** Turret tracking is normalised to a 40 km signature resolution since the 2019 rework. */
const TURRET_SIG_RESOLUTION = 40_000

/** Average damage multiplier for a hit chance, including 1% wrecking shots at 3x (as the game rolls it). */
function turretMultiplier(chance: number): number {
  const wrecking = Math.min(chance, 0.01)
  const normal = chance - wrecking
  const normalPart = normal > 0 ? normal * ((0.01 + chance) / 2 + 0.49) : 0
  return normalPart + wrecking * 3
}

export interface Geometry {
  distance: number
  /** Relative sideways speed, m/s */
  transversal: number
  /** Target's own speed (for missiles and drones), m/s */
  targetSpeed: number
  targetSig: number
  /** How fast the target moves away from the shooter, m/s (negative when closing in) */
  receding: number
}

/** Share of a weapon's damage that lands, and what limits it. */
export function application(w: WeaponStats, g: Geometry): { factor: number; limit?: string } {
  if (w.kind === 'turret') {
    const angular = g.transversal / Math.max(g.distance, 1)
    const trackingTerm = w.tracking && g.targetSig > 0 ? ((angular * TURRET_SIG_RESOLUTION) / (w.tracking * g.targetSig)) ** 2 : 0
    const beyond = Math.max(0, g.distance - (w.optimal ?? 0))
    const rangeTerm = beyond > 0 ? (w.falloff ? (beyond / w.falloff) ** 2 : Infinity) : 0
    const factor = turretMultiplier(0.5 ** (trackingTerm + rangeTerm))
    const limit = factor > 0.98 ? undefined : rangeTerm > trackingTerm ? (rangeTerm === Infinity ? 'вне дальности' : 'фоллоф') : 'наводка'
    return { factor, limit }
  }
  if (w.kind === 'smartbomb') return g.distance <= (w.optimal ?? 0) ? { factor: 1 } : { factor: 0, limit: 'вне радиуса смартбомбы' }
  if (w.kind === 'missile' || w.kind === 'vorton') {
    // A missile chasing a target that moves away covers (speed − receding speed) × flight time;
    // against one coming closer it reaches farther.
    if (w.optimal !== undefined) {
      const flightTime = w.missileVelocity ? w.optimal / w.missileVelocity : 0
      const reach = w.missileVelocity ? Math.max(0, (w.missileVelocity - g.receding) * flightTime) : w.optimal
      if (g.distance > reach) return { factor: 0, limit: g.receding > 0 && g.distance <= w.optimal ? 'цель уходит от ракет' : 'вне дальности полёта' }
    }
    const e = w.explosionRadius ?? 0
    const ve = w.explosionVelocity ?? 0
    const drf = w.drf ?? 0.5
    const sigTerm = e > 0 ? g.targetSig / e : 1
    const speedTerm = e > 0 && g.targetSpeed > 0 && ve > 0 ? ((g.targetSig * ve) / (e * g.targetSpeed)) ** drf : Infinity
    const factor = Math.min(1, sigTerm, speedTerm)
    const limit = factor > 0.98 ? undefined : sigTerm <= speedTerm ? 'радиус взрыва' : 'скорость взрыва'
    return { factor, limit }
  }
  if (w.kind === 'drone') {
    // Drones fly to the target: range doesn't matter. As in Pyfa, drones faster than the target keep pace
    // with it (no transversal, full application); a faster target simply outruns them.
    if (w.speed && g.targetSpeed > w.speed) return { factor: 0, limit: 'цель быстрее дронов' }
    return { factor: turretMultiplier(1) }
  }
  return { factor: 1 }
}

const layerEffective = (byType: number[], l: LayerStats) => byType.reduce((s, d, i) => s + d * (1 - l.resist[i]), 0)

/**
 * Seconds to strip a layer of `hp` starting at `start`: the target repairs `passive` all the time
 * and `active` only until `capOut` (its capacitor runs dry).
 */
function layerTime(hp: number, dps: number, passive: number, active: number, start: number, capOut: number): number {
  if (hp <= 0) return 0
  let remaining = hp
  let t = start
  if (t < capOut) {
    const net = dps - passive - active
    const window = capOut - t
    if (net > 0 && net * window >= remaining) return remaining / net
    if (net > 0) remaining -= net * window
    if (capOut === Infinity) return Infinity
    t = capOut
  }
  const net = dps - passive
  if (net <= 0) return Infinity
  return t + remaining / net - start
}

/** Longest fight worth simulating; beyond it the tank holds. */
const MAX_FIGHT_SEC = 3 * 3600

/**
 * Seconds to strip the shield, integrating the game's passive recharge: at fraction s of the shield
 * it regenerates 10·S/T·(√s − s) HP/s — nothing when full, the peak (2.5·S/T) at 25%.
 * Active boosting adds `active` HP/s until the capacitor runs out at `capOut`.
 */
function shieldTime(hp: number, dps: number, rechargeSec: number, active: number, capOut: number): number {
  if (hp <= 0) return 0
  if (dps <= 0) return Infinity
  const k = rechargeSec > 0 ? (10 * hp) / rechargeSec : 0
  let shield = hp
  let t = 0
  const dt = Math.max(0.05, Math.min(1, hp / dps / 2000))
  while (shield > 0) {
    const s = shield / hp
    const regen = k * (Math.sqrt(s) - s) + (t < capOut ? active : 0)
    const net = dps - regen
    // The regeneration holds the damage: the shield settles above zero.
    if (net <= 0 && (t >= capOut || capOut === Infinity)) return Infinity
    shield = Math.min(hp, shield - net * dt)
    t += dt
    if (t > MAX_FIGHT_SEC) return Infinity
  }
  return t
}

function direction(att: FitStats, def: FitStats, g: Geometry): CombatDirection {
  const weapons: AppliedWeapon[] = att.offense.weapons.map((w) => {
    const { factor, limit } = application(w, g)
    return { typeId: w.typeId, chargeTypeId: w.chargeTypeId, kind: w.kind, count: w.count, dps: w.dps, applied: w.dps * factor, factor, limit }
  })
  const appliedByType = [0, 0, 0, 0] as [number, number, number, number]
  att.offense.weapons.forEach((w, i) => {
    const factor = weapons[i].factor
    w.damage.forEach((d, k) => (appliedByType[k] += (d / (w.cycle || 1)) * factor))
  })
  const d = def.defense
  const effective = { shield: layerEffective(appliedByType, d.shield), armor: layerEffective(appliedByType, d.armor), hull: layerEffective(appliedByType, d.hull) }
  const repair = { shield: d.shieldBoost + d.passiveShieldRegen, armor: d.armorRepair, hull: d.hullRepair }
  const activeReps = d.shieldBoost + d.armorRepair + d.hullRepair
  const capOut = def.capacitor.stable || !activeReps ? Infinity : (def.capacitor.lastsSec ?? 0)

  const shield = shieldTime(d.shield.hp, effective.shield, d.shieldRechargeSec, d.shieldBoost, capOut)
  const armor = shield === Infinity ? Infinity : layerTime(d.armor.hp, effective.armor, 0, d.armorRepair, shield, capOut)
  const hull = shield === Infinity || armor === Infinity ? Infinity : layerTime(d.hull.hp, effective.hull, 0, d.hullRepair, shield + armor, capOut)

  const paperDps = weapons.reduce((s, w) => s + w.dps, 0)
  const applied = weapons.reduce((s, w) => s + w.applied, 0)
  // Identical weapons (same module and charge) as one line: "6× Heavy Assault Missile Launcher II".
  const grouped = new Map<string, AppliedWeapon>()
  for (const w of weapons) {
    const key = `${w.kind}|${w.typeId}|${w.chargeTypeId ?? 0}`
    const g = grouped.get(key)
    if (g) grouped.set(key, { ...g, count: g.count + w.count, dps: g.dps + w.dps, applied: g.applied + w.applied })
    else grouped.set(key, { ...w })
  }
  return {
    weapons: [...grouped.values()],
    paperDps,
    appliedByType,
    applied,
    effective,
    repair,
    time: { shield, armor, hull },
    timeToKill: shield + armor + hull,
    capWarning: capOut !== Infinity ? `Накопитель цели кончается за ${Math.round(capOut)} с — после этого её активные ремонтники не работают` : undefined
  }
}

function sideInfo(side: Side, st: SideState): CombatSideInfo {
  const d = st.stats.defense
  return {
    shipTypeId: side.pilot.fit.shipTypeId,
    name: side.pilot.fit.name,
    maxVelocity: st.maxVelocity,
    webbedVelocity: st.webbedVelocity,
    speed: st.speed,
    signature: st.signature,
    prop: side.prop && { kind: side.prop.kind, typeId: side.prop.typeId, on: st.propOn, blocked: st.blocked },
    hasEwar: side.ewar.some((m) => m.t.kind !== 'point'),
    effects: st.effects,
    ehp: d.ehp,
    hp: { shield: d.shield.hp, armor: d.armor.hp, hull: d.hull.hp },
    resist: { shield: d.shield.resist, armor: d.armor.resist, hull: d.hull.resist },
    ranges: weaponRanges(st.stats)
  }
}

/** Distinct weapon ranges of a fit, for the range rings on the tactical map. */
function weaponRanges(s: FitStats): CombatSideInfo['ranges'] {
  const out: CombatSideInfo['ranges'] = []
  for (const w of s.offense.weapons) {
    if (w.kind !== 'turret' && w.kind !== 'missile' && w.kind !== 'vorton') continue
    const r = { kind: w.kind === 'turret' ? ('turret' as const) : ('missile' as const), typeId: w.typeId, optimal: w.optimal ?? 0, falloff: w.kind === 'turret' ? (w.falloff ?? 0) : undefined }
    if (!out.some((x) => x.kind === r.kind && Math.abs(x.optimal - r.optimal) < 1 && (x.falloff ?? 0) === (r.falloff ?? 0))) out.push(r)
  }
  return out
}

/** Farthest distance any weapon of either side still reaches, for the chart. */
function chartRange(stats: FitStats[], current: number): number {
  let max = 0
  for (const s of stats)
    for (const w of s.offense.weapons) {
      if (w.kind === 'turret') max = Math.max(max, (w.optimal ?? 0) + 2.5 * (w.falloff ?? 0))
      else if (w.kind === 'missile' || w.kind === 'vorton') max = Math.max(max, (w.optimal ?? 0) * 1.1)
    }
  return Math.min(300_000, Math.max(10_000, max, current * 1.25))
}

/** The game's stacking penalty for the n-th strongest module of a kind (0-based). */
const stackingPenalty = (n: number) => Math.exp(-((n / 2.67) ** 2))

/** Strength of a web or painter at a distance: full within range, 0.5^((d − range)/falloff)² beyond. */
function ewarEfficiency(d: number, range: number, falloff: number): number {
  if (d <= range) return 1
  if (!falloff) return 0
  return 0.5 ** (((d - range) / falloff) ** 2)
}

interface Tactical {
  typeId: number
  t: TacticalModule
}

/** Webs, painters, scrams and points of a fit that are fitted (not offline). */
function ewarModules(pilot: CombatPilot, s: FitStats): Tactical[] {
  return s.modules
    .filter((r) => r.tactical && r.tactical.kind !== 'mwd' && r.tactical.kind !== 'ab' && pilot.fit.modules[r.index]?.state !== 'offline')
    .map((r) => ({ typeId: pilot.fit.modules[r.index].typeId, t: r.tactical! }))
}

/**
 * Combined multiplier of several webs or painters (strength in %, −60 or +30) at a distance, strongest
 * first with the stacking penalty, plus one line per module type for the UI.
 */
function stacked(mods: Tactical[], kind: 'web' | 'paint', d: number): { mult: number; effects: CombatEffect[] } {
  const list = mods
    .filter((m) => m.t.kind === kind)
    .map((m) => {
      const t = m.t as Extract<TacticalModule, { kind: 'web' | 'paint' }>
      const efficiency = ewarEfficiency(d, t.range, t.falloff)
      return { typeId: m.typeId, t, efficiency, value: t.strength * efficiency }
    })
    .filter((m) => m.efficiency > 0.001)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  let mult = 1
  const byType = new Map<number, CombatEffect>()
  list.forEach((m, i) => {
    const value = m.value * stackingPenalty(i)
    mult *= 1 + value / 100
    const e = byType.get(m.typeId)
    if (e) {
      e.count++
      e.value = ((1 + e.value / 100) * (1 + value / 100) - 1) * 100
    } else byType.set(m.typeId, { kind, typeId: m.typeId, count: 1, value, efficiency: m.efficiency, range: m.t.range, falloff: m.t.falloff })
  })
  return { mult, effects: [...byType.values()] }
}

/** Scramblers or disruptors of a kind in reach at a distance, one line per module type. */
function tackle(mods: Tactical[], kind: 'scram' | 'point', d: number): CombatEffect[] {
  const byType = new Map<number, CombatEffect>()
  for (const m of mods) {
    if (m.t.kind !== kind || m.t.range < d) continue
    const e = byType.get(m.typeId)
    if (e) e.count++
    else byType.set(m.typeId, { kind, typeId: m.typeId, count: 1, value: 0, efficiency: 1, range: m.t.range, falloff: 0 })
  }
  return [...byType.values()]
}

/** One side's fit with the propulsion module switched on or off (for MWD/AB toggles and a scram). */
function withProp(pilot: CombatPilot, index: number, on: boolean): CombatPilot {
  return {
    ...pilot,
    fit: { ...pilot.fit, modules: pilot.fit.modules.map((m, i) => (i === index ? { ...m, state: on ? (m.state === 'overload' ? 'overload' : 'active') : 'online' } : m)) }
  }
}

/** A side of the fight: its fit stats with the propulsion on or off, computed once each. */
class Side {
  readonly base: FitStats
  readonly prop?: { kind: 'mwd' | 'ab'; typeId: number; index: number; fitOn: boolean }
  readonly ewar: Tactical[]
  private cache = new Map<boolean, FitStats>()

  constructor(readonly pilot: CombatPilot) {
    this.base = calculateFit(pilot.fit, pilot.skills)
    const p = this.base.modules.find((r) => r.tactical?.kind === 'mwd' || r.tactical?.kind === 'ab')
    if (p) {
      const m = pilot.fit.modules[p.index]
      this.prop = { kind: p.tactical!.kind as 'mwd' | 'ab', typeId: m.typeId, index: p.index, fitOn: m.state === 'active' || m.state === 'overload' }
    }
    this.ewar = ewarModules(pilot, this.base)
  }

  stats(propOn: boolean): FitStats {
    if (!this.prop || propOn === this.prop.fitOn) return this.base
    let s = this.cache.get(propOn)
    if (!s) this.cache.set(propOn, (s = calculateFit(withProp(this.pilot, this.prop.index, propOn).fit, this.pilot.skills)))
    return s
  }
}

/** Where one side stands at a distance: its stats, top speed and signature under the opponent's modules. */
interface SideState {
  stats: FitStats
  propOn: boolean
  blocked: boolean
  maxVelocity: number
  webbedVelocity: number
  speed: number
  signature: number
  effects: CombatEffect[]
}

function sideState(me: Side, them: Side, d: number, wantProp: boolean | undefined, theirEwar: boolean, speed: number, sigOverride?: number): SideState {
  const want = wantProp ?? me.prop?.fitOn ?? false
  const ewar = theirEwar ? them.ewar : []
  const scrams = tackle(ewar, 'scram', d)
  // A warp scrambler shuts down a microwarpdrive (not an afterburner).
  const blocked = want && me.prop?.kind === 'mwd' && scrams.length > 0
  const propOn = !!me.prop && want && !blocked
  const stats = me.stats(propOn)
  const web = stacked(ewar, 'web', d)
  const paint = stacked(ewar, 'paint', d)
  const maxVelocity = stats.navigation.maxVelocity
  const webbedVelocity = maxVelocity * Math.max(0, web.mult)
  return {
    stats,
    propOn,
    blocked,
    maxVelocity,
    webbedVelocity,
    speed: Math.min(speed, webbedVelocity),
    signature: sigOverride ?? stats.navigation.signatureRadius * paint.mult,
    effects: [...web.effects, ...paint.effects, ...scrams, ...tackle(ewar, 'point', d)]
  }
}

export function simulate(a: CombatPilot, b: CombatPilot, sc: CombatScenario): CombatResult {
  const A = new Side(a)
  const B = new Side(b)
  const rad = Math.PI / 180
  const at = (d: number) => {
    const sa = sideState(A, B, d, sc.propA, sc.ewarB !== false, sc.speedA, sc.sigA)
    const sb = sideState(B, A, d, sc.propB, sc.ewarA !== false, sc.speedB, sc.sigB)
    // Sideways components along the same axis: opposite directions add up.
    const transversal = Math.abs(sb.speed * Math.sin(sc.headingB * rad) - sa.speed * Math.sin(sc.headingA * rad))
    // Rate the distance grows (same for both shooters): the opponent moving away, you moving closer.
    const receding = sb.speed * Math.cos(sc.headingB * rad) - sa.speed * Math.cos(sc.headingA * rad)
    const geo = (target: SideState): Geometry => ({ distance: d, transversal, targetSpeed: target.speed, targetSig: target.signature, receding })
    return { sa, sb, transversal, ab: geo(sb), ba: geo(sa) }
  }

  const now = at(sc.distance)
  const maxD = chartRange([now.sa.stats, now.sb.stats], sc.distance)
  const points = 80
  const curve = { distance: [] as number[], ab: [] as number[], ba: [] as number[] }
  for (let i = 0; i <= points; i++) {
    const d = Math.max(500, (maxD * i) / points)
    const p = at(d)
    curve.distance.push(d)
    curve.ab.push(p.sa.stats.offense.weapons.reduce((s, w) => s + w.dps * application(w, p.ab).factor, 0))
    curve.ba.push(p.sb.stats.offense.weapons.reduce((s, w) => s + w.dps * application(w, p.ba).factor, 0))
  }

  return {
    a: sideInfo(A, now.sa),
    b: sideInfo(B, now.sb),
    ab: direction(now.sa.stats, now.sb.stats, now.ab),
    ba: direction(now.sb.stats, now.sa.stats, now.ba),
    angularVelocity: now.transversal / Math.max(sc.distance, 1),
    transversal: now.transversal,
    curve
  }
}

/** Default scenario values from both fits: their top speeds, 10 km, the opponent orbiting. */
export function defaults(a: CombatPilot, b: CombatPilot): { speedA: number; speedB: number; sigA: number; sigB: number } {
  const sa = calculateFit(a.fit, a.skills)
  const sb = calculateFit(b.fit, b.skills)
  return { speedA: sa.navigation.maxVelocity, speedB: sb.navigation.maxVelocity, sigA: sa.navigation.signatureRadius, sigB: sb.navigation.signatureRadius }
}
