// Icons for attributes, skills etc. The SDE only names client resource files
// (res:/ui/texture/icons/…); the files themselves come from CCP's client resource CDN,
// located through the client's resfileindex. Everything is cached on disk.

import { app, protocol } from 'electron'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { iconPath } from './sde'

const BINARIES = 'https://binaries.eveonline.com'
const RESOURCES = 'https://resources.eveonline.com'
export const ICON_SCHEME = 'evei'

const iconDir = (): string => join(app.getPath('userData'), 'icons')

/** Must run before app 'ready'. */
export function registerIconScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ICON_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

let indexPromise: Promise<Map<string, string>> | null = null

/** res:/ui/texture path → CDN path, for the current client build. */
function resourceIndex(): Promise<Map<string, string>> {
  if (!indexPromise) {
    indexPromise = (async () => {
      mkdirSync(iconDir(), { recursive: true })
      let build: string | null = null
      try {
        build = ((await (await fetch(`${BINARIES}/eveclient_TQ.json`)).json()) as { build: string }).build
      } catch {
        // Offline: fall back to whatever index we have.
      }
      const cached = readdirSync(iconDir()).filter((f) => /^index-\d+\.json$/.test(f)).sort().reverse()
      const file = build ? `index-${build}.json` : cached[0]
      if (file && existsSync(join(iconDir(), file))) {
        return new Map(Object.entries(JSON.parse(await readFile(join(iconDir(), file), 'utf8')) as Record<string, string>))
      }
      if (!build) throw new Error('Нет индекса ресурсов клиента')

      const appIndex = await (await fetch(`${BINARIES}/eveonline_${build}.txt`)).text()
      const entry = appIndex.split('\n').find((l) => l.startsWith('app:/resfileindex.txt,'))
      if (!entry) throw new Error('resfileindex не найден')
      const resIndex = await (await fetch(`${BINARIES}/${entry.split(',')[1]}`)).text()
      const map: Record<string, string> = {}
      for (const line of resIndex.split('\n')) {
        if (!line.startsWith('res:/ui/texture/')) continue
        const [res, path] = line.split(',')
        map[res.toLowerCase()] = path
      }
      await writeFile(join(iconDir(), `index-${build}.json`), JSON.stringify(map))
      for (const old of cached) if (old !== `index-${build}.json`) rmSync(join(iconDir(), old), { force: true })
      return new Map(Object.entries(map))
    })().catch((err) => {
      indexPromise = null
      throw err
    })
  }
  return indexPromise
}

const pending = new Map<number, Promise<Buffer | null>>()

async function loadIcon(iconId: number): Promise<Buffer | null> {
  const res = iconPath(iconId)
  if (!res) return null
  const cdnPath = (await resourceIndex()).get(res)
  if (!cdnPath) return null
  const cacheFile = join(iconDir(), 'files', cdnPath.replace(/[\\/]/g, '_'))
  if (existsSync(cacheFile)) return readFile(cacheFile)
  const r = await fetch(`${RESOURCES}/${cdnPath}`)
  if (!r.ok) return null
  let buf = Buffer.from(await r.arrayBuffer())
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf)
  mkdirSync(join(iconDir(), 'files'), { recursive: true })
  await writeFile(cacheFile, buf)
  return buf
}

/** Serves evei://icon/<iconID> to the renderer. */
export function handleIconScheme(): void {
  protocol.handle(ICON_SCHEME, async (request) => {
    const m = /^evei:\/\/icon\/(\d+)/.exec(request.url)
    if (!m) return new Response(null, { status: 404 })
    const id = Number(m[1])
    let p = pending.get(id)
    if (!p) {
      p = loadIcon(id).catch(() => null)
      pending.set(id, p)
      void p.finally(() => pending.delete(id))
    }
    const buf = await p
    if (!buf) return new Response(null, { status: 404 })
    return new Response(new Uint8Array(buf), { headers: { 'content-type': 'image/png', 'cache-control': 'max-age=31536000' } })
  })
}
