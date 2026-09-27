import { useEffect, useRef, useState } from 'react'
import { useLang } from '../AppContext'
import { imageUrl } from '../lib/esi'
import { getBasic, tn } from '../lib/sde'
import { AttrIcon } from './Icon'

/** EM, thermal, kinetic, explosive damage attributes — their icons are the game's damage type icons. */
const DAMAGE_ATTRS = [114, 118, 117, 116] as const
const DAMAGE_NAME: Record<number, string> = { 114: 'ЭМ', 118: 'Термический', 117: 'Кинетический', 116: 'Фугасный' }

/** Meta groups in the game's order, with their headings. */
const META_GROUPS: [number[], string][] = [
  [[1], 'Tech I'],
  [[2], 'Tech II'],
  [[3], 'Сюжетные'],
  [[4], 'Фракционные'],
  [[6], 'Deadspace'],
  [[5], 'Офицерские']
]

const damageCache = new Map<string, Promise<Record<number, Record<number, number>>>>()

function loadDamage(ids: number[]): Promise<Record<number, Record<number, number>>> {
  const key = ids.join(',')
  let pending = damageCache.get(key)
  if (!pending) {
    pending = window.api.sde.dogmaAttrs(ids, [...DAMAGE_ATTRS])
    damageCache.set(key, pending)
  }
  return pending
}

/** Damage types a charge deals, strongest first (only those that make up a real part of it). */
function damageTypes(attrs: Record<number, number> | undefined): number[] {
  if (!attrs) return []
  const total = DAMAGE_ATTRS.reduce((s, a) => s + (attrs[a] ?? 0), 0)
  if (!total) return []
  return DAMAGE_ATTRS.filter((a) => (attrs[a] ?? 0) / total >= 0.2).sort((a, b) => (attrs[b] ?? 0) - (attrs[a] ?? 0))
}

function DamageIcons({ types }: { types: number[] }) {
  return (
    <span className="dmg-icons">
      {types.map((a) => (
        <AttrIcon key={a} attr={a} size={16} title={DAMAGE_NAME[a]} />
      ))}
    </span>
  )
}

/**
 * Charge selector like the game's: charges grouped Tech I / Tech II / faction…,
 * each with its icon and damage type.
 */
export function ChargePicker({ charges, value, onChange }: { charges: number[]; value?: number; onChange: (id: number | undefined) => void }) {
  const lang = useLang()
  const [open, setOpen] = useState(false)
  const [damage, setDamage] = useState<Record<number, Record<number, number>>>({})
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!charges.length) return
    let live = true
    void loadDamage(charges).then((d) => live && setDamage(d))
    return () => {
      live = false
    }
  }, [charges])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const name = (id: number) => tn(getBasic(id)?.n, lang) || String(id)
  const known = new Set(META_GROUPS.flatMap(([m]) => m))
  const groups: [string, number[]][] = [
    ...META_GROUPS.map(([metas, label]) => [label, charges.filter((c) => metas.includes(getBasic(c)?.meta ?? 1))] as [string, number[]]),
    ['Прочие', charges.filter((c) => !known.has(getBasic(c)?.meta ?? 1))] as [string, number[]]
  ]
    .map(([label, ids]) => [label, [...ids].sort((a, b) => name(a).localeCompare(name(b)))] as [string, number[]])
    .filter(([, ids]) => ids.length)

  const pick = (id: number | undefined) => {
    onChange(id)
    setOpen(false)
  }

  return (
    <div className="charge-picker" ref={root}>
      <button className="charge-current" onClick={() => setOpen(!open)} title={value ? name(value) : undefined}>
        {value ? (
          <>
            <img src={imageUrl.typeIcon(value, 32)} width={20} height={20} alt="" />
            <span className="charge-name">{name(value)}</span>
            <DamageIcons types={damageTypes(damage[value])} />
          </>
        ) : (
          <span className="charge-name muted">— без заряда —</span>
        )}
        <span className="charge-caret">▾</span>
      </button>
      {open && (
        <div className="charge-menu">
          <div className={`charge-item ${!value ? 'selected' : ''}`} onClick={() => pick(undefined)}>
            <span className="charge-name muted">— без заряда —</span>
          </div>
          {groups.map(([label, ids]) => (
            <div key={label}>
              <div className="charge-group">{label}</div>
              {ids.map((id) => (
                <div key={id} className={`charge-item ${id === value ? 'selected' : ''}`} onClick={() => pick(id)}>
                  <img src={imageUrl.typeIcon(id, 32)} width={22} height={22} alt="" loading="lazy" />
                  <span className="charge-name">{name(id)}</span>
                  <DamageIcons types={damageTypes(damage[id])} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
