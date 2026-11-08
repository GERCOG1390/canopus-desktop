// Combat simulator: applied damage of one fit against another at the opening geometry, using the game's
// published formulas, and the fight itself stepped through time (shared/combatTimeline.ts).

import type { AppliedWeapon, CombatDirection, CombatEffect, CombatPilot, CombatResult, CombatScenario, CombatSideInfo } from '../../shared/combat'
import { fightProblems, rate, searchAdvice, type Candidate, type CombatAdvice, type Rated } from '../../shared/combatAdvice'
import { application, dependsOnStayingAway, ewarEfficiency, isSentry, runTimeline, stackingPenalty, type Combatant, type Geometry, type Orders, type Tactical, type Timeline } from '../../shared/combatTimeline'
import type { FitStats, TacticalModule } from '../../shared/fit'
import { chargesFor } from '../sde'
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

/** One module of a fit set to a state. */
function withState(pilot: CombatPilot, index: number, state: 'online' | 'active'): CombatPilot {
  return { ...pilot, fit: { ...pilot.fit, modules: pilot.fit.modules.map((m, i) => (i === index ? { ...m, state } : m)) } }
}

/**
 * A side of the fight: its fit stats with the propulsion on or off, computed once each. An assault damage control
 * counts as off in these: it runs only for seconds at a time, and the fight switches it on itself (`adc`).
 */
class Side {
  readonly pilot: CombatPilot
  readonly base: FitStats
  readonly prop?: { kind: 'mwd' | 'ab'; typeId: number; index: number; fitOn: boolean }
  readonly ewar: (Tactical & { index: number })[]
  /** The burst: resonance multipliers per layer while it runs */
  readonly adc?: NonNullable<Combatant['adc']>
  private cache = new Map<boolean, FitStats>()

  constructor(pilot: CombatPilot) {
    const fitted = calculateFit(pilot.fit, pilot.skills)
    const adc = fitted.defense.adc
    if (adc) {
      pilot = withState(pilot, adc.index, 'online')
      const off = adc.on ? calculateFit(pilot.fit, pilot.skills) : fitted
      const on = adc.on ? fitted : calculateFit(withState(pilot, adc.index, 'active').fit, pilot.skills)
      const mult = (l: 'shield' | 'armor' | 'hull') => on.defense[l].resist.map((r, i) => (1 - off.defense[l].resist[i] > 0 ? (1 - r) / (1 - off.defense[l].resist[i]) : 1))
      this.adc = { index: adc.index, need: adc.need, duration: adc.duration, delay: adc.delay, mult: { shield: mult('shield'), armor: mult('armor'), hull: mult('hull') } }
      this.base = off
    } else this.base = fitted
    this.pilot = pilot
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
    .filter((m) => !taken.has(m.index) && !m.occasional && m.cycle > 0 && (m.capPerSecond !== 0 || m.tactical || m.index === d.rah?.index))
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
    rah: d.rah,
    adc: side.adc,
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

  // A win that leans on the opponent idling out of its own reach: what if it simply came closer?
  const closing = (): CombatResult['ifCloses'] => {
    if (!dependsOnStayingAway(timeline)) return undefined
    const tl = runTimeline(
      combatant(A, wantA),
      combatant(B, !!B.prop),
      orders(sc.behaviorA, sc.rangeA, sc.headingA, sc.speedA, wantA, sc.ewarA !== false, sc.sigA),
      { behavior: 'approach', range: 1000, heading: sc.headingB, speed: 1e6, wantProp: !!B.prop, useEwar: sc.ewarB !== false, sig: sc.sigB },
      sc.distance
    )
    return tl.winner === timeline.winner ? undefined : { winner: tl.winner, end: tl.end }
  }

  return {
    a: sideInfo(A, now.sa),
    b: sideInfo(B, now.sb),
    ifCloses: closing(),
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

/** Ranges to try, up to what the weapons reach; a fit with only flying drones has no such limit. */
const RANGE_STEPS = [1, 2.5, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250].map((km) => km * 1000)

function rangesFor(s: FitStats, current: number): number[] {
  let reach = 0
  for (const w of s.offense.weapons) {
    if (w.kind === 'turret' || isSentry(w)) reach = Math.max(reach, (w.optimal ?? 0) + 2 * (w.falloff ?? 0))
    else if (w.kind === 'missile' || w.kind === 'vorton') reach = Math.max(reach, w.optimal ?? 0)
    else if (w.kind === 'drone') reach = Math.max(reach, 30_000)
  }
  const steps = reach > 0 ? RANGE_STEPS.filter((r) => r <= reach * 1.05) : []
  return [...new Set([...(steps.length ? steps : [RANGE_STEPS[0]]), current])].sort((x, y) => x - y)
}

/** Runs a fight per option: weapons' ammo, range, flying mode and propulsion against the opponent as set. */
export async function advise(a: CombatPilot, b: CombatPilot, sc: CombatScenario): Promise<CombatAdvice> {
  const B = new Side(b)
  const wantB = sc.propB ?? B.prop?.fitOn ?? false
  const enemy = combatant(B, wantB)
  const hpOf = (s: FitStats) => ({ shield: s.defense.shield.hp, armor: s.defense.armor.hp, hull: s.defense.hull.hp })
  const baseA = new Side(a)
  const hp = { a: hpOf(baseA.base), b: hpOf(B.base) }

  // The weapons that have charges loaded, and what else they could load.
  const loaded = new Map<number, number>()
  for (const m of a.fit.modules) if (m.chargeTypeId && baseA.base.offense.weapons.some((w) => w.typeId === m.typeId)) loaded.set(m.typeId, m.chargeTypeId)
  const charges: Record<number, number[]> = {}
  for (const typeId of loaded.keys()) charges[typeId] = chargesFor(typeId)
  const startAmmo = Object.fromEntries(loaded)

  // A side per ammo set, kept: the fit is only worked out once for each.
  const sides = new Map<string, Side>()
  const sideFor = (ammo: Record<number, number>): Side => {
    const key = JSON.stringify(Object.entries(ammo).sort())
    let side = sides.get(key)
    if (!side) {
      side = new Side({ ...a, fit: { ...a.fit, modules: a.fit.modules.map((m) => (m.typeId in ammo ? { ...m, chargeTypeId: ammo[m.typeId] } : m)) } })
      sides.set(key, side)
    }
    return side
  }
  const mine = (c: Candidate): Orders => ({ behavior: c.behavior, range: c.range, heading: sc.headingA, speed: 1e6, wantProp: c.prop, useEwar: sc.ewarA !== false, sig: sc.sigA })
  const theirs: Orders = { behavior: sc.behaviorB ?? 'free', range: sc.rangeB ?? sc.distance, heading: sc.headingB, speed: sc.speedB, wantProp: wantB, useEwar: sc.ewarB !== false, sig: sc.sigB }
  const fightAgainst = (c: Candidate, opp: Orders): Timeline => runTimeline(combatant(sideFor(c.ammo), c.prop), enemy, mine(c), opp, sc.distance)

  const wantA = sc.propA ?? baseA.prop?.fitOn ?? false
  const start: Candidate = { behavior: 'keep', range: sc.rangeA ?? sc.distance, ammo: startAmmo, prop: wantA }
  const found = await searchAdvice({
    start,
    rangesFor: (ammo) => rangesFor(sideFor(ammo).base, sc.rangeA ?? sc.distance),
    charges,
    canProp: !!baseA.prop,
    fight: (c) => fightAgainst(c, theirs),
    hp,
    pause: () => new Promise((resolve) => setImmediate(resolve))
  })

  // What's flown now, as it's set up.
  const now = simulate(a, b, sc)
  // Described as it's flown: an orbit is an orbit, anything else is told as keeping range.
  const current = rate({ ...start, behavior: sc.behaviorA === 'orbit' ? 'orbit' : 'keep' }, now.timeline, hp)
  const alreadyBest = found.best.score <= current.score + 0.005

  // The same choice if the opponent doesn't do as assumed: comes at you, or keeps away at its own longest reach.
  let kiteRange = 0
  for (const w of B.base.offense.weapons) if (w.kind === 'turret' || w.kind === 'missile' || w.kind === 'vorton') kiteRange = Math.max(kiteRange, w.optimal ?? 0)
  kiteRange = kiteRange || sc.distance
  const flat = { speed: 1e6, heading: sc.headingB, wantProp: !!B.prop, useEwar: sc.ewarB !== false, sig: sc.sigB }
  const enemyFull = combatant(B, !!B.prop)
  const reaction = (o: Orders): Rated => rate(found.best.candidate, runTimeline(combatant(sideFor(found.best.candidate.ammo), found.best.candidate.prop), enemyFull, mine(found.best.candidate), o, sc.distance), hp)
  return {
    current,
    best: found.best,
    alreadyBest,
    alternatives: found.alternatives,
    ifOpponent: { rushes: reaction({ ...flat, behavior: 'approach', range: 500 }), kites: reaction({ ...flat, behavior: 'keep', range: kiteRange }), kiteRange },
    problems: fightProblems(now),
    tried: found.tried
  }
}
