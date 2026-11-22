// The golden check: reference fits and fights, worked out by the real engine on the real SDE, against the
// figures recorded in tests/golden/expected.json. Any figure that moves is reported: a bug, or an intended
// change (then the expected file is rewritten with --update and the reason goes in the commit).
//
// Bundled and run by tools/check/golden.mjs (the engine's main-process imports are swapped for a file-based SDE).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { calculate } from '../../src/main/dogma/stats'
import { simulate } from '../../src/main/dogma/combat'
import type { FitSpec, ModuleState, Slot } from '../../src/shared/fit'
import type { SdeDb } from '../../src/shared/sde'
import { db } from './golden-shim'

const ROOT = process.env.CANOPUS_ROOT!
const UPDATE = process.argv.includes('--update')
const EXPECTED = `${ROOT}/tests/golden/expected.json`

// ---------- EFT, the way the app reads it (lib/fitting.tsx fromEft, main/sde fittingCatalog) ----------

const SLOT_EFFECTS: [number, Slot][] = [
  [12, 'hi'],
  [13, 'med'],
  [11, 'lo'],
  [2663, 'rig'],
  [3772, 'sub']
]

function byName(d: SdeDb): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of Object.values(d.types)) {
    const key = t.n[0].toLowerCase()
    if (!m.has(key) || t.pub) m.set(key, t.id)
  }
  return m
}

function parseEft(text: string, d: SdeDb): { fits: FitSpec[]; unknown: string[] } {
  const names = byName(d)
  const unknown: string[] = []
  const fits: FitSpec[] = []
  let fit: FitSpec | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const head = /^\[(.+?),\s*(.+)\]$/.exec(line)
    if (head) {
      const ship = names.get(head[1].toLowerCase())
      if (!ship) unknown.push(head[1])
      fit = { shipTypeId: ship ?? 0, name: head[2], modules: [], drones: [], implants: [], cargo: [] }
      fits.push(fit)
      continue
    }
    if (!fit) continue
    const offline = /\/offline$/i.test(line)
    const clean = line.replace(/\s*\/offline$/i, '')
    const qty = /^(.+?) x(\d+)$/.exec(clean)
    const [modName, chargeName] = (qty ? qty[1] : clean).split(',').map((s) => s.trim())
    const id = names.get(modName.toLowerCase())
    if (!id) {
      unknown.push(modName)
      continue
    }
    const cat = d.groups[d.types[id].g]?.c
    const dogma = d.dogma[id]
    if (cat === 18) {
      fit.drones.push({ typeId: id, count: Number(qty?.[2] ?? 1), active: 0 })
      continue
    }
    if (cat === 20 && dogma?.a[331]) {
      fit.implants.push(id)
      continue
    }
    const slot = cat === 7 || cat === 32 ? SLOT_EFFECTS.find(([e]) => dogma?.e.includes(e))?.[1] : undefined
    if (!slot || qty) {
      fit.cargo!.push({ typeId: id, qty: Number(qty?.[2] ?? 1) })
      continue
    }
    const effects = (dogma?.e ?? []).map((e) => d.effects[e]).filter(Boolean)
    const act = effects.some((e) => (e.cat === 1 || e.cat === 2) && !!e.dur)
    const state: ModuleState = offline ? 'offline' : act ? 'active' : 'online'
    let chargeTypeId: number | undefined
    if (chargeName) {
      chargeTypeId = names.get(chargeName.toLowerCase())
      if (!chargeTypeId) unknown.push(chargeName)
    }
    fit.modules.push({ typeId: id, slot, state, ...(chargeTypeId ? { chargeTypeId } : {}) })
  }
  // Drones out as the bandwidth and the five-drone limit allow, in the order listed (as the app's launchFor).
  for (const f of fits) {
    const bw = d.dogma[f.shipTypeId]?.a[1271] ?? 0
    let left = bw
    let out = 0
    for (const dr of f.drones) {
      const each = d.dogma[dr.typeId]?.a[1272] ?? 0
      const n = Math.max(0, Math.min(dr.count, 5 - out, each > 0 ? Math.floor(left / each + 1e-9) : dr.count))
      dr.active = n
      out += n
      left -= n * each
    }
  }
  return { fits, unknown }
}

// ---------- What is recorded ----------

const r = (v: number | undefined, digits = 2): number | null => (v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(digits)))
const res = (a: number[]) => a.map((x) => r(x * 100, 2))

function fitFigures(spec: FitSpec) {
  const s = calculate(db, spec, { mode: 'all5' })
  return {
    problems: s.modules.flatMap((m) => m.problems).length,
    cpu: r(s.ship.cpu.used),
    power: r(s.ship.power.used),
    dps: r(s.offense.totalDps),
    dpsReload: r(s.offense.totalDpsReload),
    volley: r(s.offense.totalVolley),
    droneDps: r(s.offense.droneDps),
    weapons: s.offense.weapons.map((w) => ({ kind: w.kind, dps: r(w.dps), optimal: r(w.optimal, 0), falloff: r(w.falloff, 0), tracking: r(w.tracking, 4), er: r(w.explosionRadius), ev: r(w.explosionVelocity) })),
    hp: { shield: r(s.defense.shield.hp), armor: r(s.defense.armor.hp), hull: r(s.defense.hull.hp) },
    resist: { shield: res(s.defense.shield.resist), armor: res(s.defense.armor.resist), hull: res(s.defense.hull.resist) },
    ehp: r(s.defense.ehp, 0),
    shieldBoost: r(s.defense.shieldBoost),
    armorRepair: r(s.defense.armorRepair),
    passiveRegen: r(s.defense.passiveShieldRegen),
    cap: { capacity: r(s.capacitor.capacity), rechargeSec: r(s.capacitor.rechargeSec), use: r(s.capacitor.usePerSecond), stable: s.capacitor.stable, level: r(s.capacitor.stableLevel, 3), lasts: r(s.capacitor.lastsSec, 0) },
    nav: { speed: r(s.navigation.maxVelocity), align: r(s.navigation.alignSec), sig: r(s.navigation.signatureRadius), warp: r(s.navigation.warpSpeed) },
    lock: { range: r(s.targeting.maxRange, 0), scan: r(s.targeting.scanResolution), targets: s.targeting.maxTargets, sensor: r(s.targeting.sensorStrength) },
    heat: s.modules.filter((m) => m.heat?.damage).map((m) => r(m.heat!.damage))
  }
}

function fightFigures(a: FitSpec, b: FitSpec, sc: Record<string, unknown>) {
  const res = simulate({ fit: a, skills: { mode: 'all5' } }, { fit: b, skills: { mode: 'all5' } }, sc as never)
  const tl = res.timeline
  const side = (o: typeof tl.a) => ({
    shieldDown: r(o.shieldDown ?? undefined, 1),
    armorDown: r(o.armorDown ?? undefined, 1),
    dead: r(o.dead ?? undefined, 1),
    dealt: r(o.dealt, 0),
    left: { s: r(o.left.s, 3), a: r(o.left.a, 3), h: r(o.left.h, 3), c: r(o.left.c, 3) },
    burnt: o.heat?.modules.filter((m) => m.burnt !== null).length ?? 0
  })
  return { winner: tl.winner, end: r(tl.end, 1), a: side(tl.a), b: side(tl.b), events: tl.events.map((e) => `${e.t.toFixed(1)} ${e.side} ${e.kind}${e.index !== undefined ? `#${e.index}` : ''}`) }
}

// ---------- Compare ----------

function diff(path: string, was: unknown, now: unknown, out: string[]): void {
  if (typeof was === 'object' && was && typeof now === 'object' && now && !Array.isArray(was) === !Array.isArray(now)) {
    const keys = new Set([...Object.keys(was), ...Object.keys(now)])
    for (const k of keys) diff(`${path}.${k}`, (was as Record<string, unknown>)[k], (now as Record<string, unknown>)[k], out)
    return
  }
  if (JSON.stringify(was) !== JSON.stringify(now)) out.push(`${path}: ${JSON.stringify(was)} → ${JSON.stringify(now)}`)
}

const { fits, unknown } = parseEft(readFileSync(`${ROOT}/tests/golden/fits.eft`, 'utf8'), db)
if (unknown.length) {
  console.log(`Unknown names in fits.eft: ${[...new Set(unknown)].join(', ')}`)
  process.exit(2)
}
const dupes = fits.map((f) => f.name).filter((n, i, all) => all.indexOf(n) !== i)
if (dupes.length) {
  console.log(`Fit names used twice in fits.eft: ${[...new Set(dupes)].join(', ')}`)
  process.exit(2)
}
const byFit = new Map(fits.map((f) => [f.name, f]))
const fights = JSON.parse(readFileSync(`${ROOT}/tests/golden/fights.json`, 'utf8')) as { name: string; a: string; b: string; sc: Record<string, unknown> }[]

const now = {
  sde: db.build,
  fits: Object.fromEntries(fits.map((f) => [f.name, fitFigures(f)])),
  fights: Object.fromEntries(
    fights.map((x) => {
      const a = byFit.get(x.a)
      const b = byFit.get(x.b)
      if (!a || !b) throw new Error(`fights.json: no fit "${!a ? x.a : x.b}"`)
      return [x.name, fightFigures(a, b, x.sc)]
    })
  )
}

if (UPDATE || !existsSync(EXPECTED)) {
  writeFileSync(EXPECTED, JSON.stringify(now, null, 1) + '\n')
  console.log(`Golden figures written: ${fits.length} fits, ${fights.length} fights (SDE ${db.build}).`)
  process.exit(0)
}

const was = JSON.parse(readFileSync(EXPECTED, 'utf8'))
const changes: string[] = []
diff('fits', was.fits, now.fits, changes)
diff('fights', was.fights, now.fights, changes)
const problems = Object.entries(now.fits).filter(([, f]) => f.problems > 0).map(([n, f]) => `${n}: ${f.problems} fitting problems`)
if (problems.length) console.log(`Fits that don't fit (fix fits.eft):\n  ${problems.join('\n  ')}`)
if (!changes.length) {
  console.log(`Golden OK: ${fits.length} fits, ${fights.length} fights match (SDE ${db.build}).`)
  process.exit(problems.length ? 1 : 0)
}
if (was.sde !== db.build) console.log(`Note: the figures were recorded on SDE ${was.sde}, this is ${db.build} — a balance patch moves numbers too.`)
console.log(`Golden figures changed (${changes.length}):`)
for (const c of changes.slice(0, 80)) console.log(`  ${c}`)
if (changes.length > 80) console.log(`  … and ${changes.length - 80} more`)
console.log('A bug: fix it. Intended: npm run golden -- --update, and say why in the commit.')
process.exit(1)
