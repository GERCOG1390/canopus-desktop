import { useEffect, useReducer } from 'react'
import { createBasicsCache } from '../../../shared/basicsCache'
import type { L10n, TypeBasic } from '../../../shared/sde'

export type Lang = 0 | 1

/** Picks the English (0) or Russian (1) string, falling back to English. */
export const tn = (n: L10n | undefined, lang: Lang): string => (n ? n[lang] || n[0] : '')

// ---------- Batched type-name cache shared by every <TypeLink> ----------

const basics = createBasicsCache<TypeBasic>((ids) => window.api.sde.basics(ids))

export const requestBasics = (ids: Iterable<number>): void => basics.request(ids)
export const primeBasics = (map: Record<number, TypeBasic>): void => basics.prime(map)
export const getBasic = (id: number): TypeBasic | undefined => basics.get(id)
/** Re-request anything that failed while the SDE was still downloading. */
export const retryMissing = (): void => basics.retry()

export function useTypeBasic(id: number): TypeBasic | undefined {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    return basics.subscribe(force)
  }, [])
  if (id && !basics.has(id)) requestBasics([id])
  return basics.get(id)
}

/** Loads names for many IDs at once and re-renders when they arrive. */
export function useTypeBasics(ids: number[]): (id: number) => TypeBasic | undefined {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    return basics.subscribe(force)
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
