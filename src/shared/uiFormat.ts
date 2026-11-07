// Small display rules that are worth a test: how long ago something was, and where a chart's scale ends.

const YEAR_MS = 365.25 * 86400000
const MONTH_MS = YEAR_MS / 12

function yearWord(n: number): string {
  const tens = n % 100
  const ones = n % 10
  if (tens >= 11 && tens <= 14) return 'лет'
  if (ones === 1) return 'год'
  return ones >= 2 && ones <= 4 ? 'года' : 'лет'
}

/** "3 ч назад", "2 мес назад", "3 года назад": a loss from 1190 days ago is a loss from three years ago. */
export function agoText(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} ч назад`
  const d = Math.floor(h / 24)
  if (d < 60) return `${d} дн назад`
  const years = Math.floor(ms / YEAR_MS)
  if (years < 1) return `${Math.floor(ms / MONTH_MS)} мес назад`
  return `${years} ${yearWord(years)} назад`
}

/**
 * The top of a bar chart's scale. Normally the largest value; when one day dwarfs the rest it would flatten them
 * to nothing, so the scale ends a little above the ordinary days and that bar is drawn cut, with its value written.
 */
export function flowLimit(values: number[]): number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (!sorted.length) return 0
  const max = sorted[sorted.length - 1]
  if (sorted.length < 5) return max
  const ordinary = sorted[Math.floor((sorted.length - 1) * 0.85)]
  return max > ordinary * 4 ? ordinary * 2 : max
}
