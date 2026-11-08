import assert from 'node:assert/strict'
import { test } from 'node:test'
import { frameAt, adaptRah, application, dependsOnStayingAway, applyDamage, isSentry, rahResist, recharge, runTimeline, stackedMultiplier, TIMELINE_MAX_SEC, turretMultiplier } from './combatTimeline.ts'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)
const layer = (hp, r = 0) => ({ hp, resist: [r, r, r, r], ehp: hp })
const still = { maxVelocity: 0, signature: 100, alignSec: 1 }

// A plain ship: no shield regen to speak of, full capacitor, nothing fitted.
const ship = (o = {}) => ({
  weapons: [],
  shield: layer(0),
  armor: layer(0),
  hull: layer(100),
  shieldRechargeSec: 0,
  neutResist: 1,
  capacity: 100,
  capRechargeSec: 0,
  repairers: [],
  modules: [],
  tactical: [],
  off: still,
  ...o
})
// A gun that always lands in full at its range: no tracking term, target within optimal.
const gun = (o = {}) => ({ moduleIndex: 0, typeId: 1, kind: 'turret', count: 1, volley: 10, dps: 10, dpsReload: 10, damage: [10, 0, 0, 0], cycle: 1, optimal: 1e6, falloff: 0, tracking: 1e6, ...o })
const orders = (o = {}) => ({ behavior: 'stop', range: 1000, heading: 0, speed: 0, wantProp: false, useEwar: true, ...o })
const run = (a, b, oa = {}, ob = {}, d = 1000) => runTimeline(a, b, orders(oa), orders(ob), d)
const FULL = turretMultiplier(1)

// ---------- Physics

test('turret formula against hand numbers', () => {
  // Chance 1: 0.99 × (1.01/2 + 0.49) + 0.01 × 3
  close(turretMultiplier(1), 0.99 * 0.995 + 0.03)
  // Chance 0.5 from one falloff out.
  const g = { distance: 2000, transversal: 0, targetSpeed: 0, targetSig: 100, receding: 0 }
  const f = application(gun({ optimal: 1000, falloff: 1000 }), g).factor
  close(f, 0.49 * ((0.01 + 0.5) / 2 + 0.49) + 0.03)
})

test('sentries are guns: range and tracking count, flying drones ignore them', () => {
  // Garde II as the engine reports it.
  const garde = gun({ kind: 'drone', optimal: 30937.5, falloff: 30000, tracking: 0.0462, speed: 1.25e-5 })
  assert.equal(isSentry(garde), true)
  const far = { distance: 150000, transversal: 0, targetSpeed: 0, targetSig: 35, receding: 0 }
  // (119062.5/30000)² ≈ 15.75 half-lives.
  assert.ok(application(garde, far).factor < 0.001)
  assert.equal(application(garde, far).limit, 'фоллоф')
  const near = { distance: 3000, transversal: 400, targetSpeed: 400, targetSig: 35, receding: 0 }
  const up = application(garde, near)
  // Tracks a frigate badly at 3 km, but it's a tracking problem, not "the target outran the drones".
  assert.equal(up.limit, 'наводка')
  assert.notEqual(up.limit, 'цель быстрее дронов')
  // In its optimal at a still target: full.
  close(application(garde, { distance: 20000, transversal: 0, targetSpeed: 0, targetSig: 35, receding: 0 }).factor, FULL)

  const ogre = gun({ kind: 'drone', speed: 2000 })
  assert.equal(isSentry(ogre), false)
  close(application(ogre, far).factor, FULL)
  assert.equal(application(ogre, { ...far, targetSpeed: 2500 }).factor, 0)
})

test('webs stack with the penalty, strongest first', () => {
  const web = (s) => ({ typeId: 1, t: { kind: 'web', strength: s, range: 10000, falloff: 0 } })
  close(stackedMultiplier([web(-60)], 'web', 5000), 0.4)
  // Second web at e^-(1/2.67)² ≈ 0.869.
  close(stackedMultiplier([web(-60), web(-60)], 'web', 5000), 0.4 * (1 - 0.6 * Math.exp(-((1 / 2.67) ** 2))))
  assert.equal(stackedMultiplier([web(-60)], 'web', 20000), 1)
})

test('damage spills to the next layer in that layer’s terms', () => {
  const c = { shield: layer(100, 0.5), armor: layer(100, 0), hull: layer(100, 0) }
  const s = { shield: 100, armor: 100, hull: 100 }
  // 300 raw at 50% is 150 on the shield: 100 stops it, a third of the raw damage carries on, 100 on the armor.
  const dealt = applyDamage(s, c, [300, 0, 0, 0])
  assert.equal(s.shield, 0)
  close(s.armor, 0)
  close(s.hull, 100)
  close(dealt, 200)
})

test('the recharge curve: nothing when full, comes back from empty, peak at 25%', () => {
  assert.equal(recharge(100, 100, 100, 1), 100)
  assert.ok(recharge(0, 100, 100, 1) > 0)
  // 10·C/τ·(√s − s) at 25%: 2.5 per second for C = τ.
  close(recharge(25, 100, 100, 0.001) - 25, 2.5 * 0.001, 1e-5)
})

// ---------- The fight

test('volleys come at the start of each cycle: a 100 HP hull takes ten of them', () => {
  const r = run(ship({ weapons: [gun()] }), ship({ hull: layer(100) }))
  // 10.15 a shot: 9.85 shots, the tenth at t = 9.
  assert.equal(r.winner, 'a')
  close(r.end, 9, 0.21)
  assert.equal(r.b.dead, r.end)
  assert.ok(r.events.some((e) => e.kind === 'dead' && e.side === 'b'))
})

test('reload: a load of 2 fires at 0 and 1, then waits out the reload', () => {
  const r = run(ship({ weapons: [gun({ shots: 2, reloadSec: 5 })] }), ship({ hull: layer(35) }))
  // 2 shots by t=1, the next at 1 + 1 + 5 = 7, the fourth at 8.
  close(r.end, 8, 0.21)
  assert.ok(r.events.some((e) => e.kind === 'reload'))
})

test('spool: each cycle adds its step up to the top', () => {
  const r = run(ship({ weapons: [gun({ spoolMax: 2, spoolPerCycle: 1 })] }), ship({ hull: layer(100000) }), {}, {}, 1000)
  // ×1, ×2, ×3, ×3…: 10, 20, 30, 30 per second at full application.
  const dealt = r.series.slice(1, 5).map((p) => p.a.dealt / FULL)
  close(dealt[0], 20, 1e-6)
  close(dealt[1], 30, 1e-6)
  close(dealt[2], 30, 1e-6)
})

test('a weapon out of capacitor stops, and says so', () => {
  const r = run(ship({ weapons: [gun({ need: 40 })], capacity: 100 }), ship({ hull: layer(100000) }))
  // Two shots paid for, the capacitor doesn't come back: 2 volleys in the whole fight.
  close(r.a.dealt, 20 * FULL)
  assert.ok(r.events.some((e) => e.kind === 'capEmpty' && e.side === 'a'))
  assert.equal(r.winner, null)
  assert.equal(r.end, TIMELINE_MAX_SEC)
})

test('a fleeing ship really leaves: the guns fall silent and nobody dies', () => {
  const short = gun({ optimal: 5000, falloff: 0 })
  const r = run(ship({ weapons: [short] }), ship({ hull: layer(1e6), off: { maxVelocity: 2000, signature: 100, alignSec: 1 } }), {}, { behavior: 'flee', speed: 2000 }, 4000)
  assert.equal(r.winner, null)
  assert.ok(r.events.some((e) => e.kind === 'lostRange' && e.side === 'a'))
  // Only about the first second had it in range.
  assert.ok(r.a.dealt < 40, `dealt ${r.a.dealt}`)
  // Nothing can reach anything any more: the fight ends a minute later rather than running out the clock.
  assert.ok(r.end < 70, `end ${r.end}`)
})

test('inertia: top speed is reached along the game’s curve', () => {
  const r = run(ship(), ship({ hull: layer(1e6), off: { maxVelocity: 100, signature: 100, alignSec: 10 } }), {}, { behavior: 'flee', speed: 100 })
  const at = (t) => r.series.find((p) => p.t >= t).b.v
  // 75% of top at the align time, by the definition of align.
  close(at(10), 75, 3)
  assert.ok(at(60) > 99)
})

test('orbit holds its range, keep-at-range settles, approach closes and stops', () => {
  const fast = { maxVelocity: 300, signature: 100, alignSec: 2 }
  const target = ship({ hull: layer(1e6) })
  const orbit = run(target, ship({ hull: layer(1e6), off: fast }), {}, { behavior: 'orbit', range: 5000, speed: 300, heading: 90 }, 8000)
  const late = orbit.series.filter((p) => p.t > 120)
  assert.ok(late.every((p) => Math.abs(p.distance - 5000) < 400), `orbit ${late[0].distance}`)
  assert.ok(late.every((p) => p.transversal > 200))
  const keep = run(target, ship({ hull: layer(1e6), off: fast }), {}, { behavior: 'keep', range: 5000, speed: 300 }, 20000)
  close(keep.series.at(-1).distance, 5000, 200)
  const near = run(target, ship({ hull: layer(1e6), off: fast }), {}, { behavior: 'approach', range: 1000, speed: 300 }, 20000)
  close(near.series.at(-1).distance, 1000, 200)
  // Approach doesn't back off from something already closer.
  const inside = run(target, ship({ hull: layer(1e6), off: fast }), {}, { behavior: 'approach', range: 5000, speed: 300 }, 1000)
  close(inside.series.at(-1).distance, 1000, 1)
})

test('a web holds a ship back only within reach', () => {
  const web = { index: 1, typeId: 1, t: { kind: 'web', strength: -50, range: 10000, falloff: 0 } }
  const webber = ship({ tactical: [web], modules: [{ index: 1, need: 0, cycle: 5 }] })
  const runner = ship({ hull: layer(1e6), off: { maxVelocity: 100, signature: 100, alignSec: 1 } })
  const inside = run(webber, runner, {}, { behavior: 'orbit', range: 5000, speed: 100, heading: 90 }, 5000)
  close(inside.series.at(-1).b.v, 50, 2)
  const off = run(webber, runner, { useEwar: false }, { behavior: 'orbit', range: 5000, speed: 100, heading: 90 }, 5000)
  close(off.series.at(-1).b.v, 100, 2)
})

test('a scrambler switches a microwarpdrive off, not an afterburner', () => {
  const scram = { index: 1, typeId: 1, t: { kind: 'scram', strength: 2, range: 10000 } }
  const tackler = ship({ tactical: [scram], modules: [{ index: 1, need: 0, cycle: 5 }] })
  const runner = (kind) =>
    ship({ hull: layer(1e6), capacity: 1e6, off: { maxVelocity: 100, signature: 100, alignSec: 1 }, on: { index: 2, kind, need: 0, cycle: 10, maxVelocity: 1000, signature: 500, alignSec: 1 } })
  const orbit = { behavior: 'orbit', range: 5000, speed: 1000, heading: 90, wantProp: true }
  const mwd = run(tackler, runner('mwd'), {}, orbit, 5000)
  close(mwd.series.at(-1).b.v, 100, 3)
  assert.ok(mwd.events.some((e) => e.kind === 'propBlocked' && e.side === 'b'))
  const ab = run(tackler, runner('ab'), {}, orbit, 5000)
  // A little under top speed: a ship in a tight turn is slower than flying straight.
  close(ab.series.at(-1).b.v, 1000, 20)
})

test('neuts drain the capacitor and that ends an active tank', () => {
  // 30 HP/s of repairs at 30 cap a cycle hold 20 DPS off forever while the capacitor lasts.
  const tanker = () =>
    ship({
      armor: layer(200),
      hull: layer(100),
      capacity: 1000,
      capRechargeSec: 1000,
      repairers: [{ index: 1, layer: 'armor', amount: 30, cycle: 1, need: 1 }]
    })
  const shooter = ship({ weapons: [gun({ cycle: 1, damage: [20, 0, 0, 0] })] })
  const without = run(shooter, tanker())
  assert.equal(without.winner, null)
  const neut = { index: 5, typeId: 1, t: { kind: 'neut', amount: 500, range: 10000, falloff: 0, cycle: 5 } }
  const withNeut = run(ship({ weapons: shooter.weapons, tactical: [neut], modules: [{ index: 5, need: 0, cycle: 5 }] }), tanker())
  assert.equal(withNeut.winner, 'a')
  assert.ok(withNeut.events.some((e) => e.kind === 'capEmpty' && e.side === 'b'))
  // Out of neut range it does nothing.
  const far = { ...neut, t: { ...neut.t, range: 100 } }
  const outOfReach = run(ship({ weapons: shooter.weapons, tactical: [far], modules: [{ index: 5, need: 0, cycle: 5 }] }), tanker())
  assert.equal(outOfReach.winner, null)
  // A resistant target takes half.
  const half = { ...tanker(), neutResist: 0.5 }
  const a = runTimeline(ship({ tactical: [neut], modules: [{ index: 5, need: 0, cycle: 5 }] }), half, orders(), orders(), 1000)
  close(a.series[0].b.c, 0.75, 0.001)
})

test('a nosferatu takes only from a fuller capacitor', () => {
  const nos = { index: 5, typeId: 1, t: { kind: 'nos', amount: 50, range: 10000, falloff: 0, cycle: 5 } }
  const mine = (cap) => ship({ capacity: cap, tactical: [nos], modules: [{ index: 5, need: 0, cycle: 5 }] })
  const full = run(mine(100), ship({ capacity: 100 }))
  assert.equal(full.series[0].b.c, 1)
})

test('an ancillary booster runs dry: it holds, then reloads while the shield falls', () => {
  const asb = ship({ shield: layer(100), armor: layer(0), hull: layer(1), shieldRechargeSec: 0, repairers: [{ index: 1, layer: 'shield', amount: 30, cycle: 1, need: 0, shots: 3, reloadSec: 60 }] })
  const shooter = ship({ weapons: [gun({ damage: [30, 0, 0, 0] })] })
  const r = run(shooter, asb)
  assert.ok(r.events.some((e) => e.kind === 'repReload'))
  // 3 boosts undo 3 volleys, then 30.45 a second against 100 + ~4.5 lost: about 3 + 3 s to strip.
  assert.equal(r.winner, 'a')
  assert.ok(r.end > 5 && r.end < 12, `end ${r.end}`)
})

test('a repairer rests at full health, so its capacitor is not spent', () => {
  const r = run(ship(), ship({ armor: layer(100), repairers: [{ index: 1, layer: 'armor', amount: 10, cycle: 1, need: 5 }] }))
  assert.equal(r.series.at(-1).b.c, 1)
})

test('armor repairs land at the end of the cycle, shield boosts at the start', () => {
  const armor = run(ship({ weapons: [gun({ cycle: 100 })] }), ship({ armor: layer(100), hull: layer(100), repairers: [{ index: 1, layer: 'armor', amount: 5, cycle: 2, need: 0 }] }))
  const pts = armor.series
  // Hit once at 0 for about 10; nothing back before the cycle ends at 2.
  close(pts[1].b.a, 1 - 10 * FULL / 100, 1e-9)
  close(pts[3].b.a, 1 - (10 * FULL - 5) / 100, 1e-9)
})

test('both dying in one instant is both', () => {
  const r = run(ship({ weapons: [gun()], hull: layer(5) }), ship({ weapons: [gun()], hull: layer(5) }))
  assert.equal(r.winner, 'both')
  assert.equal(r.end, 0)
})

test('mobile drones spend the flight before their first bite, sentries do not', () => {
  const drone = gun({ kind: 'drone', speed: 1000, optimal: 0, falloff: 0 })
  const r = run(ship({ weapons: [drone] }), ship({ hull: layer(1e6) }), {}, {}, 5000)
  assert.equal(r.series[1].a.dealt, 0)
  assert.ok(r.series[6].a.dealt > 0)
  const sentry = gun({ kind: 'drone', speed: 1e-5 })
  const s = run(ship({ weapons: [sentry] }), ship({ hull: layer(1e6) }), {}, {}, 5000)
  assert.ok(s.series[0].a.dealt > 0)
})

test('the same setup always gives the same fight', () => {
  const make = () => run(ship({ weapons: [gun()] }), ship({ hull: layer(50), weapons: [gun()] }))
  assert.deepEqual(make(), make())
})

test('a shot with almost no chance is not fired: far in falloff the guns hold, and keep their ammo', () => {
  const g = gun({ optimal: 1000, falloff: 1000, shots: 2, reloadSec: 5 })
  // At 20 km: (19000/1000)² half-lives, a chance of practically nothing but not quite zero.
  const r = run(ship({ weapons: [g] }), ship({ hull: layer(1e6) }), {}, {}, 20000)
  assert.equal(r.a.dealt, 0)
  assert.ok(!r.events.some((e) => e.kind === 'reload'))
})

test('a fight where one side can still reach goes on', () => {
  const long = gun({ optimal: 1e7, falloff: 0 })
  const short = gun({ optimal: 100, falloff: 0 })
  const r = run(ship({ weapons: [short], hull: layer(1e7) }), ship({ weapons: [long], hull: layer(1e7) }), {}, {}, 5000)
  assert.equal(r.end, TIMELINE_MAX_SEC)
})

test('a layer falls once in the record, even if a repair brings it back for a moment', () => {
  const tank = ship({ armor: layer(50), hull: layer(200), repairers: [{ index: 1, layer: 'armor', amount: 20, cycle: 3, need: 0 }] })
  const r = run(ship({ weapons: [gun({ damage: [25, 0, 0, 0] })] }), tank)
  assert.equal(r.events.filter((e) => e.kind === 'armorDown').length, 1)
  assert.equal(r.winner, 'a')
})

// ---------- Reactive Armor Hardener
// Damage and resonances are in the order em, thermal, kinetic, explosive. A resonance of 0.85 is 15% resist.

const near = (a, b) => a.forEach((v, i) => close(v, b[i], 1e-9))
const START = [0.85, 0.85, 0.85, 0.85]

test('RAH: no damage in a cycle, no change', () => {
  near(adaptRah(START, [0, 0, 0, 0], 0.06), START)
})

test('RAH: four types: the two least hit give 6% each, the two most hit share it', () => {
  // Thermal 40, kinetic 30 are the most hit; explosive 20 and em 10 give.
  near(adaptRah(START, [10, 40, 30, 20], 0.06), [0.91, 0.79, 0.79, 0.91])
})

test('RAH: a type can only give what it has: its resonance stops at 1', () => {
  near(adaptRah([0.98, 0.7, 0.72, 1], [1, 40, 30, 2], 0.06), [1, 0.69, 0.71, 1])
})

test('RAH: three types: the same rule, the untouched one is simply the least hit', () => {
  near(adaptRah(START, [0, 40, 30, 20], 0.06), [0.91, 0.79, 0.79, 0.91])
})

test('RAH: damage taken decides, not the raw order: ties go em, explosive, kinetic, thermal', () => {
  near(adaptRah(START, [10, 10, 10, 10], 0.06), [0.91, 0.79, 0.79, 0.91])
})

test('RAH: one type: everything drifts to it and settles at 60% there, 0% elsewhere', () => {
  let v = START
  v = adaptRah(v, [0, 0, 100, 0], 0.06)
  near(v, [0.91, 0.91, 0.67, 0.91])
  v = adaptRah(v, [0, 0, 100, 0], 0.06)
  near(v, [0.97, 0.97, 0.49, 0.97])
  v = adaptRah(v, [0, 0, 100, 0], 0.06)
  near(v, [1, 1, 0.4, 1])
  near(adaptRah(v, [0, 0, 100, 0], 0.06), [1, 1, 0.4, 1])
})

test('RAH: two types: the rest goes to them equally, settling at 30% each', () => {
  let v = START
  for (let i = 0; i < 5; i++) v = adaptRah(v, [0, 60, 40, 0], 0.06)
  near(v, [1, 0.7, 0.7, 1])
})

test('RAH: the total of 60% never changes', () => {
  let v = START
  const hits = [[10, 40, 30, 20], [0, 0, 100, 0], [50, 0, 0, 50], [1, 2, 3, 4]]
  for (let i = 0; i < 40; i++) {
    v = adaptRah(v, hits[i % 4], 0.06)
    close(v.reduce((a, b) => a + b, 0), 3.4, 1e-9)
    assert.ok(v.every((x) => x <= 1 + 1e-9 && x > 0))
  }
})

test('RAH: its resist goes through the stacking penalty with its peers', () => {
  const rah = { rest: [1, 1, 1, 0.5], peers: [[], [0.8], [], []], index: 3, cycle: 10, shift: 0.06, start: START }
  // Alone: 0.4 on kinetic is 60%.
  close(rahResist(rah, [1, 1, 0.4, 1])[2], 0.6)
  // With a peer of 0.8, the stronger comes first and the weaker takes the penalty: 0.6 × (1 − 0.2·e^-(1/2.67)²)
  close(rahResist(rah, [1, 0.6, 1, 1])[1], 1 - 0.6 * (1 - 0.2 * Math.exp(-((1 / 2.67) ** 2))))
  // The unpenalised rest multiplies on top.
  close(rahResist(rah, [1, 1, 1, 0.85])[3], 1 - 0.5 * 0.85)
})

const rahShip = (o = {}) =>
  ship({
    armor: layer(1e6),
    hull: layer(100),
    capacity: 1e6,
    modules: [{ index: 3, need: 0, cycle: 10 }],
    rah: { index: 3, cycle: 10, shift: 0.06, start: START, rest: [1, 1, 1, 1], peers: [[], [], [], []] },
    ...o
  })
const kinetic = ship({ weapons: [gun({ damage: [0, 0, 100, 0], cycle: 1 })] })

test('in a fight: a RAH under kinetic fire takes less each cycle, down to 40% of the damage', () => {
  const r = run(kinetic, rahShip())
  const taken = (t) => r.series.find((p) => p.t >= t).a.dealt / FULL
  close(taken(5), 85, 1e-6) // 15%
  close(taken(15), 67, 1e-6) // after one cycle
  close(taken(25), 49, 1e-6)
  close(taken(35), 40, 1e-6) // settled
  close(taken(200), 40, 1e-6)
  assert.deepEqual(r.b.armorResist.map((x) => Math.round(x * 100)), [0, 0, 60, 0])
})

test('in a fight: a RAH does not stir while only the shield is hit', () => {
  const r = run(kinetic, rahShip({ shield: layer(1e6) }))
  close(r.b.armorResist[0], 0.15)
  close(r.b.armorResist[2], 0.15)
})

test('in a fight: a RAH without capacitor gives nothing, and starts over from 15% when it can run again', () => {
  // The neut empties the capacitor at the start; recharge is off, so it never runs at all after the first cycle.
  const poor = rahShip({ capacity: 10, modules: [{ index: 3, need: 10, cycle: 10 }] })
  const r = run(kinetic, poor)
  // First cycle paid: 15%, 85 a volley; next cycle can't be paid: no bonus.
  close(r.series.find((p) => p.t >= 5).a.dealt / FULL, 85, 1e-6)
  close(r.series.find((p) => p.t >= 15).a.dealt / FULL, 100, 1e-6)
  assert.ok(r.events.some((e) => e.kind === 'capEmpty' && e.side === 'b'))
  // With recharge it returns to the base split and adapts from there.
  const back = rahShip({ capacity: 10, capRechargeSec: 200, modules: [{ index: 3, need: 8, cycle: 10 }] })
  const again = run(kinetic, back)
  const low = again.series.filter((p) => p.t > 15).map((p) => p.a.dealt / FULL)
  assert.ok(low.includes(100) && low.some((v) => v < 100), 'off, then on again')
})

test('a ship with no RAH keeps its armor resists as they are', () => {
  const r = run(kinetic, ship({ armor: layer(1e6, 0.5), hull: layer(100) }))
  close(r.series.find((p) => p.t >= 15).a.dealt / FULL, 50, 1e-6)
  assert.equal(r.b.armorResist, undefined)
})

// ---------- Holding an orbit: within a kilometre of what was asked, once there

const craft = (v, align) => ship({ hull: layer(1e9), off: { maxVelocity: v, signature: 100, alignSec: align } })
const orbitFight = (va, aa, vb, ab, range, start = range, headings = [90, 90]) =>
  runTimeline(
    craft(va, aa),
    craft(vb, ab),
    orders({ behavior: 'orbit', range, speed: va, heading: headings[0] }),
    orders({ behavior: 'orbit', range, speed: vb, heading: headings[1] }),
    start
  )
const worstAfter = (r, range, t) => Math.max(...r.series.filter((p) => p.t >= t).map((p) => Math.abs(p.distance - range)))

test('orbit: the fight on the screenshot, 225 and 1036 m/s at 21.1 km', () => {
  const r = orbitFight(225, 8, 1036, 11, 21100)
  assert.ok(worstAfter(r, 21100, 0) <= 1000, `off by ${worstAfter(r, 21100, 0)}`)
})

for (const [va, aa, vb, ab, range] of [
  [225, 8, 1036, 11, 5000],
  [225, 8, 1036, 11, 10000],
  [225, 8, 1036, 11, 40000],
  [150, 20, 150, 20, 30000],
  [400, 5, 3000, 4, 10000],
  [1500, 3, 1500, 3, 5000],
  [2500, 2, 2500, 2, 12000],
  [0, 10, 300, 6, 1000],
  [100, 30, 90, 30, 60000]
]) {
  test(`orbit holds: ${va} and ${vb} m/s at ${range / 1000} km`, () => {
    const r = orbitFight(va, aa, vb, ab, range)
    assert.ok(worstAfter(r, range, 0) <= 1000, `off by ${Math.round(worstAfter(r, range, 0))}`)
    // Turning, not parked: it is an orbit.
    assert.ok(r.series.at(-1).transversal > 0)
  })
}

test('orbit: from far off it comes in and then holds; opposite turns too', () => {
  const r = orbitFight(225, 8, 1036, 11, 10000, 40000)
  assert.ok(worstAfter(r, 10000, 120) <= 1000, `off by ${Math.round(worstAfter(r, 10000, 120))}`)
  const opposite = orbitFight(225, 8, 1036, 11, 21100, 21100, [90, 270])
  assert.ok(worstAfter(opposite, 21100, 0) <= 1000, `off by ${Math.round(worstAfter(opposite, 21100, 0))}`)
})

test('orbit: a web mid-way does not throw it off', () => {
  const web = { index: 1, typeId: 1, t: { kind: 'web', strength: -60, range: 30000, falloff: 0 } }
  const r = runTimeline(
    ship({ hull: layer(1e9), tactical: [web], modules: [{ index: 1, need: 0, cycle: 5 }], off: { maxVelocity: 225, signature: 100, alignSec: 8 } }),
    craft(1036, 11),
    orders({ behavior: 'orbit', range: 21100, speed: 225, heading: 90 }),
    orders({ behavior: 'orbit', range: 21100, speed: 1036, heading: 90 }),
    21100
  )
  assert.ok(worstAfter(r, 21100, 0) <= 1000, `off by ${Math.round(worstAfter(r, 21100, 0))}`)
})

// ---------- How much of a side's firepower sat idle, and when a win leans on that

test('the idle share: how much of the paper damage was out of reach, and the average dealt', () => {
  const missile = gun({ kind: 'missile', dps: 300, damage: [300, 0, 0, 0], optimal: 5000, missileVelocity: 1000, explosionRadius: 1, explosionVelocity: 1e6 })
  const drone = gun({ kind: 'drone', dps: 100, damage: [100, 0, 0, 0], speed: 2000 })
  const r = run(ship({ weapons: [missile, drone], hull: layer(1e6) }), ship({ hull: layer(1e7) }), {}, {}, 20000)
  close(r.a.idle, 0.75, 0.01)
  const near = run(ship({ weapons: [missile, drone], hull: layer(1e6) }), ship({ hull: layer(1e7) }), {}, {}, 2000)
  close(near.a.idle, 0, 0.001)
  assert.ok(near.a.averageDps > 300)
})

test('a win leans on the opponent staying away only when it wins and they sit idle', () => {
  const tl = (winner, idle) => ({ winner, b: { idle } })
  assert.equal(dependsOnStayingAway(tl('a', 0.84)), true)
  assert.equal(dependsOnStayingAway(tl('a', 0.1)), false)
  assert.equal(dependsOnStayingAway(tl('b', 0.84)), false)
  assert.equal(dependsOnStayingAway(tl(null, 0.84)), true)
})

test('orbit: too tight for the ship to turn, it swings wider than asked but stays near, as in the game', () => {
  // Turning radius is speed × inertia: 2500 m/s with a 2 s align can't hold 2.5 km.
  const r = orbitFight(2500, 2, 2500, 2, 2500)
  const far = Math.max(...r.series.map((p) => p.distance))
  assert.ok(far < 15000, `drifted to ${Math.round(far)}`)
})

test('orbit: a fast ship in a tight orbit does not pull itself into the target', () => {
  // As the engine gives a Cyclone Fleet Issue: 1070 m/s, an align of about 10 s, against one the same or slower.
  for (const [va, aa] of [[1070, 10], [225, 8], [150, 16]]) {
    for (const range of [2500, 5000, 10000]) {
      const r = orbitFight(va, aa, 1070, 10, range)
      assert.ok(worstAfter(r, range, 0) <= 1000, `${va}@${range} off by ${Math.round(worstAfter(r, range, 0))}`)
    }
  }
})

test('approach: a heavy ship runs at full speed and brakes only when it must', () => {
  // A battlecruiser under a 100MN afterburner: 1070 m/s, an align of 56 s (τ ≈ 40 s).
  const heavy = (behavior) =>
    runTimeline(
      ship({ hull: layer(1e9) }),
      craft(1070, 56),
      orders(),
      orders({ behavior, range: 1000, speed: 1070 }),
      40000
    )
  for (const behavior of ['approach', 'keep']) {
    const r = heavy(behavior)
    const at = (t) => r.series.find((p) => p.t >= t)
    // v = V(1 − e^(−t/τ)) while it accelerates: 20 s gives about 39% of top speed.
    close(at(20).b.v, 1070 * (1 - Math.exp(-20 / (56 / Math.log(4)))), 30)
    // And it gets there and stops.
    close(r.series.at(-1).distance, 1000, 1000)
    assert.ok(r.series.at(-1).b.v < 50, `still ${r.series.at(-1).b.v}`)
  }
})

test('approach: closes on a slower ship running away at its top speed difference', () => {
  const r = runTimeline(craft(225, 8), craft(1070, 11), orders({ behavior: 'flee', speed: 225 }), orders({ behavior: 'approach', range: 1000, speed: 1070 }), 21000)
  // 845 m/s of closing: well inside 40 s from 21 km, then matches its speed.
  close(r.series.find((p) => p.t >= 60).distance, 1000, 1000)
  close(r.series.find((p) => p.t >= 120).b.v, 225, 20)
})

test('the replay: every point knows where the ships were, and it agrees with the distance', () => {
  const r = runTimeline(craft(300, 5), craft(1000, 8), orders({ behavior: 'orbit', range: 8000, speed: 300 }), orders({ behavior: 'orbit', range: 8000, speed: 1000 }), 8000)
  assert.ok(r.series.length > 10)
  for (const p of r.series) close(Math.hypot(p.pos.bx - p.pos.ax, p.pos.by - p.pos.ay), p.distance, 1e-6)
  // They do move.
  const first = r.series[0].pos
  const last = r.series.at(-1).pos
  assert.ok(Math.hypot(last.bx - first.bx, last.by - first.by) > 100)
})

test('the replay: a moment between two points is in between them', () => {
  const series = [
    { t: 0, distance: 1000, transversal: 0, pos: { ax: 0, ay: 0, bx: 1000, by: 0 }, a: { s: 1, a: 1, h: 1, c: 1, v: 0, dealt: 0 }, b: { s: 1, a: 1, h: 1, c: 1, v: 0, dealt: 7 } },
    { t: 2, distance: 3000, transversal: 0, pos: { ax: 100, ay: 0, bx: 3100, by: 0 }, a: { s: 0, a: 1, h: 1, c: 0.5, v: 10, dealt: 5 }, b: { s: 1, a: 1, h: 1, c: 1, v: 0, dealt: 9 } }
  ]
  const m = frameAt(series, 1)
  close(m.distance, 2000)
  close(m.pos.ax, 50)
  close(m.a.s, 0.5)
  close(m.a.c, 0.75)
  // Damage is what happened in that second, not a blend.
  assert.equal(m.a.dealt, 5)
  assert.equal(frameAt(series, -5).t, 0)
  assert.equal(frameAt(series, 99).t, 2)
  assert.equal(frameAt([series[0]], 1).t, 0)
})

// ---------- Assault damage control

// Hull resonance ×0.25 while it runs: 75% less damage on the hull, for 5 s, then 100 s before it can go again.
const adc = (o = {}) => ({ index: 9, need: 10, duration: 5, delay: 100, mult: { shield: [1, 1, 1, 1], armor: [1, 1, 1, 1], hull: [0.25, 0.25, 0.25, 0.25] }, ...o })

test('assault damage control: off at first, on once half the ship is gone, only for its duration', () => {
  // 10 a second into a 100 HP hull: dead after ten volleys without it.
  const plain = run(ship({ weapons: [gun()] }), ship())
  assert.equal(plain.b.dead, 9)
  const r = run(ship({ weapons: [gun()] }), ship({ adc: adc() }))
  const on = r.events.filter((e) => e.kind === 'adcOn')
  assert.equal(on.length, 1)
  assert.equal(r.events.find((e) => e.kind === 'adcOn').side, 'b')
  // Half gone after the volley at 4 s; on from the next step, five volleys at a quarter, then full damage again.
  close(on[0].t, 4.2, 1e-6)
  assert.equal(r.b.dead, 13)
})

test('assault damage control: not a resist for the whole fight', () => {
  // A long fight: it can only have run once in 100 s, so the ship falls about as fast as without it.
  const tough = ship({ hull: layer(1000) })
  const plain = run(ship({ weapons: [gun()] }), tough)
  const r = run(ship({ weapons: [gun()] }), { ...tough, adc: adc() })
  // Five volleys at a quarter: 37.5 saved, four more volleys to make it up.
  close(r.b.dead - plain.b.dead, 4, 0.5)
  assert.equal(r.events.filter((e) => e.kind === 'adcOn').length, 1)
})

test('assault damage control: without capacitor it does not start', () => {
  const r = run(ship({ weapons: [gun()] }), ship({ capacity: 5, adc: adc() }))
  assert.equal(r.events.some((e) => e.kind === 'adcOn'), false)
  assert.equal(r.b.dead, 9)
})
