import { useEffect, useMemo, useState } from 'react'
import type { CombatDirection, CombatPilot, CombatResult, CombatScenario, CombatSideInfo } from '../../shared/combat'
import type { SavedFit } from '../../shared/fit'
import { AppProvider, useLang } from './AppContext'
import { AttrIcon } from './components/Icon'
import { Card, Empty, SearchBox } from './components/ui'
import { imageUrl } from './lib/esi'
import { fmtNum } from './lib/format'
import { fromEft, toEft } from './lib/fitting'
import { CATEGORY, searchTypesSde, tn, useTypeBasic, useTypeBasics } from './lib/sde'
import { locale } from './i18n'

/** Damage type icons (em, thermal, kinetic, explosive) and resist icons (same order). */
const DAMAGE_ICONS = [114, 118, 117, 116]
const RESIST_ICONS = [271, 274, 273, 272]
const LAYER_ICONS = { shield: 263, armor: 265, hull: 9 }
const LAYER_NAMES = { shield: 'Щит', armor: 'Броня', hull: 'Корпус' } as const

const n1 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 })
const km = (m: number) => `${(m / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} км`

function duration(sec: number): string {
  if (!Number.isFinite(sec)) return 'не пробить'
  if (sec < 60) return `${n1(sec)} с`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m < 60 ? `${m} мин ${s} с` : `${Math.floor(m / 60)} ч ${m % 60} мин`
}

export default function CombatWindow() {
  return (
    <AppProvider>
      <Simulator />
    </AppProvider>
  )
}

function ShipLabel({ id, name, sub }: { id: number; name?: string; sub?: string }) {
  const lang = useLang()
  const basic = useTypeBasic(id)
  return (
    <div className="combat-ship">
      <img src={imageUrl.typeRender(id, 128)} width={64} height={64} alt="" />
      <div>
        <div className="combat-ship-name">{tn(basic?.n, lang)}</div>
        {name && (
          <div className="muted small" translate="no">
            {name}
          </div>
        )}
        {sub && <div className="muted small">{sub}</div>}
      </div>
    </div>
  )
}

function Simulator() {
  const lang = useLang()
  const [attacker, setAttacker] = useState<CombatPilot | null>(null)
  const [defender, setDefender] = useState<CombatPilot | null>(null)
  const [sc, setSc] = useState<CombatScenario>({ distance: 10_000, speedA: 0, headingA: 0, speedB: 0, headingB: 90 })
  const [maxSpeed, setMaxSpeed] = useState({ a: 1000, b: 1000 })
  const [result, setResult] = useState<CombatResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // "Your" fit comes from the fitting tool and follows its changes.
  useEffect(() => {
    document.title = 'Canopus — симуляция боя'
    void window.api.combat.getAttacker().then((a) => a && setAttacker(a))
    return window.api.combat.onAttacker(setAttacker)
  }, [])

  // New ships: start from their top speeds (keeping the headings and distance).
  const shipsKey = `${attacker?.fit.shipTypeId}|${defender?.fit.shipTypeId}|${attacker?.fit.modules.length}|${defender?.fit.modules.length}`
  useEffect(() => {
    if (!attacker || !defender) return
    void window.api.combat.defaults(attacker, defender).then((d) => {
      setSc((s) => ({ ...s, speedA: Math.round(d.speedA), speedB: Math.round(d.speedB), sigA: undefined, sigB: undefined }))
      setMaxSpeed({ a: Math.max(500, Math.ceil(d.speedA * 1.5)), b: Math.max(500, Math.ceil(d.speedB * 1.5)) })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipsKey])

  useEffect(() => {
    if (!attacker || !defender) return
    let live = true
    const t = setTimeout(() => {
      window.api.combat
        .simulate(attacker, defender, sc)
        .then((r) => live && (setResult(r), setError(null)))
        .catch((e: Error) => live && setError(e.message))
    }, 60)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [attacker, defender, sc])

  const set = (patch: Partial<CombatScenario>) => setSc((s) => ({ ...s, ...patch }))

  return (
    <div className="combat">
      <header className="combat-head">
        <h1>Симуляция боя</h1>
        <p className="muted small">
          Урон считается по игровым формулам: попадание турелей (угловая скорость, сигнатура, оптимал и фоллоф), применение ракет (радиус и скорость
          взрыва), резисты и ремонтники цели. Средние значения, без случайных промахов.
        </p>
      </header>

      <div className="combat-sides">
        <Card title="Вы (фит из фитинга)">
          {attacker ? (
            <ShipLabel id={attacker.fit.shipTypeId} name={attacker.fit.name} sub={attacker.skills.mode === 'all5' ? 'Навыки: все V' : 'Навыки: ваш персонаж'} />
          ) : (
            <Empty>Откройте фит во вкладке «Фитинг» и нажмите «Симуляция боя».</Empty>
          )}
          {result && <SideStats info={result.a} />}
        </Card>
        <OpponentPicker attacker={attacker} defender={defender} onPick={setDefender} lang={lang} result={result} />
      </div>

      {attacker && defender && (
        <>
          <Card title="Сближение">
            <div className="combat-presets">
              <button className="ghost" onClick={() => set({ headingA: 0, headingB: 90 })}>
                Противник на орбите
              </button>
              <button className="ghost" onClick={() => set({ headingA: 90, headingB: 270 })}>
                Встречные орбиты
              </button>
              <button className="ghost" onClick={() => set({ headingA: 0, headingB: 180 })}>
                Сближение по прямой
              </button>
              <button className="ghost" onClick={() => set({ speedA: 0, speedB: 0 })}>
                Оба стоят
              </button>
            </div>
            <div className="combat-sliders">
              <Slider label="Дистанция" value={sc.distance} min={0} max={Math.max(150_000, result?.curve.distance.at(-1) ?? 0)} step={100} format={km} onChange={(v) => set({ distance: v })} />
              <Slider label="Ваша скорость" value={sc.speedA} min={0} max={maxSpeed.a} step={1} format={(v) => `${fmtNum(v)} м/с`} onChange={(v) => set({ speedA: v })} />
              <Slider label="Ваш курс к линии на цель" value={sc.headingA} min={0} max={360} step={5} format={(v) => `${v}°`} onChange={(v) => set({ headingA: v })} />
              <Slider label="Скорость противника" value={sc.speedB} min={0} max={maxSpeed.b} step={1} format={(v) => `${fmtNum(v)} м/с`} onChange={(v) => set({ speedB: v })} />
              <Slider label="Курс противника" value={sc.headingB} min={0} max={360} step={5} format={(v) => `${v}°`} onChange={(v) => set({ headingB: v })} />
              <SigInput label="Ваша сигнатура" value={sc.sigA} auto={result?.a.signature} onChange={(v) => set({ sigA: v })} />
              <SigInput label="Сигнатура противника" value={sc.sigB} auto={result?.b.signature} onChange={(v) => set({ sigB: v })} />
            </div>
            {result && (
              <p className="muted small">
                {`Поперечная скорость ${n1(result.transversal)} м/с · угловая ${result.angularVelocity.toLocaleString(locale(), { maximumFractionDigits: 4 })} рад/с. Курс 0° — прямо по линии на цель, 90° — поперёк; противоположные курсы (90° и 270°) складывают поперечную скорость.`}
              </p>
            )}
          </Card>

          {error && <div className="warn-box">{error}</div>}
          {result && (
            <>
              <Verdict r={result} />
              <div className="combat-sides">
                <DirectionCard title="Вы → противник" d={result.ab} />
                <DirectionCard title="Противник → вы" d={result.ba} />
              </div>
              <Card title="Урон по дистанции (до резистов)">
                <Chart r={result} distance={sc.distance} onDistance={(d) => set({ distance: d })} />
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="combat-slider">
      <span>
        {label}: <b>{format(value)}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={Math.min(value, max)} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

function SigInput({ label, value, auto, onChange }: { label: string; value?: number; auto?: number; onChange: (v: number | undefined) => void }) {
  return (
    <label className="combat-slider">
      <span>
        {label}: <b>{`${n1(value ?? auto ?? 0)} м`}</b> {value === undefined ? <span className="muted small">из фита</span> : null}
      </span>
      <div className="row">
        <input type="number" min={1} step={1} value={value ?? ''} placeholder={auto ? n1(auto) : ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)} />
        {value !== undefined && (
          <button className="ghost small" onClick={() => onChange(undefined)}>
            Из фита
          </button>
        )}
      </div>
    </label>
  )
}

function SideStats({ info }: { info: CombatSideInfo }) {
  return (
    <div className="combat-sidestats">
      <div className="kv-list">
        <span>Скорость</span>
        <b>{`${n1(info.maxVelocity)} м/с`}</b>
        <span>Сигнатура</span>
        <b>{`${n1(info.signature)} м`}</b>
        <span>EHP</span>
        <b>{fmtNum(info.ehp)}</b>
      </div>
      <table className="table compact combat-resists">
        <thead>
          <tr>
            <th />
            {RESIST_ICONS.map((a) => (
              <th key={a}>
                <AttrIcon attr={a} size={16} />
              </th>
            ))}
            <th className="num">HP</th>
          </tr>
        </thead>
        <tbody>
          {(['shield', 'armor', 'hull'] as const).map((l) => (
            <tr key={l}>
              <td>
                <span className="with-icon">
                  <AttrIcon attr={LAYER_ICONS[l]} size={16} />
                  {LAYER_NAMES[l]}
                </span>
              </td>
              {info.resist[l].map((r, i) => (
                <td key={i} className="num">{`${(r * 100).toFixed(0)}%`}</td>
              ))}
              <td className="num">{fmtNum(info.hp[l])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type Tab = 'ship' | 'saved' | 'eft' | 'mirror'

function OpponentPicker({
  attacker,
  defender,
  onPick,
  lang,
  result
}: {
  attacker: CombatPilot | null
  defender: CombatPilot | null
  onPick: (p: CombatPilot) => void
  lang: 0 | 1
  result: CombatResult | null
}) {
  const [tab, setTab] = useState<Tab>('saved')
  const [saved, setSaved] = useState<SavedFit[] | null>(null)
  const [eft, setEft] = useState('')
  const [eftError, setEftError] = useState<string | null>(null)
  useTypeBasics(saved?.map((f) => f.shipTypeId) ?? [])
  useEffect(() => {
    void window.api.fit.list().then(setSaved)
  }, [])
  const all5 = { mode: 'all5' } as const

  async function applyEft(text: string) {
    setEftError(null)
    try {
      const { fit, unknown } = await fromEft(text)
      onPick({ fit, skills: all5 })
      if (unknown.length) setEftError(`Не распознано: ${unknown.join(', ')}`)
    } catch (e) {
      setEftError((e as Error).message)
    }
  }

  return (
    <Card title="Противник">
      {defender ? (
        <ShipLabel id={defender.fit.shipTypeId} name={defender.fit.name} sub={`Навыки: все V · модулей: ${defender.fit.modules.length}`} />
      ) : (
        <p className="muted small">Выберите корабль противника: пустой корпус, сохранённый фит или фит в формате EFT, который можно отредактировать.</p>
      )}
      {defender && result && <SideStats info={result.b} />}
      <div className="browser-tabs">
        {(
          [
            ['saved', 'Сохранённые фиты'],
            ['ship', 'Корабль'],
            ['eft', 'EFT / свой фит'],
            ['mirror', 'Зеркало']
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className={`chip-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'ship' && (
        <SearchBox
          placeholder="Корабль (рус/англ)…"
          search={(q) => searchTypesSde(q, lang, { categories: [CATEGORY.SHIP] })}
          onSelect={(t) => onPick({ fit: { shipTypeId: t.id, name: 'Без модулей', modules: [], drones: [], implants: [] }, skills: all5 })}
          renderItem={(t) => (
            <>
              <img className="type-icon" src={imageUrl.typeIcon(t.id, 32)} width={20} height={20} alt="" /> {t.name}
            </>
          )}
        />
      )}
      {tab === 'saved' &&
        (saved === null ? (
          <p className="muted small">…</p>
        ) : !saved.length ? (
          <p className="muted small">Сохранённых фитов нет — сохраните фит в фитинге или вставьте EFT.</p>
        ) : (
          <ul className="combat-fit-list">
            {saved.map((f) => (
              <li key={f.id} onClick={() => onPick({ fit: f, skills: all5 })}>
                <img src={imageUrl.typeIcon(f.shipTypeId, 32)} width={24} height={24} alt="" />
                <SavedName fit={f} />
              </li>
            ))}
          </ul>
        ))}
      {tab === 'eft' && (
        <>
          <textarea rows={8} value={eft} onChange={(e) => setEft(e.target.value)} placeholder={'[Hurricane, противник]\nGyrostabilizer II\n...'} />
          <div className="row">
            <button disabled={!eft.trim()} onClick={() => void applyEft(eft)}>
              Применить
            </button>
            <button className="ghost" onClick={async () => setEft(await navigator.clipboard.readText())}>
              Вставить из буфера
            </button>
            {defender && (
              <button className="ghost" onClick={() => setEft(toEft(defender.fit))}>
                Редактировать текущего противника
              </button>
            )}
          </div>
          {eftError && <div className="warn">{eftError}</div>}
        </>
      )}
      {tab === 'mirror' && (
        <div className="row">
          <button disabled={!attacker} onClick={() => attacker && onPick({ fit: { ...attacker.fit, name: 'Зеркало' }, skills: attacker.skills })}>
            Против такого же фита
          </button>
        </div>
      )}
    </Card>
  )
}

function SavedName({ fit }: { fit: SavedFit }) {
  const lang = useLang()
  const basic = useTypeBasic(fit.shipTypeId)
  return (
    <span>
      <b>{tn(basic?.n, lang)}</b> <span className="muted" translate="no">{fit.name}</span>
    </span>
  )
}

function Verdict({ r }: { r: CombatResult }) {
  const you = r.ab.timeToKill
  const them = r.ba.timeToKill
  let text: string
  let cls = ''
  if (!Number.isFinite(you) && !Number.isFinite(them)) text = 'Никто никого не пробьёт при этих условиях'
  else if (you < them) {
    text = `Вы побеждаете: противник уничтожен за ${duration(you)}, вам нужно было бы продержаться ${duration(them)}`
    cls = 'good'
  } else if (them < you) {
    text = `Вы проигрываете: вас уничтожат за ${duration(them)}, противнику нужно ${duration(you)}`
    cls = 'bad'
  } else text = `Равный бой: ${duration(you)}`
  return <div className={`combat-verdict ${cls}`}>{text}</div>
}

function DirectionCard({ title, d }: { title: string; d: CombatDirection }) {
  const lang = useLang()
  useTypeBasics(d.weapons.flatMap((w) => [w.typeId, w.chargeTypeId ?? 0]).filter(Boolean))
  const pct = d.paperDps ? (d.applied / d.paperDps) * 100 : 0
  return (
    <Card title={title}>
      <div className="big-stats">
        <div>
          <b>{n1(d.applied)}</b>
          <span>{`DPS по цели из ${n1(d.paperDps)} (${pct.toFixed(0)}%)`}</span>
        </div>
      </div>
      <div className="damage-profile">
        {d.appliedByType.map((v, i) => (
          <span key={i} className="with-icon">
            <AttrIcon attr={DAMAGE_ICONS[i]} size={16} />
            {n1(v)}
          </span>
        ))}
      </div>
      {d.weapons.length ? (
        <table className="table compact">
          <tbody>
            {d.weapons.map((w, i) => (
              <WeaponRow key={i} w={w} lang={lang} />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">Нет оружия с зарядами (или дронов в космосе).</p>
      )}
      <table className="table compact combat-layers">
        <thead>
          <tr>
            <th>Слой</th>
            <th className="num">DPS после резистов</th>
            <th className="num">Ремонт цели</th>
            <th className="num">Время</th>
          </tr>
        </thead>
        <tbody>
          {(['shield', 'armor', 'hull'] as const).map((l) => (
            <tr key={l}>
              <td>
                <span className="with-icon">
                  <AttrIcon attr={LAYER_ICONS[l]} size={16} />
                  {LAYER_NAMES[l]}
                </span>
              </td>
              <td className="num">{n1(d.effective[l])}</td>
              <td className="num" title={l === 'shield' ? 'Пассивная регенерация щита зависит от его заполнения; здесь — пик (при 25% щита) плюс накачка' : undefined}>
                {d.repair[l] ? (l === 'shield' ? `до ${n1(d.repair[l])} HP/с` : `${n1(d.repair[l])} HP/с`) : '—'}
              </td>
              <td className={`num ${Number.isFinite(d.time[l]) ? '' : 'bad'}`}>{duration(d.time[l])}</td>
            </tr>
          ))}
          <tr className="combat-total">
            <td>Уничтожение</td>
            <td />
            <td />
            <td className={`num ${Number.isFinite(d.timeToKill) ? '' : 'bad'}`}>
              <b>{duration(d.timeToKill)}</b>
            </td>
          </tr>
        </tbody>
      </table>
      {d.capWarning && <p className="muted small">{d.capWarning}</p>}
    </Card>
  )
}

function WeaponRow({ w, lang }: { w: CombatDirection['weapons'][number]; lang: 0 | 1 }) {
  const weapon = useTypeBasic(w.typeId)
  const charge = useTypeBasic(w.chargeTypeId ?? 0)
  return (
    <tr>
      <td>
        <span className="with-icon">
          <img className="type-icon" src={imageUrl.typeIcon(w.typeId, 32)} width={20} height={20} alt="" />
          <span>
            {w.count > 1 ? `${w.count}× ` : ''}
            {tn(weapon?.n, lang)}
            {w.chargeTypeId ? <div className="muted small">{tn(charge?.n, lang)}</div> : null}
          </span>
        </span>
      </td>
      <td className="num">{`${n1(w.applied)} / ${n1(w.dps)}`}</td>
      <td className={`num ${w.factor < 0.5 ? 'bad' : w.factor < 0.9 ? 'warn-text' : 'good'}`}>{`${(w.factor * 100).toFixed(0)}%`}</td>
      <td className="muted small">{w.limit ?? ''}</td>
    </tr>
  )
}

/** Applied DPS over distance for both sides; click to set the distance. */
function Chart({ r, distance, onDistance }: { r: CombatResult; distance: number; onDistance: (d: number) => void }) {
  const W = 900
  const H = 260
  const pad = { l: 50, r: 16, t: 12, b: 28 }
  const maxD = r.curve.distance.at(-1) ?? 1
  const maxY = Math.max(10, ...r.curve.ab, ...r.curve.ba) * 1.1
  const x = (d: number) => pad.l + (d / maxD) * (W - pad.l - pad.r)
  const y = (v: number) => H - pad.b - (v / maxY) * (H - pad.t - pad.b)
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(r.curve.distance[i]).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const ticksX = useMemo(() => {
    const step = [1, 2, 5, 10, 20, 25, 50].map((k) => k * 1000).find((s) => maxD / s <= 10) ?? 50_000
    return Array.from({ length: Math.floor(maxD / step) + 1 }, (_, i) => i * step)
  }, [maxD])
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY)
  return (
    <div className="combat-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        onClick={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * W
          const d = ((px - pad.l) / (W - pad.l - pad.r)) * maxD
          if (d >= 0 && d <= maxD) onDistance(Math.round(d / 100) * 100)
        }}
      >
        {ticksY.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {ticksX.map((d) => (
          <text key={d} x={x(d)} y={H - 8} textAnchor="middle">
            {d / 1000}
          </text>
        ))}
        <path d={path(r.curve.ab)} className="line-a" />
        <path d={path(r.curve.ba)} className="line-b" />
        <line x1={x(distance)} x2={x(distance)} y1={pad.t} y2={H - pad.b} className="marker" />
      </svg>
      <div className="combat-legend">
        <span className="legend-a">Ваш урон по противнику</span>
        <span className="legend-b">Урон противника по вам</span>
        <span className="muted small">Дистанция, км · клик по графику — поставить дистанцию</span>
      </div>
    </div>
  )
}

