import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import type { RequestOptions, Settings } from '../shared/types'
import * as auth from './auth'
import { request } from './http'
import * as sde from './sde'
import * as dogma from './dogma'
import { handleIconScheme, registerIconScheme } from './icons'
import type { FitSpec, SkillSource } from '../shared/fit'
import type { IntelSettings, OverlaySummary } from '../shared/intel'
import * as intel from './intel'
import { loadSettings, saveSettings } from './storage'

let mainWindow: BrowserWindow | null = null

function openExternal(url: string): void {
  if (/^https:\/\//i.test(url)) void shell.openExternal(url)
}

function createWindow(): void {
  const settings = loadSettings()
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'Canopus',
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    alwaysOnTop: settings.alwaysOnTop,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      // Keep scanning clipboard/log events while the window sits behind the game.
      backgroundThrottling: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(mainWindow)
  // The overlay is a secondary window: closing the main window quits the app.
  mainWindow.on('closed', () => {
    mainWindow = null
    app.quit()
  })
}

const PRELOAD = join(__dirname, '../preload/index.js')

function loadRenderer(win: BrowserWindow, hash = ''): void {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? `#${hash}` : ''))
  else void win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

const sendToMain = (channel: string, payload: unknown): void => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function registerIpc(): void {
  ipcMain.handle('http:request', (_e, url: string, options?: RequestOptions) => request(url, options))

  ipcMain.handle('auth:login', () => auth.login())
  ipcMain.handle('auth:characters', () => auth.characters())
  ipcMain.handle('auth:logout', (_e, characterId: number) => auth.logout(characterId))
  ipcMain.handle('auth:callbackUrl', () => auth.CALLBACK_URL)
  ipcMain.handle('auth:scopes', () => auth.SCOPES)

  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const prev = loadSettings()
    const next = { ...prev, ...patch }
    saveSettings(next)
    mainWindow?.setAlwaysOnTop(next.alwaysOnTop)
    if (patch.intel) {
      intel.applyClipboardSetting()
      intel.applyOverlay(loadRenderer, PRELOAD)
    }
    if (patch.activeCharacterId !== undefined || patch.intel?.logDir !== prev.intel.logDir) intel.restartLog()
    return next
  })

  ipcMain.handle('intel:restartLog', () => intel.restartLog())
  ipcMain.handle('intel:publish', (_e, summary: OverlaySummary) => intel.publish(summary))
  ipcMain.handle('intel:lastSummary', () => intel.getLastSummary())
  ipcMain.handle('intel:notify', (_e, title: string, body: string) => intel.notify(title, body))
  ipcMain.handle('intel:setOverlay', (_e, patch: Partial<IntelSettings['overlay']>) => {
    intel.setOverlay(patch, loadRenderer, PRELOAD)
    sendToMain('intel:settingsChanged', null)
  })
  ipcMain.handle('intel:resolveTypeNames', (_e, names: string[]) => sde.resolveTypeNames(names))

  ipcMain.handle('shell:openExternal', (_e, url: string) => openExternal(url))

  ipcMain.handle('sde:status', () => sde.getStatus())
  ipcMain.handle('sde:update', () => sde.initSde())
  ipcMain.handle('sde:basics', (_e, ids: number[]) => sde.basics(ids))
  ipcMain.handle('sde:search', (_e, q: string, opts) => sde.search(q, opts))
  ipcMain.handle('sde:searchSystems', (_e, q: string, limit?: number) => sde.searchSystems(q, limit))
  ipcMain.handle('sde:system', (_e, id: number) => sde.system(id))
  ipcMain.handle('sde:info', (_e, id: number) => sde.info(id))
  ipcMain.handle('sde:skillCatalog', () => sde.skillCatalog())
  ipcMain.handle('sde:attributeIcons', () => sde.attributeIcons())
  ipcMain.handle('sde:groupNames', (_e, ids: number[]) => sde.groupNames(ids))
  ipcMain.handle('sde:requiredSkills', (_e, ids: number[]) => sde.requiredSkills(ids))
  ipcMain.handle('sde:dogmaAttrs', (_e, ids: number[], attrIds: number[]) => sde.dogmaAttrs(ids, attrIds))
  ipcMain.handle('sde:blueprintForProduct', (_e, id: number) => sde.blueprintForProduct(id))

  ipcMain.handle('fit:calculate', (_e, spec: FitSpec, skills: SkillSource) => dogma.calculateFit(spec, skills))
  ipcMain.handle('fit:catalog', () => sde.fittingCatalog())
  ipcMain.handle('fit:explain', (_e, spec: FitSpec, skills: SkillSource, target: string, attr: number) => dogma.explainAttr(spec, skills, target, attr))
  ipcMain.handle('fit:charges', (_e, id: number) => sde.chargesFor(id))
  ipcMain.handle('fit:list', () => dogma.listFits())
  ipcMain.handle('fit:save', (_e, fit: FitSpec & { id?: string }) => dogma.saveFit(fit))
  ipcMain.handle('fit:delete', (_e, id: string) => dogma.deleteFit(id))
}

// Register Canopus as the handler for eveauthcanopus:// links (the EVE SSO callback).
// In development electron.exe needs the app path as an extra argument.
if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient(auth.PROTOCOL, process.execPath, [resolve(process.argv[1])])
} else {
  app.setAsDefaultProtocolClient(auth.PROTOCOL)
}

// On Windows the callback link launches a second instance; forward its URL to the first one.
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => a.toLowerCase().startsWith(`${auth.PROTOCOL}://`))
    if (url) auth.handleCallbackUrl(url)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

registerIconScheme()

app.whenReady().then(() => {
  if (!primaryInstance) return
  handleIconScheme()
  auth.initAuth()
  registerIpc()
  createWindow()
  void sde.initSde()
  intel.initIntel(sendToMain)
  intel.applyOverlay(loadRenderer, PRELOAD)
  intel.registerShortcuts(loadRenderer, PRELOAD, () => sendToMain('intel:settingsChanged', null))
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
