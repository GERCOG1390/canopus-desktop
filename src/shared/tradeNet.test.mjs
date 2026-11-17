import assert from 'node:assert/strict'
import { test } from 'node:test'
import { netTradeProfit } from './tradeNet.ts'

// Audit 2026-11-16: the Trades page took the matched share of the fees, the assistant all of them.
test('fees are charged in the share the matched sales are of all sales', () => {
  assert.deepEqual(netTradeProfit(1_000, 100, 50, 10_000, 5_000), { net: 1_000 - 150 * 0.5, share: 0.5 })
  assert.equal(netTradeProfit(1_000, 100, 50, 0, 0).net, 850)
})
