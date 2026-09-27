import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { join, resolve } from 'node:path'
import type { RequestOptions, Settings } from '../shared/types'
import * as auth from './auth'
import { request } from './http'
import * as sde from './sde'
import * as dogma from './dogma'
import * as combat from './dogma/combat'
import type { CombatPilot, CombatScenario } from '../shared/combat'
import { handleIconScheme, registerIconScheme } from './icons'
import type { FitSpec, SkillSource } from '../shared/fit'
import type { IntelSettings, OverlaySummary } from '../shared/intel'
import * as intel from './intel'
import { loadSettings, saveSettings } from './storage'
import * as notifier from './notifier'
import trayIconPath from '../../build/icon.png?asset'

// A separate profile (settings, tokens, SDE cache) — handy for testing and screenshots.
if (process.env.CANOPUS_USER_DATA) app.setPath('userData', process.env.CANOPUS_USER_DATA)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
/** Set when the app really quits (tray menu, update): closing the window then doesn't just hide it. */
let quitting = false

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
  // With the tray enabled, closing the window hides Canopus; notifications keep running.
  mainWindow.on('close', (e) => {
    if (quitting || !loadSettings().notify.tray || !tray) return
    e.preventDefault()
    mainWindow?.hide()
  })
  // The overlay is a secondary window: closing the main window quits the app.
  mainWindow.on('closed', () => {
    mainWindow = null
    app.quit()
  })
}

function showMain(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray(): void {
  const icon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('Canopus')
  const en = () => loadSettings().lang === 'en'
  const menu = () =>
    Menu.buildFromTemplate([
      { label: en() ? 'Open Canopus' : 'Открыть Canopus', click: showMain },
      {
        label: en() ? 'Intel overlay' : 'Оверлей разведки',
        type: 'checkbox',
        checked: loadSettings().intel.overlay.enabled,
        click: (item) => {
          intel.setOverlay({ enabled: item.checked }, loadRenderer, PRELOAD)
          sendToMain('intel:settingsChanged', null)
        }
      },
      { label: en() ? 'Check notifications now' : 'Проверить уведомления', click: () => void notifier.checkNow() },
      { type: 'separator' },
      {
        label: en() ? 'Quit' : 'Выход',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  tray.on('click', showMain)
  // Rebuilt on every open so the labels follow the language and the overlay state.
  tray.on('right-click', () => tray?.popUpContextMenu(menu()))
}

const PRELOAD = join(__dirname, '../preload/index.js')

function loadRenderer(win: BrowserWindow, hash = ''): void {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? `#${hash}` : ''))
  else void win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

// ---------- Combat simulator window ----------

let combatWindow: BrowserWindow | null = null
/** "Your" side: the fit open in the fitting tool, kept in sync while the simulator is open. */
let combatAttacker: CombatPilot | null = null

function openCombatWindow(): void {
  if (combatWindow && !combatWindow.isDestroyed()) {
    if (combatWindow.isMinimized()) combatWindow.restore()
    combatWindow.focus()
    return
  }
  combatWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: 'Canopus — симуляция боя',
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true }
  })
  combatWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  combatWindow.on('closed', () => (combatWindow = null))
  loadRenderer(combatWindow, 'combat')
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
    if (patch.intel && (patch.intel.logDir !== prev.intel.logDir || patch.intel.channels.join('\n') !== prev.intel.channels.join('\n'))) {
      intel.restartChannels()
    }
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
  ipcMain.handle('intel:listChannels', () => intel.listChannels())
  ipcMain.handle('intel:channelStatus', () => intel.channelStatus())
  ipcMain.handle('intel:recentReports', () => intel.recentReports())
  ipcMain.handle('intel:jumpsFrom', (_e, fromId: number, ids: number[]) => sde.jumpsFrom(fromId, ids))
  ipcMain.handle('intel:systemId', (_e, name: string) => sde.systemIdByName(name))

  ipcMain.handle('shell:openExternal', (_e, url: string) => openExternal(url))
  ipcMain.handle('notify:history', () => notifier.notifyHistory())
  ipcMain.handle('notify:checkNow', () => notifier.checkNow())

  ipcMain.handle('sde:status', () => sde.getStatus())
  ipcMain.handle('sde:update', () => sde.initSde())
  ipcMain.handle('sde:basics', (_e, ids: number[]) => sde.basics(ids))
  ipcMain.handle('sde:search', (_e, q: string, opts) => sde.search(q, opts))
  ipcMain.handle('sde:searchSystems', (_e, q: string, limit?: number) => sde.searchSystems(q, limit))
  ipcMain.handle('sde:system', (_e, id: number) => sde.system(id))
  ipcMain.handle('sde:wormholeTypes', () => sde.wormholeTypes())
  ipcMain.handle('sde:info', (_e, id: number) => sde.info(id))
  ipcMain.handle('sde:skillCatalog', () => sde.skillCatalog())
  ipcMain.handle('sde:attributeIcons', () => sde.attributeIcons())
  ipcMain.handle('sde:groupNames', (_e, ids: number[]) => sde.groupNames(ids))
  ipcMain.handle('sde:marketChildren', (_e, parent: number | null, order: 'name' | 'size', lang: 0 | 1, filterKey?: string) =>
    sde.marketChildren(parent, order, lang, filterKey)
  )
  ipcMain.handle('sde:setMarketFilter', (_e, key: string, ids: number[]) => sde.setMarketFilter(key, ids))
  ipcMain.handle('sde:marketPath', (_e, typeId: number) => sde.marketPath(typeId))
  ipcMain.handle('sde:marketTypesIn', (_e, groupId: number) => sde.marketTypesIn(groupId))
  ipcMain.handle('sde:requiredSkills', (_e, ids: number[]) => sde.requiredSkills(ids))
  ipcMain.handle('sde:dogmaAttrs', (_e, ids: number[], attrIds: number[]) => sde.dogmaAttrs(ids, attrIds))
  ipcMain.handle('sde:blueprintForProduct', (_e, id: number) => sde.blueprintForProduct(id))

  ipcMain.handle('fit:calculate', (_e, spec: FitSpec, skills: SkillSource) => dogma.calculateFit(spec, skills))

  ipcMain.handle('combat:open', (_e, attacker: CombatPilot) => {
    combatAttacker = attacker
    openCombatWindow()
  })
  ipcMain.handle('combat:setAttacker', (_e, attacker: CombatPilot) => {
    combatAttacker = attacker
    if (combatWindow && !combatWindow.isDestroyed()) combatWindow.webContents.send('combat:attacker', attacker)
  })
  ipcMain.handle('combat:isOpen', () => !!combatWindow && !combatWindow.isDestroyed())
  ipcMain.handle('combat:getAttacker', () => combatAttacker)
  ipcMain.handle('combat:simulate', (_e, a: CombatPilot, b: CombatPilot, scenario: CombatScenario) => combat.simulate(a, b, scenario))
  ipcMain.handle('combat:defaults', (_e, a: CombatPilot, b: CombatPilot) => combat.defaults(a, b))
  ipcMain.handle('fit:catalog', () => sde.fittingCatalog())
  ipcMain.handle('fit:fittableFor', (_e, shipTypeId: number) => sde.fittableFor(shipTypeId))
  ipcMain.handle('fit:explain', (_e, spec: FitSpec, skills: SkillSource, target: string, attr: number) => dogma.explainAttr(spec, skills, target, attr))
  ipcMain.handle('fit:charges', (_e, id: number) => sde.chargesFor(id))
  ipcMain.handle('fit:list', () => dogma.listFits())
  ipcMain.handle('fit:save', (_e, fit: FitSpec & { id?: string }) => dogma.saveFit(fit))
  ipcMain.handle('fit:delete', (_e, id: string) => dogma.deleteFit(id))
}

// On Windows the callback link launches a second instance; forward its URL to the first one.
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) {
  app.quit()
} else {
  // Register Canopus as the handler for eveauthcanopus:// links (the EVE SSO callback).
  // In development electron.exe needs the app path as an extra argument. The portable build
  // registers its unpacked exe, not the launcher: the callback only matters while Canopus runs,
  // and starting the running copy directly skips re-extracting the whole app.
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(auth.PROTOCOL, process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(auth.PROTOCOL, process.execPath)
  }

  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => a.toLowerCase().startsWith(`${auth.PROTOCOL}://`))
    if (url) auth.handleCallbackUrl(url)
    showMain()
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
  createTray()
  notifier.initNotifier(showMain)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => (quitting = true))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
