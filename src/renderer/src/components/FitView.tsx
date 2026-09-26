import { useState } from 'react'
import type { SkillReq } from '../../../shared/sde'
import { imageUrl } from '../lib/esi'
import { fromEsiItems, useFitting } from '../lib/fitting'
import { getBasic, requestBasics } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { MissingSkillsBox } from './skills'
import { TypeLink } from './TypeLink'

export interface FitItem {
  typeId: number
  flag: string | number
  qty: number
}

type Section = 'hi' | 'med' | 'lo' | 'rig' | 'sub' | 'drone' | 'fighter' | 'cargo' | 'other'

const SECTION_LABEL: Record<Section, string> = {
  hi: 'Разъёмы большой мощности',
  med: 'Разъёмы средней мощности',
  lo: 'Разъёмы малой мощности',
  rig: 'Модификаторы (риги)',
  sub: 'Подсистемы',
  drone: 'Отсек дронов',
  fighter: 'Ангар истребителей',
  cargo: 'Грузовой отсек',
  other: 'Прочие отсеки'
}

/** Maps ESI inventory flags (string or legacy numeric) to fitting sections. */
export function sectionOf(flag: string | number): Section {
  if (typeof flag === 'number') {
    if (flag >= 27 && flag <= 34) return 'hi'
    if (flag >= 19 && flag <= 26) return 'med'
    if (flag >= 11 && flag <= 18) return 'lo'
    if (flag >= 92 && flag <= 99) return 'rig'
    if (flag >= 125 && flag <= 132) return 'sub'
    if (flag === 87) return 'drone'
    if (flag === 158) return 'fighter'
    if (flag === 5) return 'cargo'
    return 'other'
  }
  if (flag.startsWith('HiSlot')) return 'hi'
  if (flag.startsWith('MedSlot')) return 'med'
  if (flag.startsWith('LoSlot')) return 'lo'
  if (flag.startsWith('RigSlot')) return 'rig'
  if (flag.startsWith('SubSystemSlot')) return 'sub'
  if (flag === 'DroneBay') return 'drone'
  if (flag.startsWith('FighterBay') || flag.startsWith('FighterTube')) return 'fighter'
  if (flag === 'Cargo') return 'cargo'
  return 'other'
}

const SLOT_ATTRS = { hi: 14, med: 13, lo: 12, rig: 1137, sub: 1367 } as const

/** EFT text, the format every fitting tool and the in-game import understand. */
export function toEft(shipTypeId: number, name: string, items: FitItem[]): string {
  const en = (id: number) => getBasic(id)?.n[0] ?? `#${id}`
  const by = (s: Section) => items.filter((i) => sectionOf(i.flag) === s)
  const lines = [`[${en(shipTypeId)}, ${name}]`]
  for (const s of ['lo', 'med', 'hi', 'rig', 'sub'] as Section[]) {
    for (const i of by(s)) lines.push(en(i.typeId))
    lines.push('')
  }
  for (const s of ['drone', 'fighter'] as Section[]) for (const i of by(s)) lines.push(`${en(i.typeId)} x${i.qty}`)
  lines.push('')
  for (const i of by('cargo')) lines.push(`${en(i.typeId)} x${i.qty}`)
  return lines.join('\n').trim()
}

export function FitView({ shipTypeId, name, items, showSkills = true }: { shipTypeId: number; name: string; items: FitItem[]; showSkills?: boolean }) {
  const [copied, setCopied] = useState(false)
  const { openFit } = useFitting()
  requestBasics([shipTypeId, ...items.map((i) => i.typeId)])

  const { data } = useAsync(async () => {
    const [slots, reqs] = await Promise.all([
      window.api.sde.dogmaAttrs([shipTypeId], Object.values(SLOT_ATTRS)),
      window.api.sde.requiredSkills([shipTypeId, ...items.filter((i) => sectionOf(i.flag) !== 'cargo').map((i) => i.typeId)])
    ])
    return { slots: slots[shipTypeId] ?? {}, reqs }
  }, [shipTypeId, items.map((i) => i.typeId).join(',')])

  const grouped = new Map<Section, FitItem[]>()
  for (const i of items) grouped.set(sectionOf(i.flag), [...(grouped.get(sectionOf(i.flag)) ?? []), i])

  const sections: Section[] = ['hi', 'med', 'lo', 'rig', 'sub', 'drone', 'fighter', 'cargo', 'other']
  return (
    <div className="fit">
      <div className="fit-head">
        <img src={imageUrl.typeRender(shipTypeId, 128)} width={80} height={80} alt="" />
        <div className="grow">
          <TypeLink id={shipTypeId} icon={false} className="big" />
          <div className="muted">{name}</div>
        </div>
        <button className="small" onClick={async () => openFit(await fromEsiItems(shipTypeId, name, items))}>
          Открыть в фитинге
        </button>
        <button
          className="ghost small"
          onClick={() => {
            void navigator.clipboard.writeText(toEft(shipTypeId, name, items))
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? 'Скопировано' : 'Копировать EFT'}
        </button>
      </div>
      {showSkills && data && <MissingSkillsBox reqs={data.reqs as Record<number, SkillReq>} title="Фит" />}
      <div className="fit-sections">
        {sections.map((s) => {
          const list = grouped.get(s) ?? []
          const slotCount = s in SLOT_ATTRS ? (data?.slots[SLOT_ATTRS[s as keyof typeof SLOT_ATTRS]] ?? 0) : 0
          const empty = Math.max(0, slotCount - list.length)
          if (!list.length && !empty) return null
          return (
            <div key={s} className="fit-section">
              <h5>
                {SECTION_LABEL[s]} {slotCount > 0 && <span className="muted">{list.length}/{slotCount}</span>}
              </h5>
              <ul>
                {list.map((i, idx) => (
                  <li key={`${i.typeId}-${idx}`}>
                    <TypeLink id={i.typeId} size={24} />
                    {i.qty > 1 && <span className="muted"> ×{i.qty}</span>}
                  </li>
                ))}
                {Array.from({ length: empty }, (_, k) => (
                  <li key={`empty-${k}`} className="muted empty-slot">
                    — пустой разъём —
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
