// A fight from the game log: what you dealt and took, by weapon and by opponent, what missed and what only
// grazed. The log holds damage after resists and remote repairs; it has no local repairs, no shield or armor
// state and no damage types, so "how much was tanked" can't be read from it alone.
//
// Damage and remote repair lines are checked against real logs. Misses, capacitor warfare and tackle lines are
// written from memory of the format: whatever isn't recognised is counted and shown, never dropped quietly.

export type CombatKind = 'out' | 'in' | 'missOut' | 'missIn' | 'repIn' | 'repOut' | 'cap' | 'ewar' | 'unknown'

export interface CombatEvent {
  /** ms, UTC (EVE time) */
  t: number
  kind: CombatKind
  amount: number
  /** The other party: a pilot or an NPC, in English where the client gives it */
  who: string
  /** Their ship, for players */
  ship?: string
  weapon?: string
  quality?: string
  /** The line as text, for what wasn't recognised and for tackle */
  text?: string
}

const LINE_RE = /^\[\s*(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})\s*\]\s*\(combat\)\s*(.*)$/
// A translated name comes as <localized hint="English">Перевод* with no closing tag.
const HINT_RE = /<localized hint="([^"]*)">[^<]*(?:<\/localized>)?/g
const COLOR_OUT = 'ff00ffff'
const COLOR_IN = 'ffcc0000'
const COLOR_REP = 'ffccff66'

const plain = (s: string): string => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/** "Pilot[TICK](Ship)" or an NPC's plain name. */
function party(text: string): { who: string; ship?: string } {
  const m = /^(.+?)\s*\[[^\]]*\]\s*\((.+)\)$/.exec(text.trim())
  return m ? { who: m[1].trim(), ship: m[2].trim() } : { who: text.trim() }
}

export function parseCombatLine(line: string): CombatEvent | null {
  const m = LINE_RE.exec(line.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s, rawBody] = m
  const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
  const body = rawBody.replace(HINT_RE, '$1')
  const text = plain(body)
  const color = /^<color=0x([0-9a-f]{8})>/i.exec(body)?.[1]?.toLowerCase()

  if (color === COLOR_OUT || color === COLOR_IN) {
    // <amount> <to|from, translated> <who> - <weapon> - <quality>; the weapon is absent on some NPC lines.
    const dmg = /^(\d+)\s+\S+\s+(.*)$/.exec(text)
    if (dmg) {
      const parts = dmg[2].split(' - ')
      const quality = parts.length > 1 ? parts[parts.length - 1].trim() : undefined
      const weapon = parts.length > 2 ? parts.slice(1, -1).join(' - ').trim() : undefined
      return { t, kind: color === COLOR_OUT ? 'out' : 'in', amount: Number(dmg[1]), ...party(parts[0]), weapon, quality }
    }
  }
  if (color === COLOR_REP) {
    // 772 remote shield boosted by Osprey [Drentu] - - Medium Ancillary Remote Shield Booster
    const rep = /^(\d+) (.*?)\b(by|to)\b\s+(.*)$/.exec(text)
    if (rep) {
      // The separator comes doubled here: "Osprey [Drentu] - - Booster".
      const parts = rep[4].split(' - ').map((p) => p.replace(/^-\s*/, '').trim())
      const weapon = parts[parts.length - 1] || undefined
      const name = /^(.*?)\s*\[(.+)\]$/.exec(parts[0])
      return {
        t,
        kind: rep[3] === 'by' ? 'repIn' : 'repOut',
        amount: Number(rep[1]),
        who: name ? name[2] : parts[0],
        ship: name ? name[1] : undefined,
        weapon
      }
    }
  }
  const miss = /^(.+?) misses (.+?) completely(?: - (.*))?$/.exec(text)
  if (miss) {
    const mine = /^Your\b/.test(miss[1])
    return mine
      ? { t, kind: 'missOut', amount: 0, ...party(miss[2]), weapon: miss[3]?.trim() || miss[1].replace(/^Your (group of )?/, '').trim() }
      : { t, kind: 'missIn', amount: 0, ...party(miss[1]), weapon: miss[3]?.trim() }
  }
  const cap = /^(\d+)(?: GJ)?\b.*energy (?:neutrali[sz]ed|drained)/i.exec(text)
  if (cap) return { t, kind: 'cap', amount: Number(cap[1]), who: '', text }
  if (/warp (?:scramble|disrupt)|webifi|jam/i.test(text)) return { t, kind: 'ewar', amount: 0, who: '', text }
  return { t, kind: 'unknown', amount: 0, who: '', text }
}

export interface WeaponStat {
  name: string
  damage: number
  hits: number
  misses: number
  /** hits / (hits + misses) */
  hitRate: number
  average: number
  biggest: number
  /** Hits by quality word */
  quality: Record<string, number>
  /** Share of hits that only glanced or grazed, 0–1 */
  weak: number
}

export interface PartyStat {
  who: string
  ship?: string
  damage: number
  hits: number
  misses: number
}

export interface Side {
  damage: number
  hits: number
  misses: number
  dps: number
  /** Best 10 seconds */
  peakDps: number
  weapons: WeaponStat[]
  parties: PartyStat[]
}

export interface Fight {
  start: number
  end: number
  /** Seconds, at least 1 */
  seconds: number
  dealt: Side
  taken: Side
  repairedIn: number
  repairedOut: number
  capacitor: number
  ewar: string[]
  unknown: string[]
}

/** A quiet minute ends a fight. */
const FIGHT_GAP_MS = 60_000
const PEAK_WINDOW_MS = 10_000
const WEAK = new Set(['Glances Off', 'Grazes'])

function peakDps(events: CombatEvent[]): number {
  let best = 0
  let from = 0
  let sum = 0
  for (let i = 0; i < events.length; i++) {
    sum += events[i].amount
    while (events[i].t - events[from].t >= PEAK_WINDOW_MS) sum -= events[from++].amount
    best = Math.max(best, sum)
  }
  return best / (PEAK_WINDOW_MS / 1000)
}

function side(hits: CombatEvent[], misses: CombatEvent[], seconds: number): Side {
  const weapons = new Map<string, WeaponStat>()
  const weapon = (name: string): WeaponStat => {
    let w = weapons.get(name)
    if (!w) {
      w = { name, damage: 0, hits: 0, misses: 0, hitRate: 0, average: 0, biggest: 0, quality: {}, weak: 0 }
      weapons.set(name, w)
    }
    return w
  }
  const parties = new Map<string, PartyStat>()
  const other = (e: CombatEvent): PartyStat => {
    let p = parties.get(e.who)
    if (!p) {
      p = { who: e.who, ship: e.ship, damage: 0, hits: 0, misses: 0 }
      parties.set(e.who, p)
    }
    return p
  }
  for (const e of hits) {
    const w = weapon(e.weapon ?? '')
    w.damage += e.amount
    w.hits++
    w.biggest = Math.max(w.biggest, e.amount)
    if (e.quality) w.quality[e.quality] = (w.quality[e.quality] ?? 0) + 1
    const p = other(e)
    p.damage += e.amount
    p.hits++
  }
  for (const e of misses) {
    weapon(e.weapon ?? '').misses++
    other(e).misses++
  }
  for (const w of weapons.values()) {
    w.hitRate = w.hits + w.misses ? w.hits / (w.hits + w.misses) : 0
    w.average = w.hits ? w.damage / w.hits : 0
    const weak = Object.entries(w.quality).reduce((sum, [q, n]) => sum + (WEAK.has(q) ? n : 0), 0)
    w.weak = w.hits ? weak / w.hits : 0
  }
  const damage = hits.reduce((s, e) => s + e.amount, 0)
  return {
    damage,
    hits: hits.length,
    misses: misses.length,
    dps: damage / seconds,
    peakDps: peakDps(hits),
    weapons: [...weapons.values()].sort((a, b) => b.damage - a.damage || b.misses - a.misses),
    parties: [...parties.values()].sort((a, b) => b.damage - a.damage || b.misses - a.misses)
  }
}

/** The log split into fights, oldest first. */
export function buildFights(input: CombatEvent[]): Fight[] {
  const events = [...input].sort((a, b) => a.t - b.t)
  const groups: CombatEvent[][] = []
  for (const e of events) {
    const last = groups[groups.length - 1]
    if (last && e.t - last[last.length - 1].t < FIGHT_GAP_MS) last.push(e)
    else groups.push([e])
  }
  return groups.map((g) => {
    const start = g[0].t
    const end = g[g.length - 1].t
    const seconds = Math.max(1, (end - start) / 1000)
    const of = (k: CombatKind): CombatEvent[] => g.filter((e) => e.kind === k)
    const sum = (k: CombatKind): number => of(k).reduce((s, e) => s + e.amount, 0)
    return {
      start,
      end,
      seconds,
      dealt: side(of('out'), of('missOut'), seconds),
      taken: side(of('in'), of('missIn'), seconds),
      repairedIn: sum('repIn'),
      repairedOut: sum('repOut'),
      capacitor: sum('cap'),
      ewar: [...new Set(of('ewar').map((e) => e.text ?? ''))],
      unknown: of('unknown').map((e) => e.text ?? '')
    }
  })
}

export type Finding =
  | { code: 'misses'; weapon: string; percent: number }
  | { code: 'weakHits'; weapon: string; percent: number }
  | { code: 'outdamaged'; dealt: number; taken: number }
  | { code: 'focus'; who: string; percent: number }
  | { code: 'tackled'; lines: number }

/** Enough shots for a percentage to mean something. */
const MIN_SHOTS = 10

/** What stands out in a fight. Only what the log itself shows. */
export function findings(f: Fight): Finding[] {
  const out: Finding[] = []
  for (const w of f.dealt.weapons) {
    if (!w.name || w.hits + w.misses < MIN_SHOTS) continue
    if (w.hitRate < 0.7) out.push({ code: 'misses', weapon: w.name, percent: Math.round((1 - w.hitRate) * 100) })
    if (w.weak >= 0.4) out.push({ code: 'weakHits', weapon: w.name, percent: Math.round(w.weak * 100) })
  }
  if (f.taken.damage > f.dealt.damage && f.taken.hits >= MIN_SHOTS) out.push({ code: 'outdamaged', dealt: f.dealt.damage, taken: f.taken.damage })
  const top = f.taken.parties[0]
  if (top && f.taken.parties.length > 1 && f.taken.damage > 0 && top.damage / f.taken.damage >= 0.5) {
    out.push({ code: 'focus', who: top.who, percent: Math.round((top.damage / f.taken.damage) * 100) })
  }
  if (f.ewar.length) out.push({ code: 'tackled', lines: f.ewar.length })
  return out
}
