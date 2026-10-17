// Multi-client previews: one always-on-top window with a live tile per EVE client (Electron's
// desktopCapturer, no native modules), and switching to a client by click or global hotkey.
// One action brings one window to the front; nothing is ever sent to the game.

import { BrowserWindow, desktopCapturer, globalShortcut, screen, systemPreferences } from 'electron'
import { execFile } from 'node:child_process'
import appIconPath from '../../build/icon.png?asset'
import { isClientTitle, type ClientWindow, type PreviewSettings } from '../shared/previews'
import { loadSettings, saveSettings } from './storage'

type Load = (w: BrowserWindow, hash: string) => void

let win: BrowserWindow | null = null
let saveTimer: NodeJS.Timeout | null = null
let current = 0
let registered: string[] = []

function update(fn: (p: PreviewSettings) => PreviewSettings): PreviewSettings {
  const s = loadSettings()
  const previews = fn(s.previews)
  saveSettings({ ...s, previews })
  return previews
}

/** EVE client windows, sorted by character name. */
export async function listClients(): Promise<ClientWindow[]> {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
  return sources
    .filter((s) => isClientTitle(s.name))
    .map((s) => ({ id: s.id, title: s.name, character: s.name.replace(/^EVE - /, '') }))
    .sort((a, b) => a.character.localeCompare(b.character))
}

/** macOS needs Screen Recording for the tiles and Accessibility for switching. */
export function permissions(): { screen: string; accessibility: boolean } {
  if (process.platform !== 'darwin') return { screen: 'granted', accessibility: true }
  return { screen: systemPreferences.getMediaAccessStatus('screen'), accessibility: systemPreferences.isTrustedAccessibilityClient(false) }
}

// ---------- Bringing a client to the front ----------

/**
 * Windows: user32 called straight from this process with koffi. Canopus has just received the
 * click or the hotkey, so Windows lets it hand the foreground over — no input is synthesised.
 */
let user32: { setForeground: (h: bigint) => boolean; show: (h: bigint, cmd: number) => boolean; isIconic: (h: bigint) => boolean } | null = null
function windowsApi(): typeof user32 {
  if (user32) return user32
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi')
    const lib = koffi.load('user32.dll')
    user32 = {
      setForeground: lib.func('bool __stdcall SetForegroundWindow(intptr_t hWnd)'),
      show: lib.func('bool __stdcall ShowWindow(intptr_t hWnd, int nCmdShow)'),
      isIconic: lib.func('bool __stdcall IsIconic(intptr_t hWnd)')
    }
  } catch {
    user32 = null
  }
  return user32
}

const nativeId = (sourceId: string): string => sourceId.split(':')[1] ?? ''

export function activate(client: ClientWindow): void {
  if (process.platform === 'win32') {
    const api = windowsApi()
    const h = BigInt(nativeId(client.id) || 0)
    if (!api || !h) return
    if (api.isIconic(h)) api.show(h, 9) // SW_RESTORE
    api.setForeground(h)
  } else if (process.platform === 'darwin') {
    // The window's title picks it among the EVE processes; System Events raises it.
    const title = client.title.replace(/"/g, '\\"')
    const script = `tell application "System Events"
  repeat with p in (every process whose background only is false)
    if exists (window "${title}" of p) then
      set frontmost of p to true
      perform action "AXRaise" of window "${title}" of p
      exit repeat
    end if
  end repeat
end tell`
    execFile('osascript', ['-e', script], () => {})
  } else {
    const xid = Number(nativeId(client.id)).toString(16)
    execFile('wmctrl', ['-i', '-a', `0x${xid}`], (err) => {
      if (err) execFile('xdotool', ['windowactivate', nativeId(client.id)], () => {})
    })
  }
}

/** Next / previous client in name order, from the last one switched to. */
async function step(dir: 1 | -1): Promise<void> {
  const clients = await listClients()
  if (!clients.length) return
  current = (current + dir + clients.length) % clients.length
  activate(clients[current])
  win?.webContents.send('previews:active', clients[current].id)
}

export function setActiveIndex(id: string, clients: ClientWindow[]): void {
  const i = clients.findIndex((c) => c.id === id)
  if (i >= 0) current = i
}

function registerKeys(): void {
  for (const k of registered) globalShortcut.unregister(k)
  registered = []
  const p = loadSettings().previews
  if (!p.enabled) return
  for (const [key, dir] of [
    [p.nextKey, 1],
    [p.prevKey, -1]
  ] as const) {
    if (key && globalShortcut.register(key, () => void step(dir))) registered.push(key)
  }
}

// ---------- The previews window ----------

function create(load: Load, preload: string): void {
  const p = loadSettings().previews
  const area = screen.getPrimaryDisplay().workArea
  const b = p.bounds ?? { width: p.tile * 3 + 40, height: Math.round((p.tile * 9) / 16) + 60, x: area.x + area.width - (p.tile * 3 + 60), y: area.y + 20 }
  win = new BrowserWindow({
    icon: appIconPath,
    ...b,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'Canopus — previews',
    webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  const save = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => win && !win.isDestroyed() && update((x) => ({ ...x, bounds: win!.getBounds() })), 500)
  }
  win.on('move', save)
  win.on('resize', save)
  win.on('closed', () => (win = null))
  load(win, 'previews')
}

export function applyPreviews(load: Load, preload: string): void {
  const p = loadSettings().previews
  if (!p.enabled) {
    win?.close()
    win = null
  } else if (!win) create(load, preload)
  else win.webContents.send('previews:settings', null)
  registerKeys()
}

export function setPreviews(patch: Partial<PreviewSettings>, load: Load, preload: string): PreviewSettings {
  const p = update((x) => ({ ...x, ...patch }))
  applyPreviews(load, preload)
  return p
}

