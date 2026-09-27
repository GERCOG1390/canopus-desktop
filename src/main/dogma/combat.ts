// Combat simulator: applied damage of one fit against another at a given geometry,
// using the game's published formulas (turret hit chance, missile application), and the
// time each side needs to strip the other's shield, armor and hull through resists and repairs.

import type { AppliedWeapon, CombatDirection, CombatPilot, CombatResult, CombatScenario, CombatSideInfo } from '../../shared/combat'
import type { FitStats, LayerStats, WeaponStats } from '../../shared/fit'
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

interface Geometry {
  distance: number
  /** Relative sideways speed, m/s */
  transversal: number
  /** Target's own speed (for missiles and drones), m/s */
  targetSpeed: number
  targetSig: number
}

/** Share of a weapon's damage that lands, and what limits it. */
function application(w: WeaponStats, g: Geometry): { factor: number; limit?: string } {
  if (w.kind === 'turret') {
    const angular = g.transversal / Math.max(g.distance, 1)
    const trackingTerm = w.tracking && g.targetSig > 0 ? ((angular * TURRET_SIG_RESOLUTION) / (w.tracking * g.targetSig)) ** 2 : 0
    const beyond = Math.max(0, g.distance - (w.optimal ?? 0))
    const rangeTerm = beyond > 0 ? (w.falloff ? (beyond / w.falloff) ** 2 : Infinity) : 0
    const factor = turretMultiplier(0.5 ** (trackingTerm + rangeTerm))
    const limit = factor > 0.98 ? undefined : rangeTerm > trackingTerm ? (rangeTerm === Infinity ? 'вне дальности' : 'фоллоф') : 'наводка'
    return { factor, limit }
  }
  if (w.kind === 'missile') {
    if (w.optimal !== undefined && g.distance > w.optimal) return { factor: 0, limit: 'вне дальности полёта' }
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

function sideInfo(pilot: CombatPilot, s: FitStats, sig: number): CombatSideInfo {
  const d = s.defense
  return {
    shipTypeId: pilot.fit.shipTypeId,
    name: pilot.fit.name,
    maxVelocity: s.navigation.maxVelocity,
    signature: sig,
    ehp: d.ehp,
    hp: { shield: d.shield.hp, armor: d.armor.hp, hull: d.hull.hp },
    resist: { shield: d.shield.resist, armor: d.armor.resist, hull: d.hull.resist }
  }
}

/** Farthest distance any weapon of either side still reaches, for the chart. */
function chartRange(stats: FitStats[], current: number): number {
  let max = 0
  for (const s of stats)
    for (const w of s.offense.weapons) {
      if (w.kind === 'turret') max = Math.max(max, (w.optimal ?? 0) + 2.5 * (w.falloff ?? 0))
      else if (w.kind === 'missile') max = Math.max(max, (w.optimal ?? 0) * 1.1)
    }
  return Math.min(300_000, Math.max(10_000, max, current * 1.25))
}

export function simulate(a: CombatPilot, b: CombatPilot, sc: CombatScenario): CombatResult {
  const sa = calculateFit(a.fit, a.skills)
  const sb = calculateFit(b.fit, b.skills)
  const sigA = sc.sigA ?? sa.navigation.signatureRadius
  const sigB = sc.sigB ?? sb.navigation.signatureRadius
  const rad = Math.PI / 180
  // Sideways components along the same axis: opposite directions add up.
  const transversal = Math.abs(sc.speedB * Math.sin(sc.headingB * rad) - sc.speedA * Math.sin(sc.headingA * rad))
  const geo = (distance: number, target: 'a' | 'b'): Geometry => ({
    distance,
    transversal,
    targetSpeed: target === 'b' ? sc.speedB : sc.speedA,
    targetSig: target === 'b' ? sigB : sigA
  })

  const maxD = chartRange([sa, sb], sc.distance)
  const points = 80
  const curve = { distance: [] as number[], ab: [] as number[], ba: [] as number[] }
  for (let i = 0; i <= points; i++) {
    const d = Math.max(500, (maxD * i) / points)
    curve.distance.push(d)
    curve.ab.push(sa.offense.weapons.reduce((s, w) => s + w.dps * application(w, geo(d, 'b')).factor, 0))
    curve.ba.push(sb.offense.weapons.reduce((s, w) => s + w.dps * application(w, geo(d, 'a')).factor, 0))
  }

  return {
    a: sideInfo(a, sa, sigA),
    b: sideInfo(b, sb, sigB),
    ab: direction(sa, sb, geo(sc.distance, 'b')),
    ba: direction(sb, sa, geo(sc.distance, 'a')),
    angularVelocity: transversal / Math.max(sc.distance, 1),
    transversal,
    curve
  }
}

/** Default scenario values from both fits: their top speeds, 10 km, the opponent orbiting. */
export function defaults(a: CombatPilot, b: CombatPilot): { speedA: number; speedB: number; sigA: number; sigB: number } {
  const sa = calculateFit(a.fit, a.skills)
  const sb = calculateFit(b.fit, b.skills)
  return { speedA: sa.navigation.maxVelocity, speedB: sb.navigation.maxVelocity, sigA: sa.navigation.signatureRadius, sigB: sb.navigation.signatureRadius }
}
