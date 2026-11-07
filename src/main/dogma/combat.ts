// Combat simulator: applied damage of one fit against another at the opening geometry, using the game's
// published formulas, and the fight itself stepped through time (shared/combatTimeline.ts).

import type { AppliedWeapon, CombatDirection, CombatEffect, CombatPilot, CombatResult, CombatScenario, CombatSideInfo } from '../../shared/combat'
import { application, ewarEfficiency, runTimeline, stackingPenalty, type Combatant, type Geometry, type Orders, type Tactical, type Timeline } from '../../shared/combatTimeline'
import type { FitStats, TacticalModule } from '../../shared/fit'
import { calculateFit } from './index'

function direction(att: FitStats, def: FitStats, g: Geometry): CombatDirection {
  const weapons: AppliedWeapon[] = att.offense.weapons.map((w) => {
    const { factor, limit } = application(w, g)
    return { typeId: w.typeId, chargeTypeId: w.chargeTypeId, kind: w.kind, count: w.count, dps: w.dps, applied: w.dps * factor, factor, limit, spoolMax: w.spoolMax }
  })
  const appliedByType = [0, 0, 0, 0] as [number, number, number, number]
  att.offense.weapons.forEach((w, i) => {
    const factor = weapons[i].factor
    w.damage.forEach((d, k) => (appliedByType[k] += (d / (w.cycle || 1)) * factor))
  })
  const d = def.defense
  const layerEffective = (l: FitStats['defense']['shield']): number => appliedByType.reduce((sum, v, i) => sum + v * (1 - l.resist[i]), 0)
  const effective = { shield: layerEffective(d.shield), armor: layerEffective(d.armor), hull: layerEffective(d.hull) }
  const repair = { shield: d.shieldBoost + d.passiveShieldRegen, armor: d.armorRepair, hull: d.hullRepair }

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
    time: { shield: Infinity, armor: Infinity, hull: Infinity },
    timeToKill: Infinity
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

/** Webs, painters, scrams, points and neuts of a fit that are fitted (not offline). */
function ewarModules(pilot: CombatPilot, s: FitStats): (Tactical & { index: number })[] {
  return s.modules
    .filter((r) => r.tactical && r.tactical.kind !== 'mwd' && r.tactical.kind !== 'ab' && pilot.fit.modules[r.index]?.state !== 'offline')
    .map((r) => ({ index: r.index, typeId: pilot.fit.modules[r.index].typeId, t: r.tactical! }))
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

/** Neuts or nosferatus in reach at a distance, one line per module type; value is GJ per cycle after falloff. */
function drains(mods: Tactical[], kind: 'neut' | 'nos', d: number): CombatEffect[] {
  const byType = new Map<number, CombatEffect>()
  for (const m of mods) {
    if (m.t.kind !== kind) continue
    const efficiency = ewarEfficiency(d, m.t.range, m.t.falloff)
    if (efficiency <= 0.001) continue
    const e = byType.get(m.typeId)
    if (e) {
      e.count++
      e.value += m.t.amount * efficiency
    } else byType.set(m.typeId, { kind, typeId: m.typeId, count: 1, value: m.t.amount * efficiency, efficiency, range: m.t.range, falloff: m.t.falloff })
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
  readonly ewar: (Tactical & { index: number })[]
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
    effects: [...web.effects, ...paint.effects, ...scrams, ...tackle(ewar, 'point', d), ...drains(ewar, 'neut', d), ...drains(ewar, 'nos', d)]
  }
}

/** A side as the fight needs it: its running modules one by one, with what each costs. */
function combatant(side: Side, propWanted: boolean): Combatant {
  // The modules running as fitted; propulsion is added or left out on top of this.
  const base = side.stats(false)
  const d = base.defense
  const need = (index: number): number => {
    const r = base.modules.find((m) => m.index === index)
    return r ? r.capPerSecond * r.cycle : 0
  }
  const weapons = base.offense.weapons.map((w) => (w.kind === 'drone' ? w : { ...w, need: need(w.moduleIndex) }))
  const taken = new Set([...base.offense.weapons.filter((w) => w.kind !== 'drone').map((w) => w.moduleIndex), ...d.repairers.map((r) => r.index)])
  const motion = (s: FitStats) => ({ maxVelocity: s.navigation.maxVelocity, signature: s.navigation.signatureRadius, alignSec: s.navigation.alignSec })
  const modules = base.modules
    .filter((m) => !taken.has(m.index) && !m.occasional && m.cycle > 0 && (m.capPerSecond !== 0 || m.tactical))
    .filter((m) => m.tactical?.kind !== 'mwd' && m.tactical?.kind !== 'ab')
    .map((m) => ({ index: m.index, need: m.capPerSecond * m.cycle, cycle: m.cycle }))
  let on: Combatant['on']
  if (side.prop && propWanted) {
    const running = side.stats(true)
    const r = running.modules.find((m) => m.index === side.prop!.index)
    on = { ...motion(running), index: side.prop.index, kind: side.prop.kind, need: r ? r.capPerSecond * r.cycle : 0, cycle: r?.cycle || 10 }
  }
  return {
    weapons,
    shield: d.shield,
    armor: d.armor,
    hull: d.hull,
    shieldRechargeSec: d.shieldRechargeSec,
    neutResist: d.neutResist,
    capacity: base.capacitor.capacity,
    capRechargeSec: base.capacitor.rechargeSec,
    repairers: d.repairers.map((r) => ({ ...r, need: need(r.index) })),
    modules,
    tactical: side.ewar,
    off: motion(base),
    on
  }
}

/** Layer times of the one being shot, from the fight. */
function timesOf(tl: Timeline, target: 'a' | 'b'): { time: CombatDirection['time']; timeToKill: number } {
  const o = tl[target]
  const shield = o.shieldDown ?? (o.dead !== null ? 0 : Infinity)
  const armor = o.armorDown === null ? (o.dead !== null ? 0 : Infinity) : o.armorDown - (o.shieldDown ?? 0)
  const hull = o.dead === null ? Infinity : o.dead - (o.armorDown ?? o.shieldDown ?? 0)
  return { time: { shield, armor, hull }, timeToKill: o.dead ?? Infinity }
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

  const wantA = sc.propA ?? A.prop?.fitOn ?? false
  const wantB = sc.propB ?? B.prop?.fitOn ?? false
  const orders = (behavior: CombatScenario['behaviorA'], range: number | undefined, heading: number, speed: number, wantProp: boolean, useEwar: boolean, sig: number | undefined): Orders => ({
    behavior: behavior ?? 'free',
    range: range ?? sc.distance,
    heading,
    speed,
    wantProp,
    useEwar,
    sig
  })
  const timeline = runTimeline(
    combatant(A, wantA),
    combatant(B, wantB),
    orders(sc.behaviorA, sc.rangeA, sc.headingA, sc.speedA, wantA, sc.ewarA !== false, sc.sigA),
    orders(sc.behaviorB, sc.rangeB, sc.headingB, sc.speedB, wantB, sc.ewarB !== false, sc.sigB),
    sc.distance
  )

  return {
    a: sideInfo(A, now.sa),
    b: sideInfo(B, now.sb),
    ab: { ...direction(now.sa.stats, now.sb.stats, now.ab), ...timesOf(timeline, 'b') },
    ba: { ...direction(now.sb.stats, now.sa.stats, now.ba), ...timesOf(timeline, 'a') },
    timeline,
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
