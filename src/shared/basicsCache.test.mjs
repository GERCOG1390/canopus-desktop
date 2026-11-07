import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBasicsCache } from './basicsCache.ts'

const tick = () => new Promise((r) => setTimeout(r, 2))

test('ids asked together go in one request and are cached', async () => {
  const calls = []
  const cache = createBasicsCache(async (ids) => {
    calls.push(ids)
    return Object.fromEntries(ids.map((id) => [id, { id }]))
  })
  cache.request([1, 2])
  cache.request([2, 3])
  await tick()
  assert.deepEqual(calls, [[1, 2, 3]])
  assert.deepEqual(cache.get(2), { id: 2 })
  cache.request([1])
  await tick()
  assert.equal(calls.length, 1)
})

// While the SDE builds every request fails. A listener that asks again on each change (every <TypeLink>
// re-rendering) once made an endless loop of requests: tens of thousands in seconds, the app looked frozen.
test('a failed request is not repeated until retry()', async () => {
  let calls = 0
  let ready = false
  const cache = createBasicsCache(async (ids) => {
    calls++
    if (!ready) throw new Error('База SDE ещё не загружена')
    return Object.fromEntries(ids.map((id) => [id, { id }]))
  })
  const ask = () => cache.request([7])
  cache.subscribe(ask)
  ask()
  for (let i = 0; i < 20; i++) await tick()
  assert.equal(calls, 1)
  ready = true
  cache.retry()
  for (let i = 0; i < 5; i++) await tick()
  assert.equal(calls, 2)
  assert.deepEqual(cache.get(7), { id: 7 })
})
