// Fleet doctrines: a named set of fits pasted as EFT. For each fit — which of your characters can
// fly it already and how long the others need to train, and what the fit and the whole doctrine
// cost in Jita, with a multibuy list for the in-game market.

import { useEffect, useMemo, useState } from 'react'
import type { FitSpec } from '../../../shared/fit'
import type { SkillReq } from '../../../shared/sde'
import type { CharacterAuth } from '../../../shared/types'
import { useApp } from '../AppContext'
import { fitCost } from '../components/FitCost'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading } from '../components/ui'
import { esi, imageUrl } from '../lib/esi'
import { trainingMs } from '../lib/dogma'
import { fmtDuration, fmtIsk } from '../lib/format'
import { fromEft } from '../lib/fitting'
import { tn } from '../lib/sde'
import { useAsync } from '../lib/useAsync'

const STORE_KEY = 'doctrines'

interface Doctrine {
  id: string
  name: string
  /** The fits as pasted, EFT text */
  eft: string
}

interface CharSkills {
  id: number
  name: string
  skills: Map<number, { level: number; sp: number }>
  attrs: Record<number, number>
}

/** One EFT block per fit: a new one starts at each "[Ship, Name]" line. */
function splitEft(text: string): string[] {
  const blocks: string[][] = []
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[[^\],]+,[^\]]*\]\s*$/.test(line)) blocks.push([line])
    else blocks[blocks.length - 1]?.push(line)
  }
  return blocks.map((b) => b.join('\n').trim()).filter(Boolean)
}

async function loadCharSkills(c: CharacterAuth): Promise<CharSkills | null> {
  try {
    const [s, a] = await Promise.all([
      esi<{ skills: { skill_id: number; active_skill_level: number; skillpoints_in_skill: number }[] }>(`/characters/${c.id}/skills/`, { characterId: c.id }),
      esi<{ charisma: number; intelligence: number; memory: number; perception: number; willpower: number }>(`/characters/${c.id}/attributes/`, { characterId: c.id })
    ])
    return {
      id: c.id,
      name: c.name,
      skills: new Map(s.skills.map((x) => [x.skill_id, { level: x.active_skill_level, sp: x.skillpoints_in_skill }])),
      attrs: { 164: a.charisma, 165: a.intelligence, 166: a.memory, 167: a.perception, 168: a.willpower }
    }
  } catch {
    return null
  }
}

/** Missing skill levels and the time to train them for one character. */
function gap(reqs: Record<number, SkillReq>, c: CharSkills): { missing: number; ms: number } {
  let missing = 0
  let ms = 0
  for (const [id, r] of Object.entries(reqs)) {
    const have = c.skills.get(Number(id))
    if ((have?.level ?? 0) >= r.level) continue
    missing++
    const rate = (c.attrs[r.primary] ?? 0) + (c.attrs[r.secondary] ?? 0) / 2
    ms += trainingMs(r.rank, r.level, have?.sp ?? 0, rate)
  }
  return { missing, ms }
}

export default function Doctrines() {
  const { characters } = useApp()
  const [list, setList] = useState<Doctrine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<Doctrine | null>(null)
  useEffect(() => {
    void window.api.store.get<Doctrine[]>(STORE_KEY).then((d) => {
      setList(d ?? [])
      setSelected(d?.[0]?.id ?? null)
      setLoaded(true)
    })
  }, [])
  const save = (next: Doctrine[]) => {
    setList(next)
    void window.api.store.set(STORE_KEY, next)
  }
  const doctrine = list.find((d) => d.id === selected) ?? null

  if (!loaded) return <Loading />
  return (
    <div className="doctrines">
      <div className="row">
        {list.map((d) => (
          <button key={d.id} className={d.id === selected && !editing ? '' : 'ghost'} onClick={() => (setSelected(d.id), setEditing(null))}>
            {d.name}
          </button>
        ))}
        <button className="ghost" onClick={() => setEditing({ id: `d${Date.now()}`, name: '', eft: '' })}>
          + Новая доктрина
        </button>
      </div>
      {editing ? (
        <DoctrineEditor
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={(d) => {
            save(list.some((x) => x.id === d.id) ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d])
            setSelected(d.id)
            setEditing(null)
          }}
          onDelete={list.some((x) => x.id === editing.id) ? () => (save(list.filter((x) => x.id !== editing.id)), setEditing(null), setSelected(null)) : undefined}
        />
      ) : doctrine ? (
        <DoctrineView doctrine={doctrine} characters={characters} onEdit={() => setEditing(doctrine)} />
      ) : (
        <Empty>Доктрина — набор фитов флота. Создайте её и вставьте фиты в формате EFT: Canopus покажет, кто из ваших персонажей уже может на них летать и сколько стоит комплект.</Empty>
      )}
    </div>
  )
}

function DoctrineEditor({ value, onSave, onCancel, onDelete }: { value: Doctrine; onSave: (d: Doctrine) => void; onCancel: () => void; onDelete?: () => void }) {
  const [name, setName] = useState(value.name)
  const [eft, setEft] = useState(value.eft)
  const count = splitEft(eft).length
  return (
    <Card title={value.name ? 'Изменить доктрину' : 'Новая доктрина'}>
      <label>
        Название
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ferox fleet" />
      </label>
      <label>
        Фиты в формате EFT, один за другим
        <textarea rows={14} value={eft} onChange={(e) => setEft(e.target.value)} spellCheck={false} placeholder={'[Ferox, Ferox DPS]\nMagnetic Field Stabilizer II\n…\n\n[Scimitar, Logi]\n…'} />
      </label>
      <div className="row">
        <button disabled={!name.trim() || !count} onClick={() => onSave({ ...value, name: name.trim(), eft })}>
          Сохранить
        </button>
        <span className="muted small">{`Фитов: ${count}`}</span>
        <button className="ghost" onClick={onCancel}>
          Отмена
        </button>
        {onDelete && (
          <button className="ghost" onClick={onDelete}>
            Удалить доктрину
          </button>
        )}
      </div>
    </Card>
  )
}

interface FitRow {
  fit: FitSpec
  reqs: Record<number, SkillReq>
  isk: number
  missingPrices: number
  items: [number, number][]
}

function DoctrineView({ doctrine, characters, onEdit }: { doctrine: Doctrine; characters: CharacterAuth[]; onEdit: () => void }) {
  const fits = useAsync(async () => {
    const errors: string[] = []
    const rows: FitRow[] = []
    for (const block of splitEft(doctrine.eft)) {
      try {
        const { fit, unknown } = await fromEft(block)
        if (unknown.length) errors.push(`${fit.name || block.split('\n')[0]}: не распознано — ${unknown.join(', ')}`)
        const types = [fit.shipTypeId, ...fit.modules.flatMap((m) => [m.typeId, ...(m.chargeTypeId ? [m.chargeTypeId] : [])]), ...fit.drones.map((d) => d.typeId)]
        const [reqs, cost] = await Promise.all([window.api.sde.requiredSkills([...new Set(types)]), fitCost(fit)])
        rows.push({ fit, reqs, isk: cost.total, missingPrices: cost.missing, items: cost.items })
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    return { rows, errors }
  }, [doctrine.eft])
  const chars = useAsync(async () => (await Promise.all(characters.map(loadCharSkills))).filter((c): c is CharSkills => !!c), [characters.map((c) => c.id).join(',')])
  const [copied, setCopied] = useState(false)

  const rows = fits.data?.rows ?? []
  const total = rows.reduce((a, r) => a + r.isk, 0)
  // Multibuy: English names (what the game's multibuy reads), quantities added up over the doctrine.
  const multibuy = useAsync(async () => {
    const qty = new Map<number, number>()
    for (const r of rows) for (const [id, n] of r.items) qty.set(id, (qty.get(id) ?? 0) + n)
    const basics = await window.api.sde.basics([...qty.keys()])
    return [...qty].map(([id, n]) => `${tn(basics[id]?.n, 0)} ${n}`).join('\n')
  }, [rows.length && JSON.stringify(rows.map((r) => r.items))])
  const cols = chars.data ?? []
  const pilots = useMemo(
    () => rows.map((r) => cols.filter((c) => gap(r.reqs, c).missing === 0).length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, cols]
  )

  return (
    <Card
      title={doctrine.name}
      actions={
        <>
          <button
            className="ghost"
            disabled={!multibuy.data}
            title="Список для окна «Мультипокупка» на рынке в игре"
            onClick={() => {
              void navigator.clipboard.writeText(multibuy.data ?? '')
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? 'Скопировано' : 'Копировать для мультипокупки'}
          </button>
          <button className="ghost" onClick={onEdit}>
            Изменить
          </button>
        </>
      }
    >
      {fits.loading && !fits.data ? (
        <Loading />
      ) : (
        <>
          {fits.data?.errors.map((e, i) => <ErrorBox key={i} error={e} />)}
          <div className="doctrine-table">
            <table className="table">
              <thead>
                <tr>
                  <th>Фит</th>
                  <th className="num">Jita</th>
                  <th className="num">Могут лететь</th>
                  {cols.map((c) => (
                    <th key={c.id} className="doctrine-char" title={c.name}>
                      <img src={imageUrl.portrait(c.id, 32)} width={22} height={22} alt="" />
                      <span translate="no">{c.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <TypeLink id={r.fit.shipTypeId} /> <span className="muted" translate="no">{r.fit.name}</span>
                    </td>
                    <td className="num">
                      {fmtIsk(r.isk, true)}
                      {r.missingPrices > 0 && <span className="muted" title="Часть предметов без ордеров в Jita"> *</span>}
                    </td>
                    <td className="num">{!cols.length ? <span className="muted">—</span> : `${pilots[i]} / ${cols.length}`}</td>
                    {cols.map((c) => {
                      const g = gap(r.reqs, c)
                      return (
                        <td key={c.id}>
                          {g.missing === 0 ? (
                            <span className="good">✔</span>
                          ) : (
                            <span className="warn-text" title={`Не хватает уровней навыков: ${g.missing}`}>
                              {fmtDuration(g.ms)}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              {rows.length > 1 && (
                <tfoot>
                  <tr>
                    <td className="muted">Вся доктрина</td>
                    <td className="num">{fmtIsk(total, true)}</td>
                    <td colSpan={cols.length + 1} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {!characters.length && <p className="muted small">Войдите персонажами через EVE SSO, чтобы видеть, кто может лететь.</p>}
          {chars.data && chars.data.length < characters.length && (
            <p className="muted small">Не у всех персонажей есть разрешение на чтение навыков — войдите ими заново в «Настройках».</p>
          )}
          <p className="muted small">Время обучения — по базовым атрибутам персонажа, без учёта имплантов. Цены — лучшие ордера на продажу в Jita, с полным боекомплектом.</p>
        </>
      )}
    </Card>
  )
}
