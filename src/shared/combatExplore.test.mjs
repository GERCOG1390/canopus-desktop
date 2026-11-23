import assert from 'node:assert/strict'
import { test } from 'node:test'
import { outcomeBands, outcomeKind, rankLevers } from './combatExplore.ts'

test('how a fight ends: nobody dead but hurt is a draw, nobody reaching anybody is idle', () => {
  assert.equal(outcomeKind('a', 0, 0), 'win')
  assert.equal(outcomeKind('b', 0, 0), 'lose')
  assert.equal(outcomeKind('both', 1, 1), 'both')
  assert.equal(outcomeKind(null, 12, 0), 'draw')
  assert.equal(outcomeKind(null, 0, 0), 'idle')
})

test('distances with the same outcome form one band that reaches halfway to the next', () => {
  const p = (km, kind) => ({ distance: km * 1000, kind, end: 60 })
  const bands = outcomeBands([p(10, 'win'), p(0.5, 'lose'), p(2.5, 'lose'), p(5, 'win'), p(15, 'idle')])
  assert.deepEqual(bands, [
    { kind: 'lose', from: 500, to: 3750 },
    { kind: 'win', from: 3750, to: 12500 },
    { kind: 'idle', from: 12500, to: 15000 }
  ])
  assert.deepEqual(outcomeBands([]), [])
})

test('levers: best first, then at least two mistakes; changes within rounding are left out', () => {
  const l = (delta, n) => ({ lever: { kind: 'range', behavior: 'keep', range: n }, summary: {}, delta })
  const ranked = rankLevers([l(0.3, 1), l(-0.9, 2), l(0.001, 3), l(0.6, 4), l(-0.2, 5), l(0.1, 6), l(0.2, 7), l(0.05, 8), l(-0.4, 9)], 6)
  assert.deepEqual(ranked.map((x) => x.lever.range), [4, 1, 7, 6, 2, 9])
  // No improvement at all: only what not to do.
  assert.deepEqual(rankLevers([l(-0.1, 1), l(-0.5, 2)]).map((x) => x.lever.range), [2, 1])
})
