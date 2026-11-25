import { useEffect, useMemo, useRef, useState } from 'react'
import type { CombatDirection, CombatEffect, CombatPilot, CombatResult, CombatScenario, CombatSideInfo } from '../../shared/combat'
import type { Candidate, CombatAdvice, Problem, Rated } from '../../shared/combatAdvice'
import { frameAt, type Behavior, type Timeline, type TimelineEvent, type TimelinePoint } from '../../shared/combatTimeline'
import type { FitBooster, FitSpec, FittableType, FleetBoost, SavedFit, SkillSource } from '../../shared/fit'
import type { HeatPolicy } from '../../shared/heat.ts'
import { outcomeBands, rankLevers, type CombatExplore, type Lever, type OutcomeKind } from '../../shared/combatExplore.ts'
import { addScenario, decodeScenario, encodeScenario, removeScenario, type SavedScenario, type ScenarioSetup } from '../../shared/combatScenario.ts'
import { compareFights, explainChange, historyPush, historyRedo, historyStart, historyUndo, summarize, type Change, type FightSummary } from '../../shared/combatCompare.ts'
import { FleetPanel } from './components/FleetPanel'
import { AppProvider, useApp, useLang } from './AppContext'
import { ChargePicker } from './components/ChargePicker'
import { AttrIcon } from './components/Icon'
import { Glyph } from './components/Glyph'
import { BoosterPanel } from './components/BoosterPanel'
import { MissileLab } from './components/MissileLab'
import { Card, CountUp, SearchBox, Tabs } from './components/ui'
import { imageUrl } from './lib/esi'
import { fixed, fmtNum } from './lib/format'
import { chargesFor, fromEft, fromEsiItems, loadCatalog, toEft } from './lib/fitting'
import { groupByShip, loadGameFits, type GameFitting } from './lib/gameFits'
import { CATEGORY, searchTypesSde, tn, useTypeBasic, useTypeBasics } from './lib/sde'
import { locale, translate } from './i18n'

/** Damage type icons (em, thermal, kinetic, explosive) and resist icons (same order). */
const DAMAGE_ICONS = [114, 118, 117, 116]
const RESIST_ICONS = [271, 274, 273, 272]
const LAYER_ICONS = { shield: 263, armor: 265, hull: 9 }
const LAYER_NAMES = { shield: 'Щит', armor: 'Броня', hull: 'Корпус' } as const

/** How the fight is computed: shown under the results. */
const MODEL_NOTE = 'Бой считается шаг за шагом: корабли движутся с инерцией, оружие стреляет циклами и перезаряжается, дезинтеграторы раскручиваются, накопитель тратится и восстанавливается, у анцилларных ремонтников кончаются заряды, нейтрализаторы и носферату работают по накопителю. Турели: шанс попадания 0,5^((ω·40 000 / (наводка·сигнатура))² + (max(0, d − оптимал) / фоллоф)²), с учётом Wrecking-попаданий. Ракеты: min(1, S/E, (S/E·Ve/Vt)^drf). Часовые дроны считаются как турели. Reactive Armor Hardener подстраивается под урон по броне каждый цикл. Цель надо захватить: дальность и время захвата считаются, дроны уходят только в пределах контроля. Без накопителя активные хардены отключаются. Assault Damage Control включается, когда остаётся половина HP. Перегрев: нагрев стоек, урон соседним модулям и выгорание по формулам игры, средними значениями. Командные бонусы берутся из панели «Флотские бонусы». Не учитываются: ECM, дампы и дизрапторы, время полёта ракет, наводка мобильных дронов (те, что поспевают за целью, бьют в полную силу). Значения средние, без случайных промахов.'

const n1 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 })
const km = (m: number) => `${(m / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} км`

function duration(sec: number): string {
  if (!Number.isFinite(sec)) return '—'
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
  /** Ammo chosen here for your weapons (module type → charge); the fitting tool's fit is not changed. */
  const [ammoA, setAmmoA] = useState<Record<number, number | undefined>>({})
  const attackerShip = attacker?.fit.shipTypeId
  /** Boosters taken here for the fight; undefined = those of the fit. They act from the first second. */
  const [boostA, setBoostA] = useState<FitBooster[] | undefined>()
  /** Fleet boosts set here for the fight; undefined = those of the fit. */
  const [fleetA, setFleetA] = useState<{ fleet?: FleetBoost; boosterFits?: FitSpec[] } | undefined>()
  // Another ship: its own ammo and boosters, not the ones picked here for the last one.
  useEffect(() => {
    // A scenario being opened brings its own.
    if (keepCourse.current) return
    setAmmoA({})
    setBoostA(undefined)
    setFleetA(undefined)
  }, [attackerShip])
  const you = useMemo<CombatPilot | null>(() => {
    if (!attacker) return attacker
    let fit = attacker.fit
    if (Object.keys(ammoA).length) fit = { ...fit, modules: fit.modules.map((m) => (m.typeId in ammoA ? { ...m, chargeTypeId: ammoA[m.typeId] } : m)) }
    if (boostA) fit = { ...fit, boosters: boostA }
    if (fleetA) fit = { ...fit, fleet: fleetA.fleet, boosterFits: fleetA.boosterFits }
    return fit === attacker.fit ? attacker : { ...attacker, fit }
  }, [attacker, ammoA, boostA, fleetA])
  const [sc, setSc] = useState<CombatScenario>({ distance: 10_000, speedA: 0, headingA: 0, speedB: 0, headingB: 90, behaviorA: 'orbit', behaviorB: 'orbit' })
  const [maxSpeed, setMaxSpeed] = useState({ a: 1000, b: 1000 })
  const [result, setResult] = useState<CombatResult | null>(null)
  const [mode, setMode] = useState<'fight' | 'missiles'>('fight')
  const [error, setError] = useState<string | null>(null)
  /** Set while an undo restores a setup: the restored ships keep its speeds instead of starting from their top speeds. */
  const keepCourse = useRef(false)

  // "Your" fit comes from the fitting tool and follows its changes.
  useEffect(() => {
    document.title = 'Canopus — симуляция боя'
    void window.api.combat.getAttacker().then((a) => a && setAttacker(a))
    return window.api.combat.onAttacker(setAttacker)
  }, [])

  // New ships: start from their top speeds (keeping the headings and distance).
  // Boosters too: one that changes top speed changes where the ships start from.
  const boostKey = (f?: FitSpec) => (f?.boosters ?? []).map((b) => `${b.typeId}:${(b.side ?? []).join('.')}`).join(',')
  // Fleet boosts too (a skirmish burst changes top speed).
  const fleetKey = (f?: FitSpec) => JSON.stringify([f?.fleet ?? null, (f?.boosterFits ?? []).map((b) => b.shipTypeId)])
  const shipsKey = `${attacker?.fit.shipTypeId}|${defender?.fit.shipTypeId}|${attacker?.fit.modules.length}|${defender?.fit.modules.length}|${boostKey(you?.fit)}|${boostKey(defender?.fit)}|${fleetKey(you?.fit)}|${fleetKey(defender?.fit)}`
  useEffect(() => {
    if (!attacker || !defender || keepCourse.current) return
    void window.api.combat.defaults(you ?? attacker, defender).then((d) => {
      setSc((s) => ({ ...s, speedA: Math.round(d.speedA), speedB: Math.round(d.speedB), sigA: undefined, sigB: undefined, propA: undefined, propB: undefined }))
      setMaxSpeed({ a: Math.max(500, Math.ceil(d.speedA * 1.5)), b: Math.max(500, Math.ceil(d.speedB * 1.5)) })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipsKey])

  useEffect(() => {
    if (!attacker || !defender) return
    let live = true
    const t = setTimeout(() => {
      window.api.combat
        .simulate(you ?? attacker, defender, sc)
        .then((r) => live && (setResult(r), setError(null)))
        .catch((e: Error) => live && setError(e.message))
    }, 60)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [attacker, you, defender, sc])

  // A course set by hand (an arrow on the map, the exact values) is what that ship then flies.
  const set = (patch: Partial<CombatScenario>) =>
    setSc((s) => ({
      ...s,
      ...patch,
      ...('headingA' in patch && !('behaviorA' in patch) ? { behaviorA: 'free' as const } : {}),
      ...('headingB' in patch && !('behaviorB' in patch) ? { behaviorB: 'free' as const } : {})
    }))
  // Switching propulsion on or off: the ship then flies at its new top speed.
  const [follow, setFollow] = useState<{ a?: boolean; b?: boolean }>({})
  const setProp = (side: 'a' | 'b', on: boolean) => {
    set(side === 'a' ? { propA: on } : { propB: on })
    setFollow((f) => ({ ...f, [side]: true }))
  }
  useEffect(() => {
    if (!result || (!follow.a && !follow.b)) return
    if (follow.a) set({ speedA: Math.round(result.a.maxVelocity) })
    if (follow.b) set({ speedB: Math.round(result.b.maxVelocity) })
    setMaxSpeed((m) => ({
      a: follow.a ? Math.max(500, Math.ceil(result.a.maxVelocity * 1.5)) : m.a,
      b: follow.b ? Math.max(500, Math.ceil(result.b.maxVelocity * 1.5)) : m.b
    }))
    setFollow({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])
  const [picking, setPicking] = useState(false)
  const [pickingYou, setPickingYou] = useState(false)
  // A moment of the fight being replayed on the map; null: the map shows the setup.
  const [replay, setReplay] = useState<number | null>(null)
  // The moment under the mouse on the fight charts: the map shows it while the mouse is there.
  const [preview, setPreview] = useState<number | null>(null)
  const timeline = result?.timeline
  useEffect(() => setReplay(null), [timeline])
  // Opponent's direction on the map is only for the picture: the physics depends on distance and headings.
  const [bearing, setBearing] = useState(0)

  // ---------- Undo: the setup of the fight. Your fit is not in it: it follows the fitting tool. ----------
  const setup = useMemo<Setup>(() => ({ sc, ammoA, boostA, fleetA, defender }), [sc, ammoA, boostA, fleetA, defender])
  const [hist, setHist] = useState(() => historyStart(setup))
  /** A restore is not a new step; and a restored ship keeps the speeds of the restored setup. */
  const restoring = useRef(false)
  useEffect(() => {
    if (restoring.current) {
      restoring.current = false
      return
    }
    // Dragging on the map makes many changes: one step when it settles.
    const t = setTimeout(() => setHist((h) => historyPush(h, setup)), 400)
    return () => clearTimeout(t)
  }, [setup])
  // Cleared after every render: the defaults effect above reads it in the same commit as the restore.
  useEffect(() => {
    keepCourse.current = false
  })
  const restore = (s: Setup) => {
    restoring.current = true
    keepCourse.current = true
    setSc(s.sc)
    setAmmoA(s.ammoA)
    setBoostA(s.boostA)
    setFleetA(s.fleetA)
    setDefender(s.defender)
  }
  const step = (move: typeof historyUndo) => {
    // A change still settling counts as a step of its own.
    const h = move(historyPush(hist, setup))
    if (h.present === setup || JSON.stringify(h.present) === JSON.stringify(setup)) return setHist(h)
    setHist(h)
    restore(h.present)
  }
  const undo = () => step(historyUndo)
  const redo = () => step(historyRedo)

  // ---------- Baseline: a fight pinned to compare the next ones with ----------
  const [baseline, setBaseline] = useState<{ result: CombatResult; setup: Setup } | null>(null)
  const pin = () => result && setBaseline({ result, setup })
  const changes = useMemo(() => (baseline && result ? compareFights(summarize(baseline.result), summarize(result)) : []), [baseline, result])

  // ---------- The setup at every distance, and each single change of your side ----------
  const [explored, setExplored] = useState<CombatExplore | null>(null)
  const [exploring, setExploring] = useState(false)
  const exploreRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!attacker || !defender) return
    let live = true
    setExploring(true)
    const t = setTimeout(() => {
      window.api.combat
        .explore(you ?? attacker, defender, sc)
        .then((x) => live && x && (setExplored(x), setExploring(false)))
        .catch(() => live && setExploring(false))
    }, 500)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [attacker, you, defender, sc])
  const applyLever = (l: Lever) => {
    if (l.kind === 'ammo') setAmmoA((a) => ({ ...a, [l.weapon]: l.charge }))
    else if (l.kind === 'heat') set({ heatA: l.policy })
    else if (l.kind === 'prop') setProp('a', l.on)
    else set({ behaviorA: l.behavior, rangeA: l.range })
  }

  // ---------- Scenarios ----------
  const [scenarios, setScenarios] = useState(false)
  const currentScenario = (): SavedScenario | null => (attacker ? { name: '', savedAt: new Date().toISOString(), attacker, setup } : null)
  const openScenario = (s: SavedScenario) => {
    // A step of its own: undo goes back to what was there.
    keepCourse.current = true
    setAttacker(s.attacker)
    setSc(s.setup.sc)
    setAmmoA(s.setup.ammoA ?? {})
    setBoostA(s.setup.boostA)
    setFleetA(s.setup.fleetA)
    setDefender(s.setup.defender)
    setPicking(false)
    setPickingYou(false)
    setScenarios(false)
  }
  const openScenarios = () => setScenarios(true)

  const keys = useRef({ undo, redo, pin, openScenarios })
  keys.current = { undo, redo, pin, openScenarios }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || typing(e.target)) return
      const k = e.key.toLowerCase()
      if (k === 'z') keys.current[e.shiftKey ? 'redo' : 'undo']()
      else if (k === 'y') keys.current.redo()
      else if (k === 'b') keys.current.pin()
      else if (k === 's') keys.current.openScenarios()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ready = !!(attacker && defender && result)
  const anyPicker = !attacker || !defender || picking || pickingYou

  return (
    <div className="combat">
      <header className="combat-head">
        <h1>Симуляция боя</h1>
        <Tabs
          tabs={[
            { id: 'fight', label: 'Бой' },
            { id: 'missiles', label: 'Ракеты · тест' }
          ]}
          value={mode}
          onChange={setMode}
        />
      </header>
      {mode === 'missiles' ? (
        <MissileLab you={you} target={defender && result ? { shipTypeId: defender.fit.shipTypeId, sig: result.b.signature, speed: result.b.speed } : null} />
      ) : (
        <>
          {ready && (
            <CombatTop
              r={result!}
              changes={changes}
              baseline={!!baseline}
              boosters={!!(you?.fit.boosters?.length || defender?.fit.boosters?.length)}
              onPin={pin}
              onUnpin={() => setBaseline(null)}
              onBack={() => baseline && restore(baseline.setup)}
              canUndo={hist.past.length > 0 || JSON.stringify(hist.present) !== JSON.stringify(setup)}
              canRedo={hist.future.length > 0}
              onUndo={undo}
              onRedo={redo}
              onScenarios={() => setScenarios((v) => !v)}
              better={explored && !exploring ? rankLevers(explored.levers).filter((l) => l.delta > 0).length : null}
              onWhatIf={() => exploreRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            />
          )}
          {scenarios && <ScenarioPanel current={currentScenario} onOpen={openScenario} onClose={() => setScenarios(false)} />}
          <div className={`combat-stage${anyPicker ? ' picking' : ''}`}>
            <Card className="combat-side-card side-a">
              <div className="combat-side-title">
                Вы
                {attacker && (
                  <button className="ghost small" onClick={() => setPickingYou(!pickingYou)}>
                    {pickingYou ? 'Готово' : 'Сменить'}
                  </button>
                )}
              </div>
              {attacker && <ShipLabel id={attacker.fit.shipTypeId} name={attacker.fit.name} sub={attacker.skills.mode === 'all5' ? 'Навыки: все V' : 'Навыки: ваш персонаж'} />}
              {(!attacker || pickingYou) && (
                <>
                  {!attacker && <p className="muted small">Выберите свой корабль или откройте фит во вкладке «Фитинг» и нажмите «Симуляция боя».</p>}
                  <OpponentPicker
                    attacker={null}
                    defender={attacker}
                    own
                    lang={lang}
                    onPick={(p) => {
                      setAttacker(p)
                      setPickingYou(false)
                    }}
                  />
                </>
              )}
              {result && !pickingYou && <SideStats info={result.a} />}
              {you && !pickingYou && (
                <AmmoPanel
                  fit={you.fit}
                  onCharge={(moduleId, charge) => setAmmoA((a) => ({ ...a, [moduleId]: charge }))}
                  note={Object.keys(ammoA).length ? 'Боеприпасы изменены только в симуляторе' : undefined}
                  onReset={Object.keys(ammoA).length ? () => setAmmoA({}) : undefined}
                />
              )}
              {ready && !pickingYou && (
                <SideBlock title="Тактика">
                  <Tactics info={result!.a} ewar={sc.ewarA !== false} onProp={(on) => setProp('a', on)} onEwar={(on) => set({ ewarA: on })} own="Ваши" />
                  <HeatPicker info={result!.a} value={sc.heatA} onChange={(heatA) => set({ heatA })} outcome={result!.timeline.a.heat} fit={you?.fit} />
                </SideBlock>
              )}
              {ready && !pickingYou && (
                <SideBlock title="Приказ">
                  <OrdersBox behavior={sc.behaviorA ?? 'free'} range={sc.rangeA} distance={sc.distance} onChange={(b, range) => set({ behaviorA: b, rangeA: range })} />
                </SideBlock>
              )}
              {you && !pickingYou && (
                <SideBlock title="Поддержка">
                  <Boosters
                    fit={you.fit}
                    skills={you.skills}
                    onChange={(f) => setBoostA(f.boosters ?? [])}
                    note={boostA ? 'Бустеры изменены только в симуляторе' : undefined}
                    onReset={boostA ? () => setBoostA(undefined) : undefined}
                  />
                  <FleetBoosts
                    fit={you.fit}
                    onChange={(f) => setFleetA({ fleet: f.fleet, boosterFits: f.boosterFits })}
                    note={fleetA ? 'Флотские бонусы изменены только в симуляторе' : undefined}
                    onReset={fleetA ? () => setFleetA(undefined) : undefined}
                  />
                </SideBlock>
              )}
            </Card>

            <div className="combat-center">
              {error && <div className="warn-box">{error}</div>}
              {ready ? (
                <Card className="combat-map-card">
                  <TacticalMap sc={sc} set={set} r={result!} bearing={bearing} setBearing={setBearing} maxSpeed={maxSpeed} replay={preview ?? replay} />
                  <div className="combat-timeline">
                    <Player end={result!.timeline.end} t={replay} setT={setReplay} />
                    <EventLane r={result!} cursor={preview ?? replay} onSeek={setReplay} />
                    <FightCharts r={result!} base={baseline?.result} cursor={replay} onPreview={setPreview} onSeek={setReplay} />
                    <FightLog r={result!} fits={{ a: (you ?? attacker!).fit, b: defender!.fit }} onSeek={setReplay} />
                    <Shortcuts />
                  </div>
                  <div className="combat-presets">
                    <span className="muted small">Быстро:</span>
                    <button className="ghost small" onClick={() => set({ speedA: 0, headingB: 90, speedB: result!.b.maxVelocity, behaviorA: 'stop', behaviorB: 'orbit', rangeB: undefined })}>
                      Противник на орбите
                    </button>
                    <button className="ghost small" onClick={() => set({ headingA: 90, headingB: 270, speedA: result!.a.maxVelocity, speedB: result!.b.maxVelocity, behaviorA: 'orbit', behaviorB: 'orbit', rangeA: undefined, rangeB: undefined })}>
                      Встречные орбиты
                    </button>
                    <button className="ghost small" onClick={() => set({ headingA: 0, headingB: 180, speedA: result!.a.maxVelocity, speedB: result!.b.maxVelocity, behaviorA: 'approach', behaviorB: 'approach', rangeA: 500, rangeB: 500 })}>
                      Сближение лоб в лоб
                    </button>
                    <button className="ghost small" onClick={() => set({ headingA: 0, headingB: 0, speedA: result!.a.maxVelocity, speedB: result!.b.maxVelocity, behaviorA: 'approach', behaviorB: 'flee', rangeA: 500 })}>
                      Противник убегает
                    </button>
                    <button className="ghost small" onClick={() => set({ speedA: 0, speedB: 0, behaviorA: 'stop', behaviorB: 'stop' })}>
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
                      <SigInput label="Ваша сигнатура" value={sc.sigA} auto={result!.a.signature} onChange={(v) => set({ sigA: v })} />
                      <SigInput label="Сигнатура противника" value={sc.sigB} auto={result!.b.signature} onChange={(v) => set({ sigB: v })} />
                    </div>
                    <p className="muted small">Курс считается от линии «вы → противник»: 0° — вдоль неё (к противнику для вас, от вас для него), 90° и 270° — поперёк в разные стороны.</p>
                  </details>
                </Card>
              ) : (
                !error && attacker && defender && <Card className="combat-map-card muted small">Считаю бой…</Card>
              )}
            </div>

            <Card className="combat-side-card side-b">
              <div className="combat-side-title">
                Противник
                {defender && (
                  <button className="ghost small" onClick={() => setPicking(!picking)}>
                    {picking ? 'Готово' : 'Сменить'}
                  </button>
                )}
              </div>
              {defender && (
                <ShipLabel
                  id={defender.fit.shipTypeId}
                  name={defender.fit.name}
                  sub={`${defender.skills.mode === 'all5' ? 'Навыки: все V' : 'Навыки: как у вас'} · модулей: ${defender.fit.modules.length}`}
                />
              )}
              {defender && attacker && attacker.skills.mode !== 'all5' && !picking && (
                <label className="row small">
                  <span className="muted">Навыки противника</span>
                  <select
                    value={defender.skills.mode === 'all5' ? 'all5' : 'mine'}
                    onChange={(e) => setDefender((d) => d && { ...d, skills: e.target.value === 'all5' ? { mode: 'all5' } : attacker.skills })}
                  >
                    <option value="all5">все V</option>
                    <option value="mine">как у вас</option>
                  </select>
                </label>
              )}
              {defender && result && !picking && <SideStats info={result.b} />}
              {defender && !picking && (
                <AmmoPanel
                  fit={defender.fit}
                  onCharge={(moduleId, charge) =>
                    setDefender((d) => d && { ...d, fit: { ...d.fit, modules: d.fit.modules.map((m) => (m.typeId === moduleId ? { ...m, chargeTypeId: charge } : m)) } })
                  }
                />
              )}
              {ready && !picking && (
                <SideBlock title="Тактика">
                  <Tactics info={result!.b} ewar={sc.ewarB !== false} onProp={(on) => setProp('b', on)} onEwar={(on) => set({ ewarB: on })} own="Его" />
                  <HeatPicker info={result!.b} value={sc.heatB} onChange={(heatB) => set({ heatB })} outcome={result!.timeline.b.heat} fit={defender!.fit} />
                </SideBlock>
              )}
              {ready && !picking && (
                <SideBlock title="Приказ">
                  <OrdersBox behavior={sc.behaviorB ?? 'free'} range={sc.rangeB} distance={sc.distance} onChange={(b, range) => set({ behaviorB: b, rangeB: range })} />
                </SideBlock>
              )}
              {defender && !picking && (
                <SideBlock title="Поддержка">
                  <Boosters fit={defender.fit} skills={defender.skills} onChange={(f) => setDefender((d) => d && { ...d, fit: { ...d.fit, boosters: f.boosters } })} />
                  <FleetBoosts fit={defender.fit} onChange={(f) => setDefender((d) => d && { ...d, fit: { ...d.fit, fleet: f.fleet, boosterFits: f.boosterFits } })} />
                </SideBlock>
              )}
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

          {ready && (
            <>
              <div className={`combat-explore${exploring ? ' busy' : ''}`} ref={exploreRef}>
                <div className="combat-explore-col">
                  {explored ? <OutcomeStrip x={explored} distance={sc.distance} onDistance={(d) => set({ distance: d })} /> : <Card className="muted small">Считаю варианты…</Card>}
                  <Card title="Урон по дистанции">
                    <p className="muted small combat-card-sub">При текущих скоростях, до резистов и раскрутки</p>
                    <Chart r={result!} distance={sc.distance} onDistance={(d) => set({ distance: d })} />
                  </Card>
                </div>
                <LeverList x={explored} onApply={applyLever}>
                  <AdviceCard
                    you={you ?? attacker!}
                    defender={defender!}
                    sc={sc}
                    onApply={(c) => {
                      setAmmoA((a) => ({ ...a, ...c.ammo }))
                      set({ behaviorA: c.behavior, rangeA: c.range })
                      setProp('a', c.prop)
                    }}
                  />
                </LeverList>
              </div>
              <div className="combat-sides">
                <DirectionCard title="Вы → противник" d={result!.ab} cls="side-a" average={result!.timeline.a.averageDps} />
                <DirectionCard title="Противник → вы" d={result!.ba} cls="side-b" average={result!.timeline.b.averageDps} />
              </div>
              <p className="muted small">
                {`Поперечная скорость ${n1(result!.transversal)} м/с · угловая ${result!.angularVelocity.toLocaleString(locale(), { maximumFractionDigits: 4 })} рад/с`}
              </p>
              <p className="muted small">{MODEL_NOTE}</p>
            </>
          )}
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
/** Nice round step for range rings / zoom. */
function niceRange(m: number): number {
  const steps = [2_500, 5_000, 10_000, 15_000, 20_000, 30_000, 40_000, 50_000, 75_000, 100_000, 150_000, 200_000, 300_000]
  return steps.find((s) => s >= m) ?? 300_000
}

type DragTarget = 'b' | 'va' | 'vb'

/** A rough box around a line of map text (x0, y0, x1, y1), for keeping labels apart. */
type Box = [number, number, number, number]
const textBox = (x: number, y: number, anchor: 'start' | 'middle' | 'end', chars: number): Box => {
  const w = chars * 6.4
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2
  return [x0 - 2, y - 11, x0 + w + 2, y + 4]
}
const overlaps = (p: Box, q: Box) => p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3]

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
  maxSpeed,
  replay
}: {
  sc: CombatScenario
  set: (p: Partial<CombatScenario>) => void
  r: CombatResult
  bearing: number
  setBearing: (b: number) => void
  maxSpeed: { a: number; b: number }
  replay: number | null
}) {
  const W = 760
  const H = 480
  const cx = W / 2
  const cy = H / 2
  const R = Math.min(W, H) / 2 - 22
  const [drag, setDrag] = useState<DragTarget | null>(null)
  const [view, setView] = useState(() => niceRange(Math.max(sc.distance / 0.8, 5_000)))
  // Re-fit the zoom to the distance after a drag (not during it, so the map doesn't slide under the cursor).
  useEffect(() => {
    if (!drag) setView(niceRange(Math.max(sc.distance / 0.8, 5_000)))
  }, [sc.distance, drag])

  // The replay frames the whole fight once, so the picture doesn't jump about while it plays.
  const series = r.timeline.series
  const world = useMemo(() => {
    const xs = series.flatMap((p) => [p.pos.ax, p.pos.bx])
    const ys = series.flatMap((p) => [p.pos.ay, p.pos.by])
    const x = (Math.min(...xs) + Math.max(...xs)) / 2
    const y = (Math.min(...ys) + Math.max(...ys)) / 2
    return { x, y, reach: Math.max(1000, Math.max(...xs) - x, Math.max(...ys) - y) * 1.15 }
  }, [series])
  const frame = replay === null ? null : frameAt(series, replay)
  const k = frame ? (R - 20) / world.reach : R / view
  const rad = Math.PI / 180
  const ax = frame ? cx + (frame.pos.ax - world.x) * k : cx
  const ay = frame ? cy - (frame.pos.ay - world.y) * k : cy
  const bx = frame ? cx + (frame.pos.bx - world.x) * k : cx + Math.cos(bearing * rad) * sc.distance * k
  const by = frame ? cy - (frame.pos.by - world.y) * k : cy - Math.sin(bearing * rad) * sc.distance * k
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
    if (!drag || frame) return
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
    const x = side === 'a' ? ax : bx
    const y = side === 'a' ? ay : by
    return info.ranges.map((g, i) => {
      // The label goes where the ring is on the map: under it, over it or at its side, never over a ship or another
      // label. A ring smaller than the ship's marker gets its label just outside the marker.
      const ring = g.optimal * k
      const rr = Math.max(ring, 34)
      const text = `${g.kind === 'missile' ? 'ракеты' : 'оптимал'} ${km(g.optimal)}`
      const spot = (
        [
          [x, y + rr + 13, 'middle'],
          [x, y - rr - 6, 'middle'],
          [x + rr * 0.72 + 5, y + rr * 0.72, 'start'],
          [x - rr * 0.72 - 5, y + rr * 0.72, 'end'],
          [x + rr * 0.72 + 5, y - rr * 0.72, 'start'],
          [x - rr * 0.72 - 5, y - rr * 0.72, 'end'],
          [x + rr + 6, y + 4, 'start'],
          [x - rr - 6, y + 4, 'end']
        ] as [number, number, 'middle' | 'start' | 'end'][]
      )
        .map(([lx, ly, anchor]) => ({ lx, ly, anchor, box: textBox(lx, ly, anchor, text.length) }))
        .find(({ box }) => box[1] > 4 && box[3] < H - 30 && box[0] > 4 && box[2] < W - 4 && !taken.some((t) => overlaps(t, box)))
      if (spot) taken.push(spot.box)
      return (
        <g key={`${side}${i}`} className={`ring ring-${side}`}>
          <circle cx={x} cy={y} r={ring} />
          {g.falloff ? <circle cx={x} cy={y} r={(g.optimal + g.falloff) * k} className="falloff" /> : null}
          {spot && (
            <text x={spot.lx} y={spot.ly} textAnchor={spot.anchor}>
              {text}
            </text>
          )}
        </g>
      )
    })
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
  const scaleKm = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].map((v) => v * 1000).find((v) => v * k >= 60) ?? 500_000
  // The speed labels sit past the arrow's tip, on its side of the ship.
  const tipLabel = (from: { x: number; y: number }, tip: { x: number; y: number }) => ({
    x: Math.max(8, Math.min(W - 8, tip.x + (tip.x >= from.x ? 11 : -11))),
    y: tip.y + (tip.y >= from.y ? 18 : -10),
    anchor: (tip.x >= from.x ? 'start' : 'end') as 'start' | 'end'
  })
  const la = tipLabel({ x: cx, y: cy }, ta)
  const lb = tipLabel({ x: bx, y: by }, tb)
  // The distance sits off the line between the ships, on whichever side the speed labels leave free.
  const nx = (cy - by) / Math.max(1, Math.hypot(bx - cx, by - cy))
  const ny = (bx - cx) / Math.max(1, Math.hypot(bx - cx, by - cy))
  const midX = (cx + bx) / 2
  const midY = (cy + by) / 2
  const crowded = (x: number, y: number) => [la, lb].some((l) => Math.abs(l.x - x) < 80 && Math.abs(l.y - y) < 18)
  const offset = crowded(midX + nx * 16, midY - Math.abs(ny) * 16 - 4) ? 26 : -16
  const distLabel = { x: midX + (offset < 0 ? nx * 16 : -nx * 26), y: midY + (offset < 0 ? -Math.abs(ny) * 16 - 4 : Math.abs(ny) * 26 + 10) }
  // What the range labels must keep clear of: both ships with their HP rings (and the event labels over them in the
  // replay), the speed labels and the distance.
  const shipBox = (x: number, y: number): Box => [x - 32, y - (frame ? 72 : 32), x + 32, y + 32]
  const taken: Box[] = frame
    ? [shipBox(ax, ay), shipBox(bx, by), textBox((ax + bx) / 2, (ay + by) / 2 - 10, 'middle', 8), textBox(W - 12, 20, 'end', 26)]
    : [
        shipBox(ax, ay),
        shipBox(bx, by),
        textBox(la.x, la.y, la.anchor, 18),
        textBox(lb.x, lb.y, lb.anchor, 18),
        textBox(distLabel.x, distLabel.y, 'middle', 8)
      ]
  const died = (side: 'a' | 'b') => r.timeline.events.find((e) => e.side === side && e.kind === 'dead')?.t
  const dead = (side: 'a' | 'b') => {
    const at = died(side)
    return frame !== null && at !== undefined && frame.t >= at
  }
  const trail = (side: 'a' | 'b') =>
    frame
      ? series
          .filter((p) => p.t <= frame.t)
          .map((p, i) => {
            const x = cx + ((side === 'a' ? p.pos.ax : p.pos.bx) - world.x) * k
            const y = cy - ((side === 'a' ? p.pos.ay : p.pos.by) - world.y) * k
            return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
          })
          .join(' ')
      : ''
  const hpRings = (x: number, y: number, f: TimelinePoint['a'], key: string) => (
    <g key={key} transform={`rotate(-90 ${x} ${y})`}>
      {(
        [
          ['hp-s', 21, f.s],
          ['hp-a', 25, f.a],
          ['hp-h', 29, f.h]
        ] as [string, number, number][]
      ).map(([cls, radius, share]) => (
        <g key={cls}>
          <circle cx={x} cy={y} r={radius} className="hp hp-track" />
          <circle cx={x} cy={y} r={radius} className={`hp ${cls}`} pathLength={100} strokeDasharray={`${Math.max(0, share) * 100} 100`} />
        </g>
      ))}
    </g>
  )

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
        {/* Ship icons are square: cropped to the marker's circle. */}
        <clipPath id="ship-icon-clip" clipPathUnits="objectBoundingBox">
          <circle cx={0.5} cy={0.5} r={0.5} />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={W} height={H} className="map-bg" />
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle key={f} cx={cx} cy={cy} r={R * f} className="map-grid" />
      ))}
      {rings('a')}
      {rings('b')}
      {frame ? (
        <>
          <path d={trail('a')} className="trail trail-a" />
          <path d={trail('b')} className="trail trail-b" />
          <line x1={ax} y1={ay} x2={bx} y2={by} className="los" />
          {frame.a.dealt > 0 && !dead('a') && !dead('b') && <line x1={ax} y1={ay} x2={bx} y2={by} className="beam beam-a" />}
          {frame.b.dealt > 0 && !dead('a') && !dead('b') && <line x1={bx} y1={by} x2={ax} y2={ay} className="beam beam-b" />}
          <text x={(ax + bx) / 2} y={(ay + by) / 2 - 10} textAnchor="middle" className="los-label">
            {km(frame.distance)}
          </text>
          {hpRings(ax, ay, frame.a, 'hp-a')}
          {hpRings(bx, by, frame.b, 'hp-b')}
          {(['a', 'b'] as const).map((side) => {
            const at = died(side)
            const age = at === undefined ? -1 : frame.t - at
            if (age < 0 || age > 3) return null
            const speed = Math.max(0.2, r.timeline.end / 60)
            const grow = Math.min(1, age / (1.2 * speed))
            return <circle key={side} cx={side === 'a' ? ax : bx} cy={side === 'a' ? ay : by} r={18 + grow * 42} className="blast" opacity={(1 - grow) * 0.8} />
          })}
          {(['a', 'b'] as const).map((side) => {
            const x = side === 'a' ? ax : bx
            const y = side === 'a' ? ay : by
            const recent = r.timeline.events.filter((e) => e.side === side && e.t <= frame.t && frame.t - e.t <= Math.max(3, r.timeline.end / 12)).slice(-2)
            return recent.map((e, i) => (
              <text key={`${side}${e.kind}${e.t}`} x={x} y={y - 38 - i * 16} textAnchor="middle" className={`ev-label ev-${side}`}>
                {EVENT_TEXT[e.kind]}
              </text>
            ))
          })}
          <text x={W - 12} y={20} textAnchor="end" className="rp-legend">
            <tspan fill="var(--dmg-em)">{'● '}</tspan>
            <tspan>щит</tspan>
            <tspan fill="var(--warn)">{'  ● '}</tspan>
            <tspan>броня</tspan>
            <tspan fill="var(--bad-fill)">{'  ● '}</tspan>
            <tspan>корпус</tspan>
          </text>
        </>
      ) : (
        <>
          <line x1={cx} y1={cy} x2={bx} y2={by} className="los" />
          <text x={distLabel.x} y={distLabel.y} textAnchor="middle" className="los-label">
            {km(sc.distance)}
          </text>
          {maxRing('a')}
          {maxRing('b')}
          <line x1={cx} y1={cy} x2={ta.x} y2={ta.y} className="vec vec-a" markerEnd="url(#arrow-a)" />
          <line x1={bx} y1={by} x2={tb.x} y2={tb.y} className="vec vec-b" markerEnd="url(#arrow-b)" />
        </>
      )}
      <g className={`ship ship-a ${dead('a') ? 'dead' : ''}`}>
        <circle cx={ax} cy={ay} r={17} />
        <image href={imageUrl.typeIcon(r.a.shipTypeId, 64)} x={ax - 16} y={ay - 16} width={32} height={32} clipPath="url(#ship-icon-clip)" />
        <circle cx={ax} cy={ay} r={17} className="ship-ring" />
      </g>
      <g className={`ship ship-b ${frame ? '' : 'draggable'} ${dead('b') ? 'dead' : ''}`} onPointerDown={(e) => (e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId), setDrag('b'))}>
        <circle cx={bx} cy={by} r={17} />
        <image href={imageUrl.typeIcon(r.b.shipTypeId, 64)} x={bx - 16} y={by - 16} width={32} height={32} clipPath="url(#ship-icon-clip)" />
        <circle cx={bx} cy={by} r={17} className="ship-ring" />
      </g>
      {!frame && (
        <>
          <circle cx={ta.x} cy={ta.y} r={8} className="handle handle-a" onPointerDown={(e) => (e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId), setDrag('va'))} />
          <circle cx={tb.x} cy={tb.y} r={8} className="handle handle-b" onPointerDown={(e) => (e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId), setDrag('vb'))} />
          <text x={la.x} y={la.y} textAnchor={la.anchor} className="vec-label vec-label-a">
            {r.a.speed < sc.speedA - 0.5 ? `${fmtNum(r.a.speed)} м/с под сеткой` : `${fmtNum(sc.speedA)} м/с`}
          </text>
          <text x={lb.x} y={lb.y} textAnchor={lb.anchor} className="vec-label vec-label-b">
            {r.b.speed < sc.speedB - 0.5 ? `${fmtNum(r.b.speed)} м/с под сеткой` : `${fmtNum(sc.speedB)} м/с`}
          </text>
        </>
      )}
      <g className="map-scale">
        <line x1={16} y1={H - 16} x2={16 + scaleKm * k} y2={H - 16} />
        <text x={16} y={H - 22}>
          {km(scaleKm)}
        </text>
      </g>
    </svg>
  )
}

const PLAY_SPEEDS = [1, 2, 4, 8, 16, 32]

/** Plays the fight on the map; the slider also takes you to any moment. */
function Player({ end, t, setT }: { end: number; t: number | null; setT: (t: number | null) => void }) {
  const [playing, setPlaying] = useState(false)
  // By default a fight of any length plays in about twenty seconds.
  const [speed, setSpeed] = useState(1)
  useEffect(() => setSpeed(PLAY_SPEEDS.find((s) => end / s <= 20) ?? 32), [end])
  useEffect(() => {
    if (t === null) setPlaying(false)
  }, [t])
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    let now = t ?? 0
    const step = (at: number) => {
      now = Math.min(end, now + ((at - last) / 1000) * speed)
      last = at
      setT(now)
      if (now >= end) setPlaying(false)
      else raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, end])
  const start = () => {
    if (t === null || t >= end) setT(0)
    setPlaying(true)
  }
  // Space plays and pauses, the arrows step (Shift: 10 s), Home and End go to the ends; not while typing.
  const keys = useRef({ start, playing, t })
  keys.current = { start, playing, t }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      const k = keys.current
      const go = (to: number) => {
        setPlaying(false)
        setT(Math.max(0, Math.min(end, to)))
      }
      if (e.key === ' ') k.playing ? setPlaying(false) : k.start()
      else if (e.key === 'ArrowLeft') go((k.t ?? 0) - (e.shiftKey ? 10 : 1))
      else if (e.key === 'ArrowRight') go((k.t ?? 0) + (e.shiftKey ? 10 : 1))
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(end)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end])
  if (t === null)
    return (
      <div className="combat-player">
        <button onClick={start}>
          <Glyph name="play" size={13} /> Проиграть бой
        </button>
        <span className="time">{duration(end)}</span>
      </div>
    )
  return (
    <div className="combat-player">
      <button className="ghost small" title={playing ? 'Пауза' : 'Играть'} onClick={() => (playing ? setPlaying(false) : start())}>
        <Glyph name={playing ? 'pause' : 'play'} size={13} />
      </button>
      <input
        type="range"
        min={0}
        max={end}
        step={0.1}
        value={t}
        onChange={(e) => {
          setPlaying(false)
          setT(Number(e.target.value))
        }}
      />
      <span className="time">{`${translate(duration(t))} / ${translate(duration(end))}`}</span>
      {[1, 4, 16].concat(PLAY_SPEEDS.includes(speed) && ![1, 4, 16].includes(speed) ? [speed] : []).sort((a, b) => a - b).map((s) => (
        <button key={s} className={`ghost small speed ${s === speed ? 'active' : ''}`} onClick={() => setSpeed(s)}>
          {`×${s}`}
        </button>
      ))}
      <button className="ghost small" onClick={() => setT(null)}>
        К расстановке
      </button>
    </div>
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

const EFFECT_NAMES: Record<CombatEffect['kind'], string> = { web: 'Сетка', paint: 'Подсветка', scram: 'Скрамблер', point: 'Дизраптор', neut: 'Нейтрализатор', nos: 'Носферату' }

/** Propulsion and EWAR switches of a side, and what the other side's modules do to it right now. */
function Tactics({ info, ewar, onProp, onEwar, own }: { info: CombatSideInfo; ewar: boolean; onProp: (on: boolean) => void; onEwar: (on: boolean) => void; own: string }) {
  const lang = useLang()
  const prop = useTypeBasic(info.prop?.typeId ?? 0)
  if (!info.prop && !info.hasEwar && !info.effects.length) return null
  return (
    <div className="combat-tactics">
      {info.prop && (
        <label className="check">
          <input type="checkbox" checked={info.prop.on || info.prop.blocked} onChange={(e) => onProp(e.target.checked)} />
          <span translate="no">{tn(prop?.n, lang)}</span>
          {info.prop.blocked && <span className="bad small">{translate('выключен скрамблером')}</span>}
        </label>
      )}
      {info.hasEwar && (
        <label className="check">
          <input type="checkbox" checked={ewar} onChange={(e) => onEwar(e.target.checked)} />
          {`${own} сетки, подсветка, скрамблеры и нейты включены`}
        </label>
      )}
      {info.effects.length > 0 && (
        <ul className="combat-effects">
          {info.effects.map((e) => (
            <EffectLine key={`${e.kind}${e.typeId}`} e={e} />
          ))}
        </ul>
      )}
    </div>
  )
}

function EffectLine({ e }: { e: CombatEffect }) {
  const lang = useLang()
  const t = useTypeBasic(e.typeId)
  const value = e.kind === 'neut' || e.kind === 'nos' ? `${n1(e.value)} ${translate('GJ за цикл')}` : e.kind === 'web' ? `${n1(e.value)}% ${translate('скорости')}` : e.kind === 'paint' ? `+${n1(e.value)}% ${translate('сигнатуры')}` : translate(e.kind === 'scram' ? 'варп и MWD заблокированы' : 'варп заблокирован')
  return (
    <li className={e.kind === 'paint' ? '' : 'bad'}>
      <b>{translate(EFFECT_NAMES[e.kind])}</b> <span translate="no">{`${e.count > 1 ? `${e.count}× ` : ''}${tn(t?.n, lang)}`}</span>: {value}
      {e.efficiency < 0.995 && <span className="muted small">{` · ${translate('фоллоф')} ${Math.round(e.efficiency * 100)}%`}</span>}
    </li>
  )
}

function SideStats({ info }: { info: CombatSideInfo }) {
  return (
    <div className="combat-sidestats">
      <div className="combat-keystats">
        <span>
          <span className="muted">Скорость в бою</span> <b>{`${n1(Math.min(info.webbedVelocity, info.maxVelocity))} м/с`}</b>
          {info.webbedVelocity < info.maxVelocity - 0.5 && <span className="muted small combat-keystat-sub">{`под сеткой, из ${n1(info.maxVelocity)}`}</span>}
        </span>
        <span>
          <span className="muted">Сигнатура</span> <b>{`${n1(info.signature)} м`}</b>
        </span>
        <span>
          <span className="muted">EHP</span> <b>{fmtNum(info.ehp)}</b>
        </span>
      </div>
      <details className="combat-more">
        <summary className="muted small">Резисты и HP</summary>
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
                <td key={i} className="num">{`${fixed(r * 100, 0)}%`}</td>
              ))}
              <td className="num">{fmtNum(info.hp[l])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </details>
    </div>
  )
}

type Tab = 'game' | 'ship' | 'saved' | 'eft' | 'mirror'

function OpponentPicker({
  attacker,
  defender,
  onPick,
  lang,
  own
}: {
  attacker: CombatPilot | null
  defender: CombatPilot | null
  onPick: (p: CombatPilot) => void
  /** Picking your own side */
  own?: boolean
  lang: 0 | 1
}) {
  const { active } = useApp()
  const [tab, setTabState] = useState<Tab>(active ? 'game' : 'saved')
  const [tabChosen, setTabChosen] = useState(false)
  const setTab = (t: Tab) => {
    setTabChosen(true)
    setTabState(t)
  }
  // The character loads after the window opens: show its in-game fits unless a tab was already chosen.
  useEffect(() => {
    if (active && !tabChosen) setTabState('game')
  }, [active, tabChosen])
  const [saved, setSaved] = useState<SavedFit[] | null>(null)
  const [game, setGame] = useState<{ fits?: GameFitting[]; error?: string } | null>(null)
  const activeId = active?.id
  useEffect(() => {
    if (!activeId || tab !== 'game' || game) return
    loadGameFits(activeId)
      .then((fits) => setGame({ fits }))
      .catch((e: Error) => setGame({ error: e.message }))
  }, [activeId, tab, game])
  useTypeBasics(game?.fits?.map((f) => f.ship_type_id) ?? [])
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
      {!defender && !own && <p className="muted small">Выберите корабль противника: пустой корпус, сохранённый фит или фит в формате EFT, который можно отредактировать.</p>}
      <div className="browser-tabs">
        {(
          [
            ['game', 'Фиты из игры'],
            ['saved', 'Сохранённые в Canopus'],
            ['ship', 'Корабль'],
            ['eft', 'EFT / свой фит'],
            ...(own ? [] : [['mirror', 'Зеркало']])
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
      {tab === 'game' &&
        (!active ? (
          <p className="muted small">Войдите персонажем через EVE SSO (Настройки), чтобы видеть фиты, сохранённые в игре.</p>
        ) : !game ? (
          <p className="muted small">…</p>
        ) : game.error ? (
          <p className="muted small">{`Не удалось загрузить фиты из игры: ${game.error}`}</p>
        ) : !game.fits?.length ? (
          <p className="muted small">В игре у персонажа нет сохранённых фитов.</p>
        ) : (
          <ShipFitList
            groups={groupByShip(
              game.fits,
              (f) => f.ship_type_id,
              (f) => f.name,
              lang
            )}
            fitName={(f) => f.name}
            fitKey={(f) => f.fitting_id}
            onPick={async (f) =>
              onPick({
                fit: await fromEsiItems(
                  f.ship_type_id,
                  f.name,
                  f.items.map((i) => ({ typeId: i.type_id, flag: i.flag, qty: i.quantity }))
                ),
                skills: all5
              })
            }
            lang={lang}
          />
        ))}
      {tab === 'saved' &&
        (saved === null ? (
          <p className="muted small">…</p>
        ) : !saved.length ? (
          <p className="muted small">Сохранённых фитов нет — сохраните фит в фитинге или вставьте EFT.</p>
        ) : (
          <ShipFitList
            groups={groupByShip(
              saved,
              (f) => f.shipTypeId,
              (f) => f.name,
              lang
            )}
            fitName={(f) => f.name}
            fitKey={(f) => f.id}
            onPick={(f) => onPick({ fit: f, skills: all5 })}
            lang={lang}
          />
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

/** Fits grouped by hull: click a hull to open its fits, click a fit to pick it. */
function ShipFitList<T>({
  groups,
  fitName,
  fitKey,
  onPick,
  lang
}: {
  groups: { shipTypeId: number; fits: T[] }[]
  fitName: (f: T) => string
  fitKey: (f: T) => string | number
  onPick: (f: T) => void
  lang: 0 | 1
}) {
  const [open, setOpen] = useState<Set<number>>(new Set(groups.length === 1 ? [groups[0].shipTypeId] : []))
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <ul className="combat-fit-list">
      {groups.map((g) => (
        <li key={g.shipTypeId} className="fit-ship-group">
          <div className="fit-ship-head" onClick={() => toggle(g.shipTypeId)}>
            <span className="mt-caret">{open.has(g.shipTypeId) ? '▾' : '▸'}</span>
            <img src={imageUrl.typeIcon(g.shipTypeId, 32)} width={24} height={24} alt="" />
            <ShipName id={g.shipTypeId} lang={lang} />
            <span className="muted small">{g.fits.length}</span>
          </div>
          {open.has(g.shipTypeId) &&
            g.fits.map((f) => (
              <div key={fitKey(f)} className="fit-ship-fit" onClick={() => onPick(f)} translate="no">
                {fitName(f)}
              </div>
            ))}
        </li>
      ))}
    </ul>
  )
}

function ShipName({ id, lang }: { id: number; lang: 0 | 1 }) {
  const basic = useTypeBasic(id)
  return <b className="grow">{tn(basic?.n, lang)}</b>
}

/** What undo restores: everything set up for the fight in this window. */
type Setup = ScenarioSetup

/** Keys typed into a field belong to the field (its own undo, arrows, space). */
const typing = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName))
}

const MOD = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'

/** A labelled group in a side card. */
function SideBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="combat-block">
      <div className="combat-block-title">{title}</div>
      {children}
    </section>
  )
}

function verdictOf(r: CombatResult): { text: string; cls: string } {
  const tl = r.timeline
  const share = (side: CombatSideInfo, left: Timeline['a']['left']): number => {
    const total = side.hp.shield + side.hp.armor + side.hp.hull
    return total ? Math.round(((left.s * side.hp.shield + left.a * side.hp.armor + left.h * side.hp.hull) / total) * 100) : 0
  }
  if (tl.winner === 'a') return { text: `Вы побеждаете за ${duration(tl.end)}, у вас осталось ${share(r.a, tl.a.left)}% HP`, cls: 'good' }
  if (tl.winner === 'b') return { text: `Вы проигрываете за ${duration(tl.end)}, у противника осталось ${share(r.b, tl.b.left)}% HP`, cls: 'bad' }
  if (tl.winner === 'both') return { text: `Оба погибают на ${duration(tl.end)}`, cls: '' }
  return { text: `За ${Math.round(tl.end / 60)} мин никто никого не уничтожил: у вас ${share(r.a, tl.a.left)}%, у противника ${share(r.b, tl.b.left)}%`, cls: '' }
}

const WINNER_WORD: Record<string, string> = { a: 'победа', b: 'поражение', both: 'гибнут оба', null: 'никто не погиб' }

function changeText(c: Change): string {
  switch (c.kind) {
    case 'result':
      return `было: ${WINNER_WORD[String(c.base)]}`
    case 'kill':
      return c.better ? `убийство на ${duration(c.seconds)} быстрее` : `убийство на ${duration(c.seconds)} дольше`
    case 'survive':
      return c.better ? `вы живёте на ${duration(c.seconds)} дольше` : `вы гибнете на ${duration(c.seconds)} раньше`
    case 'left':
      return `у вас остаётся ${c.now}% (было ${c.base}%)`
    case 'leftThem':
      return `у противника остаётся ${c.now}% (было ${c.base}%)`
    case 'burnt':
      return `сгорает модулей: ${c.now} (было ${c.base})`
    case 'dps':
      return `ваш урон ${c.pct > 0 ? '+' : '−'}${Math.abs(c.pct)}%`
  }
}

/**
 * The bar that stays on top while the page scrolls: the verdict, what changed against the pinned baseline,
 * and undo. Every change to the setup is judged here, without scrolling or remembering the last numbers.
 */
function CombatTop({
  r,
  changes,
  baseline,
  boosters,
  onPin,
  onUnpin,
  onBack,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onScenarios,
  better,
  onWhatIf
}: {
  r: CombatResult
  changes: Change[]
  baseline: boolean
  boosters: boolean
  onPin: () => void
  onUnpin: () => void
  onBack: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onScenarios: () => void
  /** How many single changes would make the fight better, once they are counted */
  better: number | null
  onWhatIf: () => void
}) {
  const v = verdictOf(r)
  const tl = r.timeline
  return (
    <div className="combat-top">
      <div className="combat-top-row">
        <div className={`combat-top-verdict ${v.cls}`}>{v.text}</div>
        {baseline && (
          <div className="combat-changes">
            {changes.length ? (
              changes.map((c, i) => (
                <span key={i} className={`combat-change ${c.better ? 'up' : 'down'}`}>
                  {c.better ? '▲ ' : '▼ '}
                  {changeText(c)}
                </span>
              ))
            ) : (
              <span className="combat-change">Так же, как в опорном варианте</span>
            )}
          </div>
        )}
        {!!better && (
          <button className="ghost small combat-whatif-link" title="Показать, что меняет исход" onClick={onWhatIf}>
            {`Варианты лучше: ${better} ↓`}
          </button>
        )}
        <div className="grow" />
        {baseline ? (
          <span className="combat-baseline">
            <Glyph name="bookmark" size={13} />
            <span>Опорный вариант</span>
            <button className="ghost small" title="Вернуть его сценарий" onClick={onBack}>
              Вернуть
            </button>
            <button className="ghost small" title={`Запомнить текущий вместо него (${MOD}B)`} onClick={onPin}>
              Обновить
            </button>
            <button className="ghost small icon-only" title="Убрать опорный вариант" aria-label="Убрать опорный вариант" onClick={onUnpin}>
              <Glyph name="close" size={12} />
            </button>
          </span>
        ) : (
          <button className="ghost small combat-pin" title={`Сравнивать следующие варианты с этим (${MOD}B)`} onClick={onPin}>
            <Glyph name="bookmark" size={13} /> Запомнить как опорный
          </button>
        )}
        <button className="ghost small combat-scenarios-btn" title={`Сохранить, открыть, передать сокорпу (${MOD}S)`} onClick={onScenarios}>
          <Glyph name="rows" size={13} /> Сценарии
        </button>
        <button className="ghost small icon-only" disabled={!canUndo} title={`Отменить (${MOD}Z)`} aria-label="Отменить шаг" onClick={onUndo}>
          <Glyph name="undo" size={14} />
        </button>
        <button className="ghost small icon-only" disabled={!canRedo} title={`Повторить (${MOD === '⌘' ? '⇧⌘Z' : 'Ctrl+Y'})`} aria-label="Повторить шаг" onClick={onRedo}>
          <Glyph name="redo" size={14} />
        </button>
      </div>
      {r.ifCloses && (
        <p className="warn-text small">
          {`Это держится на том, что ${Math.round(tl.b.idle * 100)}% урона противника не достаёт. Если он подойдёт: `}
          {r.ifCloses.winner === 'b' ? `поражение за ${duration(r.ifCloses.end)}` : r.ifCloses.winner === 'both' ? `оба погибают на ${duration(r.ifCloses.end)}` : r.ifCloses.winner === 'a' ? `победа за ${duration(r.ifCloses.end)}` : 'никто не погибает'}
        </p>
      )}
      {boosters && <p className="muted small">Побочные эффекты бустеров учтены только отмеченные.</p>}
    </div>
  )
}

const BEHAVIORS: [Behavior, string][] = [
  ['orbit', 'Орбита'],
  ['keep', 'Держать дистанцию'],
  ['approach', 'Сблизиться'],
  ['flee', 'Уходить'],
  ['stop', 'Стоять'],
  ['free', 'Курс с карты']
]

function OrdersBox({ behavior, range, distance, onChange }: { behavior: Behavior; range?: number; distance: number; onChange: (b: Behavior, range: number | undefined) => void }) {
  const ranged = behavior === 'orbit' || behavior === 'keep' || behavior === 'approach'
  return (
    <div className="calc-form">
      <label>
        <select value={behavior} onChange={(e) => onChange(e.target.value as Behavior, undefined)}>
          {BEHAVIORS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {ranged && (
        <label>
          Дистанция, км
          <input type="number" min={0} step={0.5} value={(range ?? distance) / 1000} onChange={(e) => onChange(behavior, Math.max(0, Number(e.target.value) || 0) * 1000)} />
        </label>
      )}
    </div>
  )
}

/** Boosters for one side of the fight, folded away until wanted. */
function Boosters({ fit, skills, onChange, note, onReset }: { fit: FitSpec; skills: SkillSource; onChange: (fit: FitSpec) => void; note?: string; onReset?: () => void }) {
  const count = fit.boosters?.length ?? 0
  const [open, setOpen] = useState(count > 0)
  useEffect(() => {
    if (count > 0) setOpen(true)
  }, [count])
  return (
    <div className="combat-boosters">
      <button className="ghost small combat-boosters-toggle" onClick={() => setOpen((x) => !x)}>
        <Glyph name="flame" size={13} /> Бустеры{count ? ` · ${count}` : ''}
      </button>
      {open && (
        <>
          <p className="muted small">Действуют с первой секунды боя.</p>
          <BoosterPanel fit={fit} skills={skills} onChange={onChange} compact />
          {note && (
            <p className="muted small">
              {note}{' '}
              {onReset && (
                <button className="ghost small" onClick={onReset}>
                  Вернуть как в фите
                </button>
              )}
            </p>
          )}
        </>
      )}
    </div>
  )
}

/** A module of a fit by its index: its name. */
function ModuleName({ fit, index }: { fit?: FitSpec; index: number }) {
  const lang = useLang()
  const t = useTypeBasic(fit?.modules[index]?.typeId ?? 0)
  return t ? <span translate="no">{`: ${tn(t.n, lang)}`}</span> : null
}

const HEAT_LABEL: Record<HeatPolicy, string> = {
  off: 'Без перегрева',
  safe: 'Перегрев, снимать вовремя',
  burn: 'Перегрев до выгорания'
}

/**
 * How a side overheats: not at all, until a module of the rack is worn to 60% and then off (how pilots pulse heat),
 * or until things burn out. With what the fight did to its modules.
 */
function HeatPicker({ info, value, onChange, outcome, fit }: { info: CombatSideInfo; value?: HeatPolicy; onChange: (v: HeatPolicy) => void; outcome?: CombatResult['timeline']['a']['heat']; fit?: FitSpec }) {
  if (!info.heatable) return null
  const v = value ?? (info.fittedHot ? 'burn' : 'off')
  const burnt = outcome?.modules.filter((m) => m.burnt !== null) ?? []
  const worn = outcome?.modules.filter((m) => m.burnt === null && m.damage >= m.hp * 0.25) ?? []
  return (
    <div className="combat-heat">
      <div className={`combat-heat-row${v === 'off' ? '' : ' hot'}`}>
        <Glyph name="flame" size={13} />
        <select aria-label="Перегрев модулей" title="Перегрев модулей" value={v} onChange={(e) => onChange(e.target.value as HeatPolicy)}>
          {(['off', 'safe', 'burn'] as const).map((k) => (
            <option key={k} value={k}>
              {HEAT_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      {outcome && v !== 'off' && (
        <p className="muted small">
          {`Нагрев стоек до ${Math.round(outcome.peak * 100)}%`}
          {burnt.length > 0 && <span className="bad">{` · сгорело: ${burnt.length}`}</span>}
          {worn.length > 0 && ` · повреждено: ${worn.length}`}
        </p>
      )}
      {burnt.length > 0 && (
        <ul className="combat-effects">
          {burnt.map((m) => (
            <li key={m.index} className="small">
              <span className="bad">{`${duration(m.burnt ?? 0)}`}</span>
              <ModuleName fit={fit} index={m.index} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Command bursts on a side for the fight: a booster's hull and bursts, or saved booster fits. */
function FleetBoosts({ fit, onChange, note, onReset }: { fit: FitSpec; onChange: (fit: FitSpec) => void; note?: string; onReset?: () => void }) {
  const count = (fit.fleet?.bursts.length ?? 0) + (fit.boosterFits?.length ?? 0)
  const [open, setOpen] = useState(count > 0)
  useEffect(() => {
    if (count > 0) setOpen(true)
  }, [count])
  return (
    <div className="combat-boosters">
      <button className="ghost small combat-boosters-toggle" onClick={() => setOpen((x) => !x)}>
        <Glyph name="fleet" size={13} /> Флотские бонусы{count ? ` · ${count}` : ''}
      </button>
      {open && (
        <>
          <p className="muted small">Командные пачки бустера флота: действуют весь бой.</p>
          <FleetPanel fit={fit} onChange={onChange} />
          {note && (
            <p className="muted small">
              {note}{' '}
              {onReset && (
                <button className="ghost small" onClick={onReset}>
                  Вернуть как в фите
                </button>
              )}
            </p>
          )}
        </>
      )}
    </div>
  )
}

const EVENT_TEXT: Record<TimelineEvent['kind'], string> = {
  shieldDown: 'Щит пробит',
  armorDown: 'Броня пробита',
  dead: 'Уничтожен',
  capEmpty: 'Накопитель пуст: модули встают',
  reload: 'Оружие ушло на перезарядку',
  repReload: 'Ремонтник ушёл на перезарядку',
  propBlocked: 'MWD выключен скрамблером',
  lostRange: 'Цель вне досягаемости оружия',
  backInRange: 'Цель снова в досягаемости',
  adcOn: 'Включён Assault Damage Control',
  locked: 'Цель захвачена',
  lockLost: 'Цель вне дальности захвата',
  capBoosterReload: 'Бустер накопителя ушёл на перезарядку',
  burnout: 'Модуль сгорел от перегрева',
  heatOff: 'Перегрев снят: модули стойки на пределе'
}

/** The whole body as a share of the ship: shield, armor and hull weighed by their hit points. */
const toughness = (side: CombatSideInfo, p: TimelinePoint['a']): number => {
  const total = side.hp.shield + side.hp.armor + side.hp.hull
  return total ? ((p.s * side.hp.shield + p.a * side.hp.armor + p.h * side.hp.hull) / total) * 100 : 0
}

function resultText(r: Rated): string {
  if (r.winner === 'a') return `победа за ${duration(r.end)}, останется ${Math.round(r.leftA * 100)}%`
  if (r.winner === 'b') return `поражение за ${duration(r.end)}, у противника останется ${Math.round(r.leftB * 100)}%`
  if (r.winner === 'both') return `оба погибают на ${duration(r.end)}`
  return `никто не погибает: у вас ${Math.round(r.leftA * 100)}%, у противника ${Math.round(r.leftB * 100)}%`
}

const resultClass = (r: Rated): string => (r.winner === 'a' ? 'good' : r.winner === 'b' ? 'bad' : '')

const DAMAGE_NAMES = ['ЭМ', 'термика', 'кинетика', 'взрыв']

const OUTCOME_WORD: Record<OutcomeKind, string> = { win: 'выигрыш', lose: 'проигрыш', both: 'оба гибнут', draw: 'ничья', idle: 'не достают' }
const OUTCOME_LEGEND: Record<OutcomeKind, string> = {
  win: 'выигрыш',
  lose: 'проигрыш',
  both: 'оба гибнут',
  draw: 'ничья: оба живы',
  idle: 'не достают друг до друга'
}

/** How the same setup ends from every starting distance; a click puts that distance on the map. */
function OutcomeStrip({ x, distance, onDistance }: { x: CombatExplore; distance: number; onDistance: (d: number) => void }) {
  const bands = outcomeBands(x.byDistance)
  const max = x.byDistance[x.byDistance.length - 1]?.distance ?? 1
  const pct = (d: number) => `${Math.max(0, Math.min(100, (d / max) * 100))}%`
  const ticks = distanceTicks(max)
  return (
    <Card title="Исход по дистанции старта">
      <div
        className="combat-strip"
        title="Клик ставит эту дистанцию на карту"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const d = ((e.clientX - rect.left) / rect.width) * max
          onDistance(Math.max(500, Math.round(d / 100) * 100))
        }}
      >
        {bands.map((b, i) => {
          const from = i === 0 ? 0 : b.from
          const w = ((b.to - from) / max) * 100
          return (
            <div key={i} className={`combat-band ${b.kind}`} style={{ left: pct(from), width: `${w}%` }} title={`${km(from)} – ${km(b.to)}: ${translate(OUTCOME_WORD[b.kind])}`}>
              {w > 9 ? OUTCOME_WORD[b.kind] : ''}
            </div>
          )
        })}
        <div className="combat-strip-now" style={{ left: pct(distance) }} />
      </div>
      <div className="combat-strip-axis muted small">
        {ticks.map((t) => (
          <span key={t} style={{ left: pct(t) }}>
            {km(t)}
          </span>
        ))}
      </div>
      <div className="combat-strip-legend muted small">
        {(['win', 'lose', 'both', 'draw', 'idle'] as OutcomeKind[])
          .filter((k) => bands.some((b) => b.kind === k))
          .map((k) => (
            <span key={k}>
              <i className={`combat-band-key ${k}`} />
              {OUTCOME_LEGEND[k]}
            </span>
          ))}
        <span className="combat-strip-now-key">текущая дистанция</span>
      </div>
    </Card>
  )
}

const SCENARIOS_KEY = 'canopus.combatScenarios'

function loadScenarios(): SavedScenario[] {
  try {
    const v = JSON.parse(localStorage.getItem(SCENARIOS_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? (v as SavedScenario[]) : []
  } catch {
    return []
  }
}

/**
 * Scenarios: the current one saved under a name, the saved ones to open again, and one line of text to send a
 * corpmate (it carries both fits and the whole setup) or to open what a corpmate sent.
 */
function ScenarioPanel({ current, onOpen, onClose }: { current: () => SavedScenario | null; onOpen: (s: SavedScenario) => void; onClose: () => void }) {
  const [list, setList] = useState<SavedScenario[]>(loadScenarios)
  const [name, setName] = useState('')
  const [paste, setPaste] = useState('')
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const keep = (next: SavedScenario[]) => {
    setList(next)
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(next))
  }
  const save = () => {
    const s = current()
    if (!s || !name.trim()) return
    keep(addScenario(list, { ...s, name: name.trim() }))
    setName('')
    setNote({ text: `Сохранён: ${name.trim()}` })
  }
  const copy = (s: SavedScenario) => {
    void navigator.clipboard.writeText(encodeScenario(s)).then(
      () => setNote({ text: 'Строка сценария скопирована: её можно вставить в чат или письмо' }),
      () => setNote({ text: 'Не удалось скопировать', bad: true })
    )
  }
  const openPasted = () => {
    const s = decodeScenario(paste)
    if (!s) return setNote({ text: 'Это не строка сценария Canopus.', bad: true })
    setPaste('')
    onOpen(s)
  }
  return (
    <div className="combat-scenarios">
      <div className="combat-scenarios-head">
        <b>Сценарии</b>
        <button className="ghost small icon-only" aria-label="Закрыть" title="Закрыть" onClick={onClose}>
          <Glyph name="close" size={12} />
        </button>
      </div>
      <form
        className="combat-scenarios-save"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название сценария" title="Например: «Рифтер против Мерлина в упор»" autoFocus />
        <button type="submit" disabled={!name.trim() || !current()}>
          Сохранить текущий
        </button>
      </form>
      {note && <p className={`small ${note.bad ? 'bad' : 'muted'}`}>{note.text}</p>}
      <div className="combat-block-title">Сохранённые</div>
      {list.length === 0 ? (
        <p className="muted small">Сохранённых сценариев пока нет.</p>
      ) : (
        <ul className="combat-scenarios-list">
          {list.map((s) => (
            <li key={s.name}>
              <button className="combat-scenario-open" title="Открыть" onClick={() => onOpen(s)}>
                <span translate="no">{s.name}</span>
                <span className="muted small">{new Date(s.savedAt).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })}</span>
              </button>
              <button className="ghost small icon-only" title="Копировать строкой" aria-label="Копировать строкой" onClick={() => copy(s)}>
                <Glyph name="copy" size={13} />
              </button>
              <button className="ghost small icon-only" title="Удалить" aria-label="Удалить" onClick={() => keep(removeScenario(list, s.name))}>
                <Glyph name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="combat-block-title">От сокорпа</div>
      <div className="combat-scenarios-paste">
        <input value={paste} onChange={(e) => setPaste(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && paste.trim() && openPasted()} placeholder="Вставьте строку canopus-sim:…" />
        <button disabled={!paste.trim()} onClick={openPasted}>
          Открыть
        </button>
      </div>
    </div>
  )
}

/** How a fight ends, said short: what a lever turns the fight into. */
function outcomeText(f: FightSummary): string {
  if (f.winner === 'a') return `победа за ${duration(f.end)}`
  if (f.winner === 'b') return `поражение за ${duration(f.end)}`
  if (f.winner === 'both') return `оба погибают на ${duration(f.end)}`
  return 'никто не погибает'
}

/** Round ticks for a distance axis: 1, 2, 2.5 or 5 times a power of ten, four to six of them. */
function distanceTicks(max: number): number[] {
  const raw = max / 5
  const p = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let t = 0; t <= max + 1; t += step) out.push(t)
  return out
}

function LeverLabel({ l }: { l: Lever }) {
  const lang = useLang()
  const prop = useTypeBasic(l.kind === 'prop' ? l.typeId : 0)
  if (l.kind === 'ammo')
    return (
      <span>
        <ChargeName id={l.charge} /> <span className="muted">вместо</span> <ChargeName id={l.from} />
      </span>
    )
  if (l.kind === 'heat') return <span>{HEAT_LABEL[l.policy]}</span>
  if (l.kind === 'prop')
    return (
      <span>
        {l.on ? 'Включить' : 'Выключить'} <span translate="no">{tn(prop?.n, lang)}</span>
      </span>
    )
  return <span>{l.behavior === 'orbit' ? `Орбита ${km(l.range)}` : `Держать ${km(l.range)}`}</span>
}

/** Each single change of your side, tried on its own: the strongest first, then what not to do. A click applies it. */
function LeverList({ x, onApply, children }: { x: CombatExplore | null; onApply: (l: Lever) => void; children?: React.ReactNode }) {
  const ranked = x ? rankLevers(x.levers) : []
  const top = Math.max(0.001, ...ranked.map((l) => Math.abs(l.delta)))
  return (
    <Card title="Что сильнее всего меняет исход" className="combat-levers-card">
      {!x ? (
        <p className="muted small">Считаю варианты…</p>
      ) : ranked.length === 0 ? (
        <p className="muted small">Ни одно отдельное изменение заметно не меняет исход.</p>
      ) : (
        <div className="combat-levers">
          <div className="combat-lever combat-lever-head muted small">
            <span>Изменение</span>
            <span>Насколько сильно</span>
            <span>Чем кончится бой</span>
          </div>
          {ranked.map((l, i) => {
            const shown = explainChange(compareFights(x!.current, l.summary), l.delta > 0)
            const effect =
              shown[0]?.kind === 'result'
                ? outcomeText(l.summary)
                : shown.length
                  ? shown.map((c, k) => (
                      <span key={k}>
                        {k > 0 && <span>{', но '}</span>}
                        <span>{changeText(c)}</span>
                      </span>
                    ))
                  : l.delta > 0
                    ? 'чуть лучше'
                    : 'чуть хуже'
            return (
              <button key={i} className={`combat-lever ${l.delta > 0 ? 'up' : 'down'}`} title="Применить" onClick={() => onApply(l.lever)}>
                <span className="combat-lever-name">
                  <LeverLabel l={l.lever} />
                </span>
                <span className="combat-lever-bar">
                  <span style={{ width: `${(Math.abs(l.delta) / top) * 100}%` }} />
                </span>
                <span className="combat-lever-effect">{effect}</span>
              </button>
            )
          })}
        </div>
      )}
      {x && <p className="muted small">{`Каждое изменение пробуется отдельно, остальное как задано. Проверено боёв: ${x.tried}`}</p>}
      {children}
    </Card>
  )
}

function ChargeName({ id }: { id: number }) {
  const lang = useLang()
  const t = useTypeBasic(id)
  return (
    <span translate="no" className="nowrap">
      {tn(t?.n, lang)}
    </span>
  )
}

function ProblemLine({ p }: { p: Problem }) {
  const lang = useLang()
  const weapon = useTypeBasic(p.code === 'application' ? p.typeId : 0)
  switch (p.code) {
    case 'application':
      return (
        <>
          <span translate="no">{tn(weapon?.n, lang)}</span> {`попадает лишь на ${p.percent}%, мешает: ${translate(p.limit)}`}
        </>
      )
    case 'weakResist':
      return <>{`Основной урон противника: ${translate(DAMAGE_NAMES[p.damage])}, ${p.share}%. ${translate(LAYER_NAMES[p.layer])} держит этот тип только на ${p.resist}%.`}</>
    case 'capEmpty':
      return <>{`Накопитель пустеет на ${duration(p.t)}: модули встают.`}</>
    case 'propBlocked':
      return <>{`MWD выключается скрамблером на ${duration(p.t)}.`}</>
    case 'lostRange':
      return <>{`Цель уходит из досягаемости на ${duration(p.t)}.`}</>
    case 'reload':
      return <>{`Оружие уходит на перезарядку на ${duration(p.t)}, урон в этот момент падает.`}</>
    case 'outgunned':
      return <>{`Противник наносит больше: ${p.theirs} DPS против ваших ${p.mine}.`}</>
    case 'lessTank':
      return <>{`У противника больше EHP: ${p.theirs.toLocaleString(locale())} против ваших ${p.mine.toLocaleString(locale())}.`}</>
  }
}

/** Tries the options by fighting them; only on request, and forgotten when the setup changes. */
function AdviceCard({ you, defender, sc, onApply }: { you: CombatPilot; defender: CombatPilot; sc: CombatScenario; onApply: (c: Candidate) => void }) {
  const [state, setState] = useState<{ advice?: CombatAdvice; busy?: boolean; error?: string }>({})
  const key = JSON.stringify([you.fit, defender.fit, sc])
  // Each search has a number; an answer for a setup that has since changed is dropped.
  const search = useRef(0)
  useEffect(() => {
    search.current++
    setState({})
  }, [key])
  const run = () => {
    const mine = ++search.current
    setState({ busy: true })
    window.api.combat.advise(you, defender, sc).then(
      (advice) => mine === search.current && setState({ advice }),
      (e: Error) => mine === search.current && setState({ error: e.message })
    )
  }
  const a = state.advice
  const ammoChanged = a ? Object.entries(a.best.candidate.ammo).filter(([id, charge]) => a.current.candidate.ammo[Number(id)] !== charge) : []
  const flying = (c: Candidate) => `${translate(c.behavior === 'orbit' ? 'Орбита' : 'Держать дистанцию')}, ${km(c.range)}`
  return (
    <div className="combat-advice">
      <div className="combat-advice-title">Лучшее сочетание</div>
      <div className="row">
        <button className="nowrap" onClick={run} disabled={!!state.busy}>
          {state.busy ? 'Перебираю варианты…' : 'Подобрать сочетание'}
        </button>
        <span className="muted small">Дистанция, боеприпасы и MWD/AB вместе, а не по одному. Противник ведёт себя так, как задано в его карточке.</span>
      </div>
      {state.error && <p className="warn-text small">{state.error}</p>}
      {a && (
        <>
          {a.alreadyBest ? (
            <p>
              <b>Лучше текущего варианта не нашлось.</b> <span className={resultClass(a.current)}>{resultText(a.current)}</span>
            </p>
          ) : (
            <>
              <p>
                <b>{flying(a.best.candidate)}</b>
                {ammoChanged.map(([id, charge]) => (
                  <span key={id}>
                    {' · '}
                    <ChargeName id={charge} />
                  </span>
                ))}
                {a.best.candidate.prop !== a.current.candidate.prop && (
                  <>
                    {' · '}
                    <span>{a.best.candidate.prop ? 'включить MWD/AB' : 'выключить MWD/AB'}</span>
                  </>
                )}
              </p>
              <p className="small">
                <span className={resultClass(a.best)}>{resultText(a.best)}</span>
                <span className="muted">
                  {' · '}
                  <span>сейчас:</span> <span>{resultText(a.current)}</span>
                </span>
              </p>
              <button className="ghost small" onClick={() => onApply(a.best.candidate)}>
                Применить
              </button>
            </>
          )}
          {a.best.winner !== 'a' && <p className="warn-text small">Если противник ведёт себя так, среди проверенных дистанций, зарядов и режимов MWD/AB победы нет. Что мешает, смотрите ниже.</p>}
          <table className="table compact">
            <tbody>
              <tr>
                <td className="muted small">Если противник пойдёт в ближний бой</td>
                <td className={resultClass(a.ifOpponent.rushes)}>{resultText(a.ifOpponent.rushes)}</td>
              </tr>
              <tr>
                <td className="muted small">{`Если противник будет держаться на ${km(a.ifOpponent.kiteRange)}`}</td>
                <td className={resultClass(a.ifOpponent.kites)}>{resultText(a.ifOpponent.kites)}</td>
              </tr>
              {a.alternatives.map((r, i) => (
                <tr key={i}>
                  <td className="muted small">{`Ещё вариант: ${flying(r.candidate)}`}</td>
                  <td className={resultClass(r)}>{resultText(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {a.problems.length > 0 && (
            <>
              <div className="muted small">Что мешает сейчас</div>
              <ul className="combat-effects">
                {a.problems.map((p, i) => (
                  <li key={i}>
                    <ProblemLine p={p} />
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted small">{`Проверено боёв: ${a.tried}. Фит не меняется: совет только про то, как лететь и чем стрелять. Навыки к боеприпасам не проверяются.`}</p>
        </>
      )}
    </div>
  )
}

/** Left and right margins of the fight charts, as a share of their width: the event lane lines up with them. */
const CHART_W = 900
const CHART_PAD = { l: 96, r: 16 }
const laneX = (t: number, span: number) => `${((CHART_PAD.l + (t / span) * (CHART_W - CHART_PAD.l - CHART_PAD.r)) / CHART_W) * 100}%`

/** The events worth a mark on the lane; the rest are in the log. */
const LANE_EVENTS = new Set<TimelineEvent['kind']>(['locked', 'shieldDown', 'armorDown', 'dead', 'burnout', 'heatOff', 'capEmpty', 'propBlocked', 'adcOn', 'lostRange'])

/** What a mark on the lane means, short, for the legend under it. */
const LANE_SHORT: Partial<Record<TimelineEvent['kind'], string>> = {
  locked: 'цель захвачена',
  shieldDown: 'щит пробит',
  armorDown: 'броня пробита',
  dead: 'уничтожен',
  burnout: 'модуль сгорел',
  heatOff: 'перегрев снят',
  capEmpty: 'накопитель пуст',
  propBlocked: 'MWD выключен',
  adcOn: 'включён ADC',
  lostRange: 'цель вне досягаемости'
}

function EventMark({ e }: { e: TimelineEvent }) {
  if (e.kind === 'shieldDown') return <AttrIcon attr={LAYER_ICONS.shield} size={14} />
  if (e.kind === 'armorDown') return <AttrIcon attr={LAYER_ICONS.armor} size={14} />
  const glyph = e.kind === 'locked' ? 'lock' : e.kind === 'dead' ? 'close' : e.kind === 'burnout' || e.kind === 'heatOff' ? 'flame' : e.kind === 'capEmpty' ? 'bolt' : e.kind === 'adcOn' ? 'star' : 'alert'
  return <Glyph name={glyph} size={12} />
}

/** The fight's events on a time lane, one row per side; a click goes to that moment on the map. */
function EventLane({ r, cursor, onSeek }: { r: CombatResult; cursor: number | null; onSeek: (t: number) => void }) {
  const tl = r.timeline
  const span = Math.max(1, tl.end)
  const events = tl.events.filter((e) => LANE_EVENTS.has(e.kind))
  // The marks are icons: what each one means, for the kinds on the lane, in the order they first happen.
  const kinds = events.filter((e, i) => events.findIndex((x) => x.kind === e.kind) === i)
  return (
    <div className="combat-lane">
      {(['a', 'b'] as const).map((side) => (
        <div key={side} className={`combat-lane-row side-${side}`}>
          <span className="combat-lane-label">{side === 'a' ? 'Вы' : 'Противник'}</span>
          {events
            .filter((e) => e.side === side)
            .map((e, i) => (
              <button
                key={i}
                className={`combat-lane-mark ${e.kind}`}
                style={{ left: laneX(e.t, span) }}
                title={`${translate(duration(e.t))}: ${translate(EVENT_TEXT[e.kind])}`}
                aria-label={translate(EVENT_TEXT[e.kind])}
                onClick={() => onSeek(e.t)}
              >
                <EventMark e={e} />
              </button>
            ))}
        </div>
      ))}
      {cursor !== null && <div className="combat-lane-cursor" style={{ left: laneX(cursor, span) }} />}
      {kinds.length > 0 && (
        <div className="combat-lane-legend muted small">
          {kinds.map((e) => (
            <span key={e.kind}>
              <span className={`combat-lane-key ${e.kind}`}>
                <EventMark e={e} />
              </span>
              {LANE_SHORT[e.kind]}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * How the fight goes, on the same time line as the map: hovering shows that moment on the map, a click stays
 * there. The pinned baseline is drawn dashed under it. Flat rows (a distance that never changes) fold away.
 */
function FightCharts({ r, base, cursor, onPreview, onSeek }: { r: CombatResult; base?: CombatResult; cursor: number | null; onPreview: (t: number | null) => void; onSeek: (t: number) => void }) {
  const tl = r.timeline
  const [hover, setHover] = useState<number | null>(null)
  const pts = tl.series
  const at = hover !== null ? pts[Math.min(hover, pts.length - 1)] : null
  const span = Math.max(1, tl.end, base?.timeline.end ?? 0)
  const dist = pts.map((p) => p.distance / 1000)
  const flatDistance = dist.length > 0 && Math.max(...dist) - Math.min(...dist) < Math.max(0.05, Math.max(...dist) * 0.01)
  // A capacitor that stays high (never below 70% while the ship is alive) looks flat on a short chart: its lowest
  // point is said in a line instead.
  const lowCap = (side: 'a' | 'b') => Math.min(1, ...pts.filter((p) => p[side].h > 0).map((p) => p[side].c))
  const capLow = { a: lowCap('a'), b: lowCap('b') }
  const flatCap = pts.length > 0 && capLow.a > 0.7 && capLow.b > 0.7
  const rows = useMemo(() => {
    const bp = base?.timeline.series
    return [
      {
        title: 'Прочность, %',
        a: pts.map((p) => toughness(r.a, p.a)),
        b: pts.map((p) => toughness(r.b, p.b)),
        base: base && bp ? { pts: bp, a: bp.map((p) => toughness(base.a, p.a)), b: bp.map((p) => toughness(base.b, p.b)) } : undefined,
        max: 100,
        fmt: (v: number) => `${Math.round(v)}%`,
        height: 120
      },
      ...(flatCap ? [] : [{ title: 'Накопитель, %', a: pts.map((p) => p.a.c * 100), b: pts.map((p) => p.b.c * 100), max: 100, fmt: (v: number) => `${Math.round(v)}%`, height: 56 }]),
      ...(pts.some((p) => p.a.heat !== undefined || p.b.heat !== undefined)
        ? [{ title: 'Нагрев стойки, %', a: pts.map((p) => (p.a.heat ?? 0) * 100), b: pts.map((p) => (p.b.heat ?? 0) * 100), max: 100, fmt: (v: number) => `${Math.round(v)}%`, height: 56 }]
        : []),
      ...(flatDistance ? [] : [{ title: 'Дистанция, км', a: dist, b: null, max: Math.max(1, ...dist), fmt: (v: number) => n1(v), height: 56 }])
    ]
  }, [pts, r.a, r.b, base, dist, flatDistance, flatCap])
  const show = (i: number | null) => {
    setHover(i)
    onPreview(i === null ? null : pts[Math.min(i, pts.length - 1)].t)
  }
  return (
    <div className="combat-chart">
      {rows.map((row, i) => (
        <FightRow key={row.title} row={row} pts={pts} span={span} end={tl.end} hover={hover} setHover={show} cursor={cursor} onSeek={onSeek} events={i === 0 ? tl.events.filter((e) => e.kind === 'shieldDown' || e.kind === 'armorDown' || e.kind === 'dead') : []} />
      ))}
      {(flatDistance || flatCap) && (
        <div className="muted small combat-flat">
          {flatDistance && dist.length > 0 && <span>{`Дистанция не меняется: ${km(dist[0] * 1000)}`}</span>}
          {flatCap && <span>{`Накопитель не ниже: у вас ${Math.floor(capLow.a * 100)}%, у противника ${Math.floor(capLow.b * 100)}%`}</span>}
        </div>
      )}
      <div className="combat-legend">
        <span className="legend-a">Вы</span>
        <span className="legend-b">Противник</span>
        {base && <span className="legend-base">Опорный вариант</span>}
        {at && <span className="muted small">{`${duration(at.t)} · ${Math.round(toughness(r.a, at.a))}% / ${Math.round(toughness(r.b, at.b))}% · ${km(at.distance)} · ${n1(at.a.v)} / ${n1(at.b.v)} м/с`}</span>}
      </div>
    </div>
  )
}

/** Every event of the fight in a list, folded away: the lane above shows the important ones. */
function FightLog({ r, fits, onSeek }: { r: CombatResult; fits: { a: FitSpec; b: FitSpec }; onSeek: (t: number) => void }) {
  const tl = r.timeline
  if (!tl.events.length && !tl.a.armorResist && !tl.b.armorResist) return null
  return (
    <details className="combat-log">
      <summary className="muted small">{`Журнал боя · ${tl.events.length}`}</summary>
      {tl.a.armorResist && <RahLine who="Вы" resist={tl.a.armorResist} />}
      {tl.b.armorResist && <RahLine who="Противник" resist={tl.b.armorResist} />}
      <table className="table compact combat-events">
        <tbody>
          {tl.events.map((e, i) => (
            <tr key={i} onClick={() => onSeek(e.t)}>
              <td className="muted small">{duration(e.t)}</td>
              <td className={e.side === 'a' ? 'legend-a' : 'legend-b'}>{e.side === 'a' ? 'Вы' : 'Противник'}</td>
              <td>
                {EVENT_TEXT[e.kind]}
                {e.kind === 'burnout' && e.index !== undefined && <ModuleName fit={e.side === 'a' ? fits.a : fits.b} index={e.index} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/** How to work the simulator: the hints and the keys, folded away once learned. */
function Shortcuts() {
  return (
    <details className="combat-help">
      <summary className="muted small">Подсказки и клавиши</summary>
      <ul className="muted small">
        <li>На карте тяните противника и концы стрелок скорости.</li>
        <li>Наведите на график — корабли на карте покажут этот момент; клик оставит его.</li>
        <li>Прочность — доля HP без учёта резистов.</li>
        <li>Клик по полосе исходов ставит эту дистанцию на карту; клик по изменению применяет его.</li>
      </ul>
    <div className="combat-keys muted small">
      <span>
        <kbd>Пробел</kbd> пуск и пауза
      </span>
      <span>
        <kbd>←</kbd>
        <kbd>→</kbd> шаг 1 с, с Shift — 10 с
      </span>
      <span>
        <kbd>{`${MOD}Z`}</kbd> отменить
      </span>
      <span>
        <kbd>{`${MOD}B`}</kbd> запомнить как опорный
      </span>
      <span>
        <kbd>{`${MOD}S`}</kbd> сценарии
      </span>
    </div>
    </details>
  )
}

/** Where a Reactive Armor Hardener's armor resists ended up by the end of the fight. */
function RahLine({ who, resist }: { who: string; resist: number[] }) {
  return (
    <p className="small">
      <span className="muted">{who}</span> <span>{'· Reactive Armor Hardener, резисты брони к концу боя:'}</span>{' '}
      {resist.map((r, i) => (
        <span key={i} className="with-icon" style={{ marginRight: 10 }}>
          <AttrIcon attr={RESIST_ICONS[i]} size={14} />
          {`${Math.round(r * 100)}%`}
        </span>
      ))}
    </p>
  )
}

type ChartRow = {
  title: string
  a: number[]
  b: number[] | null
  /** The baseline fight, on its own time points. */
  base?: { pts: TimelinePoint[]; a: number[]; b: number[] }
  max: number
  fmt: (v: number) => string
  height: number
}

function FightRow({ row, pts, span, end, hover, setHover, cursor, onSeek, events }: { row: ChartRow; pts: TimelinePoint[]; span: number; end: number; hover: number | null; setHover: (i: number | null) => void; cursor: number | null; onSeek: (t: number) => void; events: TimelineEvent[] }) {
  const W = CHART_W
  const H = row.height
  const pad = { ...CHART_PAD, t: 8, b: 16 }
  const x = (t: number) => pad.l + (t / span) * (W - pad.l - pad.r)
  const y = (v: number) => H - pad.b - (Math.min(v, row.max) / (row.max || 1)) * (H - pad.t - pad.b)
  const path = (vals: number[], at: TimelinePoint[] = pts) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(at[i].t).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  // Two sides on the same line (a mirror fight): the second one dashed, so both show.
  const same = !!row.b && row.a.every((v, i) => Math.abs(v - (row.b as number[])[i]) < 0.5)
  const timeAt = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
    return ((((e.clientX - rect.left) / rect.width) * W - pad.l) / (W - pad.l - pad.r)) * span
  }
  return (
    <div>
      <div className="muted small">{row.title}</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const t = timeAt(e)
          let best = 0
          pts.forEach((p, i) => {
            if (Math.abs(p.t - t) < Math.abs(pts[best].t - t)) best = i
          })
          setHover(best)
        }}
        onClick={(e) => onSeek(Math.max(0, Math.min(end, timeAt(e))))}
      >
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="grid" />
        <line x1={pad.l} x2={W - pad.r} y1={y(row.max)} y2={y(row.max)} className="grid" />
        <text x={pad.l - 6} y={y(row.max) + 4} textAnchor="end">
          {row.fmt(row.max)}
        </text>
        <text x={pad.l - 6} y={y(0) + 4} textAnchor="end">
          {row.fmt(0)}
        </text>
        <text x={x(end)} y={H - 3} textAnchor="end">
          {duration(end)}
        </text>
        {row.base && <path d={path(row.base.a, row.base.pts)} className="line-base line-base-a" />}
        {row.base && <path d={path(row.base.b, row.base.pts)} className="line-base line-base-b" />}
        <path d={path(row.a)} className="line-a" />
        {row.b && <path d={path(row.b)} className={`line-b${same ? ' same' : ''}`} />}
        {events.map((e, i) => {
          const near = pts.reduce((best, p, j) => (Math.abs(p.t - e.t) < Math.abs(pts[best].t - e.t) ? j : best), 0)
          return (
            <circle key={i} cx={x(e.t)} cy={y((e.side === 'a' ? row.a : row.b ?? row.a)[near])} r={4} className={`ev-dot-${e.side}`}>
              <title>{`${duration(e.t)}: ${translate(EVENT_TEXT[e.kind])}`}</title>
            </circle>
          )
        })}
        {cursor !== null && <line x1={x(cursor)} x2={x(cursor)} y1={pad.t} y2={H - pad.b} className="marker" />}
        {hover !== null && pts[hover] && <line x1={x(pts[hover].t)} x2={x(pts[hover].t)} y1={pad.t} y2={H - pad.b} className="marker hover" />}
      </svg>
    </div>
  )
}

function DirectionCard({ title, d, cls, average }: { title: string; d: CombatDirection; cls: string; average: number }) {
  const lang = useLang()
  useTypeBasics(d.weapons.flatMap((w) => [w.typeId, w.chargeTypeId ?? 0]).filter(Boolean))
  const pct = d.paperDps ? (d.applied / d.paperDps) * 100 : 0
  return (
    <Card title={title} className={`combat-direction ${cls}`}>
      <div className="big-stats">
        <div>
          <b>
            <CountUp value={d.applied} format={n1} />
          </b>
          <span>{`DPS на старте из ${n1(d.paperDps)} (${fixed(pct, 0)}%)`}</span>
        </div>
      </div>
      <div className="muted small">{`В среднем за бой: ${n1(average)} DPS после резистов`}</div>
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
      <td className={`num ${w.factor < 0.5 ? 'bad' : w.factor < 0.9 ? 'warn-text' : 'good'}`}>{`${fixed(w.factor * 100, 0)}%`}</td>
      <td className="muted small">
        {w.limit ?? ''}
        {w.spoolMax ? <div>{`раскрутка до ×${(1 + w.spoolMax).toLocaleString(locale(), { maximumFractionDigits: 2 })}`}</div> : null}
      </td>
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


/** Ammo for every kind of weapon on a fit: one picker per module type (all identical guns load the same). */
function AmmoPanel({ fit, onCharge, note, onReset }: { fit: FitSpec; onCharge: (moduleTypeId: number, chargeTypeId: number | undefined) => void; note?: string; onReset?: () => void }) {
  const lang = useLang()
  const [catalog, setCatalog] = useState<Map<number, FittableType> | null>(null)
  useEffect(() => {
    void loadCatalog().then(setCatalog)
  }, [])
  const groups = useMemo(() => {
    const m = new Map<number, { count: number; charge?: number }>()
    for (const mod of fit.modules) {
      if (!catalog?.get(mod.typeId)?.charges) continue
      const g = m.get(mod.typeId) ?? { count: 0, charge: mod.chargeTypeId }
      g.count++
      m.set(mod.typeId, g)
    }
    return [...m.entries()]
  }, [fit, catalog])
  if (!groups.length) return null
  return (
    <div className="ammo-panel">
      <div className="ammo-title">
        <span>Боеприпасы</span>
        {onReset && (
          <button className="ghost small" onClick={onReset}>
            Как в фитинге
          </button>
        )}
      </div>
      {groups.map(([moduleId, g]) => (
        <AmmoRow key={moduleId} moduleId={moduleId} count={g.count} charge={g.charge} lang={lang} onCharge={(c) => onCharge(moduleId, c)} />
      ))}
      {note && <div className="muted small">{note}</div>}
    </div>
  )
}

function AmmoRow({ moduleId, count, charge, lang, onCharge }: { moduleId: number; count: number; charge?: number; lang: 0 | 1; onCharge: (c: number | undefined) => void }) {
  const basic = useTypeBasic(moduleId)
  const [charges, setCharges] = useState<number[]>(charge ? [charge] : [])
  useEffect(() => {
    void chargesFor(moduleId).then(setCharges)
  }, [moduleId])
  return (
    <div className="ammo-row">
      <img className="type-icon" src={imageUrl.typeIcon(moduleId, 32)} width={20} height={20} alt="" />
      <span className="ammo-weapon">{`${count > 1 ? `${count}× ` : ''}${tn(basic?.n, lang)}`}</span>
      <ChargePicker charges={charges} value={charge} onChange={onCharge} />
    </div>
  )
}
