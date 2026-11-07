import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agoText, flowLimit } from './uiFormat.ts'

const MIN = 60000
const DAY = 86400000

test('how long ago reads the way people say it', () => {
  assert.equal(agoText(5 * MIN), '5 мин назад')
  assert.equal(agoText(3 * 60 * MIN), '3 ч назад')
  assert.equal(agoText(47 * 60 * MIN), '47 ч назад')
  assert.equal(agoText(3 * DAY), '3 дн назад')
  assert.equal(agoText(59 * DAY), '59 дн назад')
  assert.equal(agoText(69 * DAY), '2 мес назад')
  assert.equal(agoText(364 * DAY), '11 мес назад')
  assert.equal(agoText(1184 * DAY), '3 года назад')
  assert.equal(agoText(366 * DAY), '1 год назад')
  assert.equal(agoText(1793 * DAY), '4 года назад')
  assert.equal(agoText(365.25 * 5 * DAY), '5 лет назад')
  assert.equal(agoText(365.25 * 21 * DAY), '21 год назад')
  assert.equal(agoText(365.25 * 11 * DAY), '11 лет назад')
})

test('a time in the future (a clock off by a little) is not negative', () => {
  assert.equal(agoText(-5 * MIN), '0 мин назад')
})

test('one huge day does not flatten the wallet chart', () => {
  const ordinary = Array.from({ length: 20 }, (_, i) => 100e6 + i * 5e6)
  const limit = flowLimit([...ordinary, 13.7e9])
  assert.ok(limit < 1e9, `limit ${limit}`)
  assert.ok(limit >= 195e6, 'ordinary days stay inside the scale')
})

test('without an outlier the scale is simply the largest day', () => {
  assert.equal(flowLimit([100, 120, 90, 110, 95, 105]), 120)
  assert.equal(flowLimit([]), 0)
  // Too few days to call any of them unusual.
  assert.equal(flowLimit([5, 1000]), 1000)
})
