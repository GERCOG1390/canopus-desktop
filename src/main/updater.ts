// Updates from GitHub Releases: finds a newer release, downloads the build that matches this copy
// (installer, portable or the macOS zip) in the background, checks its sha256 against the digest
// GitHub publishes and swaps it in on restart or quit.

import { app, Notification } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, createReadStream, createWriteStream, existsSync, writeFileSync } from 'node:fs'
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

/** Canopus.app, from …/Canopus.app/Contents/MacOS/Canopus. */
const macBundle = (): string => dirname(dirname(dirname(process.execPath)))

function detectKind(): UpdateKind {
  if (process.platform === 'darwin') {
    if (!app.isPackaged) return 'manual'
    // Run from the mounted dmg, or translocated by Gatekeeper (not moved out of Downloads): nothing to replace.
    const bundle = macBundle()
    if (!bundle.endsWith('.app') || bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return 'manual'
    try {
      accessSync(dirname(bundle), constants.W_OK)
      return 'mac'
    } catch {
      return 'manual'
    }
  }
  if (process.platform === 'linux') {
    // An AppImage knows its own path; a .deb install is updated by the package manager.
    const image = process.env.APPIMAGE
    if (!app.isPackaged || !image) return 'manual'
    try {
      accessSync(dirname(image), constants.W_OK)
      return 'appimage'
    } catch {
      return 'manual'
    }
  }
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
  const name =
    status.kind === 'mac'
      ? `Canopus-${version}-mac.zip`
      : status.kind === 'appimage'
        ? `Canopus-${version}-linux.AppImage`
        : status.kind === 'portable'
        ? `Canopus-${version}-portable.exe`
        : `Canopus-Setup-${version}.exe`
  return r.assets.find((a) => a.name === name) ?? null
}

/** Asks GitHub for the latest release; downloads it right away when auto-update is on. */
export async function checkForUpdate(manual = false): Promise<UpdateStatus> {
  if (busy || status.state === 'downloading' || status.state === 'ready') return status
  busy = true
  set({ state: 'checking', message: undefined })
  try {
    // The newest release that has a build for this platform: a release made for the other platform
    // only (e.g. a macOS-only fix) is skipped, so it neither hides nor fakes an update for this copy.
    const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=20`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Canopus/${status.current}` }
    })
    if (!res.ok) throw new Error(`GitHub: ${res.status}`)
    const platformBuild = process.platform === 'darwin' ? /-mac\.(dmg|zip)$/ : process.platform === 'linux' ? /-linux\.(AppImage|deb)$/ : /\.exe$/
    const hasBuild = (x: Release) => (status.kind === 'manual' ? x.assets.some((a) => platformBuild.test(a.name)) : !!pickAsset(x))
    const releases = ((await res.json()) as Release[])
      .filter((x) => !x.draft && !x.prerelease && hasBuild(x))
      .sort((x, y) => compareVersions(y.tag_name, x.tag_name))
    const r = releases[0]
    const checkedAt = new Date().toISOString()
    const version = r?.tag_name.replace(/^v/, '')
    if (!r || compareVersions(version, status.current) <= 0) {
      set({ state: 'latest', checkedAt, version: undefined, notes: undefined, page: r?.html_url })
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
  if (status.kind === 'mac') {
    spawnMacSwap(relaunch, env)
    return true
  }
  if (status.kind === 'appimage') {
    spawnAppImageSwap(relaunch, env)
    return true
  }
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

/**
 * macOS: a detached shell script waits for Canopus to exit, unpacks the zip next to the app, checks
 * that the new app is signed by the same developer (the old app's designated requirement), swaps
 * the bundles and optionally starts Canopus again. Any failure leaves the old app in place.
 */
function spawnMacSwap(relaunch: boolean, env: NodeJS.ProcessEnv): void {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const bundle = macBundle()
  const dir = dirname(downloaded!)
  const script = [
    '#!/bin/bash',
    `zip=${q(downloaded!)}; app=${q(bundle)}; log=${q(join(dir, 'apply-update.log'))}; pid=${process.pid}`,
    'exec >"$log" 2>&1; echo "$(date) start"',
    'for i in $(seq 1 240); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done',
    'new=$(mktemp -d "$(dirname "$app")/.canopus-update.XXXXXX") || exit 1',
    'cleanup() { rm -rf "$new"; }',
    'ditto -x -k "$zip" "$new" || { echo unzip failed; cleanup; exit 1; }',
    'src=$(find "$new" -maxdepth 1 -name "*.app" | head -1)',
    'req=$(codesign -d -r- "$app" 2>&1 | sed -n "s/^designated => //p")',
    'if [ -z "$src" ] || ! codesign --verify --deep --strict ${req:+-R="$req"} "$src"; then echo "signature check failed"; cleanup; exit 1; fi',
    'old="$app.old-$$"',
    'mv "$app" "$old" && mv "$src" "$app" || { echo swap failed; [ -d "$old" ] && [ ! -d "$app" ] && mv "$old" "$app"; cleanup; exit 1; }',
    'rm -rf "$old" "$zip"; cleanup; echo "$(date) done"',
    relaunch ? 'open "$app"' : ''
  ].join('\n')
  const scriptPath = join(dir, 'apply-update.sh')
  writeFileSync(scriptPath, script, { mode: 0o755 })
  spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore', env }).unref()
}

/**
 * Linux AppImage: a detached shell script waits for Canopus to exit, copies the new image next to
 * the old one, makes it executable and moves it over the old file (keeping its name), then
 * optionally starts it. The download was checked against GitHub's sha256 already.
 */
function spawnAppImageSwap(relaunch: boolean, env: NodeJS.ProcessEnv): void {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const target = process.env.APPIMAGE!
  const dir = dirname(downloaded!)
  const script = [
    '#!/bin/sh',
    `src=${q(downloaded!)}; dst=${q(target)}; log=${q(join(dir, 'apply-update.log'))}; pid=${process.pid}`,
    'exec >"$log" 2>&1; echo "$(date) start"',
    'i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 240 ]; do sleep 0.5; i=$((i+1)); done',
    'tmp="$dst.new-$$"',
    'cp "$src" "$tmp" && chmod +x "$tmp" && mv -f "$tmp" "$dst" || { echo swap failed; rm -f "$tmp"; exit 1; }',
    'rm -f "$src"; echo "$(date) done"',
    relaunch ? 'nohup "$dst" >/dev/null 2>&1 &' : ''
  ].join('\n')
  const scriptPath = join(dir, 'apply-update.sh')
  writeFileSync(scriptPath, script, { mode: 0o755 })
  // The AppImage runtime sets these for its own process; the new image must start clean.
  const clean = { ...env }
  for (const k of ['APPIMAGE', 'APPDIR', 'OWD', 'ARGV0']) delete clean[k]
  spawn('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore', env: clean }).unref()
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
