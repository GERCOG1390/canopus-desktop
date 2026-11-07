import assert from 'node:assert/strict'
import { test } from 'node:test'
import { candidateKey, fightProblems, rate, searchAdvice } from './combatAdvice.ts'

const hp = { a: { shield: 100, armor: 100, hull: 100 }, b: { shield: 100, armor: 100, hull: 100 } }
// A fight outcome: who won when, and what was left of each as one share of everything.
const fightOf = (winner, end, leftA, leftB) => ({
  winner,
  end,
  events: [],
  series: [],
  a: { left: { s: leftA, a: leftA, h: leftA, c: 1 } },
  b: { left: { s: leftB, a: leftB, h: leftB, c: 1 } }
})
const c = (o = {}) => ({ behavior: 'orbit', range: 1000, ammo: {}, prop: true, ...o })
const score = (w, e, a, b) => rate(c(), fightOf(w, e, a, b), hp).score

test('a win beats a stalemate beats both dying beats a loss, however they went', () => {
  const closeWin = score('a', 899, 0.01, 0)
  const greatStalemate = score(null, 900, 1, 0.01)
  const both = score('both', 10, 0, 0)
  const greatLoss = score('b', 800, 0, 0.01)
  assert.ok(closeWin > greatStalemate)
  assert.ok(greatStalemate > both)
  assert.ok(both > greatLoss)
})

test('within a kind: more left and sooner is better, a loss that hurt them more is better', () => {
  assert.ok(score('a', 100, 0.9, 0) > score('a', 100, 0.5, 0))
  assert.ok(score('a', 50, 0.5, 0) > score('a', 500, 0.5, 0))
  assert.ok(score(null, 900, 0.8, 0.2) > score(null, 900, 0.5, 0.5))
  assert.ok(score('b', 100, 0, 0.2) > score('b', 100, 0, 0.8))
})

test('toughness is weighed by hit points', () => {
  const tl = { ...fightOf('a', 10, 0, 0), a: { left: { s: 1, a: 0, h: 0, c: 1 } } }
  const heavyShield = { ...hp, a: { shield: 300, armor: 100, hull: 100 } }
  assert.equal(rate(c(), tl, heavyShield).leftA, 0.6)
})

// A world with a known best: ammo 2 is good at 20 km, ammo 1 at 5 km, and the propulsion helps a little.
const world = (log = []) => (x) => {
  log.push(candidateKey(x))
  const ammo = x.ammo[77]
  const good = (ammo === 2 && x.range === 20000) || (ammo === 1 && x.range === 5000)
  if (!good) return fightOf('b', 60, 0, 0.5)
  const left = (ammo === 2 ? 0.6 : 0.3) + (x.prop ? 0.1 : 0) + (x.behavior === 'keep' ? 0.05 : 0)
  return fightOf('a', 60, left, 0)
}
const input = (o = {}) => ({
  start: c({ ammo: { 77: 1 } }),
  rangesFor: () => [5000, 10000, 20000],
  charges: { 77: [1, 2, 3] },
  canProp: true,
  fight: world(),
  hp,
  ...o
})

test('the search finds the ammo that only works somewhere the first sweep did not look best', async () => {
  const r = await searchAdvice(input())
  assert.equal(r.best.candidate.ammo[77], 2)
  assert.equal(r.best.candidate.range, 20000)
  assert.equal(r.best.candidate.behavior, 'keep')
  assert.equal(r.best.candidate.prop, true)
  assert.equal(r.best.winner, 'a')
})

test('it turns the propulsion off when that wins', async () => {
  const noProp = (x) => (x.prop ? fightOf('b', 60, 0, 0.5) : fightOf('a', 60, 0.5, 0))
  const r = await searchAdvice(input({ fight: noProp }))
  assert.equal(r.best.candidate.prop, false)
})

test('without propulsion it does not try flipping it', async () => {
  const log = []
  await searchAdvice(input({ canProp: false, start: c({ ammo: { 77: 1 }, prop: false }), fight: world(log) }))
  assert.ok(log.every((k) => k.includes('|false|')))
})

test('no fight is run twice', async () => {
  const log = []
  const r = await searchAdvice(input({ fight: world(log) }))
  assert.equal(new Set(log).size, log.length)
  assert.equal(r.tried, log.length)
})

test('alternatives differ from the best in range or mode, and from each other', async () => {
  const r = await searchAdvice(input())
  const places = r.alternatives.map((a) => `${a.candidate.behavior}|${a.candidate.range}`)
  assert.equal(new Set(places).size, places.length)
  assert.ok(!places.includes(`${r.best.candidate.behavior}|${r.best.candidate.range}`))
  assert.ok(places.length <= 3)
})

test('several weapons: ammo chosen for each', async () => {
  const two = (x) => (x.ammo[77] === 2 && x.ammo[88] === 9 ? fightOf('a', 60, 0.9, 0) : x.ammo[77] === 2 ? fightOf('a', 60, 0.5, 0) : fightOf('b', 60, 0, 0.5))
  const r = await searchAdvice(input({ start: c({ ammo: { 77: 1, 88: 8 } }), charges: { 77: [1, 2], 88: [8, 9] }, fight: two }))
  assert.deepEqual(r.best.candidate.ammo, { 77: 2, 88: 9 })
})

test('nothing to load: only the flying is searched, and a pause is honoured', async () => {
  let pauses = 0
  const r = await searchAdvice(
    input({
      start: c(),
      charges: {},
      fight: (x) => fightOf('a', 60, x.range === 10000 ? 0.9 : 0.1, 0),
      pause: async () => void pauses++
    })
  )
  assert.equal(r.best.candidate.range, 10000)
  assert.ok(pauses >= 1)
})

// ---------- What holds a fit back

const side = (o = {}) => ({
  hp: { shield: 1000, armor: 100, hull: 100 },
  resist: { shield: [0, 0.2, 0.4, 0.5], armor: [0.5, 0.35, 0.25, 0.1], hull: [0.33, 0.33, 0.33, 0.33] },
  ehp: 1000,
  ...o
})
const direction = (o = {}) => ({ weapons: [], applied: 100, paperDps: 100, appliedByType: [0, 0, 0, 0], ...o })
const problems = (o = {}) =>
  fightProblems({ a: side(), b: side(), ab: direction(), ba: direction(), timeline: { events: [], winner: null, end: 10, series: [] }, ...o })
const codes = (l) => l.map((p) => p.code)

test('a clean fight has nothing to say', () => {
  assert.deepEqual(problems(), [])
})

test('the weapon losing the most damage is named, with what limits it', () => {
  const ab = direction({
    weapons: [
      { typeId: 1, dps: 100, applied: 50, factor: 0.5, limit: 'наводка' },
      { typeId: 2, dps: 300, applied: 30, factor: 0.1, limit: 'фоллоф' },
      { typeId: 3, dps: 50, applied: 50, factor: 1 }
    ]
  })
  assert.deepEqual(problems({ ab }), [{ code: 'application', typeId: 2, limit: 'фоллоф', percent: 10 }])
  // A weapon doing most of its damage is not a problem.
  assert.deepEqual(problems({ ab: direction({ weapons: [{ typeId: 1, dps: 100, applied: 80, factor: 0.8, limit: 'наводка' }] }) }), [])
})

test('incoming damage that lands on a weak resist of the main layer', () => {
  // All EM into a shield with 0% EM, against an average of 27.5%.
  const em = problems({ ba: direction({ appliedByType: [100, 0, 0, 0] }) })
  assert.deepEqual(em, [{ code: 'weakResist', layer: 'shield', damage: 0, share: 100, resist: 0 }])
  // All explosive into the same shield, its best resist: nothing to say.
  assert.deepEqual(problems({ ba: direction({ appliedByType: [0, 0, 0, 100] }) }), [])
  // Evenly mixed damage has no type to blame.
  assert.deepEqual(problems({ ba: direction({ appliedByType: [25, 25, 25, 25] }) }), [])
})

test('the layer judged is the one with the most hit points; a bare hull tank says nothing', () => {
  const armorShip = side({ hp: { shield: 100, armor: 1000, hull: 100 } })
  const p = problems({ a: armorShip, ba: direction({ appliedByType: [0, 0, 0, 100] }) })
  assert.deepEqual(p, [{ code: 'weakResist', layer: 'armor', damage: 3, share: 100, resist: 10 }])
  const hullShip = side({ hp: { shield: 100, armor: 100, hull: 1000 } })
  assert.deepEqual(problems({ a: hullShip, ba: direction({ appliedByType: [100, 0, 0, 0] }) }), [])
})

test('only my own events count, each once, from the first time', () => {
  const timeline = {
    winner: 'b',
    end: 50,
    series: [],
    events: [
      { t: 5, side: 'b', kind: 'capEmpty' },
      { t: 10, side: 'a', kind: 'capEmpty' },
      { t: 12, side: 'a', kind: 'capEmpty' },
      { t: 20, side: 'a', kind: 'reload' },
      { t: 25, side: 'a', kind: 'propBlocked' },
      { t: 30, side: 'a', kind: 'lostRange' }
    ]
  }
  assert.deepEqual(problems({ timeline }), [
    { code: 'capEmpty', t: 10 },
    { code: 'propBlocked', t: 25 },
    { code: 'lostRange', t: 30 },
    { code: 'reload', t: 20 }
  ])
})

test('out-damaged and out-tanked only by a clear margin', () => {
  assert.deepEqual(codes(problems({ ab: direction({ applied: 100 }), ba: direction({ applied: 149 }) })), [])
  assert.deepEqual(problems({ ab: direction({ applied: 100 }), ba: direction({ applied: 150 }) }), [{ code: 'outgunned', mine: 100, theirs: 150 }])
  assert.deepEqual(problems({ b: side({ ehp: 1500 }) }), [{ code: 'lessTank', mine: 1000, theirs: 1500 }])
})

test('a resist the RAH has already moved is judged as it ended up', () => {
  const armorShip = side({ hp: { shield: 100, armor: 1000, hull: 100 } })
  const ba = direction({ appliedByType: [0, 0, 0, 100] })
  // Fitted resist 10% on explosive, but the RAH reached 60% in the fight.
  const timeline = { events: [], winner: null, end: 10, series: [], a: { armorResist: [0.5, 0.2, 0.1, 0.6] } }
  assert.deepEqual(problems({ a: armorShip, ba, timeline }), [])
})
