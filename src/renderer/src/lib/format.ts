const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtNum = (n: number | null | undefined): string => (n == null || Number.isNaN(n) ? '—' : nf0.format(n))

export function fmtIsk(n: number | null | undefined, compact = false): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (compact) {
    const abs = Math.abs(n)
    if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T ISK`
    if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B ISK`
    if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M ISK`
    if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K ISK`
  }
  return `${nf2.format(n)} ISK`
}

export function fmtDuration(ms: number): string {
  if (ms <= 0) return 'готово'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}д ${h}ч ${m}м`
  if (h > 0) return `${h}ч ${m}м`
  return `${m}м ${s % 60}с`
}

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} ч назад`
  return `${Math.floor(h / 24)} дн назад`
}

/** In-game rounding: one decimal, except that any positive security below 0.05 shows as 0.1 (still lowsec). */
export function roundSec(sec: number): number {
  if (sec > 0 && sec < 0.05) return 0.1
  return Math.round(sec * 10) / 10
}

const SEC_COLORS = ['#8f2f69', '#b52d2d', '#be3a1e', '#e65c1e', '#e6881e', '#f0ce37', '#8fd13b', '#5bd13b', '#3bd17f', '#3ba5d1', '#2c75e1']

export function secColor(sec: number): string {
  const r = roundSec(sec)
  if (r <= 0) return SEC_COLORS[0]
  return SEC_COLORS[Math.min(10, Math.round(r * 10))]
}

export const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V']
