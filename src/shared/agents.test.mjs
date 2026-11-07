import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterAgents } from './agents.ts'

const agent = (id, n, c, d, l, s, extra = {}) => ({ id, n, c, d, l, s, ...extra })
const agents = [
  agent(1, 'Near Hisec', 100, 24, 4, 10),
  agent(2, 'Far Hisec', 100, 24, 4, 20),
  agent(3, 'Lowsec', 100, 24, 4, 30),
  agent(4, 'Wrong level', 100, 24, 3, 10),
  agent(5, 'Wrong division', 100, 22, 4, 10),
  agent(6, 'Locator', 200, 22, 4, 10, { loc: 1 })
]
const ctx = {
  sec: (s) => ({ 10: 0.9, 20: 0.46, 30: 0.44 })[s] ?? 0,
  corpName: (c) => (c === 100 ? ['Caldari Navy', 'Флот Калдари'] : ['Other Corp', 'Другая корпорация']),
  jumps: new Map([[10, 5], [20, 2], [30, 1]])
}
const ids = (r) => r.list.map((a) => a.id)

test('level, division and highsec filter; nearest first', () => {
  const r = filterAgents(agents, { level: 4, division: 24, locators: false, highsec: true, q: '', limit: 50 }, ctx)
  assert.deepEqual(ids(r), [2, 1]) // 0.46 rounds to 0.5 and is highsec; 0.44 is not
  assert.equal(r.total, 2)
})

test('locators are any division', () => {
  assert.deepEqual(ids(filterAgents(agents, { level: 4, division: 0, locators: true, highsec: false, q: '', limit: 50 }, ctx)), [6])
})

test('search finds the agent or the corporation in either language', () => {
  const q = (text) => ids(filterAgents(agents, { level: 4, division: 0, locators: false, highsec: false, q: text, limit: 50 }, ctx))
  assert.deepEqual(q('far'), [2])
  assert.equal(q('флот').length, 4)
  assert.equal(q('NAVY').length, 4)
})

test('the limit cuts the list, not the total; no origin sorts by name', () => {
  const r = filterAgents(agents, { level: 4, division: 24, locators: false, highsec: false, q: '', limit: 1 }, { ...ctx, jumps: undefined })
  assert.equal(r.total, 3)
  assert.equal(r.list.length, 1)
  assert.equal(r.list[0].id, 2) // "Far Hisec" first within the corporation
})
