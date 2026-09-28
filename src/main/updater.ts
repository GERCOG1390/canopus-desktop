// Updates from GitHub Releases: finds a newer release, downloads the build that matches this copy
// (installer or portable) in the background, checks its sha256 against the digest GitHub publishes
// and swaps it in on restart or quit.

import { app, Notification } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, writeFileSync } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { compareVersions, RELEASES_REPO, type UpdateKind, type UpdateStatus } from '../shared/update'
import { loadSettings } from './storage'

const CHECK_EVERY = 6 * 3600_000
const FIRST_CHECK = 15_000

interface Asset {
  name: string
  size: number
  digest?: string | null
  browser_download_url: string
}

interface Release {
  tag_name: string
  html_url: string
  body: string
  draft: boolean
  prerelease: boolean
  assets: Asset[]
}

function detectKind(): UpdateKind {
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'portable'
  // The NSIS installer puts its uninstaller next to the exe; an unpacked or dev build has none.
  if (app.isPackaged && existsSync(join(dirname(process.execPath), 'Uninstall Canopus.exe'))) return 'installer'
  return 'manual'
}

let status: UpdateStatus = { state: 'idle', current: app.getVersion(), kind: detectKind() }
let release: Release | null = null
let asset: Asset | null = null
/** The verified download, waiting to be installed. */
let downloaded: string | null = null
let busy = false
let applied = false
let notifiedVersion = ''
let send: (status: UpdateStatus) => void = () => {}

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  send(status)
}

export function updateStatus(): UpdateStatus {
  return status
}

function pickAsset(r: Release): Asset | null {
  const version = r.tag_name.replace(/^v/, '')
  const name = status.kind === 'portable' ? `Canopus-${version}-portable.exe` : `Canopus-Setup-${version}.exe`
  return r.assets.find((a) => a.name === name) ?? null
}

/** Asks GitHub for the latest release; downloads it right away when auto-update is on. */
export async function checkForUpdate(manual = false): Promise<UpdateStatus> {
  if (busy || status.state === 'downloading' || status.state === 'ready') return status
  busy = true
  set({ state: 'checking', message: undefined })
  try {
    const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Canopus/${status.current}` }
    })
    if (!res.ok) throw new Error(`GitHub: ${res.status}`)
    const r = (await res.json()) as Release
    const checkedAt = new Date().toISOString()
    const version = r.tag_name.replace(/^v/, '')
    if (r.draft || r.prerelease || compareVersions(version, status.current) <= 0) {
      set({ state: 'latest', checkedAt, version: undefined, notes: undefined, page: r.html_url })
      return status
    }
    release = r
    asset = pickAsset(r)
    set({ state: 'available', checkedAt, version, notes: r.body, page: r.html_url, size: asset?.size })
    if (status.kind !== 'manual' && asset && (manual || loadSettings().autoUpdate)) {
      busy = false
      return await downloadUpdate()
    }
    notifyOnce(version, false)
  } catch (err) {
    set({ state: 'error', message: (err as Error).message })
  } finally {
    busy = false
  }
  return status
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!release || !asset || status.kind === 'manual' || busy) return status
  busy = true
  const dir = join(app.getPath('temp'), 'canopus-update')
  const dest = join(dir, asset.name)
  try {
    await mkdir(dir, { recursive: true })
    set({ state: 'downloading', progress: 0, message: undefined })
    const expected = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7).toLowerCase() : null
    // A finished download from an earlier run is reused.
    const reuse = existsSync(dest) && (await stat(dest)).size === asset.size && (!expected || (await sha256(dest)) === expected)
    if (!reuse) {
      const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': `Canopus/${status.current}` } })
      if (!res.ok || !res.body) throw new Error(`download: ${res.status}`)
      const total = asset.size
      let done = 0
      let last = 0
      const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
      body.on('data', (chunk: Buffer) => {
        done += chunk.length
        if (done - last > total / 100) {
          last = done
          set({ progress: done / total })
        }
      })
      await pipeline(body, createWriteStream(dest))
      if ((await stat(dest)).size !== asset.size) throw new Error('size mismatch')
      if (expected && (await sha256(dest)) !== expected) {
        await rm(dest, { force: true })
        throw new Error('sha256 mismatch')
      }
    }
    downloaded = dest
    set({ state: 'ready', progress: 1 })
    notifyOnce(status.version!, true)
  } catch (err) {
    set({ state: 'error', message: (err as Error).message })
  } finally {
    busy = false
  }
  return status
}

function notifyOnce(version: string, ready: boolean): void {
  const key = `${version}:${ready}`
  if (notifiedVersion === key || !Notification.isSupported()) return
  notifiedVersion = key
  const en = loadSettings().lang === 'en'
  const title = en ? `Canopus ${version} is available` : `Доступна версия Canopus ${version}`
  const body = ready
    ? en
      ? 'Downloaded. It installs when you restart Canopus.'
      : 'Загружена. Установится при перезапуске Canopus.'
    : en
      ? 'Open Settings to download it.'
      : 'Скачать можно в настройках.'
  new Notification({ title, body }).show()
}

/**
 * Starts the swap in a detached process. The installer runs silently into the existing install
 * and starts Canopus again. The portable exe can't be overwritten while its launcher runs, so a
 * hidden PowerShell waits for it to exit, copies the new exe over it (keeping its name) and starts it.
 */
function spawnInstaller(relaunch: boolean): boolean {
  if (!downloaded || applied) return false
  applied = true
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  if (status.kind === 'installer') {
    const args = ['--updated', '/S', ...(relaunch ? ['--force-run'] : [])]
    spawn(downloaded, args, { detached: true, stdio: 'ignore', env }).unref()
    return true
  }
  const target = process.env.PORTABLE_EXECUTABLE_FILE!
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`
  const script = [
    `$src = ${q(downloaded)}; $dst = ${q(target)}; $log = ${q(join(dirname(downloaded), 'apply-update.log'))}`,
    '"$(Get-Date -Format o) start" | Out-File -LiteralPath $log -Encoding utf8',
    'for ($i = 0; $i -lt 240; $i++) {',
    '  try { Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop; $ok = $true; break } catch { $err = $_.Exception.Message; Start-Sleep -Milliseconds 500 }',
    '}',
    '"$(Get-Date -Format o) copied=$ok tries=$i $err" | Out-File -LiteralPath $log -Append -Encoding utf8',
    'if ($ok) { Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue }',
    relaunch ? 'Start-Process -FilePath $dst' : ''
  ].join('\n')
  const scriptPath = join(dirname(downloaded), 'apply-update.ps1')
  // With a BOM Windows PowerShell reads the script as UTF-8 (paths may contain Cyrillic).
  writeFileSync(scriptPath, '﻿' + script, 'utf8')
  // A detached powershell.exe has no console and exits at once, and a attached one dies with Canopus;
  // wscript starts it hidden with its own console. The .vbs is UTF-16 for the same Cyrillic paths.
  const vbsPath = join(dirname(downloaded), 'apply-update.vbs')
  const vbs = `CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${scriptPath}""", 0, False\r\n`
  writeFileSync(vbsPath, Buffer.from('﻿' + vbs, 'utf16le'))
  spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore', windowsHide: true, env }).unref()
  return true
}

/** Installs the downloaded update and restarts Canopus. */
export function installAndRestart(quit: () => void): void {
  if (!spawnInstaller(true)) return
  setTimeout(quit, 800)
}

/** A ready update that wasn't installed yet is applied when Canopus quits (without starting it again). */
export function applyOnQuit(): void {
  if (status.state === 'ready' && loadSettings().autoUpdate) spawnInstaller(false)
}

export function initUpdater(sendStatus: (status: UpdateStatus) => void): void {
  send = sendStatus
  if (status.kind === 'manual' && !app.isPackaged) return
  const auto = () => {
    if (loadSettings().autoUpdate) void checkForUpdate()
  }
  setTimeout(auto, FIRST_CHECK)
  setInterval(auto, CHECK_EVERY)
}
