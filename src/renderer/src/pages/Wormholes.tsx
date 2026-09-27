// Wormholes: type database (SDE), J-space system lookup and a mass calculator for rolling holes.

import { useEffect, useMemo, useState } from 'react'
import type { SystemBasic, WormholeType } from '../../../shared/sde'
import { useLang } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, SearchBox, Sec } from '../components/ui'
import { fmtNum } from '../lib/format'
import { CATEGORY, searchTypesSde, tn, useTypeBasic } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { locale } from '../i18n'

/** Wormhole class IDs as used by the SDE. */
const CLASS_LABEL: Record<number, string> = {
  1: 'C1',
  2: 'C2',
  3: 'C3',
  4: 'C4',
  5: 'C5',
  6: 'C6',
  7: 'Highsec',
  8: 'Lowsec',
  9: 'Nullsec',
  12: 'Thera',
  13: 'C13 (Shattered)',
  14: 'Sentinel',
  15: 'Barbican',
  16: 'Vidette',
  17: 'Conflux',
  18: 'Redoubt',
  25: 'Pochven'
}
const classLabel = (c: number) => CLASS_LABEL[c] ?? (c > 0 ? `класс ${c}` : 'неизвестно')

const tons = (kg: number) => `${(kg / 1000).toLocaleString(locale(), { maximumFractionDigits: 0 })} т`
const mkg = (kg: number) => `${(kg / 1e6).toLocaleString(locale(), { maximumFractionDigits: 1 })} млн кг`

/** Which ships fit through, by the hole's per-jump mass limit. */
function passes(jumpMass: number): string {
  if (jumpMass <= 5_000_000) return 'фрегаты и эсминцы'
  if (jumpMass <= 62_000_000) return 'до линейных крейсеров'
  if (jumpMass <= 375_000_000) return 'до линкоров'
  if (jumpMass <= 1_000_000_000) return 'до фрейтеров'
  return 'капитальные корабли'
}

export default function Wormholes() {
  const types = useAsync(() => window.api.sde.wormholeTypes(), [])
  const [selected, setSelected] = useState<WormholeType | null>(null)
  return (
    <>
      <Lookup types={types.data ?? []} onPick={setSelected} />
      <MassCalc hole={selected} />
      <TypeTable types={types.data ?? []} selected={selected} onPick={setSelected} />
    </>
  )
}

function Lookup({ types, onPick }: { types: WormholeType[]; onPick: (w: WormholeType) => void }) {
  const [q, setQ] = useState('')
  const code = q.trim().toUpperCase()
  const hole = types.find((t) => t.code === code)
  const sys = useAsync(async () => {
    if (!/^J\d{6}$/i.test(code) && !/^(THERA|TURNUR)$/i.test(code)) return null
    const hits = await window.api.sde.searchSystems(code, 3)
    const hit = hits.find((h) => h.n.toUpperCase() === code)
    return hit ? await window.api.sde.system(hit.id) : null
  }, [code])
  return (
    <Card title="Поиск: код дыры или J-система">
      <input value={q} placeholder="Например, C247 или J100001" onChange={(e) => setQ(e.target.value)} />
      {hole && (
        <div className="wh-card">
          <HoleSummary w={hole} />
          <button onClick={() => onPick(hole)}>В калькулятор массы</button>
        </div>
      )}
      {sys.data && <SystemCard s={sys.data} />}
      {code.length >= 4 && !hole && !sys.data && !sys.loading && <p className="muted small">Не найдено: введите 4-символьный код сигнатуры дыры или имя J-системы.</p>}
    </Card>
  )
}

function HoleSummary({ w }: { w: WormholeType }) {
  return (
    <div className="kv-list wh-kv">
      <span>Дыра</span>
      <b>{w.code}</b>
      <span>Ведёт в</span>
      <b>{classLabel(w.target)}</b>
      <span>Живёт</span>
      <b>{`${fmtNum(w.lifetime / 60)} ч`}</b>
      <span>Общая масса</span>
      <b>{mkg(w.mass)}</b>
      <span>Масса за прыжок</span>
      <b>{`${mkg(w.jumpMass)} — ${passes(w.jumpMass)}`}</b>
      {w.regen > 0 && (
        <>
          <span>Восстановление массы</span>
          <b>{`${mkg(w.regen)} в сутки`}</b>
        </>
      )}
    </div>
  )
}

function SystemCard({ s }: { s: SystemBasic }) {
  const lang = useLang()
  const effect = useTypeBasic(s.fx ?? 0)
  return (
    <div className="kv-list wh-kv">
      <span>Система</span>
      <b>
        <Sec value={s.sec} /> {s.n}
      </b>
      <span>Регион</span>
      <b>{tn(s.region, lang)}</b>
      <span>Класс</span>
      <b>{s.wc ? classLabel(s.wc) : '—'}</b>
      <span>Эффект</span>
      <b>{s.fx ? <TypeLink id={s.fx} size={16} /> : 'нет'}</b>
      {s.fx && effect && <span className="muted small wh-hint">Клик по эффекту — его точные модификаторы для этого класса.</span>}
    </div>
  )
}

function TypeTable({ types, selected, onPick }: { types: WormholeType[]; selected: WormholeType | null; onPick: (w: WormholeType) => void }) {
  const [target, setTarget] = useState<number | 0>(0)
  const targets = [...new Set(types.map((t) => t.target))].filter((c) => CLASS_LABEL[c]).sort((a, b) => a - b)
  const shown = types.filter((t) => !target || t.target === target)
  return (
    <Card
      title={`Типы вормхолов (${shown.length})`}
      actions={
        <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
          <option value={0}>Ведут куда угодно</option>
          {targets.map((c) => (
            <option key={c} value={c}>
              {`Ведут в ${classLabel(c)}`}
            </option>
          ))}
        </select>
      }
    >
      <table className="table compact">
        <thead>
          <tr>
            <th>Код</th>
            <th>Ведёт в</th>
            <th className="num">Живёт, ч</th>
            <th className="num">Масса, млн кг</th>
            <th className="num">За прыжок, млн кг</th>
            <th>Пропускает</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((w) => (
            <tr key={w.id} className={selected?.id === w.id ? 'selected-row' : ''}>
              <td>
                <b>{w.code}</b>
              </td>
              <td>{classLabel(w.target)}</td>
              <td className="num">{fmtNum(w.lifetime / 60)}</td>
              <td className="num">{fmtNum(w.mass / 1e6)}</td>
              <td className="num">{fmtNum(w.jumpMass / 1e6)}</td>
              <td className="muted small">{passes(w.jumpMass)}</td>
              <td>
                <button className="ghost small" onClick={() => onPick(w)}>
                  В калькулятор
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Данные из SDE (CCP). Настоящая масса дыры случайна в пределах ±10% от указанной.</p>
    </Card>
  )
}

// ---------------- Mass calculator ----------------

type HoleState = 'fresh' | 'reduced' | 'critical'

/** Remaining mass as fractions of the nominal mass, for the state the game shows (actual mass is ±10%). */
const STATE_RANGE: Record<HoleState, [number, number]> = {
  fresh: [0.5 * 0.9, 1.1],
  reduced: [0.1 * 0.9, 0.5 * 1.1],
  critical: [0, 0.1 * 1.1]
}

/** Prop modules used for rolling: "hot" jumps add their mass. */
const PROP_MODULES = ['1MN Afterburner II', '5MN Microwarpdrive II', '10MN Afterburner II', '50MN Microwarpdrive II', '100MN Afterburner II', '500MN Microwarpdrive II']
const ATTR_MASS_ADDITION = 796

interface RollShip {
  typeId: number
  mass: number
  prop: number
}
interface Jump {
  ship: number
  hot: boolean
  out: boolean
}

function MassCalc({ hole }: { hole: WormholeType | null }) {
  const lang = useLang()
  const [mass, setMass] = useState(2_000_000_000)
  const [jumpMass, setJumpMass] = useState(300_000_000)
  const [state, setState] = useState<HoleState>('fresh')
  const [ships, setShips] = useState<RollShip[]>([])
  const [jumps, setJumps] = useState<Jump[]>([])
  const props = useAsync(async () => {
    const ids = await window.api.intel.resolveTypeNames(PROP_MODULES)
    const attrs = await window.api.sde.dogmaAttrs(Object.values(ids), [ATTR_MASS_ADDITION])
    return PROP_MODULES.filter((n) => ids[n]).map((n) => ({ name: n, add: attrs[ids[n]]?.[ATTR_MASS_ADDITION] ?? 0 }))
  }, [])

  useEffect(() => {
    if (!hole) return
    setMass(hole.mass)
    setJumpMass(hole.jumpMass)
    setJumps([])
  }, [hole?.id])

  async function addShip(typeId: number) {
    const m = (await window.api.sde.basics([typeId]))[typeId]?.mass ?? 0
    // Default prop module by hull size: big hulls roll with 100MN AB / 500MN MWD.
    const guess = props.data?.find((p) => p.name.startsWith(m > 50_000_000 ? '100MN' : m > 5_000_000 ? '10MN' : '1MN'))
    setShips((s) => [...s, { typeId, mass: m, prop: guess?.add ?? 0 }])
  }

  const [lo0, hi0] = STATE_RANGE[state].map((f) => f * mass) as [number, number]
  const rows = useMemo(() => {
    let used = 0
    return jumps.map((j) => {
      const s = ships[j.ship]
      const m = (s?.mass ?? 0) + (j.hot ? (s?.prop ?? 0) : 0)
      used += m
      const lo = lo0 - used
      const hi = hi0 - used
      const risk = m > jumpMass ? 'too-heavy' : hi <= 0 ? 'closed' : lo <= 0 ? (j.out ? 'cut-off' : 'may-close') : null
      return { j, m, lo, hi, risk }
    })
  }, [jumps, ships, lo0, hi0, jumpMass])
  const last = rows.at(-1)
  const remLo = last ? last.lo : lo0
  const remHi = last ? last.hi : hi0
  // Who is on the far side: an odd number of "out" jumps minus "in" jumps.
  const outside = ships.map((_, i) => jumps.filter((j) => j.ship === i).reduce((s, j) => s + (j.out ? 1 : -1), 0) > 0)

  return (
    <Card title="Калькулятор массы (роллинг)">
      <div className="row wh-form">
        <label>
          Общая масса, млн кг
          <input type="number" value={mass / 1e6} onChange={(e) => setMass(Number(e.target.value) * 1e6)} />
        </label>
        <label>
          Масса за прыжок, млн кг
          <input type="number" value={jumpMass / 1e6} onChange={(e) => setJumpMass(Number(e.target.value) * 1e6)} />
        </label>
        <label>
          Состояние дыры (Show Info в игре)
          <select value={state} onChange={(e) => setState(e.target.value as HoleState)}>
            <option value="fresh">Не нарушена (&gt;50% массы)</option>
            <option value="reduced">Уменьшена (10–50%)</option>
            <option value="critical">Критическая (&lt;10%)</option>
          </select>
        </label>
        {hole && <span className="muted small">{`Дыра ${hole.code} → ${classLabel(hole.target)}`}</span>}
      </div>

      <div className="wh-ships">
        <div className="wh-ships-head">
          <b>Корабли для роллинга</b>
          <SearchBox placeholder="Добавить корабль…" search={(q) => searchTypesSde(q, lang, { categories: [CATEGORY.SHIP] })} onSelect={(t) => void addShip(t.id)} clearOnSelect />
        </div>
        {!ships.length ? (
          <p className="muted small">Добавьте корабли, которыми будете прыгать: масса берётся из SDE, «горячий» прыжок — с включённым AB/MWD.</p>
        ) : (
          <table className="table compact">
            <tbody>
              {ships.map((s, i) => (
                <tr key={i} className={outside[i] ? 'wh-outside' : ''}>
                  <td>
                    <TypeLink id={s.typeId} size={20} />
                    {outside[i] && <span className="threat threat-high">снаружи</span>}
                  </td>
                  <td className="num">{`холодный ${tons(s.mass)}`}</td>
                  <td>
                    <select value={s.prop} onChange={(e) => setShips((all) => all.map((x, k) => (k === i ? { ...x, prop: Number(e.target.value) } : x)))}>
                      <option value={0}>Без AB/MWD</option>
                      {(props.data ?? []).map((p) => (
                        <option key={p.name} value={p.add}>
                          {`${p.name} (+${tons(p.add)})`}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{`горячий ${tons(s.mass + s.prop)}`}</td>
                  <td className="nowrap">
                    <button className="ghost small" onClick={() => setJumps((j) => [...j, { ship: i, hot: false, out: true }])}>
                      Туда ❄
                    </button>
                    <button className="ghost small" onClick={() => setJumps((j) => [...j, { ship: i, hot: true, out: true }])}>
                      Туда 🔥
                    </button>
                    <button className="ghost small" onClick={() => setJumps((j) => [...j, { ship: i, hot: false, out: false }])}>
                      Обратно ❄
                    </button>
                    <button className="ghost small" onClick={() => setJumps((j) => [...j, { ship: i, hot: true, out: false }])}>
                      Обратно 🔥
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="stats-row">
        <div className="stat">
          <div className="stat-label">Осталось массы</div>
          <div className="stat-value">{`${fmtNum(Math.max(0, remLo) / 1e6)}–${fmtNum(Math.max(0, remHi) / 1e6)} млн кг`}</div>
          <div className="muted small">{`с учётом ±10% и состояния дыры; прыжков: ${jumps.length}`}</div>
        </div>
      </div>
      <div className="wh-bar">
        <div className="wh-bar-sure" style={{ width: `${Math.max(0, Math.min(100, (remLo / mass) * 100))}%` }} />
        <div className="wh-bar-maybe" style={{ width: `${Math.max(0, Math.min(100, ((remHi - Math.max(0, remLo)) / mass) * 100))}%` }} />
      </div>

      {rows.length > 0 && (
        <table className="table compact">
          <thead>
            <tr>
              <th>#</th>
              <th>Корабль</th>
              <th>Прыжок</th>
              <th className="num">Масса</th>
              <th className="num">Осталось, млн кг</th>
              <th>Риск</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.risk === 'cut-off' || r.risk === 'too-heavy' ? 'danger' : ''}>
                <td className="muted">{i + 1}</td>
                <td>
                  <TypeLink id={ships[r.j.ship]?.typeId ?? 0} size={16} />
                </td>
                <td>{`${r.j.out ? 'туда' : 'обратно'} ${r.j.hot ? '🔥 горячим' : '❄ холодным'}`}</td>
                <td className="num">{tons(r.m)}</td>
                <td className="num">{`${fmtNum(Math.max(0, r.lo) / 1e6)}–${fmtNum(Math.max(0, r.hi) / 1e6)}`}</td>
                <td className="small">
                  {r.risk === 'too-heavy' && <span className="bad">не пройдёт: тяжелее лимита за прыжок</span>}
                  {r.risk === 'closed' && <span className="good">дыра схлопнется наверняка</span>}
                  {r.risk === 'may-close' && <span className="warn-text">может схлопнуться на этом прыжке</span>}
                  {r.risk === 'cut-off' && <span className="bad">может схлопнуться — корабль останется снаружи!</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        {jumps.length > 0 && (
          <button className="ghost" onClick={() => setJumps((j) => j.slice(0, -1))}>
            Отменить прыжок
          </button>
        )}
        {jumps.length > 0 && (
          <button className="ghost" onClick={() => setJumps([])}>
            Сбросить прыжки
          </button>
        )}
      </div>
      <p className="muted small">
        Состояние дыры видно в игре в Show Info. Настоящая масса случайна в пределах ±10%, поэтому остаток — диапазон. Прыгайте «туда» так, чтобы при худшем случае корабль
        успел вернуться: опасные прыжки помечены красным.
      </p>
    </Card>
  )
}
