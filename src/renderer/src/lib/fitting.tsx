import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { FitDrone, FitModule, FitSpec, FittableType, ModuleState, Slot } from '../../../shared/fit'
import { useApp } from '../AppContext'
import { getBasic, primeBasics } from './sde'

export const SLOT_ORDER: Slot[] = ['hi', 'med', 'lo', 'rig', 'sub']
export const SLOT_LABEL: Record<Slot | 'drone' | 'implant', string> = {
  hi: 'Большой мощности',
  med: 'Средней мощности',
  lo: 'Малой мощности',
  rig: 'Риги',
  sub: 'Подсистемы',
  drone: 'Дроны',
  implant: 'Импланты'
}

// ---------- Fittable catalog (loaded once) ----------

let catalogPromise: Promise<Map<number, FittableType>> | null = null

export function loadCatalog(): Promise<Map<number, FittableType>> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const list = await window.api.fit.catalog()
      primeBasics(await window.api.sde.basics(list.map((t) => t.id)))
      return new Map(list.map((t) => [t.id, t]))
    })().catch((e) => {
      catalogPromise = null
      throw e
    })
  }
  return catalogPromise
}

const chargeCache = new Map<number, Promise<number[]>>()
export function chargesFor(moduleTypeId: number): Promise<number[]> {
  if (!chargeCache.has(moduleTypeId)) {
    chargeCache.set(
      moduleTypeId,
      window.api.fit.charges(moduleTypeId).then(async (ids) => {
        primeBasics(await window.api.sde.basics(ids))
        return ids
      })
    )
  }
  return chargeCache.get(moduleTypeId)!
}

export function nextState(current: ModuleState, info: FittableType | undefined, reverse = false): ModuleState {
  const states: ModuleState[] = ['offline', 'online']
  if (info?.act) states.push('active')
  if (info?.act && info.oh) states.push('overload')
  const i = states.indexOf(current)
  return states[(i + (reverse ? states.length - 1 : 1)) % states.length]
}

export function defaultState(info: FittableType | undefined): ModuleState {
  return info?.act && !info.burst ? 'active' : 'online'
}

// ---------- EFT import / export ----------

const en = (id: number) => getBasic(id)?.n[0] ?? `#${id}`

export function toEft(fit: FitSpec): string {
  const lines = [`[${en(fit.shipTypeId)}, ${fit.name || 'Canopus fit'}]`]
  for (const slot of ['lo', 'med', 'hi', 'rig', 'sub'] as Slot[]) {
    for (const m of fit.modules.filter((x) => x.slot === slot)) {
      lines.push(`${en(m.typeId)}${m.chargeTypeId ? `, ${en(m.chargeTypeId)}` : ''}${m.state === 'offline' ? ' /OFFLINE' : ''}`)
    }
    lines.push('')
  }
  for (const d of fit.drones) lines.push(`${en(d.typeId)} x${d.count}`)
  if (fit.implants.length) {
    lines.push('')
    for (const i of fit.implants) lines.push(en(i))
  }
  if (fit.cargo?.length) {
    lines.push('')
    for (const c of fit.cargo) lines.push(`${en(c.typeId)} x${c.qty}`)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

async function exactType(name: string): Promise<number | null> {
  const key = name.trim().toLowerCase()
  if (!key) return null
  const hits = await window.api.sde.search(name, { limit: 10 })
  return hits.find((h) => h.n.some((n) => n.toLowerCase() === key))?.id ?? null
}

/** Parses EFT text (the format of pyfa, the in-game fitting window and zKillboard). */
export async function fromEft(text: string): Promise<{ fit: FitSpec; unknown: string[] }> {
  const catalog = await loadCatalog()
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const head = /^\[(.+?),\s*(.*)\]$/.exec(lines.find((l) => l.startsWith('[')) ?? '')
  if (!head) throw new Error('Не найдена первая строка вида [Корабль, Название]')
  const shipTypeId = await exactType(head[1])
  if (!shipTypeId) throw new Error(`Неизвестный корабль: ${head[1]}`)

  const fit: FitSpec = { shipTypeId, name: head[2] || 'Импорт', modules: [], drones: [], implants: [], cargo: [] }
  const unknown: string[] = []
  for (const line of lines.slice(lines.indexOf(head[0]) + 1)) {
    if (!line || /^\[empty .+ slot\]$/i.test(line)) continue
    const offline = /\/offline$/i.test(line)
    const clean = line.replace(/\s*\/offline$/i, '')
    const qtyMatch = /^(.+?)\s+x(\d+)$/i.exec(clean)
    const [namePart, chargeName] = (qtyMatch ? qtyMatch[1] : clean).split(/,\s*/)
    const id = await exactType(namePart)
    if (!id) {
      unknown.push(namePart)
      continue
    }
    const info = catalog.get(id)
    const qty = qtyMatch ? Number(qtyMatch[2]) : 1
    if (info?.slot === 'drone') fit.drones.push({ typeId: id, count: qty, active: 0 })
    else if (info?.slot === 'implant') fit.implants.push(id)
    else if (info && !qtyMatch) {
      const chargeTypeId = chargeName ? ((await exactType(chargeName)) ?? undefined) : undefined
      fit.modules.push({ typeId: id, slot: info.slot as Slot, state: offline ? 'offline' : defaultState(info), chargeTypeId })
    } else fit.cargo!.push({ typeId: id, qty })
  }
  // Launch as many drones as bandwidth usually allows: assume up to 5 of the first stack.
  let toLaunch = 5
  for (const d of fit.drones) {
    d.active = Math.min(d.count, toLaunch)
    toLaunch -= d.active
  }
  return { fit, unknown }
}

/** Converts an ESI item list (fittings, assets, killmails) with inventory flags into a fit. */
export async function fromEsiItems(shipTypeId: number, name: string, items: { typeId: number; flag: string | number; qty: number }[]): Promise<FitSpec> {
  const catalog = await loadCatalog()
  const basics = await window.api.sde.basics(items.map((i) => i.typeId))
  const fit: FitSpec = { shipTypeId, name, modules: [], drones: [], implants: [], cargo: [] }
  const slotOf = (flag: string | number): Slot | 'drone' | 'cargo' | null => {
    const f = String(flag)
    if (/^HiSlot|^(2[7-9]|3[0-4])$/.test(f)) return 'hi'
    if (/^MedSlot|^(19|2[0-6])$/.test(f)) return 'med'
    if (/^LoSlot|^(1[1-8])$/.test(f)) return 'lo'
    if (/^RigSlot|^(9[2-9])$/.test(f)) return 'rig'
    if (/^SubSystemSlot|^(12[5-9]|13[0-2])$/.test(f)) return 'sub'
    if (f === 'DroneBay' || f === '87') return 'drone'
    if (f === 'Cargo' || f === '5') return 'cargo'
    return null
  }
  const byFlag = new Map<string, { module?: number; charge?: number }>()
  for (const i of items) {
    const slot = slotOf(i.flag)
    if (!slot) continue
    if (slot === 'drone') {
      const existing = fit.drones.find((d) => d.typeId === i.typeId)
      if (existing) existing.count += i.qty
      else fit.drones.push({ typeId: i.typeId, count: i.qty, active: 0 })
      continue
    }
    if (slot === 'cargo') {
      fit.cargo!.push({ typeId: i.typeId, qty: i.qty })
      continue
    }
    const entry = byFlag.get(String(i.flag)) ?? {}
    if (basics[i.typeId]?.c === 8) entry.charge = i.typeId
    else entry.module = i.typeId
    byFlag.set(String(i.flag), entry)
  }
  for (const [flag, e] of byFlag) {
    if (!e.module) continue
    const info = catalog.get(e.module)
    let charge = e.charge
    // Unloaded weapon: pick the most plentiful compatible charge from the cargo hold.
    if (!charge && info?.charges && fit.cargo?.length) {
      const fits = new Set(await chargesFor(e.module))
      charge = [...fit.cargo].filter((c) => fits.has(c.typeId)).sort((a, b) => b.qty - a.qty)[0]?.typeId
    }
    fit.modules.push({ typeId: e.module, slot: (slotOf(flag) as Slot) ?? info?.slot, state: defaultState(info), chargeTypeId: charge })
  }
  let toLaunch = 5
  for (const d of fit.drones) {
    d.active = Math.min(d.count, toLaunch)
    toLaunch -= d.active
  }
  return fit
}

// ---------- Shared fitting state ----------

interface FittingState {
  fit: FitSpec | null
  savedId: string | null
  setFit: (fit: FitSpec | null, savedId?: string | null) => void
  updateFit: (fn: (fit: FitSpec) => FitSpec) => void
  /** Opens a fit in the Fitting page from anywhere in the app. */
  openFit: (fit: FitSpec, savedId?: string | null) => void
}

const Ctx = createContext<FittingState | null>(null)
const DRAFT_KEY = 'canopus.fitDraft'

export function FittingProvider({ children }: { children: ReactNode }) {
  const { navigate } = useApp()
  const [fit, setFitState] = useState<FitSpec | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')
    } catch {
      return null
    }
  })
  const [savedId, setSavedId] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(fit))
    } catch {
      // Storage is a convenience only.
    }
  }, [fit])

  const setFit = useCallback((f: FitSpec | null, id: string | null = null) => {
    setFitState(f)
    setSavedId(id)
  }, [])
  const updateFit = useCallback((fn: (f: FitSpec) => FitSpec) => setFitState((f) => (f ? fn(f) : f)), [])
  const openFit = useCallback(
    (f: FitSpec, id: string | null = null) => {
      setFit(f, id)
      navigate('fitting')
    },
    [navigate, setFit]
  )

  return <Ctx.Provider value={{ fit, savedId, setFit, updateFit, openFit }}>{children}</Ctx.Provider>
}

export function useFitting(): FittingState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useFitting outside FittingProvider')
  return ctx
}

export type { FitDrone, FitModule }
