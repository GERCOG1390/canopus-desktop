import assert from 'node:assert/strict'
import { test } from 'node:test'
import { limitedFor } from './esiLimit.ts'
import { rememberWars, warBudget, sideId, sortWars, warRole, warsToRead, warStatus } from './wars.ts'

const NOW = Date.parse('2026-11-06T12:00:00Z')
const war = (o) => ({
  id: 1,
  aggressor: { alliance_id: 100 },
  defender: { corporation_id: 200 },
  declared: '2026-11-01T00:00:00Z',
  started: '2026-11-02T00:00:00Z',
  mutual: false,
  open_for_allies: false,
  ...o
})

test('statuses, from real ESI shapes', () => {
  // Declared, starts tomorrow (war 763712).
  assert.equal(warStatus(war({ started: '2026-11-07T04:53:00Z' }), NOW), 'pending')
  assert.equal(warStatus(war({}), NOW), 'active')
  // Retracted with the end still ahead: still shooting until then.
  assert.equal(warStatus(war({ retracted: '2026-11-05T00:00:00Z', finished: '2026-11-07T00:00:00Z' }), NOW), 'ending')
  // Retracted long ago (war 763000).
  assert.equal(warStatus(war({ retracted: '2026-09-29T19:45:00Z', finished: '2026-10-01T03:47:00Z' }), NOW), 'finished')
  // Retracted before it started: it ended without starting.
  assert.equal(warStatus(war({ started: '2026-11-08T00:00:00Z', finished: '2026-11-06T00:00:00Z' }), NOW), 'finished')
})

test('a side is its alliance or else its corporation', () => {
  assert.equal(sideId({ alliance_id: 5 }), 5)
  assert.equal(sideId({ corporation_id: 6 }), 6)
  assert.equal(sideId({}), 0)
})

test('a role: by corporation, by alliance, as an ally, or none', () => {
  const w = war({ allies: [{ corporation_id: 300 }, { alliance_id: 400 }] })
  assert.equal(warRole(w, { corporationId: 1, allianceId: 100 }), 'aggressor')
  assert.equal(warRole(w, { corporationId: 200 }), 'defender')
  assert.equal(warRole(w, { corporationId: 300 }), 'ally')
  assert.equal(warRole(w, { corporationId: 1, allianceId: 400 }), 'ally')
  assert.equal(warRole(w, { corporationId: 1 }), null)
  // A pilot with no alliance doesn't match a side with none.
  assert.equal(warRole(war({}), {}), null)
})

test('order: mine, then running, then upcoming, then over; within those by destruction, then newest', () => {
  const me = { corporationId: 200 }
  const other = { aggressor: { alliance_id: 1 }, defender: { corporation_id: 2 } }
  const wars = [
    war({ id: 1, ...other, finished: '2026-11-01T00:00:00Z' }),
    war({ id: 2, ...other, started: '2026-11-08T00:00:00Z' }),
    war({ id: 3, ...other }),
    war({ id: 4, aggressor: { alliance_id: 1, isk_destroyed: 500 }, defender: { corporation_id: 2 } }),
    war({ id: 5, finished: '2026-11-01T00:00:00Z' }), // mine, over
    war({ id: 6, ...other })
  ]
  assert.deepEqual(sortWars(wars, me, NOW).map((w) => w.id), [5, 4, 6, 3, 2, 1])
})

test('wars to read: running ones first, then new ones newest first, never a finished one', () => {
  const memory = { finished: [10, 7], running: [3, 5] }
  assert.deepEqual(warsToRead([10, 9, 8, 7, 5, 3, 2], memory, 4), { read: [3, 5, 9, 8], unread: 1 })
  assert.deepEqual(warsToRead([10, 9, 8, 7, 5, 3, 2], memory, 100), { read: [3, 5, 9, 8, 2], unread: 0 })
  // A running war too old for the list is still read: that's the point of remembering it.
  assert.deepEqual(warsToRead([9], { finished: [], running: [1] }, 5), { read: [1, 9], unread: 0 })
  assert.deepEqual(warsToRead([], { finished: [], running: [] }, 5), { read: [], unread: 0 })
})

test('remembering: a finished war moves out of running and stays out', () => {
  const m = rememberWars({ finished: [1], running: [2, 3] }, [war({ id: 2, finished: '2026-11-01T00:00:00Z' }), war({ id: 4 })], NOW)
  assert.deepEqual(m.finished.sort(), [1, 2])
  assert.deepEqual(m.running.sort(), [3, 4])
  assert.deepEqual(warsToRead([4, 3, 2, 1], m, 10).read, [3, 4])
})

test('esi limits are told from other errors', () => {
  assert.equal(limitedFor('429: Too Many Requests retry-after=216'), 216)
  assert.equal(limitedFor('420: Error limited retry-after=30'), 30)
  assert.equal(limitedFor('429: Too Many Requests'), 60)
  assert.equal(limitedFor('404: Not found'), null)
  assert.equal(limitedFor('fetch failed'), null)
})

test('the budget: a portion at a time, 1200 in a window, then the wait until the oldest leaves it', () => {
  const memory = (...spent) => ({ finished: [], running: [], spent })
  assert.deepEqual(warBudget(memory(), NOW), { budget: 500, waitSeconds: 0 })
  assert.deepEqual(warBudget(memory({ at: NOW - 60_000, count: 500 }, { at: NOW - 30_000, count: 500 }), NOW), { budget: 200, waitSeconds: 0 })
  assert.deepEqual(warBudget(memory({ at: NOW - 60_000, count: 700 }, { at: NOW - 30_000, count: 500 }), NOW), { budget: 0, waitSeconds: 840 })
  // Older than the window: forgotten.
  assert.deepEqual(warBudget(memory({ at: NOW - 15 * 60_000, count: 1200 }), NOW), { budget: 500, waitSeconds: 0 })
})

test('remembering counts what was read and drops what left the window', () => {
  const m = rememberWars({ finished: [], running: [], spent: [{ at: NOW - 16 * 60_000, count: 500 }, { at: NOW - 60_000, count: 100 }] }, [war({ id: 1 })], NOW)
  assert.deepEqual(m.spent, [{ at: NOW - 60_000, count: 100 }, { at: NOW, count: 1 }])
})

test('every request counts against the budget, failed ones too: ESI charges for errors as well', () => {
  const m = rememberWars({ finished: [], running: [] }, [war({ id: 1 })], NOW, 40)
  assert.deepEqual(m.spent, [{ at: NOW, count: 40 }])
  // Without the count of requests, the wars read are the count.
  assert.deepEqual(rememberWars({ finished: [], running: [] }, [war({ id: 1 })], NOW).spent, [{ at: NOW, count: 1 }])
})
