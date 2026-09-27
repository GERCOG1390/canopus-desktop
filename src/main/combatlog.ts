// Follows the game log (Documents\EVE\logs\Gamelogs) of the active character: damage dealt and taken,
// bounties and system changes, for the ratting tracker. The format is the same in every client language:
// colours mark outgoing (cyan) and incoming (red) damage, <localized hint="…"> carries English names.

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CombatLogEvent } from '../shared/ratting'
import { defaultLogDir } from './intel'
import { loadSettings } from './storage'

type Send = (channel: string, payload: unknown) => void

const LINE_RE = /^\[\s*(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})\s*\]\s*\((\w+)\)\s*(.*)$/
const HINT_RE = /<localized hint="([^"]+)">/g

const gamelogDir = (): string | null => {
  const chat = loadSettings().intel.logDir || defaultLogDir()
  if (!chat) return null
  const dir = join(dirname(chat), 'Gamelogs')
  return existsSync(dir) ? dir : null
}

function parse(line: string): CombatLogEvent | null {
  const m = LINE_RE.exec(line)
  if (!m) return null
  const [, y, mo, d, h, mi, s, kind, body] = m
  const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
  const hints = [...body.matchAll(HINT_RE)].map((x) => x[1])
  if (kind === 'combat') {
    const dmg = /<color=0x(ff00ffff|ffcc0000)><b>(\d+)<\/b>/.exec(body)
    if (!dmg) return null
    const out = dmg[1] === 'ff00ffff'
    return { t, kind: out ? 'out' : 'in', amount: Number(dmg[2]), who: hints[0] ?? '', weapon: hints[1] }
  }
  if (kind === 'bounty') {
    const isk = /<b>[^<]*?([\d][\d\s.,']*)\s*ISK<\/b>/.exec(body.replace(/<color=[^>]+>/g, ''))
    if (!isk) return null
    const amount = Number(isk[1].replace(/[\s.,' ]/g, ''))
    return amount ? { t, kind: 'bounty', amount, who: '' } : null
  }
  if (kind === 'None' && hints.length) {
    // Undocking ("…into the solar system X") or jumping ("from X to Y"): the last hint is where you are.
    return { t, kind: 'system', amount: 0, who: hints[hints.length - 1] }
  }
  return null
}

class GameLogWatcher {
  private timer: NodeJS.Timeout | null = null
  private file: string | null = null
  private offset = 0
  private partial = ''
  private lastScan = 0
  events: CombatLogEvent[] = []

  constructor(private readonly send: Send) {}

  restart(): void {
    this.stop()
    this.file = null
    this.events = []
    this.timer = setInterval(() => this.tick(), 1000)
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private newest(dir: string): string | null {
    const charId = loadSettings().activeCharacterId
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.txt') && (!charId || f.endsWith(`_${charId}.txt`)))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    return files[0] ? join(dir, files[0].f) : null
  }

  private tick(): void {
    try {
      const dir = gamelogDir()
      if (!dir) return
      if (!this.file || Date.now() - this.lastScan > 10_000) {
        this.lastScan = Date.now()
        const newest = this.newest(dir)
        if (newest && newest !== this.file) {
          this.file = newest
          this.offset = 0
          this.partial = ''
          this.events = []
          this.send('ratting:reset', { file: newest })
        }
      }
      if (this.file) this.read()
    } catch {
      // A log rotated away mid-read: picked up on the next scan.
    }
  }

  private read(): void {
    const file = this.file!
    const size = statSync(file).size
    if (size < this.offset) this.offset = 0
    if (size === this.offset) return
    const fd = openSync(file, 'r')
    let text: string
    try {
      const buf = Buffer.alloc(size - this.offset)
      readSync(fd, buf, 0, buf.length, this.offset)
      text = this.partial + buf.toString('utf8')
    } finally {
      closeSync(fd)
    }
    this.offset = size
    const lines = text.split(/\r?\n/)
    this.partial = lines.pop() ?? ''
    const fresh = lines.map(parse).filter((e): e is CombatLogEvent => !!e)
    if (!fresh.length) return
    this.events.push(...fresh)
    this.send('ratting:events', fresh)
  }
}

let watcher: GameLogWatcher | null = null

export function initCombatLog(send: Send): void {
  watcher = new GameLogWatcher(send)
  watcher.restart()
}

export const restartCombatLog = (): void => watcher?.restart()

/** Everything parsed from the current log file (for a window opened later). */
export const combatLogEvents = (): CombatLogEvent[] => watcher?.events ?? []
