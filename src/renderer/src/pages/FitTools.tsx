// Fitting tools: which skills pay off most for a fit, side-by-side fit comparison,
// and the fits people actually fly (recent losses on zKillboard).

import { useMemo, useState } from 'react'
import type { FitSpec, FitStats, SavedFit, SkillSource } from '../../../shared/fit'
import { useApp, useLang } from '../AppContext'
import { useCharacter } from '../CharacterContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, Tabs } from '../components/ui'
import { spForLevel } from '../lib/dogma'
import { esi } from '../lib/esi'
import { fmtAgo, fmtDuration, fmtNum, ROMAN } from '../lib/format'
import { fromEsiItems } from '../lib/fitting'
import { loadGameFits } from '../lib/gameFits'
import { getBasic, primeBasics, tn, useTypeBasics } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { locale } from '../i18n'

export type FitTool = 'learn' | 'compare' | 'popular'

const n1 = (v: number, d = 1) => v.toLocaleString(locale(), { maximumFractionDigits: d })

export function FitTools({ tool, setTool, fit, skills, onLoad }: { tool: FitTool; setTool: (t: FitTool | null) => void; fit: FitSpec; skills: SkillSource; onLoad: (f: FitSpec) => void }) {
  return (
    <Card
      className="fit-tools"
      actions={
        <button className="ghost small" onClick={() => setTool(null)}>
          ✕
        </button>
      }
    >
      <Tabs
        tabs={[
          { id: 'learn', label: 'Что выучить' },
          { id: 'compare', label: 'Сравнить фиты' },
          { id: 'popular', label: 'Популярные фиты (zKillboard)' }
        ]}
        value={tool}
        onChange={setTool}
      />
      {tool === 'learn' && <WhatToLearn fit={fit} />}
      {tool === 'compare' && <CompareFits fit={fit} skills={skills} />}
      {tool === 'popular' && <PopularFits shipTypeId={fit.shipTypeId} onLoad={onLoad} />}
    </Card>
  )
}

// ---------------- What to learn ----------------

type Metric = 'dps' | 'ehp' | 'activeTank' | 'speed' | 'align' | 'lockRange'
const METRICS: [Metric, string][] = [
  ['dps', 'Урон (DPS)'],
  ['ehp', 'EHP'],
  ['activeTank', 'Активный танк'],
  ['speed', 'Скорость'],
  ['align', 'Разгон до варпа'],
  ['lockRange', 'Дальность захвата']
]

function WhatToLearn({ fit }: { fit: FitSpec }) {
  const char = useCharacter()
  const [metric, setMetric] = useState<Metric>('dps')
  const levels = useMemo(() => (char.skills ? Object.fromEntries([...char.skills.entries()].map(([id, s]) => [id, s.active])) : null), [char.skills])
  const gains = useAsync(async () => {
    if (!levels) return null
    const list = await window.api.fit.skillGains(fit, levels)
    const ids = list.map((g) => g.skill)
    const [attrs, basics] = await Promise.all([window.api.sde.dogmaAttrs(ids, [275, 180, 181]), window.api.sde.basics(ids)])
    primeBasics(basics)
    return list.map((g) => {
      const a = attrs[g.skill] ?? {}
      const rank = a[275] ?? 1
      const rate = (char.attributes?.[a[180]] ?? 0) + (char.attributes?.[a[181]] ?? 0) / 2
      const sp = char.skills?.get(g.skill)?.sp ?? 0
      const need = Math.max(0, spForLevel(rank, g.from + 1) - Math.max(sp, spForLevel(rank, g.from)))
      return { ...g, hours: rate ? need / rate / 60 : Infinity }
    })
  }, [JSON.stringify(fit), levels])

  if (!char.skills) return <Empty>Нужен персонаж: войдите через EVE SSO, чтобы посчитать, что даст каждый следующий уровень ваших навыков.</Empty>
  if (gains.loading) return <Loading label="Пересчитываю фит для каждого навыка…" />
  if (gains.error) return <ErrorBox error={gains.error} />
  // "Better" is less time to align; everything else is more.
  const value = (g: NonNullable<typeof gains.data>[number]) => (metric === 'align' ? -g.align : g[metric])
  const rows = (gains.data ?? []).filter((g) => value(g) > 1e-6).sort((a, b) => value(b) / Math.max(b.hours, 0.05) - value(a) / Math.max(a.hours, 0.05)).slice(0, 30)
  return (
    <>
      <div className="row">
        <span className="muted small">Что улучшаем:</span>
        {METRICS.map(([m, label]) => (
          <button key={m} className={`chip-btn ${metric === m ? 'active' : ''}`} onClick={() => setMetric(m)}>
            {label}
          </button>
        ))}
      </div>
      {!rows.length ? (
        <Empty>Ни один следующий уровень навыка не улучшит это у этого фита.</Empty>
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th>Навык</th>
              <th>Уровень</th>
              <th className="num">Учить</th>
              <th className="num">Прибавка</th>
              <th className="num">За час обучения</th>
              <th>Заодно</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const v = value(g)
              const others = METRICS.filter(([m]) => m !== metric && (m === 'align' ? g.align < -0.005 : g[m] > 0.05)).map(([m, label]) => `${label} ${m === 'align' ? `−${n1(-g.align, 2)} с` : `+${n1(g[m])}`}`)
              return (
                <tr key={g.skill}>
                  <td>
                    <TypeLink id={g.skill} size={18} />
                  </td>
                  <td>{`${ROMAN[g.from]} → ${ROMAN[g.from + 1]}`}</td>
                  <td className="num">{Number.isFinite(g.hours) ? fmtDuration(g.hours * 3_600_000) : '—'}</td>
                  <td className="num good">{metric === 'align' ? `−${n1(v, 2)} с` : `+${n1(v)}`}</td>
                  <td className="num">
                    <b>{metric === 'align' ? `${n1(v / Math.max(g.hours, 0.05), 3)} с` : n1(v / Math.max(g.hours, 0.05), 2)}</b>
                  </td>
                  <td className="muted small">{others.join(' · ')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="muted small">Фит пересчитан с каждым навыком на один уровень выше (ваши текущие навыки и импланты). Сортировка — по пользе на час обучения.</p>
    </>
  )
}

// ---------------- Compare fits ----------------

interface Row {
  label: string
  get: (s: FitStats) => number
  fmt: (v: number) => string
  lowerBetter?: boolean
}

const ROWS: Row[] = [
  { label: 'DPS', get: (s) => s.offense.totalDps, fmt: (v) => n1(v) },
  { label: 'Залп', get: (s) => s.offense.totalVolley, fmt: (v) => fmtNum(Math.round(v)) },
  { label: 'EHP', get: (s) => s.defense.ehp, fmt: (v) => fmtNum(Math.round(v)) },
  { label: 'Активный танк, EHP/с', get: (s) => s.defense.activeTankEhp, fmt: (v) => n1(v) },
  { label: 'Регенерация щита, HP/с', get: (s) => s.defense.passiveShieldRegen, fmt: (v) => n1(v) },
  { label: 'Накопитель, % стабильности', get: (s) => (s.capacitor.stable ? (s.capacitor.stableLevel ?? 0) * 100 : 0), fmt: (v) => (v ? `${n1(v)}%` : 'нестабилен') },
  { label: 'Скорость, м/с', get: (s) => s.navigation.maxVelocity, fmt: (v) => n1(v) },
  { label: 'Разгон до варпа, с', get: (s) => s.navigation.alignSec, fmt: (v) => n1(v, 2), lowerBetter: true },
  { label: 'Сигнатура, м', get: (s) => s.navigation.signatureRadius, fmt: (v) => n1(v), lowerBetter: true },
  { label: 'Дальность захвата, км', get: (s) => s.targeting.maxRange / 1000, fmt: (v) => n1(v) },
  { label: 'Разрешение сканера, мм', get: (s) => s.targeting.scanResolution, fmt: (v) => n1(v) },
  { label: 'ЦПУ занято, %', get: (s) => (s.ship.cpu.total ? (s.ship.cpu.used / s.ship.cpu.total) * 100 : 0), fmt: (v) => `${n1(v)}%`, lowerBetter: true },
  { label: 'Реактор занят, %', get: (s) => (s.ship.power.total ? (s.ship.power.used / s.ship.power.total) * 100 : 0), fmt: (v) => `${n1(v)}%`, lowerBetter: true }
]

function CompareFits({ fit, skills }: { fit: FitSpec; skills: SkillSource }) {
  const lang = useLang()
  const { active } = useApp()
  const [others, setOthers] = useState<FitSpec[]>([])
  const saved = useAsync(() => window.api.fit.list(), [])
  const game = useAsync(async () => (active ? await loadGameFits(active.id).catch(() => []) : []), [active?.id])
  useTypeBasics([...(saved.data ?? []).map((f) => f.shipTypeId), ...(game.data ?? []).map((f) => f.ship_type_id)])
  const fits = [fit, ...others]
  const stats = useAsync(() => Promise.all(fits.map((f) => window.api.fit.calculate(f, skills))), [JSON.stringify(fits), JSON.stringify(skills)])

  async function add(value: string) {
    const [kind, id] = value.split(':')
    if (kind === 's') {
      const f = saved.data?.find((x) => x.id === id) as SavedFit | undefined
      if (f) setOthers((o) => [...o, f].slice(-3))
    } else if (kind === 'g') {
      const f = game.data?.find((x) => String(x.fitting_id) === id)
      if (f) {
        const spec = await fromEsiItems(f.ship_type_id, f.name, f.items.map((i) => ({ typeId: i.type_id, flag: i.flag, qty: i.quantity })))
        setOthers((o) => [...o, spec].slice(-3))
      }
    }
  }

  return (
    <>
      <div className="row">
        <select value="" onChange={(e) => void add(e.target.value)}>
          <option value="">+ добавить фит для сравнения…</option>
          {!!saved.data?.length && (
            <optgroup label="Сохранённые в Canopus">
              {saved.data.map((f) => (
                <option key={f.id} value={`s:${f.id}`}>
                  {`${tn(getBasic(f.shipTypeId)?.n, lang)} — ${f.name}`}
                </option>
              ))}
            </optgroup>
          )}
          {!!game.data?.length && (
            <optgroup label="Фиты из игры">
              {game.data.map((f) => (
                <option key={f.fitting_id} value={`g:${f.fitting_id}`}>
                  {`${tn(getBasic(f.ship_type_id)?.n, lang)} — ${f.name}`}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <span className="muted small">Все фиты считаются с одними и теми же навыками — теми, что выбраны в фитинге.</span>
      </div>
      {stats.loading ? (
        <Loading />
      ) : stats.data ? (
        <table className="table compact compare-table">
          <thead>
            <tr>
              <th />
              {fits.map((f, i) => (
                <th key={i} className="num">
                  <TypeLink id={f.shipTypeId} size={20} />
                  <div className="muted small" translate="no">
                    {i === 0 ? `${f.name} (текущий)` : f.name}
                  </div>
                  {i > 0 && (
                    <button className="ghost small" onClick={() => setOthers((o) => o.filter((_, k) => k !== i - 1))}>
                      ✕
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const vals = stats.data!.map(r.get)
              const best = r.lowerBetter ? Math.min(...vals) : Math.max(...vals)
              return (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  {vals.map((v, i) => (
                    <td key={i} className={`num ${vals.length > 1 && v === best && vals.some((x) => x !== v) ? 'good compare-best' : ''}`}>
                      {r.fmt(v)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}
    </>
  )
}

// ---------------- Popular fits (zKillboard losses) ----------------

interface ZkbKill {
  killmail_id: number
  zkb: { hash: string; totalValue?: number }
}
interface Killmail {
  killmail_time: string
  victim: { ship_type_id: number; items?: { item_type_id: number; flag: number; quantity_destroyed?: number; quantity_dropped?: number }[] }
}
/** Fitted slots in killmail flags: low, mid, high, rigs, subsystems. */
const FITTED = (flag: number) => (flag >= 11 && flag <= 34) || (flag >= 92 && flag <= 99) || (flag >= 125 && flag <= 132)
const CHARGE_CATEGORY = 8

function PopularFits({ shipTypeId, onLoad }: { shipTypeId: number; onLoad: (f: FitSpec) => void }) {
  const lang = useLang()
  const ship = getBasic(shipTypeId)
  const data = useAsync(async () => {
    const losses = ((await window.api.request<ZkbKill[]>(`https://zkillboard.com/api/losses/shipTypeID/${shipTypeId}/`)) ?? []).slice(0, 40)
    const mails = (await Promise.all(losses.map((k) => esi<Killmail>(`/killmails/${k.killmail_id}/${k.zkb.hash}/`).catch(() => null)))).map((km, i) => ({ km, z: losses[i] }))
    const ids = [...new Set(mails.flatMap(({ km }) => km?.victim.items?.map((i) => i.item_type_id) ?? []))]
    const basics = ids.length ? await window.api.sde.basics(ids) : {}
    primeBasics(basics)
    // Same set of fitted modules (charges ignored) = same fit.
    const groups = new Map<string, { count: number; last: string; value: number; km: Killmail; id: number; modules: number[] }>()
    for (const { km, z } of mails) {
      if (!km?.victim.items) continue
      const modules = km.victim.items.filter((i) => FITTED(i.flag) && basics[i.item_type_id]?.c !== CHARGE_CATEGORY).map((i) => i.item_type_id)
      if (modules.length < 3) continue
      const key = [...modules].sort((a, b) => a - b).join(',')
      const g = groups.get(key)
      if (g) {
        g.count++
        if (km.killmail_time > g.last) g.last = km.killmail_time
      } else groups.set(key, { count: 1, last: km.killmail_time, value: z.zkb.totalValue ?? 0, km, id: z.killmail_id, modules })
    }
    return { total: mails.filter((m) => m.km).length, fits: [...groups.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, 12) }
  }, [shipTypeId])

  async function open(g: { km: Killmail; id: number }) {
    const items = (g.km.victim.items ?? []).map((i) => ({ typeId: i.item_type_id, flag: i.flag, qty: (i.quantity_destroyed ?? 0) + (i.quantity_dropped ?? 0) }))
    onLoad(await fromEsiItems(shipTypeId, `zKill ${g.id}`, items))
  }

  if (data.loading) return <Loading label="Смотрю последние потери на zKillboard…" />
  if (data.error) return <ErrorBox error={data.error} />
  if (!data.data?.fits.length) return <Empty>{`На zKillboard нет свежих потерь ${tn(ship?.n, lang)} с модулями.`}</Empty>
  return (
    <>
      <p className="muted small">{`Фиты ${tn(ship?.n, lang)}, с которыми их чаще всего теряли (последние ${data.data.total} потерь на zKillboard). Это реальные фиты, на которых летают игроки.`}</p>
      <table className="table compact">
        <thead>
          <tr>
            <th className="num">Раз</th>
            <th>Модули</th>
            <th className="num">Последний раз</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.data.fits.map((g) => {
            const counts = new Map<number, number>()
            g.modules.forEach((m) => counts.set(m, (counts.get(m) ?? 0) + 1))
            return (
              <tr key={g.id}>
                <td className="num">
                  <b>{g.count}</b>
                </td>
                <td className="small popular-mods">
                  {[...counts.entries()].map(([m, n]) => (
                    <span key={m}>
                      {n > 1 ? `${n}× ` : ''}
                      <TypeLink id={m} size={16} />
                    </span>
                  ))}
                </td>
                <td className="num muted small">{fmtAgo(g.last)}</td>
                <td>
                  <button className="ghost small" onClick={() => void open(g)}>
                    Открыть
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

