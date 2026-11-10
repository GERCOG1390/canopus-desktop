// The fight as it unfolds: ships move with inertia, weapons cycle, reload and spool up, the capacitor drains
// and recharges, repairers burn charges and neuts bite, all stepped through time. Values are averages (no
// random misses), so the same setup always gives the same fight.
//
// Not modelled: heat, ECM and sensor or weapon disruption, command bursts, missile flight time, the tracking of
// mobile drones (those that keep up land in full).

import type { LayerStats, TacticalModule, WeaponStats } from './fit'

// ---------- One shot at one moment: the game's formulas ----------

/** Turret tracking is normalised to a 40 km signature resolution since the 2019 rework. */
const TURRET_SIG_RESOLUTION = 40_000

/** Average damage multiplier for a hit chance, including 1% wrecking shots at 3x (as the game rolls it). */
export function turretMultiplier(chance: number): number {
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

/** Sentry drones don't fly: their speed is a tiny fraction of a metre per second. */
export const isSentry = (w: Pick<WeaponStats, 'kind' | 'speed'>): boolean => w.kind === 'drone' && (w.speed ?? 0) < 1

function gunnery(w: WeaponStats, g: Geometry): { factor: number; limit?: string } {
  const angular = g.transversal / Math.max(g.distance, 1)
  const trackingTerm = w.tracking && g.targetSig > 0 ? ((angular * TURRET_SIG_RESOLUTION) / (w.tracking * g.targetSig)) ** 2 : 0
  const beyond = Math.max(0, g.distance - (w.optimal ?? 0))
  const rangeTerm = beyond > 0 ? (w.falloff ? (beyond / w.falloff) ** 2 : Infinity) : 0
  const factor = turretMultiplier(0.5 ** (trackingTerm + rangeTerm))
  const limit = factor > 0.98 ? undefined : rangeTerm > trackingTerm ? (rangeTerm === Infinity ? 'вне дальности' : 'фоллоф') : 'наводка'
  return { factor, limit }
}

/** Share of a weapon's damage that lands, and what limits it. */
export function application(w: WeaponStats, g: Geometry): { factor: number; limit?: string } {
  if (w.kind === 'turret' || isSentry(w)) return gunnery(w, g)
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

/** The game's stacking penalty for the n-th strongest module of a kind (0-based). */
export const stackingPenalty = (n: number): number => Math.exp(-((n / 2.67) ** 2))

/** Strength of a falloff module at a distance: full within range, 0.5^((d − range)/falloff)² beyond. */
export function ewarEfficiency(d: number, range: number, falloff: number): number {
  if (d <= range) return 1
  if (!falloff) return 0
  return 0.5 ** (((d - range) / falloff) ** 2)
}

/** A module working on the other ship. */
export interface Tactical {
  typeId: number
  t: TacticalModule
}

/** A web's or painter's reach and strength, narrowed from the union. */
type Falloff = Extract<TacticalModule, { kind: 'web' | 'paint' }>

/** Combined multiplier of several webs or painters at a distance, strongest first with the stacking penalty. */
export function stackedMultiplier(mods: Tactical[], kind: 'web' | 'paint', d: number): number {
  const values = mods
    .filter((m) => m.t.kind === kind)
    .map((m) => {
      const t = m.t as Falloff
      return t.strength * ewarEfficiency(d, t.range, t.falloff)
    })
    .sort((a, b) => Math.abs(b) - Math.abs(a))
  return values.reduce((mult, v, i) => mult * (1 + (v * stackingPenalty(i)) / 100), 1)
}

// ---------- The fight ----------

export type Behavior = 'orbit' | 'keep' | 'approach' | 'flee' | 'stop' | 'free'

export interface Orders {
  behavior: Behavior
  /** Orbit, keep-at-range or approach distance, m */
  range: number
  /** Degrees from the line between the ships: where 'free' flies, and which way an orbit turns */
  heading: number
  /** Top speed asked for, m/s; webs and the ship itself may hold it lower */
  speed: number
  wantProp: boolean
  /** Use webs, painters, scramblers and neuts on the other ship */
  useEwar: boolean
  /** Signature set by hand */
  sig?: number
}

/**
 * A Reactive Armor Hardener: 60% resist in all, starting 15% each, drifting towards the damage taken. Resonances
 * below (1 − resist) go em, thermal, kinetic, explosive. Each armor resist is `rest` × the stacking-penalised product
 * of `peers` and the RAH's own resonance, the way the engine stacks it.
 */
export interface Rah {
  index: number
  cycle: number
  /** Share one type gives up per cycle, 0.06 */
  shift: number
  start: number[]
  /** Everything else on that armor resonance */
  rest: number[]
  /** Other modules penalised in the same stage */
  peers: number[][]
}

const stacked = (mults: number[]): number => {
  const run = (list: number[]): number => list.reduce((p, m, i) => p * (1 + (m - 1) * Math.exp(-((i / 2.67) ** 2))), 1)
  return run(mults.filter((m) => m > 1).sort((a, b) => b - a)) * run(mults.filter((m) => m < 1).sort((a, b) => a - b))
}

/** Armor resists with the RAH at these resonances. */
export const rahResist = (r: Rah, vector: number[]): number[] => vector.map((v, i) => 1 - r.rest[i] * stacked([...r.peers[i], v]))

// When types took the same damage the game orders them em, explosive, kinetic, thermal.
const RAH_TIE_ORDER = [0, 3, 2, 1]

/**
 * One cycle of the RAH, from the armor damage taken in it. Three or four types hit: the two least hit give up to
 * `shift` each and the two most hit share it. One or two hit: every untouched type gives, and only those hit receive.
 * The state it settles at is the game's; the pace for one or two types is the same per-cycle cap.
 */
export function adaptRah(vector: number[], damage: number[], shift: number): number[] {
  const order = [...RAH_TIE_ORDER].sort((x, y) => damage[x] - damage[y])
  const hit = order.filter((i) => damage[i] > 0)
  if (!hit.length) return vector
  const givers = hit.length >= 3 ? order.slice(0, 2) : order.filter((i) => damage[i] <= 0)
  const takers = hit.length >= 3 ? order.slice(2) : hit
  const out = [...vector]
  let pool = 0
  for (const i of givers) {
    const give = Math.min(shift, 1 - out[i])
    out[i] += give
    pool += give
  }
  for (const i of takers) out[i] -= pool / takers.length
  return out
}

export interface Repairer {
  index: number
  layer: 'shield' | 'armor' | 'hull'
  amount: number
  cycle: number
  need: number
  /** Cycles a load of charges lasts, for ancillary repairers; undefined when it needs none */
  shots?: number
  reloadSec?: number
}

export interface CapModule {
  index: number
  need: number
  cycle: number
  /** Cycles a load of charges lasts, for capacitor boosters */
  shots?: number
  reloadSec?: number
}

export interface Motion {
  maxVelocity: number
  signature: number
  alignSec: number
}

export interface Combatant {
  weapons: (WeaponStats & { need?: number })[]
  shield: LayerStats
  armor: LayerStats
  hull: LayerStats
  shieldRechargeSec: number
  /** Multiplier on incoming neuts, 1 = none resisted */
  neutResist: number
  capacity: number
  capRechargeSec: number
  repairers: Repairer[]
  rah?: Rah
  /**
   * An assault damage control, off as the fight starts. The pilot switches it on once half the ship is gone; it runs
   * `duration` s, then waits `delay` s. While on, each layer's resonances are multiplied by `mult` (em, thermal, kinetic, explosive).
   */
  adc?: { index: number; need: number; duration: number; delay: number; mult: { shield: number[]; armor: number[]; hull: number[] } }
  /** Active hardeners: their module indexes, and each layer's resonance multiplier with all of them off */
  hardeners?: { indexes: number[]; mult: { shield: number[]; armor: number[]; hull: number[] } }
  /** Targeting range, m, and scan resolution, mm; undefined = always locked */
  lock?: { range: number; scanResolution: number }
  /** How far drones can be ordered to attack, m; undefined = no limit */
  droneControlRange?: number
  /** Everything else that draws on the capacitor */
  modules: CapModule[]
  tactical: (Tactical & { index: number })[]
  off: Motion
  /** With the propulsion running */
  on?: Motion & { index: number; kind: 'mwd' | 'ab'; need: number; cycle: number }
}

export type TimelineEvent = {
  t: number
  side: 'a' | 'b'
  kind: 'shieldDown' | 'armorDown' | 'dead' | 'capEmpty' | 'reload' | 'repReload' | 'propBlocked' | 'lostRange' | 'backInRange' | 'adcOn' | 'locked' | 'lockLost' | 'capBoosterReload'
}

export interface TimelinePoint {
  t: number
  distance: number
  transversal: number
  /** Where the ships are, for the replay; only the gap between them means anything */
  pos: { ax: number; ay: number; bx: number; by: number }
  /** Per side: shield, armor, hull and capacitor as a share 0–1, speed, and damage dealt in that second after resists */
  a: { s: number; a: number; h: number; c: number; v: number; dealt: number }
  b: { s: number; a: number; h: number; c: number; v: number; dealt: number }
}

export interface SideOutcome {
  /** When each layer fell, s */
  shieldDown: number | null
  armorDown: number | null
  dead: number | null
  /** Total damage dealt after the target's resists */
  dealt: number
  /** What remains at the end, 0–1 */
  left: { s: number; a: number; h: number; c: number }
  /** Armor resists at the end, for a ship with a RAH */
  armorResist?: number[]
  /** Share of the paper damage that was out of reach, over the fight */
  idle: number
  /** Damage dealt after resists, per second of the fight */
  averageDps: number
}

export interface Timeline {
  winner: 'a' | 'b' | 'both' | null
  end: number
  a: SideOutcome
  b: SideOutcome
  events: TimelineEvent[]
  series: TimelinePoint[]
}

/** A fight that hasn't ended by then is called off. */
export const TIMELINE_MAX_SEC = 900
const DT = 0.2
/** Below this share of its damage nobody bothers firing: chance is practically nil, ammo and capacitor are not. */
const WORTH_FIRING = 0.01
/** Nothing in reach of anything for this long: the fight is over. */
const OUT_OF_REACH_SEC = 60
const LOG4 = Math.log(4)
/** How far off the asked range an orbit steers straight back rather than around */
const ORBIT_STIFFNESS_M = 500
const ORBIT_MAX_LEAN = 0.7
/** How far off a keep-at-range or approach distance a ship eases off */
const RANGE_STIFFNESS_M = 500

type Vec = { x: number; y: number }
const length = (v: Vec): number => Math.hypot(v.x, v.y)

/** Capacitor and shield share one recharge curve; this solves it exactly, so an empty one still comes back. */
export function recharge(value: number, max: number, tauSec: number, dt: number): number {
  if (max <= 0 || tauSec <= 0) return value
  const r = 1 + (Math.sqrt(Math.max(0, Math.min(value, max)) / max) - 1) * Math.exp((-5 * dt) / tauSec)
  return Math.max(value, max * r * r)
}

interface WeaponState {
  w: Combatant['weapons'][number]
  next: number
  shots: number
  spool: number
  arrival: number
  firing: boolean
  /** Drones: the order to attack has been given */
  sent: boolean
}

interface RepState {
  r: Repairer
  next: number
  shots: number
  pending: { at: number; amount: number } | null
}

interface ModState extends CapModule {
  next: number
  on: boolean
  left: number
  tactical?: Combatant['tactical'][number]
}

interface State {
  key: 'a' | 'b'
  c: Combatant
  /** The RAH: where it stands, whether it's running, and the armor damage of this cycle */
  rah?: { vector: number[]; running: boolean; damage: number[] }
  /** When the lock on the other ship is done; null while there is none */
  lockAt: number | null
  locked: boolean
  /** Inside targeting range last step */
  lockInRange: boolean | null
  capBoosterFlag: boolean
  /** The assault damage control: running until, and free to start again from */
  adc: { until: number; ready: number }
  o: Orders
  pos: Vec
  vel: Vec
  freeDir: Vec
  orbitSign: number
  shield: number
  armor: number
  hull: number
  cap: number
  weapons: WeaponState[]
  reps: RepState[]
  mods: ModState[]
  propNext: number
  propPaid: boolean
  propOn: boolean
  blocked: boolean
  outcome: SideOutcome
  dealtBucket: number
  capFlag: boolean
  reloadFlag: boolean
  repReloadFlag: boolean
  inRange: boolean | null
  idleSum: number
}

const empty = (): SideOutcome => ({ shieldDown: null, armorDown: null, dead: null, dealt: 0, left: { s: 1, a: 1, h: 1, c: 1 }, idle: 0, averageDps: 0 })

function start(key: 'a' | 'b', c: Combatant, o: Orders, pos: Vec, distance: number): State {
  const rad = (o.heading * Math.PI) / 180
  // 0° is along the line, away from "you": towards the opponent for you, away from you for them.
  const freeDir = { x: Math.cos(rad), y: Math.sin(rad) }
  // With a lock or a control range to respect, drones leave only when they can be ordered to.
  const commanded = !!c.lock || c.droneControlRange !== undefined
  return {
    key,
    // The armor as it stands in the fight; the fitted figure stays with the fit.
    c: c.rah ? { ...c, armor: { ...c.armor, resist: rahResist(c.rah, c.rah.start) as LayerStats['resist'] } } : c,
    rah: c.rah ? { vector: c.rah.start, running: true, damage: [0, 0, 0, 0] } : undefined,
    lockAt: null,
    locked: !c.lock,
    lockInRange: null,
    capBoosterFlag: false,
    adc: { until: -1, ready: 0 },
    o,
    pos,
    vel: { x: 0, y: 0 },
    freeDir,
    orbitSign: Math.sin(rad) < 0 ? -1 : 1,
    shield: c.shield.hp,
    armor: c.armor.hp,
    hull: c.hull.hp,
    cap: c.capacity,
    weapons: c.weapons.map((w) => ({
      w,
      next: 0,
      shots: w.shots ?? 0,
      spool: 0,
      // Mobile drones have to get there first.
      arrival: !commanded && w.kind === 'drone' && (w.speed ?? 0) >= 1 ? distance / (w.speed as number) : 0,
      firing: false,
      sent: !commanded
    })),
    reps: c.repairers.map((r) => ({ r, next: 0, shots: r.shots ?? 0, pending: null })),
    mods: c.modules.map((m) => ({ ...m, next: 0, on: true, left: m.shots ?? 0, tactical: c.tactical.find((t) => t.index === m.index) })),
    propNext: 0,
    propPaid: true,
    propOn: false,
    blocked: false,
    outcome: empty(),
    dealtBucket: 0,
    capFlag: false,
    reloadFlag: false,
    repReloadFlag: false,
    inRange: null,
    idleSum: 0
  }
}

/** The other ship's modules that are running and aimed at this one. */
function incoming(them: State): Tactical[] {
  if (!them.o.useEwar) return []
  // A module that draws on the capacitor works only while it's paid for; one that doesn't always works.
  return them.c.tactical.filter((t) => them.mods.find((m) => m.index === t.index)?.on !== false)
}

const scrammed = (mods: Tactical[], d: number): boolean => mods.some((m) => m.t.kind === 'scram' && m.t.range >= d)

function desiredVelocity(me: State, other: State, d: number, speed: number): Vec {
  const radial = { x: (other.pos.x - me.pos.x) / d, y: (other.pos.y - me.pos.y) / d }
  const o = me.o
  const tau = (me.propOn && me.c.on ? me.c.on.alignSec : me.c.off.alignSec) / LOG4
  const opening = (other.vel.x - me.vel.x) * radial.x + (other.vel.y - me.vel.y) * radial.y
  // Where the distance would settle if it let go now: stopping takes v·τ. Full speed until then, so a heavy ship isn't held back.
  const closing = (range: number): number => Math.max(-1, Math.min(1, (d + opening * tau - range) / RANGE_STIFFNESS_M))
  switch (o.behavior) {
    case 'stop':
      return { x: 0, y: 0 }
    case 'free':
      return { x: me.freeDir.x * speed, y: me.freeDir.y * speed }
    case 'flee':
      return { x: -radial.x * speed, y: -radial.y * speed }
    case 'approach': {
      const k = Math.max(0, closing(o.range))
      return { x: radial.x * speed * k, y: radial.y * speed * k }
    }
    case 'keep': {
      const k = closing(o.range)
      return { x: radial.x * speed * k, y: radial.y * speed * k }
    }
    case 'orbit': {
      // Where the distance is heading a turn from now, not only where it is: without that the ship weaves. And a
      // lean inwards for the turn itself: velocity lags the heading by v·τ/r, and left alone that carries it outwards.
      // Worked from the asked range and capped: from the current distance it would feed itself and fly the ship into the target.
      const lean = Math.min(ORBIT_MAX_LEAN, (speed * tau) / Math.max(o.range, 1))
      const k = Math.max(-1, Math.min(1, (d + opening * tau - o.range) / ORBIT_STIFFNESS_M + lean))
      // The turn is chosen once in world terms: for the ship on the far side the tangent points the other way.
      const side = me.key === 'a' ? 1 : -1
      const tangent = { x: -radial.y * me.orbitSign * side, y: radial.x * me.orbitSign * side }
      const across = Math.sqrt(1 - k * k)
      return { x: (tangent.x * across + radial.x * k) * speed, y: (tangent.y * across + radial.y * k) * speed }
    }
  }
}

/** Seconds to lock a target, by the game's formula. */
export const lockTime = (scanResolution: number, signature: number): number => (scanResolution > 0 && signature > 0 ? 40000 / (scanResolution * Math.asinh(signature) ** 2) : Infinity)

/**
 * A side's layers as they take damage now: its hardeners off while there is no capacitor to run them (those stopped
 * are taken as an even share of the whole set), and the assault damage control's burst while it runs.
 */
function layersNow(s: State, t: number): State['c'] {
  const adc = s.c.adc && t + 1e-9 < s.adc.until ? s.c.adc : undefined
  const h = s.c.hardeners
  const off = h ? h.indexes.filter((i) => s.mods.find((m) => m.index === i)?.on === false).length / h.indexes.length : 0
  if (!adc && !off) return s.c
  const layer = (name: 'shield' | 'armor' | 'hull'): LayerStats => ({
    ...s.c[name],
    resist: s.c[name].resist.map((r, i) => 1 - Math.min(1, (1 - r) * (h ? 1 + (h.mult[name][i] - 1) * off : 1) * (adc ? adc.mult[name][i] : 1))) as LayerStats['resist']
  })
  return { ...s.c, shield: layer('shield'), armor: layer('armor'), hull: layer('hull') }
}

/** Damage after this layer's resists, spilling what's left to the next layer. */
export function applyDamage(s: { shield: number; armor: number; hull: number }, c: { shield: LayerStats; armor: LayerStats; hull: LayerStats }, byType: readonly number[], onArmor?: (taken: number[]) => void): number {
  let left: number[] = [...byType]
  let dealt = 0
  for (const name of ['shield', 'armor', 'hull'] as const) {
    if (s[name] <= 0) continue
    const after = left.reduce((sum, d, i) => sum + d * (1 - c[name].resist[i]), 0)
    if (after <= 0) return dealt
    const landed = Math.min(1, s[name] / after)
    if (name === 'armor') onArmor?.(left.map((d, i) => d * (1 - c.armor.resist[i]) * landed))
    if (after < s[name]) {
      s[name] -= after
      return dealt + after
    }
    const share = 1 - s[name] / after
    dealt += s[name]
    s[name] = 0
    left = left.map((d) => d * share)
  }
  return dealt
}

/** Most of a fight is decided by the opponent's guns not reaching: worth asking what if it simply came closer. */
export const dependsOnStayingAway = (tl: Pick<Timeline, 'winner'> & { b: Pick<SideOutcome, 'idle'> }): boolean => (tl.winner === 'a' || tl.winner === null) && tl.b.idle >= 0.3

export function runTimeline(a: Combatant, b: Combatant, orderA: Orders, orderB: Orders, distance: number): Timeline {
  const A = start('a', a, orderA, { x: 0, y: 0 }, distance)
  const B = start('b', b, orderB, { x: Math.max(distance, 1), y: 0 }, distance)
  const events: TimelineEvent[] = []
  const series: TimelinePoint[] = []
  const log = (t: number, s: State, kind: TimelineEvent['kind']): void => void events.push({ t, side: s.key, kind })

  const frac = (s: State) => ({
    s: s.c.shield.hp ? s.shield / s.c.shield.hp : 0,
    a: s.c.armor.hp ? s.armor / s.c.armor.hp : 0,
    h: s.c.hull.hp ? s.hull / s.c.hull.hp : 0,
    c: s.c.capacity ? s.cap / s.c.capacity : 0
  })

  const pay = (s: State, need: number): boolean => {
    if (need <= 0) {
      s.cap = Math.min(s.c.capacity, s.cap - need)
      return true
    }
    if (s.cap < need) return false
    s.cap -= need
    return true
  }
  const noCap = (t: number, s: State): void => {
    if (s.capFlag) return
    s.capFlag = true
    log(t, s, 'capEmpty')
  }

  const steps = Math.round(TIMELINE_MAX_SEC / DT)
  let end = TIMELINE_MAX_SEC
  let finished = false
  let nextSample = 0
  let quietSince: number | null = null

  for (let step = 0; step <= steps; step++) {
    const t = step * DT
    const gap = { x: B.pos.x - A.pos.x, y: B.pos.y - A.pos.y }
    const d = Math.max(length(gap), 1)

    const pairs: [State, State][] = [
      [A, B],
      [B, A]
    ]

    // ----- What each ship can do under the other's modules, and how it moves.
    for (const [me, them] of pairs) {
      const mods = incoming(them)
      const blocked = me.c.on?.kind === 'mwd' && scrammed(mods, d)
      if (blocked && me.o.wantProp && !me.blocked) log(t, me, 'propBlocked')
      me.blocked = !!blocked
      const prop = me.c.on
      let on = false
      if (prop && me.o.wantProp && !blocked) {
        if (t + 1e-9 >= me.propNext) {
          me.propPaid = pay(me, prop.need)
          if (!me.propPaid) noCap(t, me)
          me.propNext = me.propPaid ? me.propNext + prop.cycle : t + DT
          if (me.propNext < t) me.propNext = t + prop.cycle
        }
        on = me.propPaid
      }
      me.propOn = on
      const motion = on && prop ? prop : me.c.off
      const top = motion.maxVelocity * Math.max(0, stackedMultiplier(mods, 'web', d))
      const speed = Math.min(me.o.speed, top)
      const want = desiredVelocity(me, them, d, speed)
      const k = 1 - Math.exp(-DT / Math.max(0.1, motion.alignSec / LOG4))
      me.vel.x += (want.x - me.vel.x) * k
      me.vel.y += (want.y - me.vel.y) * k
    }
    A.pos.x += A.vel.x * DT
    A.pos.y += A.vel.y * DT
    B.pos.x += B.vel.x * DT
    B.pos.y += B.vel.y * DT

    const gapNow = { x: B.pos.x - A.pos.x, y: B.pos.y - A.pos.y }
    const dNow = Math.max(length(gapNow), 1)
    const line = { x: gapNow.x / dNow, y: gapNow.y / dNow }
    const rel = { x: B.vel.x - A.vel.x, y: B.vel.y - A.vel.y }
    const receding = rel.x * line.x + rel.y * line.y
    const transversal = Math.abs(rel.x * -line.y + rel.y * line.x)

    // ----- Fire. Both ships shoot in the same instant; the damage lands together afterwards.
    const hits = new Map<State, number[]>([
      [A, [0, 0, 0, 0]],
      [B, [0, 0, 0, 0]]
    ])
    for (const [me, them] of pairs) {
      const mods = incoming(me)
      const motion = them.propOn && them.c.on ? them.c.on : them.c.off
      const geo = {
        distance: dNow,
        transversal,
        targetSpeed: length(them.vel),
        targetSig: them.o.sig ?? motion.signature * stackedMultiplier(mods, 'paint', dNow),
        receding
      }
      // A target has to be inside targeting range, and the lock takes its time; losing the range loses the lock.
      const inLockRange = !me.c.lock || dNow <= me.c.lock.range
      if (me.c.lock) {
        if (!inLockRange) {
          if (me.lockInRange !== false) log(t, me, 'lockLost')
          me.lockAt = null
          me.locked = false
        } else {
          me.lockAt ??= t + lockTime(me.c.lock.scanResolution, geo.targetSig)
          if (!me.locked && t + 1e-9 >= me.lockAt) {
            me.locked = true
            log(t, me, 'locked')
          }
        }
        me.lockInRange = inLockRange
      }
      const inControl = me.c.droneControlRange === undefined || dNow <= me.c.droneControlRange
      let anyInReach = false
      const paper = me.weapons.reduce((sum, ws) => sum + ws.w.dps, 0)
      for (const ws of me.weapons) {
        const drone = ws.w.kind === 'drone'
        // Drones are ordered once, with a lock and inside control range; after that they keep at it by themselves.
        if (drone && !ws.sent && me.locked && inControl) {
          ws.sent = true
          ws.arrival = (ws.w.speed ?? 0) >= 1 ? t + dNow / (ws.w.speed as number) : 0
        }
        const unreachable = drone ? !ws.sent && (!inLockRange || !inControl) : !inLockRange
        const waiting = drone ? !ws.sent && !unreachable : inLockRange && !me.locked
        const factor = unreachable ? 0 : application(ws.w, geo).factor
        if (factor >= WORTH_FIRING) anyInReach = true
        else if (paper > 0) me.idleSum += ws.w.dps / paper
        if (waiting || t + 1e-9 < ws.next || t + 1e-9 < ws.arrival) continue
        // Out of reach: nothing is fired, and a spooled weapon loses its spool.
        if (factor < WORTH_FIRING) {
          ws.spool = 0
          ws.firing = false
          continue
        }
        if (ws.w.need && !pay(me, ws.w.need)) {
          noCap(t, me)
          ws.firing = false
          continue
        }
        const boost = 1 + ws.spool
        ws.w.damage.forEach((v, i) => ((hits.get(them) as number[])[i] += v * boost * factor))
        if (ws.w.spoolMax) ws.spool = Math.min(ws.w.spoolMax, ws.spool + (ws.w.spoolPerCycle ?? 0))
        ws.firing = true
        // On time, the cycle keeps its pace between simulation steps; after waiting, it starts again from now.
        ws.next = t - ws.next < DT + 1e-9 ? ws.next + ws.w.cycle : t + ws.w.cycle
        if (ws.w.shots) {
          ws.shots--
          if (ws.shots <= 0) {
            ws.shots = ws.w.shots
            ws.next += ws.w.reloadSec ?? 0
            ws.spool = 0
            if (!me.reloadFlag) {
              me.reloadFlag = true
              log(t, me, 'reload')
            }
          }
        }
      }
      if (me.weapons.length) {
        if (me.inRange === true && !anyInReach) log(t, me, 'lostRange')
        if (me.inRange === false && anyInReach) log(t, me, 'backInRange')
        me.inRange = anyInReach
      }
    }

    // ----- Modules that aren't weapons: paying for them, and what neuts take.
    for (const [me, them] of pairs) {
      for (const m of me.mods) {
        if (t + 1e-9 < m.next) continue
        const tactical: TacticalModule | undefined = m.tactical?.t
        const aimed = tactical && tactical.kind !== 'mwd' && tactical.kind !== 'ab'
        const reach = !aimed ? 1 : !me.o.useEwar || !me.locked ? 0 : 'falloff' in tactical ? ewarEfficiency(dNow, tactical.range, tactical.falloff) : (tactical as { range: number }).range >= dNow ? 1 : 0
        // Nobody runs a web or a neut at something it can't reach.
        if (aimed && reach <= 0.001) {
          m.on = false
          m.next = t + DT
          continue
        }
        // A capacitor booster is pressed when there is room for its charge, not into a full capacitor.
        if (m.need < 0 && me.cap - m.need > me.c.capacity) {
          m.next = t + DT
          continue
        }
        const rah = me.c.rah?.index === m.index ? me.c.rah : undefined
        if (!pay(me, m.need)) {
          if (m.need > 0) noCap(t, me)
          m.on = false
          m.next = t + DT
          // Off, it gives nothing at all; turned on again it starts from the even split.
          if (rah && me.rah?.running) {
            me.rah = { vector: [1, 1, 1, 1], running: false, damage: [0, 0, 0, 0] }
            me.c.armor.resist = rahResist(rah, me.rah.vector) as LayerStats['resist']
          }
          continue
        }
        m.on = true
        if (rah && me.rah) {
          me.rah = { vector: me.rah.running ? (t > 0 ? adaptRah(me.rah.vector, me.rah.damage, rah.shift) : me.rah.vector) : rah.start, running: true, damage: [0, 0, 0, 0] }
          me.c.armor.resist = rahResist(rah, me.rah.vector) as LayerStats['resist']
        }
        m.next = Math.max(m.next + m.cycle, t)
        if (m.shots && --m.left <= 0) {
          m.left = m.shots
          m.next += m.reloadSec ?? 0
          if (!me.capBoosterFlag) {
            me.capBoosterFlag = true
            log(t, me, 'capBoosterReload')
          }
        }
        if (tactical?.kind === 'neut') {
          them.cap = Math.max(0, them.cap - tactical.amount * reach * them.c.neutResist)
        } else if (tactical?.kind === 'nos') {
          // A nosferatu only drinks from a capacitor fuller, by share, than one's own.
          const share = (s: State): number => (s.c.capacity ? s.cap / s.c.capacity : 0)
          if (share(them) > share(me)) {
            const take = Math.min(tactical.amount * reach * them.c.neutResist, them.cap)
            them.cap -= take
            me.cap = Math.min(me.c.capacity, me.cap + take)
          }
        }
      }
    }

    // ----- The assault damage control: on once half the ship is gone, if the capacitor allows.
    for (const s of [A, B]) {
      const adc = s.c.adc
      if (!adc || t + 1e-9 < s.adc.ready || s.adc.until > t) continue
      const total = s.c.shield.hp + s.c.armor.hp + s.c.hull.hp
      if (!total || (s.shield + s.armor + s.hull) / total > 0.5) continue
      if (!pay(s, adc.need)) continue
      s.adc = { until: t + adc.duration, ready: t + adc.duration + adc.delay }
      log(t, s, 'adcOn')
    }

    // ----- Repairs: shield boosters heal when they start, armor and hull ones when they finish.
    for (const s of [A, B]) {
      for (const rs of s.reps) {
        const r = rs.r
        if (rs.pending && t + 1e-9 >= rs.pending.at) {
          s[r.layer] = Math.min(s.c[r.layer].hp, s[r.layer] + rs.pending.amount)
          rs.pending = null
        }
        // An emptied layer is still repaired, as in the game: the HP goes back onto it.
        if (t + 1e-9 < rs.next || s[r.layer] >= s.c[r.layer].hp) continue
        if (!pay(s, r.need)) {
          noCap(t, s)
          continue
        }
        if (r.layer === 'shield') s.shield = Math.min(s.c.shield.hp, s.shield + r.amount)
        else rs.pending = { at: t + r.cycle, amount: r.amount }
        rs.next = t + r.cycle
        if (r.shots) {
          rs.shots--
          if (rs.shots <= 0) {
            rs.shots = r.shots
            rs.next += r.reloadSec ?? 0
            if (!s.repReloadFlag) {
              s.repReloadFlag = true
              log(t, s, 'repReload')
            }
          }
        }
      }
    }

    // ----- Natural recharge, then the damage of this instant.
    for (const s of [A, B]) {
      s.cap = recharge(s.cap, s.c.capacity, s.c.capRechargeSec, DT)
      // An emptied shield comes back by itself, as the capacitor does.
      if (s.hull > 0) s.shield = recharge(s.shield, s.c.shield.hp, s.c.shieldRechargeSec, DT)
    }
    for (const [me, them] of pairs) {
      const before = { s: them.shield, a: them.armor }
      const dealt = applyDamage(them, layersNow(them, t), hits.get(them) as number[], (taken) => {
        if (them.rah) taken.forEach((v, i) => ((them.rah as NonNullable<State['rah']>).damage[i] += v))
      })
      me.outcome.dealt += dealt
      me.dealtBucket += dealt
      // The first fall counts: a repair landing on an empty layer can bring it back for a moment.
      if (before.s > 0 && them.shield <= 0 && them.c.shield.hp > 0 && them.outcome.shieldDown === null) {
        them.outcome.shieldDown = t
        log(t, them, 'shieldDown')
      }
      if (before.a > 0 && them.armor <= 0 && them.c.armor.hp > 0 && them.outcome.armorDown === null) {
        them.outcome.armorDown = t
        log(t, them, 'armorDown')
      }
    }
    for (const s of [A, B]) {
      if (s.hull <= 0 && s.outcome.dead === null) {
        s.outcome.dead = t
        log(t, s, 'dead')
      }
    }
    finished = A.outcome.dead !== null || B.outcome.dead !== null
    // Only once someone has had a gun and lost its reach: two unarmed ships aren't "over", they're just flying.
    const anyArmed = A.weapons.length > 0 || B.weapons.length > 0
    const reachable = A.inRange === true || B.inRange === true
    if (!anyArmed || reachable) quietSince = null
    else quietSince ??= t
    if (quietSince !== null && t - quietSince >= OUT_OF_REACH_SEC) finished = true
    if (t + 1e-9 >= nextSample || finished) {
      const fa = frac(A)
      const fb = frac(B)
      series.push({
        t,
        distance: dNow,
        transversal,
        pos: { ax: A.pos.x, ay: A.pos.y, bx: B.pos.x, by: B.pos.y },
        a: { ...fa, v: length(A.vel), dealt: A.dealtBucket },
        b: { ...fb, v: length(B.vel), dealt: B.dealtBucket }
      })
      A.dealtBucket = 0
      B.dealtBucket = 0
      nextSample += 1
    }
    if (finished) {
      end = t
      break
    }
  }

  A.outcome.left = frac(A)
  B.outcome.left = frac(B)
  const ticks = Math.max(1, Math.round(end / DT) + 1)
  for (const s of [A, B]) {
    s.outcome.idle = s.idleSum / ticks
    s.outcome.averageDps = s.outcome.dealt / Math.max(end, 1)
  }
  if (a.rah) A.outcome.armorResist = [...A.c.armor.resist]
  if (b.rah) B.outcome.armorResist = [...B.c.armor.resist]
  const winner = A.outcome.dead !== null && B.outcome.dead !== null ? 'both' : B.outcome.dead !== null ? 'a' : A.outcome.dead !== null ? 'b' : null
  return { winner, end, a: A.outcome, b: B.outcome, events, series }
}

/** The fight at any moment between its points. Damage isn't blended: it is what the coming point says was dealt. */
export function frameAt(series: TimelinePoint[], t: number): TimelinePoint {
  if (t <= series[0].t) return series[0]
  const last = series[series.length - 1]
  if (t >= last.t) return last
  let hi = 1
  while (series[hi].t < t) hi++
  const p = series[hi - 1]
  const q = series[hi]
  const k = (t - p.t) / (q.t - p.t)
  const mix = (a: number, b: number): number => a + (b - a) * k
  const side = (x: TimelinePoint['a'], y: TimelinePoint['a']): TimelinePoint['a'] => ({ s: mix(x.s, y.s), a: mix(x.a, y.a), h: mix(x.h, y.h), c: mix(x.c, y.c), v: mix(x.v, y.v), dealt: y.dealt })
  return {
    t,
    distance: Math.hypot(mix(p.pos.bx, q.pos.bx) - mix(p.pos.ax, q.pos.ax), mix(p.pos.by, q.pos.by) - mix(p.pos.ay, q.pos.ay)),
    transversal: mix(p.transversal, q.transversal),
    pos: { ax: mix(p.pos.ax, q.pos.ax), ay: mix(p.pos.ay, q.pos.ay), bx: mix(p.pos.bx, q.pos.bx), by: mix(p.pos.by, q.pos.by) },
    a: side(p.a, q.a),
    b: side(p.b, q.b)
  }
}
