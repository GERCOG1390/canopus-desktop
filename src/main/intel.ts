// Intel sources that don't touch the game client: the Local chat log on disk and the clipboard
// (the player copies Local / D-scan / fleet window with Ctrl+A, Ctrl+C). Plus the overlay window.

import { app, BrowserWindow, clipboard, globalShortcut, Notification, screen } from 'electron'
import { existsSync, openSync, readSync, closeSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ChannelInfo, ClipboardKind, IntelReport, IntelSettings, LogEvent, OverlaySummary } from '../shared/intel'
import { isLoaded as sdeLoaded, parseIntelMessage } from './sde'
import { loadSettings, saveSettings } from './storage'

type Send = (channel: string, payload: unknown) => void

// ---------------- Local chat log ----------------

const LINE_RE = /^﻿?\[\s*(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2})\s*\]\s*(.+?) > (.*)$/
const SYSTEM_SPEAKERS = new Set(['EVE System', 'Система EVE', 'EVE-System', 'Système EVE', 'EVEシステム', '系统'])

export function defaultLogDir(): string | null {
  const candidates = [
    join(app.getPath('documents'), 'EVE', 'logs', 'Chatlogs'),
    join(app.getPath('home'), 'OneDrive', 'Documents', 'EVE', 'logs', 'Chatlogs'),
    join(app.getPath('home'), 'Documents', 'EVE', 'logs', 'Chatlogs')
  ]
  return candidates.find((d) => existsSync(d)) ?? null
}

function readUtf16(file: string, start: number, end: number): string {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(end - start)
    readSync(fd, buf, 0, buf.length, start)
    return buf.toString('utf16le')
  } finally {
    closeSync(fd)
  }
}

interface LogHeader {
  id: string
  name: string
}

const headerCache = new Map<string, LogHeader>()

/** "Channel ID" and "Channel Name" from a chat log's header (cached per file). */
function readHeader(file: string): LogHeader | null {
  let known = headerCache.get(file)
  if (!known) {
    try {
      const head = readUtf16(file, 0, Math.min(2000, statSync(file).size))
      const id = /Channel ID:\s+(.+)/.exec(head)?.[1].trim()
      const name = /Channel Name:\s+(.+)/.exec(head)?.[1].trim()
      // A header still being written may be incomplete: only complete ones are cached.
      if (id && name) headerCache.set(file, (known = { id, name }))
    } catch {
      // unreadable file
    }
  }
  return known ?? null
}

const isLocalLog = (file: string): boolean => readHeader(file)?.id.toLowerCase() === 'local'

class LocalLogWatcher {
  private timer: NodeJS.Timeout | null = null
  private file: string | null = null
  private offset = 0
  private partial = ''
  private lastScanDir = 0

  constructor(private readonly send: Send) {}

  restart(): void {
    this.stop()
    this.file = null
    this.timer = setInterval(() => this.tick(), 1000)
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private emit(e: LogEvent): void {
    this.send('intel:log', e)
  }

  private findNewest(dir: string, charId: number | null): string | null {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.txt') && (!charId || f.endsWith(`_${charId}.txt`)))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const { f } of files.slice(0, 40)) if (isLocalLog(join(dir, f))) return join(dir, f)
    return null
  }

  private tick(): void {
    try {
      const settings = loadSettings()
      const dir = settings.intel.logDir || defaultLogDir()
      if (!dir || !existsSync(dir)) {
        this.emit({ type: 'status', file: null, dir, error: 'Папка логов чата EVE не найдена' })
        this.stop()
        return
      }
      // Look for a newer Local log (new session / relog) every few seconds.
      if (!this.file || Date.now() - this.lastScanDir > 5000) {
        this.lastScanDir = Date.now()
        const newest = this.findNewest(dir, settings.activeCharacterId)
        if (newest && newest !== this.file) {
          this.file = newest
          this.offset = 0
          this.partial = ''
          this.emit({ type: 'status', file: newest, dir })
          this.read(true)
          return
        }
        if (!newest && !this.file) this.emit({ type: 'status', file: null, dir, error: 'Лог Local не найден — зайдите в игру' })
      }
      if (this.file) this.read(false)
    } catch (err) {
      this.emit({ type: 'status', file: this.file, dir: null, error: (err as Error).message })
    }
  }

  private read(initial: boolean): void {
    const file = this.file!
    const size = statSync(file).size
    if (size < this.offset) this.offset = 0
    if (size === this.offset) return
    const text = this.partial + readUtf16(file, this.offset, size - ((size - this.offset) % 2))
    this.offset = size - ((size - this.offset) % 2)
    const lines = text.split(/\r?\n/)
    this.partial = lines.pop() ?? ''

    let lastSystem: LogEvent | null = null
    const speakers = new Map<string, string>()
    const recentCutoff = Date.now() - 30 * 60_000
    for (const line of lines) {
      const m = LINE_RE.exec(line)
      if (!m) continue
      const [, at, speaker, message] = m
      if (SYSTEM_SPEAKERS.has(speaker)) {
        const sys = /:\s*([^:]+?)\*?\s*$/.exec(message)
        if (sys) lastSystem = { type: 'system', system: sys[1].trim(), at, initial }
        if (!initial && lastSystem) {
          this.emit(lastSystem)
          lastSystem = null
        }
        continue
      }
      if (initial) {
        if (parseLogTime(at) > recentCutoff) speakers.set(speaker, at)
      } else this.emit({ type: 'speaker', name: speaker, at, initial })
    }
    if (initial && lastSystem) this.emit(lastSystem)
    for (const [name, at] of speakers) this.emit({ type: 'speaker', name, at, initial })
  }
}

/** Log timestamps are EVE time (UTC). */
function parseLogTime(at: string): number {
  const [d, t] = at.split(' ')
  return Date.parse(`${d.replace(/\./g, '-')}T${t}Z`)
}

// ---------------- Intel channels ----------------

const CLEAR_RE = /(^|[^\p{L}])(clr|clear|nv|no visual|чисто|клир)([^\p{L}]|$)/iu
/** Chat logs older than this are not considered when looking for channels. */
const CHANNEL_MAX_AGE = 14 * 86400_000

const logDir = (): string | null => {
  const dir = loadSettings().intel.logDir || defaultLogDir()
  return dir && existsSync(dir) ? dir : null
}

/** Session start from a log file name ("Channel_20260926_034108_2112345678.txt"), ms UTC. */
function sessionStart(file: string): number | null {
  const m = /_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_\d+)?\.txt$/.exec(file)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null
}

/** Chat channels seen in recent logs, newest first (Local is left out). */
export function listChannels(maxAge = CHANNEL_MAX_AGE): ChannelInfo[] {
  const dir = logDir()
  if (!dir) return []
  const seen = new Map<string, ChannelInfo>()
  const cutoff = Date.now() - maxAge
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.txt')) continue
    // Skip old sessions by name, without touching the file.
    const started = sessionStart(f)
    if (started !== null && started < cutoff) continue
    const file = join(dir, f)
    const mtime = statSync(file).mtimeMs
    if (mtime < cutoff) continue
    const h = readHeader(file)
    if (!h || h.id.toLowerCase() === 'local') continue
    const key = h.name.toLowerCase()
    const prev = seen.get(key)
    if (!prev || prev.lastSeen < mtime) seen.set(key, { name: h.name, lastSeen: mtime, file })
  }
  return [...seen.values()].sort((a, b) => b.lastSeen - a.lastSeen)
}

interface Followed {
  channel: string
  file: string
  offset: number
  partial: string
}

/** Follows the newest log of every watched intel channel and reports new lines. */
class ChannelWatcher {
  private timer: NodeJS.Timeout | null = null
  private followed = new Map<string, Followed>()
  private lastScan = 0
  private startedAt = Date.now()
  /** Recent reports, so a window opened (or reloaded) later still gets the history. */
  readonly recent: IntelReport[] = []

  constructor(private readonly send: Send) {}

  restart(): void {
    this.stop()
    this.followed.clear()
    this.lastScan = 0
    this.startedAt = Date.now()
    if (!loadSettings().intel.channels.length) return
    this.timer = setInterval(() => this.tick(), 1000)
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  status(): ChannelInfo[] {
    return loadSettings().intel.channels.map((name) => {
      const f = this.followed.get(name.toLowerCase())
      return { name, lastSeen: f ? statSync(f.file).mtimeMs : 0, file: f?.file }
    })
  }

  private tick(): void {
    // Messages are parsed against the SDE (systems, ships, stargates): wait until it is loaded.
    if (!sdeLoaded()) return
    try {
      const watched = loadSettings().intel.channels
      if (Date.now() - this.lastScan > 5000) {
        this.lastScan = Date.now()
        const known = new Map(listChannels(7 * 86400_000).map((c) => [c.name.toLowerCase(), c]))
        let changed = false
        for (const name of watched) {
          const key = name.toLowerCase()
          const newest = known.get(key)
          const current = this.followed.get(key)
          if (newest?.file && newest.file !== current?.file) {
            this.followed.set(key, { channel: newest.name, file: newest.file, offset: 0, partial: '' })
            changed = true
          }
        }
        if (changed) this.send('intel:channels', this.status())
      }
      for (const f of this.followed.values()) this.read(f)
    } catch {
      // A log rotated away mid-read: picked up again on the next scan.
    }
  }

  private read(f: Followed): void {
    const size = statSync(f.file).size
    if (size < f.offset) f.offset = 0
    if (size === f.offset) return
    const firstRead = f.offset === 0
    const end = size - ((size - f.offset) % 2)
    const text = f.partial + readUtf16(f.file, f.offset, end)
    f.offset = end
    const lines = text.split(/\r?\n/)
    f.partial = lines.pop() ?? ''
    // On the first read of a log only the last 20 minutes matter.
    const cutoff = firstRead ? Date.now() - 20 * 60_000 : 0
    for (const line of lines) {
      const m = LINE_RE.exec(line)
      if (!m) continue
      const [, at, speaker, message] = m
      if (SYSTEM_SPEAKERS.has(speaker)) continue
      const time = parseLogTime(at)
      if (time < cutoff) continue
      const { systems, ships } = parseIntelMessage(message)
      const report: IntelReport = {
        // Stable across re-reads, so the window can de-duplicate.
        id: `${f.channel}|${time}|${speaker}|${message.length}|${message.slice(0, 40)}`,
        channel: f.channel,
        at: new Date(time).toISOString(),
        speaker,
        message: message.trim(),
        systems,
        ships,
        clear: CLEAR_RE.test(message),
        // Lines written before Canopus started are history, not alerts.
        initial: time < this.startedAt - 2000
      }
      this.recent.push(report)
      if (this.recent.length > 300) this.recent.splice(0, this.recent.length - 300)
      this.send('intel:report', report)
    }
  }
}

// ---------------- Clipboard ----------------

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 '\-._]{1,36}$/

export function classifyClipboard(text: string): ClipboardKind | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length || lines.length > 3000) return null
  const tabbed = lines.filter((l) => l.includes('\t'))
  if (tabbed.length >= lines.length * 0.8) {
    // Probe scanner rows start with a signature ID: "ABC-123<TAB>Cosmic Signature<TAB>Data Site<TAB>…"
    if (tabbed.filter((l) => /^[A-Z]{3}-\d{3}\t/.test(l)).length >= tabbed.length * 0.8) return 'probe'
    // D-scan rows start with a type ID: "11190<TAB>Name<TAB>Sabre<TAB>1 234 km"
    if (tabbed.filter((l) => /^\d+\t/.test(l)).length >= tabbed.length * 0.8) return 'dscan'
    if (tabbed.every((l) => l.split('\t').length >= 3)) return 'fleet'
    return null
  }
  // A Local member list: one character name per line.
  if (lines.length >= 2 && lines.every((l) => NAME_RE.test(l) && !/\s{2,}/.test(l))) return 'local'
  return null
}

class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null
  private last = ''

  constructor(private readonly send: Send) {}

  private busy = false

  start(): void {
    if (this.timer) return
    void Promise.resolve(clipboard.readText()).then((t) => (this.last = t))
    this.timer = setInterval(async () => {
      if (this.busy) return
      this.busy = true
      try {
        const text = await Promise.resolve(clipboard.readText())
        if (text === this.last) return
        this.last = text
        const kind = classifyClipboard(text)
        if (kind) this.send('intel:clipboard', { kind, text })
      } finally {
        this.busy = false
      }
    }, 400)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

// ---------------- Overlay ----------------

let overlay: BrowserWindow | null = null
let lastSummary: OverlaySummary | null = null
let saveBoundsTimer: NodeJS.Timeout | null = null

function updateIntelSettings(fn: (i: IntelSettings) => IntelSettings): IntelSettings {
  const s = loadSettings()
  const intel = fn(s.intel)
  saveSettings({ ...s, intel })
  return intel
}

function createOverlay(load: (w: BrowserWindow, hash: string) => void, preload: string): void {
  const { overlay: cfg } = loadSettings().intel
  const area = screen.getPrimaryDisplay().workArea
  const b = cfg.bounds ?? { width: 300, height: 420, x: area.x + area.width - 320, y: area.y + 120 }
  overlay = new BrowserWindow({
    ...b,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: true,
    title: 'Canopus — оверлей',
    webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setOpacity(cfg.opacity)
  overlay.setIgnoreMouseEvents(cfg.clickThrough, { forward: true })
  const saveBounds = () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
    saveBoundsTimer = setTimeout(() => {
      if (overlay && !overlay.isDestroyed()) {
        const bounds = overlay.getBounds()
        updateIntelSettings((i) => ({ ...i, overlay: { ...i.overlay, bounds } }))
      }
    }, 500)
  }
  overlay.on('move', saveBounds)
  overlay.on('resize', saveBounds)
  overlay.on('closed', () => (overlay = null))
  load(overlay, 'overlay')
}

export function applyOverlay(load: (w: BrowserWindow, hash: string) => void, preload: string): void {
  const cfg = loadSettings().intel.overlay
  if (!cfg.enabled) {
    overlay?.close()
    overlay = null
    return
  }
  if (!overlay) createOverlay(load, preload)
  overlay!.setOpacity(cfg.opacity)
  overlay!.setIgnoreMouseEvents(cfg.clickThrough, { forward: true })
}

export function setOverlay(patch: Partial<IntelSettings['overlay']>, load: (w: BrowserWindow, hash: string) => void, preload: string): IntelSettings {
  const intel = updateIntelSettings((i) => ({ ...i, overlay: { ...i.overlay, ...patch } }))
  applyOverlay(load, preload)
  return intel
}

// ---------------- Wiring ----------------

let logWatcher: LocalLogWatcher | null = null
let clipWatcher: ClipboardWatcher | null = null
let channelWatcher: ChannelWatcher | null = null

export function initIntel(send: Send): void {
  logWatcher = new LocalLogWatcher(send)
  clipWatcher = new ClipboardWatcher(send)
  channelWatcher = new ChannelWatcher(send)
  logWatcher.restart()
  channelWatcher.restart()
  applyClipboardSetting()
}

export function restartLog(): void {
  logWatcher?.restart()
}

/** Re-read the watched intel channels (after the channel list or log folder changed). */
export function restartChannels(): void {
  channelWatcher?.restart()
}

export const channelStatus = (): ChannelInfo[] => channelWatcher?.status() ?? []

export const recentReports = (): IntelReport[] => channelWatcher?.recent ?? []

export function applyClipboardSetting(): void {
  if (loadSettings().intel.clipboard) clipWatcher?.start()
  else clipWatcher?.stop()
}

export function publish(summary: OverlaySummary): void {
  lastSummary = summary
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('intel:summary', summary)
}

export const getLastSummary = (): OverlaySummary | null => lastSummary

export function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show()
}

/** Ctrl+Shift+L — show/hide the overlay, Ctrl+Shift+K — toggle click-through. */
export function registerShortcuts(load: (w: BrowserWindow, hash: string) => void, preload: string, onChange: () => void): void {
  globalShortcut.register('CommandOrControl+Shift+L', () => {
    const cfg = loadSettings().intel.overlay
    setOverlay({ enabled: !cfg.enabled }, load, preload)
    onChange()
  })
  globalShortcut.register('CommandOrControl+Shift+K', () => {
    const cfg = loadSettings().intel.overlay
    setOverlay({ clickThrough: !cfg.clickThrough }, load, preload)
    onChange()
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
}
