import assert from 'node:assert/strict'
import { test } from 'node:test'
import { missileApplication } from './missileApplication.ts'

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)
// Scourge Rage Heavy Assault Missile with all skills at V, as the engine gives it.
const ham = { radius: 161.25, velocity: 130.5, drf: 0.92 }

test('a fast frigate shrugs off a heavy assault missile: the speed term decides', () => {
  const r = missileApplication({ ...ham, sig: 40, speed: 400 })
  close(r.size, 40 / 161.25)
  close(r.speedBase, (40 * 130.5) / (161.25 * 400))
  close(r.speedTerm, ((40 * 130.5) / (161.25 * 400)) ** 0.92)
  close(r.factor, r.speedTerm)
  assert.equal(r.limit, 'speed')
})

test('the picture is the formula: the speed term is the signature over how far the target gets while the blast grows', () => {
  const r = missileApplication({ ...ham, sig: 40, speed: 400 })
  close(r.growSec, 161.25 / 130.5)
  close(r.shift, 400 * r.growSec)
  close(r.speedBase, 40 / r.shift)
})

test('a still target is held back only by its size', () => {
  const r = missileApplication({ ...ham, sig: 40, speed: 0 })
  assert.equal(r.shift, 0)
  assert.equal(r.speedTerm, Infinity)
  close(r.factor, 40 / 161.25)
  assert.equal(r.limit, 'size')
})

test('a big slow target takes it all', () => {
  const r = missileApplication({ ...ham, sig: 400, speed: 100 })
  assert.equal(r.factor, 1)
  assert.equal(r.limit, 'none')
})

test('nothing negative or empty breaks it', () => {
  const r = missileApplication({ radius: 0, velocity: 0, drf: 0.5, sig: 0, speed: -5 })
  assert.ok(Number.isFinite(r.factor))
  assert.ok(r.factor >= 0 && r.factor <= 1)
})
