import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isClearReport, jumpRisk, routeVerdict, shipsThrough } from './intelChecks.ts'

test('clear means clear: one system, a clear word', () => {
  assert.equal(isClearReport('XYZ clr', 1), true)
  assert.equal(isClearReport('XYZ чисто', 1), true)
})

test('no visual is not clear: the hostile is still about', () => {
  assert.equal(isClearReport('XYZ nv', 1), false)
  assert.equal(isClearReport('XYZ no visual', 1), false)
})

test('a clear about one system does not silence a report about another', () => {
  assert.equal(isClearReport('XYZ clr, ABC 5 reds', 2), false)
})

test('a route is called clean only when every system was really checked', () => {
  assert.equal(routeVerdict({ total: 10, done: 10, failed: 0, running: false, found: 0 }), 'clean')
  assert.equal(routeVerdict({ total: 10, done: 7, failed: 3, running: false, found: 0 }), 'partial')
  assert.equal(routeVerdict({ total: 10, done: 0, failed: 10, running: false, found: 0 }), 'partial')
  assert.equal(routeVerdict({ total: 10, done: 4, failed: 0, running: true, found: 0 }), 'checking')
  assert.equal(routeVerdict({ total: 10, done: 10, failed: 0, running: false, found: 2 }), 'danger')
})

test('what passes a wormhole follows the real ship masses', () => {
  assert.equal(shipsThrough(5e6), 'фрегаты и эсминцы')
  assert.equal(shipsThrough(62e6), 'до линейных крейсеров')
  assert.equal(shipsThrough(375e6), 'до линкоров')
  // C729: a Bowhead (400) fits, a Charon or Rhea (960) doesn't.
  assert.equal(shipsThrough(410e6), 'до линкоров и Bowhead')
  assert.equal(shipsThrough(1e9), 'до фрейтеров')
  // Supercarriers weigh up to 1.78 bn; titans 2.1 to 2.4 bn.
  assert.equal(shipsThrough(2e9), 'капитальные, кроме титанов')
  assert.equal(shipsThrough(0), null)
})

test('a hole that may close while anyone is outside is the red case, whichever way the last jump went', () => {
  assert.equal(jumpRisk({ mass: 300, jumpMass: 500, lo: -10, hi: 100, outsideAfter: true }), 'cut-off')
  assert.equal(jumpRisk({ mass: 300, jumpMass: 500, lo: -10, hi: 100, outsideAfter: false }), 'may-close')
  assert.equal(jumpRisk({ mass: 600, jumpMass: 500, lo: 10, hi: 100, outsideAfter: false }), 'too-heavy')
  assert.equal(jumpRisk({ mass: 300, jumpMass: 500, lo: -20, hi: -10, outsideAfter: false }), 'closed')
  assert.equal(jumpRisk({ mass: 300, jumpMass: 500, lo: 10, hi: 100, outsideAfter: true }), null)
})
