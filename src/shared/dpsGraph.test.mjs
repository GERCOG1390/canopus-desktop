import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appliedAt, curveAlong, distanceTicks, dpsCurve, effectiveRange, graphReach } from './dpsGraph.ts'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)
const still = { sig: 100_000, speed: 0, angle: 90, ownEwar: false }

function fit({ weapons = [], modules = [], droneControlRange = 70_000 } = {}) {
  return { offense: { weapons }, modules, targeting: { droneControlRange } }
}
const gun = { kind: 'turret', dps: 100, optimal: 10_000, falloff: 5_000, tracking: 50, damage: [0, 0, 0, 0], cycle: 1 }
const missile = { kind: 'missile', dps: 100, optimal: 40_000, missileVelocity: 4_000, explosionRadius: 100, explosionVelocity: 100, drf: 0.5, damage: [0, 0, 0, 0], cycle: 1 }
const drone = { kind: 'drone', dps: 50, speed: 3_000, damage: [0, 0, 0, 0], cycle: 1 }

// A still target: only range counts. Turrets land (in average, with wrecking shots) about 100% within optimal,
// half the hit chance one falloff out (the hits that land then graze, so about 40% of the damage).
test('a turret against a still target: full in optimal, the falloff curve beyond', () => {
  const inside = appliedAt(fit({ weapons: [gun] }), still, 5_000).dps
  assert.ok(inside > 101 && inside < 102, `${inside}`) // 1% wrecking shots at 3x lift it a little over 100%
  const falloff = appliedAt(fit({ weapons: [gun] }), still, 15_000).dps
  assert.ok(falloff > 39 && falloff < 40, `${falloff}`) // a 50% chance, and the hits that land are weaker: 39.5%
  assert.ok(appliedAt(fit({ weapons: [gun] }), still, 40_000).dps < 0.1)
})

test('a missile lands in full to its flight range and nothing past it', () => {
  close(appliedAt(fit({ weapons: [missile] }), still, 39_000).dps, 100)
  close(appliedAt(fit({ weapons: [missile] }), still, 41_000).dps, 0)
})

test('a target flying straight away outruns missiles sooner', () => {
  const away = { sig: 100_000, speed: 1_000, angle: 0, ownEwar: false }
  close(appliedAt(fit({ weapons: [missile] }), away, 35_000).dps, 0)
  close(appliedAt(fit({ weapons: [missile] }), away, 25_000).dps, 100)
})

test('drones stop past drone control range', () => {
  assert.ok(appliedAt(fit({ weapons: [drone] }), still, 60_000).dps > 0)
  close(appliedAt(fit({ weapons: [drone] }), still, 80_000).dps, 0)
})

test("the fit's own web slows the target only within its reach", () => {
  const web = { index: 0, cpu: 0, power: 0, capPerSecond: 0, cycle: 5, problems: [], tactical: { kind: 'web', strength: -60, range: 10_000, falloff: 0 } }
  const t = { sig: 40, speed: 1_000, angle: 90, ownEwar: true }
  const near = appliedAt(fit({ weapons: [missile], modules: [web] }), t, 9_000)
  const far = appliedAt(fit({ weapons: [missile], modules: [web] }), t, 11_000)
  close(near.speed, 400)
  close(far.speed, 1_000)
  assert.ok(near.dps > far.dps)
  close(appliedAt(fit({ weapons: [missile], modules: [web] }), { ...t, ownEwar: false }, 9_000).speed, 1_000)
})

test('the graph reaches past the longest weapon, and the useful range is where half the best still lands', () => {
  const s = fit({ weapons: [missile] })
  const reach = graphReach([s])
  assert.ok(reach >= 40_000 && reach <= 50_000, `${reach}`)
  const curve = dpsCurve(s, still, reach, 100)
  const r = effectiveRange(curve)
  assert.ok(r >= 39_000 && r <= 40_000, `${r}`)
  assert.equal(effectiveRange(dpsCurve(fit(), still, reach, 10)), 0)
})

test('damage is split by weapon kind', () => {
  const p = appliedAt(fit({ weapons: [gun, drone] }), still, 5_000)
  assert.ok(p.byKind.turret > 99)
  close(p.byKind.drone, p.dps - p.byKind.turret)
})

// Review 2026-11-15: marks every 14 km read badly.
test('distance marks fall on round kilometres', () => {
  assert.deepEqual(distanceTicks(70_000), [0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000])
  assert.deepEqual(distanceTicks(45_000), [0, 10_000, 20_000, 30_000, 40_000])
})

// Review 2026-11-15: the shooter's own speed was left out; Pyfa has it.
test("a shooter flying alongside the target cancels its transversal", () => {
  const t = { sig: 130, speed: 1_000, angle: 90, ownEwar: false }
  const alone = appliedAt(fit({ weapons: [gun] }), t, 5_000).dps
  const alongside = appliedAt(fit({ weapons: [gun] }), { ...t, shooterSpeed: 1_000, shooterAngle: 90 }, 5_000).dps
  assert.ok(alongside > 99 && alone < alongside, `${alone} < ${alongside}`)
})

test('a shooter chasing a target that flies away keeps its missiles in reach', () => {
  const away = { sig: 100_000, speed: 1_000, angle: 0, ownEwar: false }
  close(appliedAt(fit({ weapons: [missile] }), away, 35_000).dps, 0)
  close(appliedAt(fit({ weapons: [missile] }), { ...away, shooterSpeed: 1_000, shooterAngle: 0 }, 35_000).dps, 100)
})

test('the graph can run along the target speed or signature at one distance', () => {
  const t = { sig: 40, speed: 0, angle: 90, ownEwar: false }
  const bySpeed = curveAlong(fit({ weapons: [missile] }), t, 'speed', 2_000, 10_000, 20)
  assert.equal(bySpeed[0].x, 0)
  assert.ok(bySpeed[0].dps >= bySpeed[20].dps)
  const bySig = curveAlong(fit({ weapons: [missile] }), t, 'sig', 400, 10_000, 20)
  assert.ok(bySig[20].dps >= bySig[1].dps)
})
