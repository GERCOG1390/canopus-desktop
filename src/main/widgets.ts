// Overlay mini-windows (timers, price lookup, wallet): frameless, translucent, always on top, each
// remembering where it was put. Same look and behaviour as the intel overlay.

import { BrowserWindow, screen } from 'electron'
import appIconPath from '../../build/icon.png?asset'
import { WIDGET_SIZE, WIDGET_VIEWS, type WidgetSettings, type WidgetView } from '../shared/widgets'
import { loadSettings, saveSettings } from './storage'

type Load = (w: BrowserWindow, hash: string) => void

const windows = new Map<WidgetView, BrowserWindow>()
const saveTimers = new Map<WidgetView, NodeJS.Timeout>()

function update(fn: (w: WidgetSettings) => WidgetSettings): WidgetSettings {
  const s = loadSettings()
  const widgets = fn(s.widgets)
  saveSettings({ ...s, widgets })
  return widgets
}

function create(view: WidgetView, load: Load, preload: string): BrowserWindow {
  const cfg = loadSettings().widgets
  const area = screen.getPrimaryDisplay().workArea
  const size = WIDGET_SIZE[view]
  // New windows cascade down the left edge so they don't land on top of each other.
  const i = WIDGET_VIEWS.indexOf(view)
  const b = cfg.views[view]?.bounds ?? { ...size, x: area.x + 20, y: area.y + 80 + i * (size.height + 16) }
  const win = new BrowserWindow({
    icon: appIconPath,
    ...b,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: `Canopus — ${view}`,
    webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setOpacity(cfg.opacity)
  const saveBounds = () => {
    clearTimeout(saveTimers.get(view))
    saveTimers.set(
      view,
      setTimeout(() => {
        if (win.isDestroyed()) return
        const bounds = win.getBounds()
        update((w) => ({ ...w, views: { ...w.views, [view]: { ...w.views[view], enabled: true, bounds } } }))
      }, 500)
    )
  }
  win.on('move', saveBounds)
  win.on('resize', saveBounds)
  win.on('closed', () => windows.delete(view))
  load(win, `widget-${view}`)
  return win
}

/** Opens and closes the mini-windows to match the settings. */
export function applyWidgets(load: Load, preload: string): void {
  const cfg = loadSettings().widgets
  for (const view of WIDGET_VIEWS) {
    const on = !!cfg.views[view]?.enabled
    const win = windows.get(view)
    if (!on && win) {
      win.close()
      windows.delete(view)
    } else if (on) {
      const w = win ?? create(view, load, preload)
      windows.set(view, w)
      w.setOpacity(cfg.opacity)
    }
  }
}

export function setWidget(view: WidgetView, enabled: boolean, load: Load, preload: string): WidgetSettings {
  const w = update((s) => ({ ...s, views: { ...s.views, [view]: { ...s.views[view], enabled } } }))
  applyWidgets(load, preload)
  return w
}

export function setWidgetOpacity(opacity: number, load: Load, preload: string): WidgetSettings {
  const w = update((s) => ({ ...s, opacity }))
  applyWidgets(load, preload)
  return w
}
