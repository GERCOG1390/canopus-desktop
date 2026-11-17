// The incoming damage the fitting's tank figures are worked out against: omni, one type, what a mission NPC
// faction shoots (from the SDE), or the pilot's own split. Remembered between sessions (a viewer convenience).

import { useEffect, useState, useSyncExternalStore } from 'react'
import { BASIC_PROFILES, normalized, type DamageWeights } from '../../../shared/damageProfile.ts'
import type { NpcFaction } from '../../../shared/npc'
import { AttrIcon } from './Icon'
import { Glyph } from './Glyph'
import { useAsync } from '../lib/useAsync'

export interface ChosenProfile {
  /** omni | em | thermal | kinetic | explosive | npc:<faction> | custom | saved:<name> */
  id: string
  w: DamageWeights
}

const KEY = 'canopus.damageProfile'
const OMNI: ChosenProfile = { id: 'omni', w: [1, 1, 1, 1] }
let current: ChosenProfile = (() => {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return p && typeof p.id === 'string' && Array.isArray(p.w) && p.w.length === 4 ? p : OMNI
  } catch {
    return OMNI
  }
})()
const listeners = new Set<() => void>()

/** The pilot's own profiles under their names (Pyfa's damage patterns), kept in this browser. */
const SAVED_KEY = 'canopus.damageProfiles'
let saved: { name: string; w: DamageWeights }[] = (() => {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((x) => typeof x?.name === 'string' && Array.isArray(x.w) && x.w.length === 4) : []
  } catch {
    return []
  }
})()

function setSaved(next: typeof saved): void {
  saved = next
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(next))
  } catch {
    // A convenience only.
  }
  listeners.forEach((l) => l())
}

const useSaved = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => saved
  )

function choose(p: ChosenProfile): void {
  current = p
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // A convenience only.
  }
  listeners.forEach((l) => l())
}

export function useDamageProfile(): ChosenProfile {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}

const BASIC_LABEL: Record<string, string> = {
  omni: 'Равномерный (омни)',
  em: 'Только ЭМ',
  thermal: 'Только термический',
  kinetic: 'Только кинетический',
  explosive: 'Только фугасный'
}
export const FACTION_LABEL: Record<NpcFaction, string> = {
  guristas: 'Гуристас',
  serpentis: 'Серпентис',
  blood_raiders: 'Блад Рейдеры',
  sansha: 'Санша',
  angel: 'Ангелы',
  rogue_drones: 'Восставшие дроны',
  amarr: 'Амарр',
  caldari: 'Калдари',
  gallente: 'Галленте',
  minmatar: 'Минматар',
  khanid: 'Ханид',
  thukker: 'Туккеры',
  mordu: 'Легион Морду',
  concord: 'КОНКОРД'
}
const DAMAGE_ICON = [114, 118, 117, 116]
const DAMAGE_CLASS = ['em', 'th', 'ki', 'ex']

/** A short name of the chosen profile, for labels ("против Гуристас"). */
export function profileLabel(p: ChosenProfile): string {
  if (p.id.startsWith('npc:')) return FACTION_LABEL[p.id.slice(4) as NpcFaction] ?? p.id
  if (p.id === 'custom') return 'свой профиль'
  if (p.id.startsWith('saved:')) return p.id.slice(6)
  return BASIC_LABEL[p.id] ?? p.id
}

export function DamageProfilePicker() {
  const p = useDamageProfile()
  const npc = useAsync(() => window.api.fit.npcProfiles(), [])
  const mine = useSaved()
  const [naming, setNaming] = useState<string | null>(null)
  // An NPC profile is remembered by name, its shares come from the current SDE (a stored copy goes stale).
  useEffect(() => {
    if (!p.id.startsWith('npc:') || !npc.data) return
    const fresh = npc.data[p.id.slice(4) as NpcFaction]
    if (fresh && fresh.some((x, i) => Math.abs(x - p.w[i]) > 1e-9)) choose({ id: p.id, w: fresh })
  }, [npc.data, p.id])
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const share = normalized(p.w)

  function pick(id: string) {
    if (id === 'custom') return choose({ id, w: [...p.w] as DamageWeights })
    if (id.startsWith('saved:')) {
      const s = mine.find((x) => x.name === id.slice(6))
      return s && choose({ id, w: s.w })
    }
    if (id.startsWith('npc:')) {
      const w = npc.data?.[id.slice(4) as NpcFaction]
      return w && choose({ id, w })
    }
    const b = BASIC_PROFILES.find((x) => x.id === id)
    if (b) choose({ id, w: b.w })
  }

  return (
    <div className="damage-picker">
      <label className="row">
        <span className="muted small">Входящий урон:</span>
        <select value={p.id} onChange={(e) => pick(e.target.value)}>
          <optgroup label="Типы урона">
            {BASIC_PROFILES.map((b) => (
              <option key={b.id} value={b.id}>
                {BASIC_LABEL[b.id]}
              </option>
            ))}
          </optgroup>
          {!!npc.data && (
            <optgroup label="NPC в миссиях (по данным игры)">
              {(Object.keys(npc.data) as NpcFaction[]).map((f) => (
                <option key={f} value={`npc:${f}`}>
                  {FACTION_LABEL[f] ?? f}
                </option>
              ))}
            </optgroup>
          )}
          {!!mine.length && (
            <optgroup label="Мои профили">
              {mine.map((s) => (
                <option key={s.name} value={`saved:${s.name}`}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
          <option value="custom">Свой профиль…</option>
        </select>
        {p.id.startsWith('saved:') && (
          <button
            className="ghost small danger"
            title="Удалить этот профиль"
            onClick={() => {
              setSaved(mine.filter((x) => x.name !== p.id.slice(6)))
              choose(OMNI)
            }}
          >
            <Glyph name="close" size={12} />
          </button>
        )}
      </label>
      {p.id === 'custom' &&
        (naming === null ? (
          <button className="ghost small" onClick={() => setNaming('')}>
            Сохранить профиль под названием…
          </button>
        ) : (
          <div className="row damage-save">
            <input autoFocus placeholder="Название, например «Триглавы»" value={naming} onChange={(e) => setNaming(e.target.value)} />
            <button
              className="small"
              disabled={!naming.trim()}
              onClick={() => {
                const name = naming.trim()
                setSaved([...mine.filter((x) => x.name !== name), { name, w: [...p.w] as DamageWeights }])
                choose({ id: `saved:${name}`, w: [...p.w] as DamageWeights })
                setNaming(null)
              }}
            >
              Сохранить
            </button>
            <button className="ghost small" onClick={() => setNaming(null)}>
              Отмена
            </button>
          </div>
        ))}
      <div className="damage-shares">
        {share.map((x, i) =>
          p.id === 'custom' ? (
            <label key={i} className={`dmg dmg-${DAMAGE_CLASS[i]}`}>
              <AttrIcon attr={DAMAGE_ICON[i]} size={16} />
              <input
                type="number"
                min={0}
                value={p.w[i]}
                onChange={(e) => choose({ id: 'custom', w: p.w.map((v, k) => (k === i ? Math.max(0, Number(e.target.value) || 0) : v)) as DamageWeights })}
              />
            </label>
          ) : (
            <span key={i} className={`dmg dmg-${DAMAGE_CLASS[i]}`}>
              <AttrIcon attr={DAMAGE_ICON[i]} size={16} />
              {pct(x)}
            </span>
          )
        )}
      </div>
    </div>
  )
}
