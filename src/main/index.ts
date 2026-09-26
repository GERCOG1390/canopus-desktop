import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
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

app.whenReady().then(() => {
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
