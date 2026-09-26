import { useEffect, useReducer } from 'react'
import type { L10n, TypeBasic } from '../../../shared/sde'

export type Lang = 0 | 1

/** Picks the English (0) or Russian (1) string, falling back to English. */
export const tn = (n: L10n | undefined, lang: Lang): string => (n ? n[lang] || n[0] : '')

// ---------- Batched type-name cache shared by every <TypeLink> ----------

const cache = new Map<number, TypeBasic>()
const requested = new Set<number>()
const listeners = new Set<() => void>()
let queue = new Set<number>()
let scheduled = false

function notify(): void {
  listeners.forEach((l) => l())
}

async function flush(): Promise<void> {
  scheduled = false
  const ids = [...queue]
  queue = new Set()
  if (!ids.length) return
  try {
    const res = await window.api.sde.basics(ids)
    Object.values(res).forEach((b) => cache.set(b.id, b))
  } catch {
    // SDE not ready yet: allow a retry once it is.
    ids.forEach((id) => requested.delete(id))
  }
  notify()
}

export function requestBasics(ids: Iterable<number>): void {
  for (const id of ids) {
    if (!id || cache.has(id) || requested.has(id)) continue
    requested.add(id)
    queue.add(id)
  }
  if (queue.size && !scheduled) {
    scheduled = true
    setTimeout(() => void flush(), 0)
  }
}

export function primeBasics(map: Record<number, TypeBasic>): void {
  Object.values(map).forEach((b) => cache.set(b.id, b))
}

export const getBasic = (id: number): TypeBasic | undefined => cache.get(id)

/** Re-request anything that failed while the SDE was still downloading. */
export function retryMissing(): void {
  requested.clear()
  notify()
}

export function useTypeBasic(id: number): TypeBasic | undefined {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    listeners.add(force)
    return () => void listeners.delete(force)
  }, [])
  if (id && !cache.has(id)) requestBasics([id])
  return cache.get(id)
}

/** Loads names for many IDs at once and re-renders when they arrive. */
export function useTypeBasics(ids: number[]): (id: number) => TypeBasic | undefined {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    listeners.add(force)
    return () => void listeners.delete(force)
  }, [])
  requestBasics(ids)
  return getBasic
}

// ---------- Search helpers ----------

export async function searchTypesSde(query: string, lang: Lang, opts?: { marketOnly?: boolean; categories?: number[] }) {
  const res = await window.api.sde.search(query, { limit: 40, ...opts })
  primeBasics(Object.fromEntries(res.map((r) => [r.id, r])))
  return res.map((r) => ({ id: r.id, name: tn(r.n, lang), alt: lang === 1 && r.n[1] !== r.n[0] ? r.n[0] : undefined }))
}

export async function searchSystemsSde(query: string) {
  const res = await window.api.sde.searchSystems(query, 20)
  return res.map((s) => ({ id: s.id, name: s.n, sec: s.sec }))
}

export const CATEGORY = {
  SHIP: 6,
  MODULE: 7,
  CHARGE: 8,
  BLUEPRINT: 9,
  SKILL: 16,
  DRONE: 18,
  IMPLANT: 20,
  SUBSYSTEM: 32,
  STRUCTURE_MODULE: 66,
  FIGHTER: 87
}
