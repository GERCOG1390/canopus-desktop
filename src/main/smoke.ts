// The smoke run (CANOPUS_SMOKE=<folder>, used by `npm run check`; does nothing otherwise). The app walks every
// section of the sidebar and every tab in it, then the combat simulator, in English, and records for each screen:
// a picture of the Canopus window only (never the screen), console errors, error boxes on the page, and Russian
// text left untranslated. It ends with report.json, a contact sheet and the exit code (1 when anything failed).
//
// Runs on a test profile (CANOPUS_USER_DATA) with no character signed in: it checks that every screen opens and
// renders, not the data of an account.

import { app, BrowserWindow, nativeImage } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CombatPilot } from '../shared/combat'
import { loadSettings, saveSettings } from './storage'
import * as sde from './sde'

interface Screen {
  name: string
  file: string
  errors: string[]
  errorBoxes: string[]
  russian: string[]
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A fit for the simulator: the golden Rifter (tests/golden/fits.eft), so the fight screen has something to show. */
const RIFTER: CombatPilot = {
  skills: { mode: 'all5' },
  fit: {
    shipTypeId: 587,
    name: 'Smoke Rifter',
    drones: [],
    implants: [],
    modules: [
      ...[0, 1, 2].map(() => ({ typeId: 2873, slot: 'hi' as const, state: 'active' as const, chargeTypeId: 12608 })),
      { typeId: 527, slot: 'med', state: 'active' },
      { typeId: 448, slot: 'med', state: 'active' },
      { typeId: 438, slot: 'med', state: 'active' },
      { typeId: 2048, slot: 'lo', state: 'active' },
      { typeId: 519, slot: 'lo', state: 'online' },
      { typeId: 519, slot: 'lo', state: 'online' }
    ]
  }
}

/** What the page shows that a user would call broken: error boxes, and Russian left in the English UI. */
const INSPECT = `(() => {
  const errorBoxes = [...document.querySelectorAll('.error')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 10)
  const russian = new Set()
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walk.nextNode()) {
    const el = walk.currentNode.parentElement
    if (!el || el.closest('[translate="no"], textarea, input, script, style')) continue
    const t = walk.currentNode.textContent.trim()
    if (/[А-Яа-яЁё]/.test(t)) russian.add(t.slice(0, 120))
  }
  for (const el of document.querySelectorAll('[title], [placeholder]')) {
    for (const v of [el.getAttribute('title'), el.getAttribute('placeholder')]) if (v && /[А-Яа-яЁё]/.test(v)) russian.add(v.slice(0, 120))
  }
  return { errorBoxes, russian: [...russian].slice(0, 30) }
})()`

const click = (selector: string, i: number) => `(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})][${i}]; if (!b) return null; b.click(); return b.textContent.trim() })()`

export async function runSmoke(dir: string, hooks: { main: () => BrowserWindow | null; combat: (attacker: CombatPilot) => BrowserWindow | null }): Promise<void> {
  mkdirSync(dir, { recursive: true })
  const screens: Screen[] = []
  const crashes: string[] = []
  let errors: string[] = []
  const listen = (w: BrowserWindow, label: string) => {
    w.webContents.on('console-message', (e: unknown, ...old: unknown[]) => {
      // Electron 34+: one event object; before: (event, level, message).
      const ev = e as { level?: string | number; message?: string }
      const level = ev.level ?? old[0]
      const message = ev.message ?? String(old[1] ?? '')
      if (level === 'error' || level === 3) errors.push(`${label}: ${message}`.slice(0, 400))
    })
    w.webContents.on('render-process-gone', (_e, d) => crashes.push(`${label}: renderer gone (${d.reason})`))
    w.webContents.on('preload-error', (_e, p, err) => crashes.push(`${label}: preload ${p}: ${err.message}`))
  }

  try {
    // English, so anything still Russian is a missing translation.
    saveSettings({ ...loadSettings(), lang: 'en' })
    for (let i = 0; i < 240 && sde.getStatus().state !== 'ready'; i++) await wait(500)
    if (sde.getStatus().state !== 'ready') crashes.push(`SDE not ready: ${JSON.stringify(sde.getStatus())}`)
    const main = hooks.main()
    if (!main) throw new Error('no main window')
    listen(main, 'main')
    main.setSize(1440, 960)
    main.webContents.reload()
    await wait(4000)

    const shot = async (w: BrowserWindow, name: string) => {
      await wait(2200)
      const file = `${String(screens.length + 1).padStart(2, '0')}-${name.replace(/[^\w-]+/g, '_').slice(0, 40)}.png`
      writeFileSync(join(dir, file), (await w.webContents.capturePage()).toPNG())
      const seen = (await w.webContents.executeJavaScript(INSPECT).catch(() => ({ errorBoxes: [], russian: [] }))) as { errorBoxes: string[]; russian: string[] }
      screens.push({ name, file, errors, ...seen })
      errors = []
    }

    const navCount = (await main.webContents.executeJavaScript(`document.querySelectorAll('.sidebar button.nav:not([title])').length`)) as number
    for (let n = 0; n < navCount; n++) {
      const section = (await main.webContents.executeJavaScript(click('.sidebar button.nav:not([title])', n))) as string | null
      if (!section) continue
      await shot(main, section)
      // Every tab of the section, and the sub-tabs of grouped ones.
      const tabs = (await main.webContents.executeJavaScript(`document.querySelectorAll('main.content .tabs button.tab').length`)) as number
      for (let t = 1; t < tabs; t++) {
        const tab = (await main.webContents.executeJavaScript(click('main.content .tabs button.tab', t))) as string | null
        if (!tab) continue
        await shot(main, `${section} - ${tab}`)
        const subs = (await main.webContents.executeJavaScript(`document.querySelectorAll('.subtabs button.subtab').length`)) as number
        for (let s = 1; s < subs; s++) {
          const sub = (await main.webContents.executeJavaScript(click('.subtabs button.subtab', s))) as string | null
          if (sub) await shot(main, `${section} - ${tab} - ${sub}`)
        }
      }
    }

    // The combat simulator: the golden Rifter against its mirror.
    const combat = hooks.combat(RIFTER)
    if (combat) {
      listen(combat, 'combat')
      await wait(4000)
      await combat.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Mirror')?.click()`)
      await wait(800)
      await combat.webContents.executeJavaScript(`[...document.querySelectorAll('.combat-picker button')].find((b) => !b.classList.contains('chip-btn'))?.click()`)
      await shot(combat, 'Combat simulator')
      await combat.webContents.executeJavaScript(`[...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'The fight')?.scrollIntoView({ block: 'start' })`)
      await shot(combat, 'Combat simulator - the fight')
    } else crashes.push('combat window did not open')

    await contactSheet(dir, screens)
  } catch (e) {
    crashes.push(`smoke run: ${(e as Error).stack ?? e}`)
  }

  const failed = screens.filter((s) => s.errors.length || s.errorBoxes.length || s.russian.length)
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ crashes, screens }, null, 1))
  console.log(`SMOKE ${crashes.length || failed.length ? 'FAILED' : 'OK'}: ${screens.length} screens, ${failed.length} with problems, ${crashes.length} crashes`)
  for (const c of crashes) console.log(`  CRASH ${c}`)
  for (const s of failed) {
    console.log(`  ${s.name} (${s.file})`)
    for (const e of s.errors.slice(0, 5)) console.log(`    console: ${e}`)
    for (const e of s.errorBoxes.slice(0, 5)) console.log(`    error box: ${e}`)
    for (const r of s.russian.slice(0, 8)) console.log(`    untranslated: ${r}`)
  }
  app.exit(crashes.length || failed.length ? 1 : 0)
}

/** All the screens on one picture, captioned, to look over at a glance. */
async function contactSheet(dir: string, screens: Screen[]): Promise<void> {
  const cols = 4
  const w = 360
  const h = 240
  const cells = screens
    .map((s) => {
      const img = nativeImage.createFromPath(join(dir, s.file)).resize({ width: w, height: h })
      const bad = s.errors.length || s.errorBoxes.length || s.russian.length
      return `<figure class="${bad ? 'bad' : ''}"><img src="${img.toDataURL()}"><figcaption>${s.name.replace(/</g, '&lt;')}</figcaption></figure>`
    })
    .join('')
  const rows = Math.ceil(screens.length / cols)
  const html = `<html><body style="margin:0;background:#111;font:12px sans-serif;color:#ddd"><style>
    .g{display:grid;grid-template-columns:repeat(${cols},${w}px);gap:8px;padding:8px} figure{margin:0} img{display:block;width:${w}px;height:${h}px}
    figcaption{padding:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .bad figcaption{color:#ff6b6b} .bad img{outline:3px solid #ff6b6b}
  </style><div class="g">${cells}</div></body></html>`
  const sheet = new BrowserWindow({ show: false, width: cols * (w + 8) + 8, height: rows * (h + 30) + 16, webPreferences: { offscreen: true } })
  await sheet.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await wait(1500)
  writeFileSync(join(dir, 'sheet.png'), (await sheet.webContents.capturePage()).toPNG())
  sheet.destroy()
}
