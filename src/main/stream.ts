// Streamer mode: a small HTTP server on 127.0.0.1 with widget pages for OBS (Browser source) and
// /api/state they poll. The data comes from ESI and zKillboard for one character: ship, system
// (optionally delayed against stream sniping), wallet change and kills / losses this session.

import { createServer, type Server } from 'node:http'
import type { StreamKill, StreamSettings, StreamState, StreamStatus, StreamWidget } from '../shared/stream'
import { STREAM_WIDGETS } from '../shared/stream'
import * as auth from './auth'
import { request } from './http'
import { loadSettings } from './storage'

const ESI = 'https://esi.evetech.net/latest'
const POLL_MS = 15_000
const SLOW_POLL_MS = 120_000

let server: Server | null = null
let status: StreamStatus = { running: false, url: null, error: null }
let pollTimer: NodeJS.Timeout | null = null
let slowTimer: NodeJS.Timeout | null = null
let onStatus: (s: StreamStatus) => void = () => {}

let state: StreamState = emptyState()
/** Every system the character was in, with when they got there: the delayed view picks from it. */
let trail: { at: number; system: NonNullable<StreamState['system']> }[] = []
let walletStart: number | null = null
const seenKills = new Set<number>()

function emptyState(): StreamState {
  return {
    character: null,
    ship: null,
    system: null,
    delayMin: 0,
    session: { startedAt: new Date().toISOString(), walletChange: null, kills: 0, losses: 0, iskDestroyed: 0, iskLost: 0 },
    killfeed: [],
    updatedAt: new Date().toISOString()
  }
}

const cfg = (): StreamSettings => loadSettings().stream
const esi = async <T>(path: string, characterId?: number): Promise<T> => (await request(ESI + path, characterId ? { characterId } : {})) as T

const names = new Map<string, string>()
async function cached(key: string, load: () => Promise<string>): Promise<string> {
  if (!names.has(key)) names.set(key, await load().catch(() => '?'))
  return names.get(key)!
}
const typeName = (id: number) => cached(`t${id}`, async () => (await esi<{ name: string }>(`/universe/types/${id}/`)).name)
const charName = (id: number) => cached(`c${id}`, async () => (await esi<{ name: string }>(`/characters/${id}/`)).name)

async function systemInfo(id: number): Promise<NonNullable<StreamState['system']>> {
  const s = await esi<{ name: string; security_status: number; constellation_id: number }>(`/universe/systems/${id}/`)
  const region = await cached(`k${s.constellation_id}`, async () => {
    const c = await esi<{ region_id: number }>(`/universe/constellations/${s.constellation_id}/`)
    return (await esi<{ name: string }>(`/universe/regions/${c.region_id}/`)).name
  })
  return { name: s.name, security: s.security_status, region }
}

function characterId(): number | null {
  const s = loadSettings()
  const id = s.stream.characterId ?? s.activeCharacterId
  return id && auth.characters().some((c) => c.id === id) ? id : null
}

/** The system to show: the latest one reached at least `delay` minutes ago. */
function shownSystem(): StreamState['system'] {
  const delay = cfg().locationDelayMin
  if (delay < 0) return null
  const cutoff = Date.now() - delay * 60_000
  for (let i = trail.length - 1; i >= 0; i--) if (trail[i].at <= cutoff) return trail[i].system
  return null
}

async function pollFast(): Promise<void> {
  const id = characterId()
  if (!id) return
  state.character = { id, name: await charName(id) }
  const [loc, ship] = await Promise.all([
    esi<{ solar_system_id: number }>(`/characters/${id}/location/`, id).catch(() => null),
    esi<{ ship_type_id: number; ship_name: string }>(`/characters/${id}/ship/`, id).catch(() => null)
  ])
  if (ship) state.ship = { typeId: ship.ship_type_id, typeName: await typeName(ship.ship_type_id), name: ship.ship_name }
  if (loc) {
    const sys = await systemInfo(loc.solar_system_id)
    if (trail[trail.length - 1]?.system.name !== sys.name) trail.push({ at: Date.now(), system: sys })
    // Keep a little more than the longest delay.
    trail = trail.filter((t, i) => i === trail.length - 1 || Date.now() - t.at < 70 * 60_000)
  }
  state.system = shownSystem()
  state.delayMin = Math.max(0, cfg().locationDelayMin)
  state.updatedAt = new Date().toISOString()
}

async function pollSlow(): Promise<void> {
  const id = characterId()
  if (!id) return
  if (cfg().showWallet) {
    const wallet = await esi<number>(`/characters/${id}/wallet/`, id).catch(() => null)
    if (wallet !== null) {
      walletStart ??= wallet
      state.session.walletChange = wallet - walletStart
    }
  } else state.session.walletChange = null
  // zKillboard: the character's recent kills and losses, details from ESI.
  const recent = (await request(`https://zkillboard.com/api/characterID/${id}/`).catch(() => [])) as { killmail_id: number; zkb: { hash: string; totalValue: number } }[]
  const feed: StreamKill[] = []
  for (const k of recent.slice(0, 10)) {
    const km = await esi<{
      killmail_time: string
      victim: { character_id?: number; ship_type_id: number }
      attackers: { character_id?: number; final_blow: boolean; ship_type_id?: number }[]
    }>(`/killmails/${k.killmail_id}/${k.zkb.hash}/`).catch(() => null)
    if (!km) continue
    const loss = km.victim.character_id === id
    const final = km.attackers.find((a) => a.final_blow)
    const otherId = loss ? final?.character_id : km.victim.character_id
    feed.push({
      id: k.killmail_id,
      at: km.killmail_time,
      loss,
      shipTypeId: km.victim.ship_type_id,
      shipName: await typeName(km.victim.ship_type_id),
      other: otherId ? await charName(otherId) : '—',
      isk: k.zkb.totalValue
    })
    // Session totals: killmails since the session started, each counted once.
    if (Date.parse(km.killmail_time) >= Date.parse(state.session.startedAt) && !seenKills.has(k.killmail_id)) {
      seenKills.add(k.killmail_id)
      if (loss) {
        state.session.losses++
        state.session.iskLost += k.zkb.totalValue
      } else {
        state.session.kills++
        state.session.iskDestroyed += k.zkb.totalValue
      }
    }
  }
  state.killfeed = feed.slice(0, 8)
}

/** Starts a new session: wallet change and kill counts from zero. */
export function resetSession(): void {
  state.session = emptyState().session
  walletStart = null
  seenKills.clear()
  void pollSlow().catch(() => {})
}

// ---------- Widget pages ----------

const PAGE_STYLE = `
  html, body { margin: 0; background: transparent; color: #f2f2ee; font: 600 22px/1.25 'Segoe UI', system-ui, -apple-system, sans-serif; }
  body { padding: 8px; text-shadow: 0 1px 3px #000, 0 0 8px #000; }
  .muted { color: #c9c9c2; font-weight: 500; font-size: .8em; }
  .row { display: flex; align-items: center; gap: 10px; }
  img { border-radius: 4px; box-shadow: 0 0 6px #000; }
  .kill { color: #7ee2a8; } .loss { color: #ff8c78; }
  .feed div { margin: 3px 0; }
`

const WIDGET_SCRIPT: Record<StreamWidget, string> = {
  ship: `s.ship ? '<div class="row"><img src="https://images.evetech.net/types/' + s.ship.typeId + '/render?size=64" width="56" height="56"><div>' + esc(s.ship.typeName) + '<div class="muted">' + esc(s.ship.name) + '</div></div></div>' : ''`,
  system: `s.system ? '<div>' + esc(s.system.name) + ' <span style="color:' + sec(s.system.security) + '">' + s.system.security.toFixed(1) + '</span><div class="muted">' + esc(s.system.region) + (s.delayMin ? ' · ' + s.delayMin + ' min ago' : '') + '</div></div>' : ''`,
  session: `'<div>' + (s.session.walletChange !== null ? '<div>' + (s.session.walletChange >= 0 ? '+' : '') + isk(s.session.walletChange) + ' ISK</div>' : '') + '<div class="muted">kills ' + s.session.kills + ' (' + isk(s.session.iskDestroyed) + ') · losses ' + s.session.losses + ' (' + isk(s.session.iskLost) + ')</div></div>'`,
  killfeed: `'<div class="feed">' + s.killfeed.slice(0, Number(q.get('n') || 5)).map(function (k) { return '<div class="row"><img src="https://images.evetech.net/types/' + k.shipTypeId + '/icon?size=32" width="28" height="28"><span class="' + (k.loss ? 'loss' : 'kill') + '">' + (k.loss ? 'LOSS' : 'KILL') + '</span> ' + esc(k.shipName) + ' <span class="muted">' + esc(k.other) + ' · ' + isk(k.isk) + '</span></div>' }).join('') + '</div>'`
}

function widgetPage(name: StreamWidget): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Canopus · ${name}</title><style>${PAGE_STYLE}</style></head>
<body><div id="w"></div><script>
var q = new URLSearchParams(location.search);
if (q.get('size')) document.documentElement.style.fontSize = q.get('size') + 'px';
function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }
function isk(v) { var a = Math.abs(v); return (v < 0 ? '-' : '') + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'b' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'm' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'k' : a.toFixed(0)) }
function sec(v) { var r = Math.round(v * 10) / 10; return r >= 0.5 ? '#5bd17f' : r > 0 ? '#e6881e' : '#d0446b' }
function tick() {
  fetch('/api/state').then(function (r) { return r.json() }).then(function (s) { document.getElementById('w').innerHTML = ${WIDGET_SCRIPT[name]} }).catch(function () {});
}
tick(); setInterval(tick, 3000);
</script></body></html>`
}

function indexPage(port: number): string {
  const links = STREAM_WIDGETS.map((w) => `<li><a href="/w/${w}">http://127.0.0.1:${port}/w/${w}</a></li>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Canopus stream widgets</title></head><body style="font-family:system-ui;background:#222;color:#eee"><h3>Canopus stream widgets</h3><ul>${links}</ul><p>Add a URL as a Browser source in OBS. Options: ?size=28 (font size), killfeed ?n=8.</p></body></html>`
}

// ---------- Server ----------

function setStatus(s: StreamStatus): void {
  status = s
  onStatus(status)
}

function stop(): void {
  if (pollTimer) clearInterval(pollTimer)
  if (slowTimer) clearInterval(slowTimer)
  pollTimer = slowTimer = null
  server?.close()
  server = null
}

/** Starts, restarts or stops the server to match the settings. */
export function apply(): void {
  stop()
  const s = cfg()
  // Another character: start over.
  if (state.character && state.character.id !== characterId()) {
    state = emptyState()
    trail = []
    walletStart = null
    seenKills.clear()
  }
  if (!s.enabled) return setStatus({ running: false, url: null, error: null })
  const srv = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (path === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      return res.end(JSON.stringify(state))
    }
    const w = /^\/w\/(\w+)$/.exec(path)?.[1] as StreamWidget | undefined
    if (w && STREAM_WIDGETS.includes(w)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(widgetPage(w))
    }
    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(indexPage(s.port))
    }
    res.writeHead(404).end()
  })
  srv.on('error', (e: NodeJS.ErrnoException) => {
    setStatus({ running: false, url: null, error: e.code === 'EADDRINUSE' ? `Порт ${s.port} занят — выберите другой` : e.message })
  })
  // Only this computer: OBS runs on the same machine.
  srv.listen(s.port, '127.0.0.1', () => setStatus({ running: true, url: `http://127.0.0.1:${s.port}`, error: null }))
  server = srv
  const fast = () => void pollFast().catch(() => {})
  const slow = () => void pollSlow().catch(() => {})
  fast()
  slow()
  pollTimer = setInterval(fast, POLL_MS)
  slowTimer = setInterval(slow, SLOW_POLL_MS)
}

export function streamStatus(): StreamStatus {
  return status
}

export function streamState(): StreamState {
  return state
}

export function initStream(send: (s: StreamStatus) => void): void {
  onStatus = send
  apply()
}
