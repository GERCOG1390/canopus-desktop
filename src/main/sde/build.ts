// Downloads CCP's SDE (JSONL zip) and condenses the parts Canopus needs into
// one JSON database plus a separate descriptions file.

import { createWriteStream } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { SDE_FORMAT, type Bonus, type L10n, type SdeDb } from '../../shared/sde'

export const SDE_BASE = 'https://developers.eveonline.com/static-data/tranquility'

export async function latestBuild(): Promise<{ buildNumber: number; releaseDate: string }> {
  const res = await fetch(`${SDE_BASE}/latest.jsonl`)
  if (!res.ok) throw new Error(`SDE: ${res.status}`)
  return JSON.parse((await res.text()).trim().split('\n')[0])
}

async function download(url: string, dest: string, onProgress: (p: number) => void): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Не удалось скачать SDE: ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let done = 0
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
  body.on('data', (chunk: Buffer) => {
    done += chunk.length
    if (total) onProgress(done / total)
  })
  await pipeline(body, createWriteStream(dest))
}

type Row = Record<string, any>
type Handler = (row: Row) => void

/** Streams the selected JSONL files out of the zip, calling a handler per row. */
function readZip(zipPath: string, handlers: Record<string, Handler>, onFile: (name: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err)
      zip.on('error', reject)
      zip.on('end', () => resolve())
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName.split('/').pop()!.replace(/\.jsonl$/, '')
        const handler = handlers[name]
        if (!handler) return zip.readEntry()
        onFile(name)
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e)
          const rl = createInterface({ input: stream, crlfDelay: Infinity })
          rl.on('line', (line) => {
            if (line) handler(JSON.parse(line))
          })
          rl.on('close', () => zip.readEntry())
          stream.on('error', reject)
        })
      })
      zip.readEntry()
    })
  })
}

const l10n = (v: Row | string | undefined): L10n => {
  if (!v) return ['', '']
  if (typeof v === 'string') return [v, v]
  return [v.en ?? '', v.ru || v.en || '']
}

const bonus = (b: Row): Bonus => ({ b: b.bonus, u: b.unitID, t: l10n(b.bonusText) })

export async function buildSde(
  dir: string,
  build: { buildNumber: number; releaseDate: string },
  onStatus: (state: 'downloading' | 'building', progress: number, message?: string) => void
): Promise<{ dbPath: string; descPath: string }> {
  const zipPath = `${dir}/sde-${build.buildNumber}.zip`
  await download(`${SDE_BASE}/eve-online-static-data-${build.buildNumber}-jsonl.zip`, zipPath, (p) => onStatus('downloading', p))

  const db: SdeDb = {
    format: SDE_FORMAT,
    build: build.buildNumber,
    releaseDate: build.releaseDate,
    types: {},
    groups: {},
    categories: {},
    marketGroups: {},
    metaGroups: {},
    attributes: {},
    attrCategories: {},
    units: {},
    effects: {},
    dogma: {},
    bonuses: {},
    blueprints: {},
    reprocess: {},
    certificates: {},
    masteries: {},
    systems: {},
    regions: {},
    constellations: {},
    jumps: {},
    factions: {},
    races: {},
    icons: {}
  }
  const descriptions: Record<number, L10n> = {}

  const handlers: Record<string, Handler> = {
    types: (r) => {
      db.types[r._key] = {
        id: r._key,
        n: l10n(r.name),
        g: r.groupID,
        pub: !!r.published,
        mg: r.marketGroupID,
        meta: r.metaGroupID,
        ml: r.metaLevel,
        vol: r.volume,
        pvol: r.packagedVolume,
        mass: r.mass,
        cap: r.capacity,
        portion: r.portionSize,
        vp: r.variationParentTypeID,
        tl: r.techLevel,
        race: r.raceID,
        faction: r.factionID,
        price: r.basePrice,
        icon: r.iconID,
        graphic: r.graphicID
      }
      if (r.published && r.description) descriptions[r._key] = l10n(r.description)
    },
    groups: (r) => (db.groups[r._key] = { n: l10n(r.name), c: r.categoryID, pub: !!r.published }),
    categories: (r) => (db.categories[r._key] = { n: l10n(r.name), pub: !!r.published }),
    marketGroups: (r) => (db.marketGroups[r._key] = { n: l10n(r.name), p: r.parentGroupID }),
    metaGroups: (r) => (db.metaGroups[r._key] = l10n(r.name)),
    dogmaAttributes: (r) =>
      (db.attributes[r._key] = {
        name: r.name,
        dn: r.displayName ? l10n(r.displayName) : undefined,
        tt: r.tooltipDescription ? l10n(r.tooltipDescription) : undefined,
        u: r.unitID,
        cat: r.attributeCategoryID,
        pub: !!r.published,
        high: r.highIsGood !== false,
        def: r.defaultValue ?? 0,
        icon: r.iconID,
        stack: r.stackable !== false
      }),
    dogmaAttributeCategories: (r) => (db.attrCategories[r._key] = r.name),
    dogmaUnits: (r) => (db.units[r._key] = l10n(r.displayName ?? '')),
    dogmaEffects: (r) =>
      (db.effects[r._key] = {
        name: r.name,
        cat: r.effectCategoryID ?? 0,
        dur: r.durationAttributeID,
        dis: r.dischargeAttributeID,
        range: r.rangeAttributeID,
        falloff: r.falloffAttributeID,
        mods: (r.modifierInfo as Row[] | undefined)
          ?.filter((m) => m.modifiedAttributeID && m.modifyingAttributeID && m.operation !== undefined && m.operation !== null)
          .map((m) => ({ func: m.func, domain: m.domain, attr: m.modifiedAttributeID, src: m.modifyingAttributeID, op: m.operation, group: m.groupID, skill: m.skillTypeID }))
      }),
    typeDogma: (r) => {
      const a: Record<number, number> = {}
      for (const x of r.dogmaAttributes ?? []) a[x.attributeID] = x.value
      const effects = (r.dogmaEffects ?? []) as Row[]
      db.dogma[r._key] = { a, e: effects.map((x) => x.effectID), de: effects.find((x) => x.isDefault)?.effectID }
    },
    typeBonus: (r) => {
      db.bonuses[r._key] = {
        role: r.roleBonuses?.map(bonus),
        misc: r.miscBonuses?.map(bonus),
        skills: r.types?.map((t: Row) => [t._key, (t._value as Row[]).map(bonus)])
      }
    },
    blueprints: (r) => {
      const act: SdeDb['blueprints'][number]['act'] = {}
      for (const [name, a] of Object.entries(r.activities ?? {}) as [string, Row][]) {
        act[name] = {
          time: a.time ?? 0,
          mat: a.materials?.map((m: Row) => [m.typeID, m.quantity]),
          prod: a.products?.map((p: Row) => (p.probability ? [p.typeID, p.quantity, p.probability] : [p.typeID, p.quantity])),
          skills: a.skills?.map((s: Row) => [s.typeID, s.level])
        }
      }
      db.blueprints[r._key] = { max: r.maxProductionLimit ?? 0, act }
    },
    typeMaterials: (r) => (db.reprocess[r._key] = (r.materials ?? []).map((m: Row) => [m.materialTypeID, m.quantity])),
    certificates: (r) =>
      (db.certificates[r._key] = {
        n: l10n(r.name),
        g: r.groupID,
        skills: (r.skillTypes ?? []).map((s: Row) => [s._key, s.basic ?? 0, s.standard ?? 0, s.improved ?? 0, s.advanced ?? 0, s.elite ?? 0])
      }),
    masteries: (r) => (db.masteries[r._key] = (r._value as Row[]).sort((a, b) => a._key - b._key).map((l) => l._value as number[])),
    mapSolarSystems: (r) =>
      (db.systems[r._key] = { n: l10n(r.name)[0], sec: r.securityStatus ?? 0, r: r.regionID, c: r.constellationID }),
    mapStargates: (r) => {
      const from = r.solarSystemID as number
      const to = r.destination?.solarSystemID as number | undefined
      if (!to) return
      const list = (db.jumps[from] ??= [])
      if (!list.includes(to)) list.push(to)
    },
    mapRegions: (r) => (db.regions[r._key] = l10n(r.name)),
    mapConstellations: (r) => (db.constellations[r._key] = l10n(r.name)[0]),
    factions: (r) => (db.factions[r._key] = l10n(r.name)),
    races: (r) => (db.races[r._key] = l10n(r.name)),
    icons: (r) => {
      if (r.iconFile) db.icons[r._key] = String(r.iconFile).toLowerCase()
    }
  }

  const files = Object.keys(handlers)
  let seen = 0
  onStatus('building', 0)
  await readZip(zipPath, handlers, (name) => onStatus('building', seen++ / files.length, name))

  const dbPath = `${dir}/sde-${build.buildNumber}.json`
  const descPath = `${dir}/sde-${build.buildNumber}-descriptions.json`
  await writeFile(dbPath, JSON.stringify(db))
  await writeFile(descPath, JSON.stringify(descriptions))
  await rm(zipPath, { force: true })
  return { dbPath, descPath }
}
