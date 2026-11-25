import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareFights, explainChange, historyPush, historyRedo, historyStart, historyUndo, summarize } from './combatCompare.ts'

const hp = { hp: { shield: 400, armor: 300, hull: 300 } }
const side = (left, averageDps = 100, burnt = []) => ({ left, averageDps, heat: burnt.length ? { modules: burnt.map((b) => ({ burnt: b })) } : undefined })
const fight = (winner, end, a, b) => ({ a: hp, b: hp, timeline: { winner, end, a, b } })
const full = { s: 1, a: 1, h: 1 }
const gone = { s: 0, a: 0, h: 0 }

test('the summary weighs what is left by layer, as the verdict does', () => {
  // Shield gone, half the armor: 150 of 1000 armor+hull... (0·400 + 0.5·300 + 1·300) / 1000 = 45%.
  const s = summarize(fight('a', 90, side({ s: 0, a: 0.5, h: 1 }, 120, [null, 40]), side(gone)))
  assert.deepEqual(s, { winner: 'a', end: 90, leftA: 45, leftB: 0, burntA: 1, dpsA: 120 })
})

test('heat that wins a lost fight: the result is the first change, and it is better', () => {
  const base = summarize(fight('b', 108, side(gone, 100), side({ s: 0, a: 0.2, h: 1 })))
  const now = summarize(fight('a', 91, side({ s: 0, a: 0.4, h: 1 }, 130, [70]), side(gone)))
  const c = compareFights(base, now)
  assert.deepEqual(c[0], { kind: 'result', now: 'a', base: 'b', better: true })
  assert.ok(c.some((x) => x.kind === 'left' && x.now === 42 && x.base === 0 && x.better))
  assert.ok(c.some((x) => x.kind === 'burnt' && x.now === 1 && !x.better))
  assert.ok(c.some((x) => x.kind === 'dps' && x.pct === 30 && x.better))
})

test('a kill in both runs: sooner is better, half a second is noise', () => {
  const base = summarize(fight('a', 108, side(full), side(gone)))
  assert.deepEqual(compareFights(base, summarize(fight('a', 91, side(full), side(gone)))), [{ kind: 'kill', seconds: 17, better: true }])
  assert.deepEqual(compareFights(base, summarize(fight('a', 108.3, side(full), side(gone)))), [])
})

test('a loss in both runs: lasting longer is better', () => {
  const base = summarize(fight('b', 60, side(gone), side(full)))
  assert.deepEqual(compareFights(base, summarize(fight('b', 75, side(gone), side(full)))), [{ kind: 'survive', seconds: 15, better: true }])
})

test('nobody dies in either run: what is left of the opponent counts, less is better', () => {
  const base = summarize(fight(null, 600, side(full), side({ s: 0.5, a: 1, h: 1 })))
  const now = summarize(fight(null, 600, side(full), side({ s: 0, a: 1, h: 1 })))
  assert.deepEqual(compareFights(base, now), [{ kind: 'leftThem', now: 60, base: 80, better: true }])
})

test('both dying is worse than nobody dying and better than losing', () => {
  const both = summarize(fight('both', 100, side(gone), side(gone)))
  const none = summarize(fight(null, 600, side(full), side(full)))
  const lost = summarize(fight('b', 100, side(gone), side(full)))
  assert.equal(compareFights(none, both)[0].better, false)
  assert.equal(compareFights(lost, both)[0].better, true)
})

test('undo and redo walk the setups; a new change drops redo; no change is no step', () => {
  let h = historyStart({ d: 10 })
  h = historyPush(h, { d: 12 })
  h = historyPush(h, { d: 12 })
  h = historyPush(h, { d: 15 })
  assert.equal(h.past.length, 2)
  h = historyUndo(h)
  assert.deepEqual(h.present, { d: 12 })
  h = historyUndo(h)
  assert.deepEqual(h.present, { d: 10 })
  assert.equal(historyUndo(h), h)
  h = historyRedo(h)
  assert.deepEqual(h.present, { d: 12 })
  h = historyPush(h, { d: 20 })
  assert.equal(h.future.length, 0)
  assert.deepEqual(historyUndo(h).present, { d: 12 })
})

test('the history keeps the last steps only', () => {
  let h = historyStart(0)
  for (let i = 1; i <= 150; i++) h = historyPush(h, i, undefined, 100)
  assert.equal(h.past.length, 100)
  assert.equal(h.past[0], 50)
})

test('a lever rated worse is not explained by the one thing it does better: the loss is named too', () => {
  // Thermal missiles kill the Tornado 6.6 s sooner, but the Raven ends with less left: rated worse overall.
  const base = summarize(fight('a', 50.4, side(full), side(gone)))
  const now = summarize(fight('a', 43.8, side({ s: 0.9, a: 1, h: 1 }), side(gone)))
  const c = compareFights(base, now)
  assert.equal(c[0].kind, 'kill')
  assert.equal(c[0].better, true)
  const worse = explainChange(c, false)
  assert.deepEqual(worse.map((x) => [x.kind, x.better]), [['kill', true], ['left', false]])
  // Rated better: the first change agrees, it alone is enough.
  assert.deepEqual(explainChange(c, true).map((x) => x.kind), ['kill'])
  assert.deepEqual(explainChange([], false), [])
})
