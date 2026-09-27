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
  const [picking, setPicking] = useState(false)
  // Opponent's direction on the map is only for the picture: the physics depends on distance and headings.
  const [bearing, setBearing] = useState(0)

  return (
    <div className="combat">
      <header className="combat-head">
        <h1>Симуляция боя</h1>
        <p className="muted small">
          Перетаскивайте противника на карте, чтобы менять дистанцию, и стрелки скорости, чтобы задать курс и скорость. Расчёт — по игровым формулам,
          средние значения без случайных промахов.
        </p>
      </header>

      <div className="combat-versus">
        <Card className="combat-side-card side-a">
          <div className="combat-side-title">Вы</div>
          {attacker ? (
            <ShipLabel id={attacker.fit.shipTypeId} name={attacker.fit.name} sub={attacker.skills.mode === 'all5' ? 'Навыки: все V' : 'Навыки: ваш персонаж'} />
          ) : (
            <Empty>Откройте фит во вкладке «Фитинг» и нажмите «Симуляция боя».</Empty>
          )}
          {result && <SideStats info={result.a} />}
        </Card>
        <div className="combat-vs">VS</div>
        <Card className="combat-side-card side-b">
          <div className="combat-side-title">
            Противник
            {defender && (
              <button className="ghost small" onClick={() => setPicking(!picking)}>
                {picking ? 'Готово' : 'Сменить'}
              </button>
            )}
          </div>
          {defender && <ShipLabel id={defender.fit.shipTypeId} name={defender.fit.name} sub={`Навыки: все V · модулей: ${defender.fit.modules.length}`} />}
          {defender && result && !picking && <SideStats info={result.b} />}
          {(!defender || picking) && (
            <OpponentPicker
              attacker={attacker}
              defender={defender}
              lang={lang}
              onPick={(p) => {
                setDefender(p)
                setPicking(false)
              }}
            />
          )}
        </Card>
      </div>

      {error && <div className="warn-box">{error}</div>}
      {attacker && defender && result && (
        <>
          <div className="combat-main">
            <Card className="combat-map-card">
              <TacticalMap sc={sc} set={set} r={result} bearing={bearing} setBearing={setBearing} maxSpeed={maxSpeed} />
              <div className="combat-presets">
                <span className="muted small">Быстро:</span>
                <button className="ghost small" onClick={() => set({ speedA: 0, headingB: 90, speedB: result.b.maxVelocity })}>
                  Противник на орбите
                </button>
                <button className="ghost small" onClick={() => set({ headingA: 90, headingB: 270, speedA: result.a.maxVelocity, speedB: result.b.maxVelocity })}>
                  Встречные орбиты
                </button>
                <button className="ghost small" onClick={() => set({ headingA: 0, headingB: 180, speedA: result.a.maxVelocity, speedB: result.b.maxVelocity })}>
                  Сближение лоб в лоб
                </button>
                <button className="ghost small" onClick={() => set({ headingA: 0, headingB: 0, speedA: result.a.maxVelocity, speedB: result.b.maxVelocity })}>
                  Противник убегает
                </button>
                <button className="ghost small" onClick={() => set({ speedA: 0, speedB: 0 })}>
                  Оба стоят
                </button>
              </div>
              <details className="combat-exact">
                <summary>Точные значения</summary>
                <div className="combat-sliders">
                  <NumberField label="Дистанция, км" value={sc.distance / 1000} step={0.1} onChange={(v) => set({ distance: Math.max(0, v * 1000) })} />
                  <NumberField label="Ваша скорость, м/с" value={sc.speedA} step={10} onChange={(v) => set({ speedA: Math.max(0, v) })} />
                  <NumberField label="Ваш курс, °" value={sc.headingA} step={5} onChange={(v) => set({ headingA: ((v % 360) + 360) % 360 })} />
                  <NumberField label="Скорость противника, м/с" value={sc.speedB} step={10} onChange={(v) => set({ speedB: Math.max(0, v) })} />
                  <NumberField label="Курс противника, °" value={sc.headingB} step={5} onChange={(v) => set({ headingB: ((v % 360) + 360) % 360 })} />
                  <SigInput label="Ваша сигнатура" value={sc.sigA} auto={result.a.signature} onChange={(v) => set({ sigA: v })} />
                  <SigInput label="Сигнатура противника" value={sc.sigB} auto={result.b.signature} onChange={(v) => set({ sigB: v })} />
                </div>
                <p className="muted small">Курс считается от линии «вы → противник»: 0° — вдоль неё (к противнику для вас, от вас для него), 90° и 270° — поперёк в разные стороны.</p>
              </details>
            </Card>
            <Summary r={result} />
          </div>
          <div className="combat-sides">
            <DirectionCard title="Вы → противник" d={result.ab} />
            <DirectionCard title="Противник → вы" d={result.ba} />
          </div>
          <Card title="Урон по дистанции при текущих скоростях (до резистов)">
            <Chart r={result} distance={sc.distance} onDistance={(d) => set({ distance: d })} />
          </Card>
          <p className="muted small">
            Турели: шанс попадания 0,5^((ω·40 000 / (наводка·сигнатура))² + (max(0, d − оптимал) / фоллоф)²), с учётом Wrecking-попаданий. Ракеты: min(1, S/E,
            (S/E·Ve/Vt)^drf), дальность — скорость × время полёта с поправкой на уходящую цель. Щит регенерирует по игровой кривой (пик при 25%), активные ремонтники
            работают, пока хватает накопителя. Не учитываются: РЭБ (сетки, нейтрализаторы, дизрапторы), перегрев, расход вашего накопителя на оружие, запуск
            ракет от края корпуса у крупных кораблей.
          </p>
        </>
      )}
    </div>
  )
}

function NumberField({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="combat-slider">
      <span>{label}</span>
      <input type="number" step={step} value={Math.round(value * 10) / 10} onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
    </label>
  )
}

/** The quick answer: who wins, how hard each side hits and what holds the damage back. */
function Summary({ r }: { r: CombatResult }) {
  return (
    <div className="combat-summary">
      <Verdict r={r} />
      <SummaryLine title="Вы → противник" d={r.ab} cls="side-a" />
      <SummaryLine title="Противник → вы" d={r.ba} cls="side-b" />
      <div className="combat-geo muted small">
        {`Поперечная скорость ${n1(r.transversal)} м/с · угловая ${r.angularVelocity.toLocaleString(locale(), { maximumFractionDigits: 4 })} рад/с`}
      </div>
    </div>
  )
}

function SummaryLine({ title, d, cls }: { title: string; d: CombatDirection; cls: string }) {
  const pct = d.paperDps ? Math.min(100, (d.applied / d.paperDps) * 100) : 0
  // The weapon losing the most damage explains the result.
  const worst = [...d.weapons].filter((w) => w.limit).sort((a, b) => b.dps - b.applied - (a.dps - a.applied))[0]
  return (
    <div className={`combat-line ${cls}`}>
      <div className="combat-line-title">{title}</div>
      <div className="combat-line-main">
        <b>{n1(d.applied)}</b>
        <span className="muted">{`DPS по цели из ${n1(d.paperDps)}`}</span>
      </div>
      <div className="combat-bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="combat-line-foot">
        <span>
          <span className="muted">Уничтожение:</span> <b className={Number.isFinite(d.timeToKill) ? '' : 'bad'}>{duration(d.timeToKill)}</b>
        </span>
        {worst && <span className="muted small">{`мешает: ${worst.limit}`}</span>}
      </div>
    </div>
  )
}

/** Nice round step for range rings / zoom. */
function niceRange(m: number): number {
  const steps = [2_500, 5_000, 10_000, 15_000, 20_000, 30_000, 40_000, 50_000, 75_000, 100_000, 150_000, 200_000, 300_000]
  return steps.find((s) => s >= m) ?? 300_000
}

type DragTarget = 'b' | 'va' | 'vb'

/**
 * Top-down view: you in the centre, the opponent where you drag him, velocity arrows you can pull
 * (length = speed, direction = heading) and the weapons' range rings (optimal solid, falloff dashed).
 */
function TacticalMap({
  sc,
  set,
  r,
  bearing,
  setBearing,
  maxSpeed
}: {
  sc: CombatScenario
  set: (p: Partial<CombatScenario>) => void
  r: CombatResult
  bearing: number
  setBearing: (b: number) => void
  maxSpeed: { a: number; b: number }
}) {
  const W = 760
  const H = 480
  const cx = W / 2
  const cy = H / 2
  const R = Math.min(W, H) / 2 - 22
  const [drag, setDrag] = useState<DragTarget | null>(null)
  const [view, setView] = useState(() => niceRange(Math.max(sc.distance / 0.6, 5_000)))
  // Re-fit the zoom to the distance after a drag (not during it, so the map doesn't slide under the cursor).
  useEffect(() => {
    if (!drag) setView(niceRange(Math.max(sc.distance / 0.6, 5_000)))
  }, [sc.distance, drag])

  const k = R / view
  const rad = Math.PI / 180
  const bx = cx + Math.cos(bearing * rad) * sc.distance * k
  const by = cy - Math.sin(bearing * rad) * sc.distance * k
  const vRef = Math.max(maxSpeed.a, maxSpeed.b, 100)
  const ARROW_MIN = 20
  const ARROW_LEN = 110
  const arrow = (x: number, y: number, speed: number, heading: number) => {
    const len = ARROW_MIN + (Math.min(speed, vRef) / vRef) * ARROW_LEN
    const a = (bearing + heading) * rad
    return { x: x + Math.cos(a) * len, y: y - Math.sin(a) * len }
  }
  const ta = arrow(cx, cy, sc.speedA, sc.headingA)
  const tb = arrow(bx, by, sc.speedB, sc.headingB)

  const toSvg = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = e.currentTarget
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const m = svg.getScreenCTM()
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 }
  }
  const norm = (deg: number) => ((deg % 360) + 360) % 360
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return
    const p = toSvg(e)
    if (drag === 'b') {
      const dx = p.x - cx
      const dy = cy - p.y
      set({ distance: Math.max(0, Math.round(Math.hypot(dx, dy) / k / 50) * 50) })
      setBearing(Math.atan2(dy, dx) / rad)
      return
    }
    const ox = drag === 'va' ? cx : bx
    const oy = drag === 'va' ? cy : by
    const dx = p.x - ox
    const dy = oy - p.y
    const len = Math.hypot(dx, dy)
    const max = drag === 'va' ? r.a.maxVelocity : r.b.maxVelocity
    const speed = Math.round(Math.min(max, Math.max(0, ((len - ARROW_MIN) / ARROW_LEN) * vRef)))
    const heading = Math.round(norm(Math.atan2(dy, dx) / rad - bearing))
    if (drag === 'va') set({ speedA: speed, headingA: heading })
    else set({ speedB: speed, headingB: heading })
  }

  const rings = (side: 'a' | 'b') => {
    const info = side === 'a' ? r.a : r.b
    const x = side === 'a' ? cx : bx
    const y = side === 'a' ? cy : by
    return info.ranges.map((g, i) => (
      <g key={`${side}${i}`} className={`ring ring-${side}`}>
        <circle cx={x} cy={y} r={g.optimal * k} />
        {g.falloff ? <circle cx={x} cy={y} r={(g.optimal + g.falloff) * k} className="falloff" /> : null}
        <text x={x} y={y + g.optimal * k + 12} textAnchor="middle">
          {`${g.kind === 'missile' ? 'ракеты' : 'оптимал'} ${km(g.optimal)}`}
        </text>
      </g>
    ))
  }
  const maxRing = (side: 'a' | 'b') => {
    const info = side === 'a' ? r.a : r.b
    return (
      <circle
        cx={side === 'a' ? cx : bx}
        cy={side === 'a' ? cy : by}
        r={ARROW_MIN + (Math.min(info.maxVelocity, vRef) / vRef) * ARROW_LEN}
        className={`speed-ring speed-${side}`}
      />
    )
  }
  const scaleKm = [1, 2, 5, 10, 20, 25, 50, 100].map((v) => v * 1000).find((v) => v * k >= 60) ?? 100_000

  return (
    <svg
      className={`combat-map ${drag ? 'dragging' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      onPointerMove={onMove}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => setDrag(null)}
    >
      <defs>
        <marker id="arrow-a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrowhead-a" />
        </marker>
        <marker id="arrow-b" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrowhead-b" />
        </marker>
      </defs>
      <rect x={0} y={0} width={W} height={H} className="map-bg" />
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle key={f} cx={cx} cy={cy} r={R * f} className="map-grid" />
      ))}
      {rings('a')}
      {rings('b')}
      <line x1={cx} y1={cy} x2={bx} y2={by} className="los" />
      <text x={(cx + bx) / 2} y={(cy + by) / 2 - 8} textAnchor="middle" className="los-label">
        {km(sc.distance)}
      </text>
      {maxRing('a')}
      {maxRing('b')}
      <line x1={cx} y1={cy} x2={ta.x} y2={ta.y} className="vec vec-a" markerEnd="url(#arrow-a)" />
      <line x1={bx} y1={by} x2={tb.x} y2={tb.y} className="vec vec-b" markerEnd="url(#arrow-b)" />
      <g className="ship ship-a">
        <circle cx={cx} cy={cy} r={17} />
        <image href={imageUrl.typeIcon(r.a.shipTypeId, 64)} x={cx - 14} y={cy - 14} width={28} height={28} />
      </g>
      <g className="ship ship-b draggable" onPointerDown={(e) => (e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId), setDrag('b'))}>
        <circle cx={bx} cy={by} r={17} />
        <image href={imageUrl.typeIcon(r.b.shipTypeId, 64)} x={bx - 14} y={by - 14} width={28} height={28} />
      </g>
      <circle cx={ta.x} cy={ta.y} r={8} className="handle handle-a" onPointerDown={(e) => (e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId), setDrag('va'))} />
      <circle cx={tb.x} cy={tb.y} r={8} className="handle handle-b" onPointerDown={(e) => (e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId), setDrag('vb'))} />
      <text x={ta.x + 10} y={ta.y - 8} className="vec-label vec-label-a">{`${fmtNum(sc.speedA)} м/с`}</text>
      <text x={tb.x + 10} y={tb.y - 8} className="vec-label vec-label-b">{`${fmtNum(sc.speedB)} м/с`}</text>
      <g className="map-scale">
        <line x1={16} y1={H - 16} x2={16 + scaleKm * k} y2={H - 16} />
        <text x={16} y={H - 22}>
          {km(scaleKm)}
        </text>
      </g>
      <text x={W - 12} y={H - 14} textAnchor="end" className="map-hint">
        Тяните противника и концы стрелок
      </text>
    </svg>
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
  lang
}: {
  attacker: CombatPilot | null
  defender: CombatPilot | null
  onPick: (p: CombatPilot) => void
  lang: 0 | 1
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
    <div className="combat-picker">
      {!defender && <p className="muted small">Выберите корабль противника: пустой корпус, сохранённый фит или фит в формате EFT, который можно отредактировать.</p>}
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
    </div>
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

