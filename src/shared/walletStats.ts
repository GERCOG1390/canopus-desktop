// The wallet journal by day (EVE time, UTC) and as a CSV file.

export interface JournalRow {
  date: string
  ref_type?: string
  amount?: number
  balance?: number
  description?: string
  reason?: string
}

export interface DayFlow {
  day: string
  income: number
  expense: number
  net: number
}

const DAY = 86400_000

export function dailyFlows(journal: JournalRow[], days: number, now = Date.now()): DayFlow[] {
  const last = Math.floor(now / DAY)
  const out: DayFlow[] = []
  for (let d = last - days + 1; d <= last; d++) out.push({ day: new Date(d * DAY).toISOString().slice(0, 10), income: 0, expense: 0, net: 0 })
  const byDay = new Map(out.map((d) => [d.day, d]))
  for (const j of journal) {
    const row = byDay.get(j.date.slice(0, 10))
    const a = j.amount ?? 0
    if (!row || !a) continue
    if (a > 0) row.income += a
    else row.expense += a
    row.net += a
  }
  return out
}

/** Text from other players stays text: spreadsheets run cells that start with = + - @ as formulas. */
function textCell(v: string | undefined): string {
  let s = v ?? ''
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function journalCsv(journal: JournalRow[], typeLabel: (refType: string) => string): string {
  const lines = ['date,type,amount,balance,description,reason']
  for (const j of journal) {
    lines.push([textCell(j.date), textCell(typeLabel(j.ref_type ?? '')), j.amount ?? '', j.balance ?? '', textCell(j.description), textCell(j.reason)].join(','))
  }
  return lines.join('\r\n') + '\r\n'
}
