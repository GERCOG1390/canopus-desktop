// Net trading profit, the same on the Trades page and in the assistant: the gross of sales matched to earlier
// buys, less the share of the period's sales tax and broker fees that falls on those sales (fees are paid on every
// order, the gross covers only the matched ones).

export function netTradeProfit(gross: number, salesTax: number, brokerFees: number, allSold: number, matchedSold: number): { net: number; share: number } {
  const share = allSold > 0 ? Math.min(1, matchedSold / allSold) : 1
  return { net: gross - (salesTax + brokerFees) * share, share }
}
