// Missile lab (test mode): any missile against an imagined target. The 3D scene shows the formula itself: the blast
// grows to its radius at its explosion velocity while the target sails on; the share of damage that lands is the
// target's signature against the blast's size and against how far it got away.

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CombatPilot } from '../../../shared/combat'
import type { FitSpec, FittableType, SkillSource } from '../../../shared/fit'
import { missileApplication, type MissileApplication } from '../../../shared/missileApplication'
import { useLang } from '../AppContext'
import { translate, locale } from '../i18n'
import { chargesFor, loadCatalog } from '../lib/fitting'
import { CATEGORY, searchTypesSde, tn, useTypeBasic, useTypeBasics } from '../lib/sde'
import { Glyph } from './Glyph'
import { Card, SearchBox } from './ui'

/** A bare capsule carries the launcher: skills count, no hull bonuses. */
const CAPSULE = 670

interface Missile {
  key: string
  launcher: number
  charge?: number
  radius: number
  velocity: number
  drf: number
  /** One missile's damage, before resists */
  volley: number
}

const n0 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 0 })
const n2 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 2 })
const pct = (v: number) => `${Math.round(v * 100)}%`

async function missilesOf(fit: FitSpec, skills: SkillSource): Promise<Missile[]> {
  const st = await window.api.fit.calculate(fit, skills)
  return st.offense.weapons
    .filter((w) => w.kind === 'missile' && w.explosionRadius && w.explosionVelocity)
    .map((w) => ({ key: `${w.typeId}:${w.chargeTypeId}`, launcher: w.typeId, charge: w.chargeTypeId, radius: w.explosionRadius!, velocity: w.explosionVelocity!, drf: w.drf ?? 1, volley: w.volley / Math.max(1, w.count) }))
    // Launchers listed one by one are the same missile once.
    .filter((m, i, all) => all.findIndex((x) => x.key === m.key) === i)
}

export function MissileLab({ you, target }: { you: CombatPilot | null; target: { shipTypeId: number; sig: number; speed: number } | null }) {
  const lang = useLang()
  // ---- the missile
  const [fitMissiles, setFitMissiles] = useState<Missile[]>([])
  useEffect(() => {
    if (!you) return setFitMissiles([])
    let live = true
    void missilesOf(you.fit, you.skills).then((m) => live && setFitMissiles(m))
    return () => {
      live = false
    }
  }, [you])
  const [source, setSource] = useState<string>('any')
  useEffect(() => {
    if (fitMissiles.length && source === 'any') setSource(fitMissiles[0].key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitMissiles])

  const [catalog, setCatalog] = useState<FittableType[]>([])
  const [groups, setGroups] = useState<Record<number, string>>({})
  useEffect(() => {
    void loadCatalog().then(async (map) => {
      const launchers = [...map.values()].filter((t) => t.launcher)
      setCatalog(launchers)
      const names = await window.api.sde.groupNames([...new Set(launchers.map((t) => t.g))])
      setGroups(Object.fromEntries(Object.entries(names).map(([g, n]) => [g, tn(n, lang)])))
    })
  }, [lang])
  // One launcher per group: the Tech II one where there is one.
  const launcherOf = useMemo(() => {
    const best = new Map<number, FittableType>()
    for (const t of catalog) {
      const had = best.get(t.g)
      if (!had || (t.meta === 2 && had.meta !== 2)) best.set(t.g, t)
    }
    return best
  }, [catalog])
  const groupList = useMemo(() => [...launcherOf.keys()].filter((g) => groups[g]).sort((a, b) => groups[a].localeCompare(groups[b])), [launcherOf, groups])
  const [group, setGroup] = useState<number | null>(null)
  useEffect(() => {
    if (group === null && groupList.length) setGroup(groupList.find((g) => /heavy assault|тяжёлых штурмовых/i.test(groups[g])) ?? groupList[0])
  }, [groupList, group, groups])
  const launcher = group !== null ? launcherOf.get(group)?.id : undefined
  const [charges, setCharges] = useState<number[]>([])
  const [charge, setCharge] = useState<number | undefined>()
  useEffect(() => {
    if (!launcher) return
    void chargesFor(launcher).then((ids) => {
      setCharges(ids)
      setCharge(ids[0])
    })
  }, [launcher])
  const chargeName = useTypeBasics(charges)
  const [all5, setAll5] = useState(true)
  const [custom, setCustom] = useState<Missile | null>(null)
  useEffect(() => {
    if (!launcher || !charge) return
    let live = true
    const fit: FitSpec = { shipTypeId: CAPSULE, name: 'lab', modules: [{ typeId: launcher, slot: 'hi', state: 'active', chargeTypeId: charge }], drones: [], implants: [] }
    void missilesOf(fit, all5 ? { mode: 'all5' } : { mode: 'char', levels: {} }).then((m) => live && setCustom(m[0] ?? null))
    return () => {
      live = false
    }
  }, [launcher, charge, all5])
  const picked = source === 'any' ? custom : fitMissiles.find((m) => m.key === source) ?? custom

  // Hand edits on top of the missile, to see what each number does.
  const [edit, setEdit] = useState<{ radius?: number; velocity?: number; drf?: number }>({})
  useEffect(() => setEdit({}), [picked?.key, picked?.radius, picked?.velocity])
  const radius = edit.radius ?? picked?.radius ?? 0
  const velocity = edit.velocity ?? picked?.velocity ?? 0
  const drf = edit.drf ?? picked?.drf ?? 1

  // ---- the target
  const [sig, setSig] = useState(target?.sig ?? 125)
  const [speed, setSpeed] = useState(target?.speed ?? 1000)
  const [hull, setHull] = useState<number | null>(target?.shipTypeId ?? null)
  const hullName = useTypeBasic(hull ?? 0)
  const missileName = useTypeBasic(picked?.charge ?? 0)
  const takeHull = async (id: number) => {
    const st = await window.api.fit.calculate({ shipTypeId: id, name: 'lab', modules: [], drones: [], implants: [] }, { mode: 'all5' })
    setHull(id)
    setSig(Math.round(st.navigation.signatureRadius))
    setSpeed(Math.round(st.navigation.maxVelocity))
  }

  const app = missileApplication({ sig, speed, radius, velocity, drf })

  return (
    <div className="missile-lab">
      <div className="missile-main">
        <Card className="missile-scene-card">
          <MissileScene
            sig={sig}
            radius={radius}
            shift={app.shift}
            grow={app.growSec}
            speed={speed}
            velocity={velocity}
            shipName={hull !== null && hullName ? tn(hullName.n, lang) : translate('Цель выстрела')}
            missileName={picked?.charge && missileName ? tn(missileName.n, lang) : translate('Ракета')}
          />
          <p className="muted small missile-legend">
            <span className="ml-key ml-blast" /> взрыв, радиус E <span className="ml-key ml-target" /> цель, сигнатура S <span className="ml-key ml-ghost" /> где цель была в момент попадания
          </p>
        </Card>
        <Card title="Доля урона от скорости цели">
          <SpeedCurve sig={sig} radius={radius} velocity={velocity} drf={drf} speed={speed} />
        </Card>
      </div>

      <div className="missile-side">
        <Card title="Ракета">
          <label className="missile-field">
            <span className="muted small">Откуда</span>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {fitMissiles.map((m) => (
                <FitMissileOption key={m.key} m={m} />
              ))}
              <option value="any">Любая ракета</option>
            </select>
          </label>
          {source === 'any' && (
            <>
              <label className="missile-field">
                <span className="muted small">Пусковая установка</span>
                <select value={group ?? ''} onChange={(e) => setGroup(Number(e.target.value))}>
                  {groupList.map((g) => (
                    <option key={g} value={g}>
                      {groups[g]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="missile-field">
                <span className="muted small">Ракета</span>
                <select value={charge ?? ''} onChange={(e) => setCharge(Number(e.target.value))}>
                  {charges.map((c) => (
                    <option key={c} value={c}>
                      {tn(chargeName(c)?.n, lang)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="missile-field">
                <span className="muted small">Навыки</span>
                <select value={all5 ? 'all5' : 'none'} onChange={(e) => setAll5(e.target.value === 'all5')}>
                  <option value="all5">все V</option>
                  <option value="none">без навыков</option>
                </select>
              </label>
            </>
          )}
          <div className="missile-nums">
            <Num label="Радиус взрыва E, м" value={radius} step={5} onChange={(v) => setEdit((x) => ({ ...x, radius: Math.max(1, v) }))} edited={edit.radius !== undefined} />
            <Num label="Скорость взрыва Ve, м/с" value={velocity} step={5} onChange={(v) => setEdit((x) => ({ ...x, velocity: Math.max(1, v) }))} edited={edit.velocity !== undefined} />
            <Num label="Снижение урона drf" value={drf} step={0.01} onChange={(v) => setEdit((x) => ({ ...x, drf: Math.max(0.1, Math.min(2, v)) }))} edited={edit.drf !== undefined} />
          </div>
          {Object.keys(edit).length > 0 && (
            <button className="ghost small" onClick={() => setEdit({})}>
              Вернуть значения ракеты
            </button>
          )}
          {source === 'any' && <p className="muted small">Ракета на голой капсуле: навыки учтены, бонусы корпуса и модули нет. Ракеты вашего фита — в списке «Откуда».</p>}
        </Card>

        <Card title="Цель выстрела">
          <SearchBox
            placeholder="Корабль: подставит сигнатуру и скорость…"
            search={(q) => searchTypesSde(q, lang, { categories: [CATEGORY.SHIP] })}
            onSelect={(t) => void takeHull(t.id)}
            initial=""
          />
          {target && (
            <button className="ghost small" onClick={() => (setHull(target.shipTypeId), setSig(Math.round(target.sig)), setSpeed(Math.round(target.speed)))}>
              Противник из симулятора
            </button>
          )}
          {hull !== null && <p className="muted small" translate="no">{tn(hullName?.n, lang)}</p>}
          <Slider label="Сигнатура S, м" value={sig} min={10} max={3000} step={5} onChange={setSig} />
          <Slider label="Скорость Vt, м/с" value={speed} min={0} max={5000} step={10} onChange={setSpeed} />
        </Card>

        <Card title="Расчёт">
          <Breakdown app={app} sig={sig} speed={speed} radius={radius} drf={drf} />
          {picked && (
            <p className="small">
              <span className="muted">Урон одной ракеты:</span> <b>{n0(picked.volley)}</b> <span className="muted">→</span> <b>{n0(picked.volley * app.factor)}</b> <span className="muted">до резистов</span>
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}

function FitMissileOption({ m }: { m: Missile }) {
  const lang = useLang()
  const l = useTypeBasic(m.launcher)
  const c = useTypeBasic(m.charge ?? 0)
  return <option value={m.key}>{`${translate('Ваш фит')}: ${tn(l?.n, lang)}${m.charge ? ` · ${tn(c?.n, lang)}` : ''}`}</option>
}

function Num({ label, value, step, onChange, edited }: { label: string; value: number; step: number; onChange: (v: number) => void; edited: boolean }) {
  return (
    <label className={`missile-field ${edited ? 'edited' : ''}`}>
      <span className="muted small">{label}</span>
      <input type="number" step={step} value={Math.round(value * 1000) / 1000} onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
    </label>
  )
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="missile-field">
      <span className="muted small">{label}</span>
      <div className="missile-slider">
        <input type="range" min={min} max={max} step={step} value={Math.min(max, value)} onChange={(e) => onChange(Number(e.target.value))} />
        <input type="number" min={0} step={step} value={value} onChange={(e) => e.target.value !== '' && onChange(Math.max(0, Number(e.target.value)))} />
      </div>
    </label>
  )
}

/** The formula with the numbers in it, and which part holds the damage back. */
function Breakdown({ app, sig, speed, radius, drf }: { app: MissileApplication; sig: number; speed: number; radius: number; drf: number }) {
  const row = (name: string, formula: string, value: number, on: boolean) => (
    <tr className={on ? 'limit' : ''}>
      <td>{name}</td>
      <td className="mono small" translate="no">
        {formula}
      </td>
      <td className="num">{value === Infinity ? '∞' : n2(Math.min(value, 99))}</td>
    </tr>
  )
  return (
    <>
      <div className={`missile-result ${app.factor >= 0.999 ? 'good' : app.factor < 0.5 ? 'bad' : ''}`}>
        <b>{pct(app.factor)}</b> <span>урона долетает</span>
      </div>
      <table className="table compact missile-terms">
        <tbody>
          {row('Потолок', '1', 1, app.limit === 'none')}
          {row('Размер', `S/E = ${n0(sig)}/${n0(radius)}`, app.size, app.limit === 'size')}
          {row('Скорость цели', speed > 0 ? `(S·Ve/(E·Vt))^drf = ${n2(app.speedBase)}^${n2(drf)}` : 'Vt = 0', app.speedTerm, app.limit === 'speed')}
        </tbody>
      </table>
      <p className="small">
        {app.limit === 'none' ? (
          <span>Цель крупнее взрыва и не успевает уйти: долетает весь урон.</span>
        ) : app.limit === 'size' ? (
          <span>Мешает размер: сигнатура цели меньше радиуса взрыва, часть взрыва уходит мимо.</span>
        ) : (
          <span>Мешает скорость: пока взрыв растёт до полного радиуса, цель успевает уйти дальше своей сигнатуры.</span>
        )}
      </p>
      <p className="muted small">
        <span>Взрыв набирает радиус за</span> <b>{`${n2(app.growSec)} с`}</b>
        <span>; цель за это время сдвигается на</span> <b>{`${n0(app.shift)} м`}</b>
        {app.shift > 0 && (
          <>
            <span>: это</span> <b>{`${n2(app.shift / Math.max(1, sig))}×`}</b> <span>её сигнатуры.</span>
          </>
        )}
      </p>
      <p className="muted small">
        <span>Формула игры: min(1, S/E, (S·Ve/(E·Vt))^drf). S·Ve/(E·Vt) — это ровно сигнатура цели, делённая на её сдвиг за время роста взрыва.</span>
      </p>
    </>
  )
}

/** Share of damage over the target's speed, with the current speed marked. */
function SpeedCurve({ sig, radius, velocity, drf, speed }: { sig: number; radius: number; velocity: number; drf: number; speed: number }) {
  const W = 760
  const H = 200
  const pad = { l: 44, r: 12, t: 12, b: 26 }
  const top = Math.max(1500, Math.ceil((speed * 2) / 500) * 500)
  const x = (v: number) => pad.l + (v / top) * (W - pad.l - pad.r)
  const y = (f: number) => H - pad.b - f * (H - pad.t - pad.b)
  const points = Array.from({ length: 121 }, (_, i) => (i / 120) * top)
  const path = points.map((v, i) => `${i ? 'L' : 'M'}${x(v).toFixed(1)},${y(missileApplication({ sig, speed: v, radius, velocity, drf }).factor).toFixed(1)}`).join(' ')
  const now = missileApplication({ sig, speed, radius, velocity, drf }).factor
  const [hover, setHover] = useState<number | null>(null)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top)
  return (
    <div className="missile-curve">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const v = ((((e.clientX - r.left) / r.width) * W - pad.l) / (W - pad.l - pad.r)) * top
          setHover(v >= 0 && v <= top ? v : null)
        }}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(f)} y2={y(f)} className="grid" />
            <text x={pad.l - 6} y={y(f) + 4} textAnchor="end">
              {pct(f)}
            </text>
          </g>
        ))}
        {ticks.map((v, i) => (
          <text key={v} x={x(v)} y={H - 6} textAnchor={i === ticks.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>
            {n0(v)}
          </text>
        ))}
        <path d={path} className="line-a" />
        <line x1={x(Math.min(speed, top))} x2={x(Math.min(speed, top))} y1={pad.t} y2={H - pad.b} className="marker" />
        <circle cx={x(Math.min(speed, top))} cy={y(now)} r={5} className="dot" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="hover" />}
      </svg>
      <div className="muted small">
        {hover !== null ? (
          <>
            <span>При скорости</span> <b>{`${n0(hover)} м/с`}</b>: <b>{pct(missileApplication({ sig, speed: hover, radius, velocity, drf }).factor)}</b>
          </>
        ) : (
          <span>Скорость цели, м/с. Наведите на график, чтобы увидеть долю урона при другой скорости.</span>
        )}
      </div>
    </div>
  )
}

const BLAST = 0xe8a33c
const TARGET = 0x4ea6e8
const GHOST = 0x9d9e99

/**
 * The shot, slowed down and looped: the missile comes in, the blast grows to radius E at its explosion velocity,
 * the target (signature S) moves on meanwhile. Sizes and the target's travel are to scale; the ship and the missile
 * inside them are only pictures of what the spheres stand for.
 */
// One loop: 0.9 s for the missile to come in, 2.4 s for the blast to grow, 1.4 s to look at it.
const IN = 0.9
const GROW = 2.4
const HOLD = 1.4
const LOOP = IN + GROW + HOLD
const RATES = [0.25, 0.5, 1]

interface SceneProps {
  sig: number
  radius: number
  shift: number
  grow: number
  speed: number
  velocity: number
  shipName: string
  missileName: string
}

/** A small stylised hull along +x, about two units long, for inside the signature sphere. */
function shipModel(): THREE.Group {
  const g = new THREE.Group()
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x8a96a8, metalness: 0.55, roughness: 0.45, flatShading: true })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x4a525e, metalness: 0.6, roughness: 0.5, flatShading: true })
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x7fd0ff })
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 1.5, 6), hullMat)
  body.rotation.z = -Math.PI / 2
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 6), hullMat)
  nose.rotation.z = -Math.PI / 2
  nose.position.x = 1
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.22), darkMat)
  deck.position.set(-0.1, 0.24, 0)
  g.add(body, nose, deck)
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.5), darkMat)
    wing.position.set(-0.35, -0.02, side * 0.38)
    wing.rotation.y = side * 0.35
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.6, 8), hullMat)
    pod.rotation.z = -Math.PI / 2
    pod.position.set(-0.45, -0.02, side * 0.62)
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 8), glowMat)
    flame.rotation.z = Math.PI / 2
    flame.position.set(-0.92, -0.02, side * 0.62)
    g.add(wing, pod, flame)
  }
  const main = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 8), glowMat)
  main.rotation.z = Math.PI / 2
  main.position.x = -1
  g.add(main)
  return g
}

/** A missile along +x, about one unit long. */
function missileModel(): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0xd9dbe0, metalness: 0.4, roughness: 0.4 })
  const finMat = new THREE.MeshStandardMaterial({ color: 0x9a3b2c, metalness: 0.3, roughness: 0.6 })
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 10), mat)
  body.rotation.z = -Math.PI / 2
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 10), finMat)
  nose.rotation.z = -Math.PI / 2
  nose.position.x = 0.51
  g.add(body, nose)
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.005, 0.1), finMat)
    const a = (k * Math.PI) / 2
    fin.position.set(-0.32, Math.cos(a) * 0.1, Math.sin(a) * 0.1)
    fin.rotation.x = a
    g.add(fin)
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 10), new THREE.MeshBasicMaterial({ color: 0xffc66b }))
  flame.rotation.z = Math.PI / 2
  flame.position.x = -0.55
  g.add(flame)
  return g
}

/** A see-through sphere with a wire over it. */
function bubble(color: number, opacity: number): THREE.Group {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })))
  g.add(new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 16, 10)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: Math.min(1, opacity * 2.2) })))
  return g
}

function MissileScene({ sig, radius, shift, grow, speed, velocity, shipName, missileName }: SceneProps) {
  const box = useRef<HTMLDivElement>(null)
  type LabelKey = 'blast' | 'target' | 'ghost' | 'missile' | 'shift' | 'speed' | 'time'
  const labels = useRef<Partial<Record<LabelKey, HTMLDivElement | null>>>({})
  const live = useRef({ sig, radius, shift, grow, speed, velocity, shipName, missileName })
  live.current = { sig, radius, shift, grow, speed, velocity, shipName, missileName }
  const reframe = useRef<(() => void) | null>(null)
  // The clock: where in the loop, whether it runs, how fast.
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  // With reduced motion it starts stopped, at the full blast.
  const clock = useRef(still ? IN + GROW : 0)
  const [paused, setPaused] = useState(still)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const [rate, setRate] = useState(1)
  const rateRef = useRef(rate)
  rateRef.current = rate
  const scrub = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = box.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    el.prepend(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1e8)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.AmbientLight(0xb8c4d6, 0.9))
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(-1, 2, 1.5)
    scene.add(sun)
    const rim = new THREE.DirectionalLight(0x6fa8ff, 0.8)
    rim.position.set(1, -0.5, -1.5)
    scene.add(rim)

    const blast = bubble(BLAST, 0.2)
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 1, depthWrite: false }))
    const shock = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 96), new THREE.MeshBasicMaterial({ color: BLAST, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }))
    shock.rotation.x = -Math.PI / 2
    const sigBubble = bubble(TARGET, 0.16)
    const ship = shipModel()
    const target = new THREE.Group()
    target.add(sigBubble, ship)
    const ghost = new THREE.Group()
    ghost.add(new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 16, 10)), new THREE.LineBasicMaterial({ color: GHOST, transparent: true, opacity: 0.45 })))
    const ghostCross = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.15, 0, 0), new THREE.Vector3(0.15, 0, 0), new THREE.Vector3(0, -0.15, 0), new THREE.Vector3(0, 0.15, 0), new THREE.Vector3(0, 0, -0.15), new THREE.Vector3(0, 0, 0.15)]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
    )
    ghost.add(ghostCross)
    const missile = missileModel()
    // A glow on it, a few pixels whatever the zoom, so it can be seen coming from far off.
    const glowGeo = new THREE.BufferGeometry()
    glowGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
    missile.add(new THREE.Points(glowGeo, new THREE.PointsMaterial({ color: 0xffc66b, size: 9, sizeAttenuation: false, transparent: true, opacity: 0.9 })))
    const TRAIL_N = 24
    const trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: TRAIL_N }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0xffc66b, transparent: true, opacity: 0.85 }))
    const track = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: TARGET, dashSize: 1, gapSize: 1 }))
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, TARGET)
    scene.add(blast, flash, shock, target, ghost, missile, trail, track, arrow)
    let grid: THREE.GridHelper | null = null
    let stars: THREE.Points | null = null

    // Where the missile comes from, and the scale of the little models.
    let from = new THREE.Vector3()
    const frame = () => {
      const { sig: S, radius: E, shift: D } = live.current
      const extent = Math.max(E, S + D, S, 10)
      const centre = new THREE.Vector3(D / 2, 0, 0)
      controls.target.copy(centre)
      // Far enough for everything that happens: the impact point, the target's whole travel, the full blast.
      const reach = D / 2 + Math.max(S, E)
      camera.position.copy(centre).add(new THREE.Vector3(0.4, 0.42, 1).normalize().multiplyScalar(reach * 3.4))
      if (grid) {
        scene.remove(grid)
        grid.geometry.dispose()
      }
      const step = 10 ** Math.floor(Math.log10(extent / 2))
      const size = Math.ceil((extent * 4) / step) * step
      grid = new THREE.GridHelper(size, Math.round(size / step), 0x3c3f45, 0x25272b)
      grid.position.set(D / 2, -Math.max(S, E) * 1.1, 0)
      scene.add(grid)
      if (stars) {
        scene.remove(stars)
        stars.geometry.dispose()
      }
      const pts: number[] = []
      for (let k = 0; k < 900; k++) {
        const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(extent * (40 + Math.random() * 20))
        pts.push(v.x + D / 2, v.y, v.z)
      }
      const sg = new THREE.BufferGeometry()
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xc9d3e6, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.7 }))
      scene.add(stars)
      ghost.scale.setScalar(S)
      ship.scale.setScalar(S * 0.5)
      from = new THREE.Vector3(-1, 0.55, 0.35).normalize().multiplyScalar(reach * 1.1)
      ;(track.material as THREE.LineDashedMaterial).dashSize = extent / 30
      ;(track.material as THREE.LineDashedMaterial).gapSize = extent / 40
    }
    reframe.current = frame
    frame()

    const resize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    const place = (key: LabelKey, at: THREE.Vector3 | null, text = '') => {
      const div = labels.current[key]
      if (!div) return
      if (!at) {
        div.style.visibility = 'hidden'
        return
      }
      const p = at.clone().project(camera)
      div.style.visibility = p.z < 1 ? 'visible' : 'hidden'
      div.style.transform = `translate(${((p.x + 1) / 2) * el.clientWidth}px, ${((1 - p.y) / 2) * el.clientHeight}px)`
      div.textContent = text
    }
    const m = (v: number) => `${n0(v)} ${translate('м')}`

    let last = performance.now()
    let raf = 0
    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (!pausedRef.current) clock.current = (clock.current + dt * rateRef.current) % LOOP
      const t = clock.current
      if (scrub.current && document.activeElement !== scrub.current) scrub.current.value = String(t)
      const { sig: S, radius: E, shift: D, grow: G, speed: V, shipName, missileName } = live.current
      const big = Math.max(E, S)
      const hit = t >= IN
      // Blast progress, 0–1; the target runs on a straight line through the impact point at constant speed.
      const p = Math.max(0, Math.min(1, (t - IN) / GROW))
      const tx = hit ? D * p : D * ((t - IN) / GROW)
      target.position.set(tx, 0, 0)
      sigBubble.scale.setScalar(S)
      blast.visible = hit
      blast.scale.setScalar(Math.max(1e-3, E * p))
      // A flash at the moment of the hit, and a ring running out with the blast front.
      const since = t - IN
      flash.visible = hit && since < 0.35
      flash.scale.setScalar(Math.max(1e-3, big * 0.12 * (1 + since * 3)))
      ;(flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - since / 0.35)
      shock.visible = hit && p > 0 && p < 1
      shock.scale.setScalar(Math.max(1e-3, E * p))
      ;(shock.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - p)
      ghost.visible = hit
      // The missile homes in on the target as it was at the moment of impact.
      const incoming = !hit
      missile.visible = incoming
      trail.visible = incoming
      if (incoming) {
        const k = t / IN
        const pos = from.clone().multiplyScalar(1 - k)
        missile.position.copy(pos)
        missile.scale.setScalar(big * 0.3)
        missile.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), from.clone().negate().normalize())
        const pts = Array.from({ length: TRAIL_N }, (_, j) => from.clone().multiplyScalar(Math.min(1, 1 - k + (j / (TRAIL_N - 1)) * 0.45)))
        trail.geometry.setFromPoints(pts)
      }
      track.geometry.setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(tx, 0, 0)])
      track.computeLineDistances()
      track.visible = hit && D > 0
      // Velocity arrow out of the ship's nose, longer for a faster ship.
      arrow.visible = V > 0
      arrow.position.set(tx + S * 0.75, 0, 0)
      const arrowLen = Math.max(big * 0.25, Math.min(big * 1.2, S * 0.4 + (V / 1000) * big * 0.5))
      arrow.setLength(arrowLen, arrowLen * 0.25, arrowLen * 0.15)
      controls.update()
      renderer.render(scene, camera)

      const up = big * 0.08
      place('target', new THREE.Vector3(tx, -S - big * 0.14, 0), `${shipName} · ${translate('сигнатура')} ${m(S)}`)
      place('speed', V > 0 ? new THREE.Vector3(tx + S * 0.75 + arrowLen + big * 0.12, 0, 0) : null, `${n0(V)} ${translate('м/с')}`)
      place('blast', hit ? new THREE.Vector3(0, Math.max(E * p, S) + up * 2, 0) : null, `${translate('взрыв ракеты')} ${m(E * p)} / ${m(E)}`)
      place('missile', incoming ? missile.position.clone().add(new THREE.Vector3(0, big * 0.2, 0)) : null, missileName)
      place('ghost', hit ? new THREE.Vector3(-Math.max(E * p, S) - up, 0, 0) : null, translate('цель в момент попадания'))
      place('shift', hit && D * p > big * 0.05 ? new THREE.Vector3(tx / 2, -Math.max(S, E * p) - big * 0.45, 0) : null, `${translate('сдвиг')} ${m(D * p)}`)
      const time = labels.current.time
      if (time) time.textContent = !hit ? translate('ракета подлетает') : `${n2(G * p)} / ${n2(G)} ${translate('с')}`
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        mesh.geometry?.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose()
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  // New sizes: frame the whole shot again.
  useEffect(() => reframe.current?.(), [sig, radius, shift])

  const label = (key: LabelKey, className: string) => (
    <div
      className={className}
      translate="no"
      ref={(d) => {
        labels.current[key] = d
      }}
    />
  )
  const jump = (t: number) => {
    clock.current = t
    setPaused(true)
  }
  return (
    <div className="missile-scene-wrap">
      <div className="missile-scene" ref={box}>
        {label('target', 'ml-label ml-label-target')}
        {label('speed', 'ml-label ml-label-target ml-label-quiet')}
        {label('blast', 'ml-label ml-label-blast')}
        {label('missile', 'ml-label ml-label-missile')}
        {label('ghost', 'ml-label ml-label-ghost ml-label-left')}
        {label('shift', 'ml-label ml-label-shift')}
        {label('time', 'ml-time')}
        <div className="ml-hint muted small">Вращение — мышью, масштаб — колесом. Время замедлено, размеры и сдвиг в масштабе.</div>
      </div>
      <div className="combat-player missile-player">
        <button className="ghost small missile-play" onClick={() => setPaused((x) => !x)}>
          <Glyph name={paused ? 'play' : 'pause'} size={13} /> {paused ? 'Играть' : 'Пауза'}
        </button>
        <button className="ghost small" onClick={() => jump(0)}>
          Пуск
        </button>
        <button className="ghost small" onClick={() => jump(IN)}>
          Попадание
        </button>
        <button className="ghost small" onClick={() => jump(IN + GROW)}>
          Полный взрыв
        </button>
        <input ref={scrub} type="range" min={0} max={LOOP} step={0.01} defaultValue={0} aria-label={translate('Время')} onInput={(e) => jump(Number((e.target as HTMLInputElement).value))} />
        {RATES.map((r) => (
          <button key={r} className={`ghost small speed ${rate === r ? 'active' : ''}`} onClick={() => setRate(r)}>
            ×{r}
          </button>
        ))}
      </div>
    </div>
  )
}
