import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import type { RequestOptions, Settings } from '../shared/types'
import * as auth from './auth'
import { request } from './http'
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
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('http:request', (_e, url: string, options?: RequestOptions) => request(url, options))

  ipcMain.handle('auth:login', () => auth.login())
  ipcMain.handle('auth:characters', () => auth.characters())
  ipcMain.handle('auth:logout', (_e, characterId: number) => auth.logout(characterId))
  ipcMain.handle('auth:callbackUrl', () => auth.CALLBACK_URL)

  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const next = { ...loadSettings(), ...patch }
    saveSettings(next)
    mainWindow?.setAlwaysOnTop(next.alwaysOnTop)
    return next
  })

  ipcMain.handle('shell:openExternal', (_e, url: string) => openExternal(url))
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

app.whenReady().then(() => {
  if (!primaryInstance) return
  auth.initAuth()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
