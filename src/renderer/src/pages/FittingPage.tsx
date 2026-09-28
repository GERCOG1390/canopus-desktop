import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { FitSpec, FitStats, FittableType, LayerStats, ModuleState, SavedFit, SkillSource, Slot } from '../../../shared/fit'
import type { SkillReq } from '../../../shared/sde'
import { useApp, useLang } from '../AppContext'
import { useCharacter } from '../CharacterContext'
import { AttrIcon } from '../components/Icon'
import { useInfo } from '../components/InfoContext'
import { ChargePicker } from '../components/ChargePicker'
import { FitCost } from '../components/FitCost'
import { FitTools, type FitTool } from './FitTools'
import { GameButton } from '../components/GameButton'
import { saveFitToGame, SCOPE } from '../lib/gameActions'
import { MarketTree } from '../components/MarketTree'
import { MissingSkillsBox } from '../components/skills'
import { TypeLink, TypeName } from '../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, SearchBox } from '../components/ui'
import { imageUrl } from '../lib/esi'
import { fmtDate, fmtDuration, fmtNum } from '../lib/format'
import { chargesFor, defaultState, fromEft, loadCatalog, nextState, SLOT_LABEL, SLOT_ORDER, toEft, useFitting } from '../lib/fitting'
import { CATEGORY, getBasic, searchTypesSde, tn, useTypeBasics } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { locale } from '../i18n'

type SkillMode = 'all5' | 'char'

/** Ship attributes holding the slot counts; their icons head each slot group. */
const SLOT_ATTR: Record<Slot, number> = { hi: 14, med: 13, lo: 12, rig: 1137, sub: 1367 }

export default function FittingPage() {
  const { fit } = useFitting()
  return fit ? <Editor /> : <StartScreen />
}

// ---------------- Start screen ----------------

function StartScreen() {
  const lang = useLang()
  const { setFit } = useFitting()
  const [eft, setEft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const saved = useAsync(() => window.api.fit.list(), [])
  useTypeBasics(saved.data?.map((f) => f.shipTypeId) ?? [])

  const newFit = (ship: { id: number }) => setFit({ shipTypeId: ship.id, name: 'Новый фит', modules: [], drones: [], implants: [] })
  /** Market group "Ships" — the root of the in-game ship browser. */
  const SHIPS_MARKET_GROUP = 4

  async function importEft() {
    setError(null)
    try {
      const { fit, unknown } = await fromEft(eft)
      setFit(fit)
      if (unknown.length) setError(`Не распознано: ${unknown.join(', ')}`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="page">
      <div className="two-col fit-start">
        <Card title="Новый фит" className="ship-browser">
          <p className="muted small">Выберите корабль по классу и расе, как в игре, или найдите по названию. Затем добавляйте модули из списка справа.</p>
          <SearchBox
            placeholder="Корабль (рус/англ)…"
            search={(q) => searchTypesSde(q, lang, { categories: [CATEGORY.SHIP] })}
            onSelect={newFit}
            renderItem={(t) => (
              <>
                <img className="type-icon" src={imageUrl.typeIcon(t.id, 32)} width={20} height={20} alt="" /> {t.name}
                {t.alt && <span className="muted small"> {t.alt}</span>}
              </>
            )}
          />
          <MarketTree root={SHIPS_MARKET_GROUP} order="size" onPick={(id) => newFit({ id })} className="ship-tree" />
        </Card>
        <div className="col-stack">
        <Card title="Импорт EFT">
          <textarea rows={6} value={eft} onChange={(e) => setEft(e.target.value)} placeholder={'[Rifter, My Rifter]\nGyrostabilizer II\n...\n125mm Gatling AutoCannon II, EMP S'} />
          <div className="row">
            <button onClick={importEft} disabled={!eft.trim()}>
              Импортировать
            </button>
            <button className="ghost" onClick={async () => setEft(await navigator.clipboard.readText())}>
              Вставить из буфера
            </button>
          </div>
          <ErrorBox error={error} />
        </Card>
        <Card title="Сохранённые фиты">
          {saved.loading ? <Loading /> : <SavedList fits={saved.data ?? []} onDeleted={saved.reload} />}
          <p className="muted small">Фиты персонажа из игры — во вкладке «Персонаж → Корабль и фиты», кнопка «Открыть в фитинге».</p>
        </Card>
        </div>
      </div>
    </div>
  )
}

function SavedList({ fits, onDeleted }: { fits: SavedFit[]; onDeleted: () => void }) {
  const { setFit } = useFitting()
  if (!fits.length) return <Empty>Сохранённых фитов пока нет.</Empty>
  return (
    <table className="table">
      <tbody>
        {[...fits]
          .sort((a, b) => b.updated.localeCompare(a.updated))
          .map((f) => (
            <tr key={f.id} className="clickable" onClick={() => setFit(f, f.id)}>
              <td>
                <TypeLink id={f.shipTypeId} />
              </td>
              <td>{f.name}</td>
              <td className="muted small">{fmtDate(f.updated)}</td>
              <td className="num">
                <button
                  className="ghost small danger"
                  onClick={async (e) => {
                    e.stopPropagation()
                    await window.api.fit.delete(f.id)
                    onDeleted()
                  }}
                >
                  Удалить
                </button>
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  )
}

// ---------------- Editor ----------------

function useSkillSource(mode: SkillMode): SkillSource {
  const char = useCharacter()
  return useMemo(() => {
    if (mode === 'char' && char.skills) {
      return { mode: 'char', levels: Object.fromEntries([...char.skills.entries()].map(([id, s]) => [id, s.active])) }
    }
    return { mode: 'all5' }
  }, [mode, char.skills])
}

function Editor() {
  const { active } = useApp()
  const char = useCharacter()
  const { fit, savedId, setFit, updateFit } = useFitting()
  const [mode, setMode] = useState<SkillMode>(active ? 'char' : 'all5')
  const skills = useSkillSource(mode)
  const [stats, setStats] = useState<FitStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [browserSlot, setBrowserSlot] = useState<Slot | 'drone' | 'implant'>('hi')
  const [notice, setNotice] = useState<string | null>(null)
  const catalog = useAsync(loadCatalog, [])
  const f = fit!
  /** Item under the cursor in the browser: the stats panel shows the fit as if it were added. */
  const [hoverId, setHoverId] = useState<number | null>(null)
  const [tool, setTool] = useState<FitTool | null>(null)
  const [preview, setPreview] = useState<{ id: number; stats?: FitStats; blocked?: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      window.api.fit
        .calculate(f, skills)
        .then((s) => !cancelled && (setStats(s), setError(null)))
        .catch((e: Error) => !cancelled && setError(e.message))
    }, 30)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [f, skills])

  useEffect(() => {
    if (!hoverId) {
      setPreview(null)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      const next = withAdded(f, hoverId)
      if (!next) return
      if (typeof next === 'string') {
        setPreview({ id: hoverId, blocked: next })
        return
      }
      void window.api.fit
        .calculate(next, skills)
        .then((s) => !cancelled && setPreview({ id: hoverId, stats: s }))
        .catch(() => undefined)
    }, 90)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverId, f, skills, stats])

  // The combat simulator window follows the fit being edited.
  useEffect(() => {
    const t = setTimeout(() => void window.api.combat.setAttacker({ fit: f, skills }), 200)
    return () => clearTimeout(t)
  }, [f, skills])

  const reqIds = [f.shipTypeId, ...f.modules.flatMap((m) => [m.typeId, m.chargeTypeId ?? 0]), ...f.drones.map((d) => d.typeId), ...f.implants].filter(Boolean)
  const reqs = useAsync(() => window.api.sde.requiredSkills(reqIds), [reqIds.join(',')])

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(null), 2500)
  }

  /**
   * The fit with one more item, or the reason it can't be added (text). Used both to fit an item
   * and to preview it when the cursor is over it in the browser.
   */
  function withAdded(x: FitSpec, id: number): FitSpec | string | null {
    const info = catalog.data?.get(id)
    if (!info) return null
    if (info.slot === 'drone') {
      const existing = x.drones.find((d) => d.typeId === id)
      const launched = x.drones.reduce((s, d) => s + d.active, 0)
      const canLaunch = launched < (stats?.ship.maxActiveDrones ?? 5) ? 1 : 0
      return existing
        ? { ...x, drones: x.drones.map((d) => (d.typeId === id ? { ...d, count: d.count + 1, active: d.active + canLaunch } : d)) }
        : { ...x, drones: [...x.drones, { typeId: id, count: 1, active: canLaunch }] }
    }
    if (info.slot === 'implant') return x.implants.includes(id) ? x : { ...x, implants: [...x.implants, id] }
    const slot = info.slot as Slot
    // One subsystem of each kind, as in the game: a new one replaces the fitted one of the same kind.
    if (slot === 'sub' && info.ss) {
      const same = x.modules.findIndex((m) => m.slot === 'sub' && catalog.data?.get(m.typeId)?.ss === info.ss)
      if (same >= 0) return { ...x, modules: x.modules.map((m, i) => (i === same ? { typeId: id, slot, state: defaultState(info) } : m)) }
    }
    const used = x.modules.filter((m) => m.slot === slot).length
    if (stats && used >= stats.ship.slots[slot]) return `Нет свободных слотов «${SLOT_LABEL[slot]}»`
    // Turrets and launchers also need a free hardpoint (a Tengu has 7 high slots but 6 launcher hardpoints).
    // Counted from the fit itself: stats are recalculated asynchronously and may lag behind quick clicks.
    const fittedWith = (flag: 'turret' | 'launcher') => x.modules.filter((m) => catalog.data?.get(m.typeId)?.[flag]).length
    if (stats && info.turret && fittedWith('turret') >= stats.ship.turrets.total)
      return `Нет свободных точек монтажа турелей: ${fittedWith('turret')} из ${stats.ship.turrets.total}`
    if (stats && info.launcher && fittedWith('launcher') >= stats.ship.launchers.total)
      return `Нет свободных точек монтажа пусковых установок: ${fittedWith('launcher')} из ${stats.ship.launchers.total}`
    return { ...x, modules: [...x.modules, { typeId: id, slot, state: defaultState(info) }] }
  }

  function addType(id: number) {
    const next = withAdded(f, id)
    if (typeof next === 'string') flash(next)
    else if (next) {
      setHoverId(null)
      updateFit(() => next)
    }
  }

  /** A group of identical modules is edited as one: state and charge change for all of them. */
  const setModules = (indices: number[], patch: Partial<FitSpec['modules'][number]>) =>
    updateFit((x) => ({ ...x, modules: x.modules.map((m, i) => (indices.includes(i) ? { ...m, ...patch } : m)) }))
  /** Slots whose identical modules are shown one per row. */
  const [expanded, setExpanded] = useState<Set<Slot>>(new Set())
  const toggleExpanded = (slot: Slot) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(slot)) next.delete(slot)
      else next.add(slot)
      return next
    })
  const removeModule = (index: number) => updateFit((x) => ({ ...x, modules: x.modules.filter((_, i) => i !== index) }))

  async function save() {
    const s = await window.api.fit.save({ ...f, id: savedId ?? undefined })
    setFit(s, s.id)
    flash('Фит сохранён')
  }

  return (
    <div className="fitting">
      <div className="fitting-toolbar">
        <input className="fit-name" value={f.name} onChange={(e) => updateFit((x) => ({ ...x, name: e.target.value }))} />
        <select value={mode} onChange={(e) => setMode(e.target.value as SkillMode)} title="Навыки для расчёта">
          <option value="all5">Все навыки V</option>
          <option value="char" disabled={!char.skills}>
            Навыки: {active?.name ?? 'войдите'}
          </option>
        </select>
        <button onClick={save}>Сохранить</button>
        <GameButton scope={SCOPE.writeFits} action={(who) => saveFitToGame(who, f)} title="Сохранить этот фит в список фитов в игре" done="в игре">
          В игру
        </GameButton>
        <button
          className="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(toEft(f))
            flash('EFT скопирован в буфер')
          }}
        >
          Копировать EFT
        </button>
        <button className={`ghost ${tool ? 'active' : ''}`} onClick={() => setTool(tool ? null : 'learn')}>
          Инструменты
        </button>
        <button className="ghost" title="Открыть окно симуляции боя с этим фитом" onClick={() => void window.api.combat.open({ fit: f, skills })}>
          ⚔ Симуляция боя
        </button>
        <button className="ghost" onClick={() => setFit(null)}>
          Закрыть
        </button>
        {notice && <span className="good small">{notice}</span>}
      </div>

      {tool && <FitTools tool={tool} setTool={setTool} fit={f} skills={skills} onLoad={(x) => setFit(x)} />}

      {stats && <FitMetrics stats={preview?.stats ?? stats} base={preview?.stats ? stats : undefined} />}

      <div className="fitting-grid">
        <div className="fit-col">
          <Card>
            <div className="fit-ship">
              <img src={imageUrl.typeRender(f.shipTypeId, 128)} width={88} height={88} alt="" />
              <div className="grow">
                <TypeLink id={f.shipTypeId} icon={false} className="big" />
                <div className="muted small">
                  <ShipChanger onPick={(id) => updateFit((x) => ({ ...x, shipTypeId: id }))} />
                </div>
              </div>
            </div>
            {mode === 'char' && reqs.data && <MissingSkillsBox reqs={reqs.data as Record<number, SkillReq>} title="Фит" />}
            {mode === 'all5' && char.skills && reqs.data && (
              <div className="muted small">Расчёт со всеми навыками V. Переключите на своего персонажа, чтобы увидеть реальные цифры.</div>
            )}
          </Card>

          {SLOT_ORDER.map((slot) => {
            const total = stats?.ship.slots[slot] ?? 0
            const mods = f.modules
              .map((m, i) => ({ m, i }))
              .filter(({ m }) => m.slot === slot)
              // Subsystems in the game's order: core, defensive, offensive, propulsion.
              .sort((a, b) => (slot === 'sub' ? (catalog.data?.get(a.m.typeId)?.ss ?? 0) - (catalog.data?.get(b.m.typeId)?.ss ?? 0) : 0))
            if (!total && !mods.length) return null
            return (
              <div key={slot} className={`slot-group ${browserSlot === slot ? 'focused' : ''}`}>
                <div className="slot-head" onClick={() => setBrowserSlot(slot)}>
                  <AttrIcon attr={SLOT_ATTR[slot]} size={20} />
                  {SLOT_LABEL[slot]}{' '}
                  <span className={mods.length > total ? 'bad' : 'muted'}>
                    {mods.length}/{total}
                  </span>
                </div>
                {groupModules(mods, expanded.has(slot)).map((g) => {
                  const { m, i } = g[0]
                  const indices = g.map((x) => x.i)
                  return (
                    <ModuleRow
                      key={i}
                      module={m}
                      count={g.length}
                      expanded={expanded.has(slot)}
                      onToggleGroup={() => toggleExpanded(slot)}
                      info={catalog.data?.get(m.typeId)}
                      result={stats?.modules.find((r) => r.index === i)}
                      onState={(s) => setModules(indices, { state: s })}
                      onCharge={(c) => setModules(indices, { chargeTypeId: c })}
                      onRemove={() => removeModule(indices[indices.length - 1])}
                    />
                  )
                })}
                {Array.from({ length: Math.max(0, total - mods.length) }, (_, k) => (
                  <div
                    key={`e${k}`}
                    className={`module-row empty ${k === 0 && browserSlot === slot ? 'target' : ''}`}
                    onClick={() => setBrowserSlot(slot)}
                  >
                    {k === 0 && browserSlot === slot ? 'Пустой слот — выберите модуль справа' : '— пустой слот —'}
                  </div>
                ))}
              </div>
            )
          })}

          <div className={`slot-group ${browserSlot === 'drone' ? 'focused' : ''}`}>
            <div className="slot-head" onClick={() => setBrowserSlot('drone')}>
              Дроны{' '}
              {stats && (
                <span className="muted">
                  {fmtNum(stats.ship.droneBay.used)}/{fmtNum(stats.ship.droneBay.total)} м³ · запущено {f.drones.reduce((s, d) => s + d.active, 0)}/{stats.ship.maxActiveDrones}
                </span>
              )}
            </div>
            {f.drones.map((d, i) => (
              <div key={d.typeId} className="module-row">
                <TypeLink id={d.typeId} size={24} />
                <span className="grow" />
                <span className="drone-ctrl" title="Запущено / всего">
                  <button className="ghost small" onClick={() => updateFit((x) => ({ ...x, drones: x.drones.map((y, j) => (j === i ? { ...y, active: Math.max(0, y.active - 1) } : y)) }))}>
                    −
                  </button>
                  {d.active}/{d.count}
                  <button className="ghost small" onClick={() => updateFit((x) => ({ ...x, drones: x.drones.map((y, j) => (j === i ? { ...y, active: Math.min(y.count, y.active + 1) } : y)) }))}>
                    +
                  </button>
                </span>
                <button className="ghost small" title="Добавить ещё одного" onClick={() => addType(d.typeId)}>
                  ×+1
                </button>
                <button className="ghost small danger" onClick={() => updateFit((x) => ({ ...x, drones: x.drones.filter((_, j) => j !== i) }))}>
                  ✕
                </button>
              </div>
            ))}
            {!f.drones.length && (
              <div className="module-row empty" onClick={() => setBrowserSlot('drone')}>
                — нет дронов —
              </div>
            )}
          </div>

          <div className={`slot-group ${browserSlot === 'implant' ? 'focused' : ''}`}>
            <div className="slot-head" onClick={() => setBrowserSlot('implant')}>
              Импланты
              {char.implants?.length ? (
                <button className="ghost small" onClick={() => updateFit((x) => ({ ...x, implants: [...(char.implants ?? [])] }))}>
                  Взять мои
                </button>
              ) : null}
            </div>
            {f.implants.map((id) => (
              <div key={id} className="module-row">
                <TypeLink id={id} size={24} />
                <span className="grow" />
                <button className="ghost small danger" onClick={() => updateFit((x) => ({ ...x, implants: x.implants.filter((y) => y !== id) }))}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="fit-col browser-col">
          <ModuleBrowser catalog={catalog.data} loading={catalog.loading} error={catalog.error} slot={browserSlot} setSlot={setBrowserSlot} onAdd={addType} onHover={setHoverId} shipTypeId={f.shipTypeId} stats={stats} />
        </div>

        <div className="fit-col stats-col">{error ? <ErrorBox error={error} /> : stats ? (
            <StatsPanel stats={preview?.stats ?? stats} base={preview?.stats ? stats : undefined} fit={f} preview={preview} />
          ) : (
            <Loading label="Считаю…" />
          )}</div>
      </div>
    </div>
  )
}

function ShipChanger({ onPick }: { onPick: (id: number) => void }) {
  const lang = useLang()
  const [open, setOpen] = useState(false)
  if (!open)
    return (
      <span className="link-like" onClick={() => setOpen(true)}>
        сменить корабль
      </span>
    )
  return (
    <SearchBox
      placeholder="Корабль…"
      search={(q) => searchTypesSde(q, lang, { categories: [CATEGORY.SHIP] })}
      onSelect={(t) => {
        onPick(t.id)
        setOpen(false)
      }}
      clearOnSelect
    />
  )
}

// ---------------- Module row ----------------

const STATE_LABEL: Record<ModuleState, string> = { offline: 'Выключен', online: 'Онлайн', active: 'Активен', overload: 'Перегрев' }

/** Identical modules (type, state and charge) together, in the order they first appear. */
function groupModules<T extends { m: FitSpec['modules'][number]; i: number }>(mods: T[], expanded: boolean): T[][] {
  if (expanded) return mods.map((x) => [x])
  const groups = new Map<string, T[]>()
  for (const x of mods) {
    const key = `${x.m.typeId}:${x.m.state}:${x.m.chargeTypeId ?? ''}`
    groups.set(key, [...(groups.get(key) ?? []), x])
  }
  return [...groups.values()]
}

function ModuleRow({
  module: m,
  count = 1,
  expanded,
  onToggleGroup,
  info,
  result,
  onState,
  onCharge,
  onRemove
}: {
  module: FitSpec['modules'][number]
  /** Identical modules shown as this one row */
  count?: number
  expanded?: boolean
  onToggleGroup?: () => void
  info?: FittableType
  result?: FitStats['modules'][number]
  onState: (s: ModuleState) => void
  onCharge: (c: number | undefined) => void
  onRemove: () => void
}) {
  const lang = useLang()
  const { open: openInfo } = useInfo()
  const charges = useAsync(async () => (info?.charges ? chargesFor(m.typeId) : []), [m.typeId, info?.charges])
  const problems = result?.problems ?? []
  return (
    <div className={`module-row ${problems.length ? 'has-problem' : ''}`} title={problems.join('\n') || undefined}>
      <button
        className={`state-btn state-${m.state}`}
        title={`${STATE_LABEL[m.state]} — клик: следующее состояние, правый клик: предыдущее`}
        onClick={() => onState(nextState(m.state, info))}
        onContextMenu={(e) => {
          e.preventDefault()
          onState(nextState(m.state, info, true))
        }}
      />
      {(count > 1 || expanded) && onToggleGroup && (
        <button
          className="qty-btn"
          title={count > 1 ? 'Одинаковые модули: показать по одному' : 'Собрать одинаковые модули в одну строку'}
          onClick={onToggleGroup}
        >
          {count > 1 ? `${count}×` : '⋯'}
        </button>
      )}
      <TypeLink id={m.typeId} size={24} />
      <span className="grow" />
      {info?.charges && (
        <ChargePicker charges={charges.data ?? (m.chargeTypeId ? [m.chargeTypeId] : [])} value={m.chargeTypeId} onChange={onCharge} />
      )}
      {m.chargeTypeId && (
        <button className="ghost small" title="Информация о заряде" onClick={() => openInfo(m.chargeTypeId!)}>
          ⓘ
        </button>
      )}
      {problems.length > 0 && <span className="bad" title={problems.join('\n')}>⚠</span>}
      <button className="ghost small danger" onClick={onRemove} title={count > 1 ? 'Снять один модуль' : 'Снять модуль'}>
        ✕
      </button>
    </div>
  )
}

// ---------------- Module browser ----------------

function ModuleBrowser({
  catalog,
  loading,
  error,
  slot,
  setSlot,
  onAdd,
  onHover,
  shipTypeId,
  stats
}: {
  catalog?: Map<number, FittableType>
  loading: boolean
  error: string | null
  slot: Slot | 'drone' | 'implant'
  setSlot: (s: Slot | 'drone' | 'implant') => void
  onAdd: (id: number) => void
  /** Item under the cursor (null when it leaves), for the live stats preview */
  onHover: (id: number | null) => void
  shipTypeId: number
  /** Current fit: slot counts and hardpoints (T3 hulls get them from subsystems) */
  stats?: FitStats | null
}) {
  const lang = useLang()
  const [query, setQuery] = useState('')
  const [meta, setMeta] = useState<'all' | 't1' | 't2' | 'faction'>('all')
  const [kind, setKind] = useState<'all' | 'turret' | 'launcher'>('all')
  const rigSize = useAsync(() => window.api.sde.dogmaAttrs([shipTypeId], [1547]).then((r) => r[shipTypeId][1547]), [shipTypeId])
  const fittable = useAsync(() => window.api.fit.fittableFor(shipTypeId).then((ids) => new Set(ids)), [shipTypeId])
  const slotCount = slot === 'drone' || slot === 'implant' ? null : stats?.ship.slots[slot] ?? null
  const noTurrets = stats ? stats.ship.turrets.total <= 0 : false
  const noLaunchers = stats ? stats.ship.launchers.total <= 0 : false
  const hasSubsystems = (stats?.ship.slots.sub ?? 0) > 0
  const droneBay = stats?.ship.droneBay.total ?? null

  const q = query.trim().toLowerCase()
  const list = useMemo(() => {
    if (!catalog) return []
    if (!fittable.data || slotCount === 0) return []
    return [...catalog.values()]
      .filter((t) => t.slot === slot)
      // Only what this hull can actually take.
      .filter((t) => fittable.data!.has(t.id))
      // A drone must fit into the drone bay (its size comes from the fit: hull, subsystems, rigs).
      .filter((t) => t.slot !== 'drone' || droneBay === null || (droneBay > 0 && (getBasic(t.id)?.v ?? 0) <= droneBay))
      .filter((t) => !(t.turret && noTurrets) && !(t.launcher && noLaunchers))
      .filter((t) => kind === 'all' || (kind === 'turret' ? t.turret : t.launcher))
      .filter((t) => meta === 'all' || (meta === 't1' ? t.meta === 1 || !t.meta : meta === 't2' ? t.meta === 2 : t.meta && ![1, 2].includes(t.meta)))
      .filter((t) => {
        if (!q) return true
        const n = getBasic(t.id)?.n
        return !!n && (n[0].toLowerCase().includes(q) || n[1].toLowerCase().includes(q))
      })
      // As in the game: Tech I, Tech II, storyline, faction, deadspace, officer; ignore the quotes around named modules.
      .sort((a, b) => {
        const rank = (t: FittableType) => (!t.meta ? 0 : ({ 1: 0, 2: 1, 3: 2, 4: 3, 6: 4, 5: 5, 14: 6 } as Record<number, number>)[t.meta] ?? 7)
        const name = (t: FittableType) => tn(getBasic(t.id)?.n, lang).replace(/^['"‘’]+/, '')
        return rank(a) - rank(b) || name(a).localeCompare(name(b))
      })
  }, [catalog, slot, q, meta, kind, lang, fittable.data, slotCount, noTurrets, noLaunchers, droneBay])

  // Without a search query the candidates are shown as the in-game browser: by purpose (market groups).
  const treeFilter = useMemo(
    () => ({ key: `fit|${shipTypeId}|${slot}|${meta}|${kind}|${droneBay}|${noTurrets}|${noLaunchers}|${list.length}`, ids: list.map((t) => t.id) }),
    [list, shipTypeId, slot, meta, kind, droneBay, noTurrets, noLaunchers]
  )
  const shown = list.slice(0, 300)
  return (
    <Card>
      <div className="browser-tabs">
        {(['hi', 'med', 'lo', 'rig', 'sub', 'drone', 'implant'] as const).map((s) => (
          <button key={s} className={`chip-btn ${s === slot ? 'active' : ''}`} onClick={() => setSlot(s)}>
            {SLOT_LABEL[s]}
          </button>
        ))}
      </div>
      <input className="browser-search" placeholder="Поиск модуля (рус/англ)…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="row">
        <select value={meta} onChange={(e) => setMeta(e.target.value as typeof meta)}>
          <option value="all">Любой мета-уровень</option>
          <option value="t1">Tech I</option>
          <option value="t2">Tech II</option>
          <option value="faction">Фракционные и прочие</option>
        </select>
        {slot === 'hi' && (
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">Все</option>
            <option value="turret">Турели</option>
            <option value="launcher">Пусковые</option>
          </select>
        )}
      </div>
      {slot === 'rig' && rigSize.data ? <p className="muted small">Размер ригов корабля: {['', 'малые', 'средние', 'большие', 'капитальные'][rigSize.data] ?? rigSize.data}</p> : null}
      {loading || fittable.loading ? (
        <Loading label="Загружаю каталог модулей…" />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        !q && list.length > 0 ? (
          <div className="browser-list browser-tree">
            <MarketTree mode="add" filter={treeFilter} onPick={onAdd} onHover={onHover} />
          </div>
        ) : (
        <ul className="browser-list">
          {shown.map((t) => (
            <li key={t.id} onMouseEnter={() => onHover(t.id)} onMouseLeave={() => onHover(null)}>
              <button className="ghost small add-btn" onClick={() => onAdd(t.id)} title="Установить">
                +
              </button>
              <TypeLink id={t.id} size={24} />
              {t.meta && t.meta !== 1 ? <span className={`meta-badge meta-${t.meta}`}>{t.meta === 2 ? 'T2' : t.meta === 14 ? 'T3' : 'F'}</span> : null}
            </li>
          ))}
          {list.length > shown.length && <li className="muted small">…ещё {list.length - shown.length}, уточните поиск</li>}
          {!list.length && (
            <li className="muted small">
              {slotCount === 0
                ? hasSubsystems && slot !== 'sub' && slot !== 'rig'
                  ? 'Слотов этого типа пока нет — сначала установите подсистемы'
                  : 'У этого корабля нет слотов этого типа'
                : slot === 'drone' && droneBay === 0
                  ? 'У этого корабля нет отсека для дронов'
                  : 'Ничего не найдено'}
            </li>
          )}
        </ul>
        )
      )}
      <p className="muted small">«+» — установить. Клик по модулю — полная информация.</p>
    </Card>
  )
}

// ---------------- Stats ----------------

/** Dogma attribute IDs whose in-game icons label the stats. */
const ICON = {
  cpu: 48,
  power: 11,
  calibration: 1132,
  turrets: 102,
  launchers: 101,
  droneBandwidth: 1271,
  droneBay: 283,
  shield: 263,
  armor: 265,
  hull: 9,
  resist: [271, 274, 273, 272],
  damage: [114, 118, 117, 116],
  capacitor: 482,
  recharge: 55,
  velocity: 37,
  agility: 70,
  signature: 552,
  mass: 4,
  targetRange: 76,
  scanRes: 564,
  maxTargets: 192,
  cargo: 38,
  shieldRecharge: 479,
  rof: 51,
  optimal: 54,
  explosionRadius: 654
}
const SENSOR_ATTR: Record<string, number> = { Радар: 208, Ладар: 209, Магнитометрия: 210, Гравиметрия: 211 }
const DAMAGE_NAMES = ['ЭМ', 'Термический', 'Кинетический', 'Фугасный']

function Bar({
  attr,
  label,
  used,
  total,
  unit = '',
  digits = 1,
  prev
}: {
  attr: number
  label: string
  used: number
  total: number
  unit?: string
  digits?: number
  /** Usage without the previewed item */
  prev?: number
}) {
  const over = used > total + 1e-6
  const pct = total ? Math.min(100, (used / total) * 100) : used ? 100 : 0
  const f = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: digits })
  return (
    <div className="res-bar">
      <div className="res-label">
        <span className="with-icon">
          <AttrIcon attr={attr} size={20} />
          {label}
        </span>
        <span className={over ? 'bad' : ''}>
          <Delta v={used} b={prev} digits={digits} better="down" /> {f(used)} / {f(total)}
          {unit}
        </span>
      </div>
      <div className={`progress ${over ? 'over' : ''}`}>
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** One label/value line of a stats section, with the game's icon. */
function KV({ attr, label, children, className = '' }: { attr?: number; label: string; children: ReactNode; className?: string }) {
  return (
    <>
      <span className="with-icon">
        {attr ? <AttrIcon attr={attr} size={20} /> : <span className="ui-icon placeholder" style={{ width: 20, height: 20 }} />}
        {label}
      </span>
      <b className={className}>{children}</b>
    </>
  )
}

const RES_CLASS = ['em', 'th', 'ki', 'ex']

function Layer({ name, attr, l, prev }: { name: string; attr: number; l: LayerStats; prev?: LayerStats }) {
  return (
    <tr>
      <td>
        <span className="with-icon">
          <AttrIcon attr={attr} size={22} />
          <span>
            {name}
            <div className="muted small">
              {fmtNum(l.hp)} HP <Delta v={l.hp} b={prev?.hp} digits={0} />
            </div>
          </span>
        </span>
      </td>
      {l.resist.map((r, i) => (
        <td key={i} className={`res res-${RES_CLASS[i]}`}>
          <div className="res-fill" style={{ width: `${Math.max(0, r) * 100}%` }} />
          <span>{(r * 100).toFixed(1)}%</span>
          <Delta v={r * 100} b={prev ? prev.resist[i] * 100 : undefined} />
        </td>
      ))}
      <td className="num">
        {fmtNum(l.ehp)}
        <Delta v={l.ehp} b={prev?.ehp} digits={0} />
      </td>
    </tr>
  )
}

const n1 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 })
const n2 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 2 })
const km = (m: number) => (m >= 1000 ? `${n1(m / 1000)} км` : `${fmtNum(m)} м`)

/** Shown on hover over the DPS: with reloads, and weapons vs drones. */
function DpsTooltip({ s }: { s: FitStats }) {
  const weapons = s.offense.weapons.filter((w) => w.kind !== 'drone')
  const weaponDps = weapons.reduce((a, w) => a + w.dps, 0)
  const weaponReload = weapons.reduce((a, w) => a + w.dpsReload, 0)
  const drones = s.offense.droneDps
  return (
    <div className="tip">
      <div className="tip-row">
        <span>Без перезарядки</span>
        <b>{n1(s.offense.totalDps)}</b>
      </div>
      <div className="tip-row">
        <span>С перезарядкой</span>
        <b>{n1(s.offense.totalDpsReload)}</b>
      </div>
      <div className="tip-sep" />
      <div className="tip-row">
        <span>Основное оружие</span>
        <b>{n1(weaponDps)}</b>
      </div>
      {weaponReload < weaponDps - 0.05 && (
        <div className="tip-row muted">
          <span>с перезарядкой</span>
          <span>{n1(weaponReload)}</span>
        </div>
      )}
      <div className="tip-row">
        <span>Дроны</span>
        <b>{n1(drones)}</b>
      </div>
    </div>
  )
}

/** Change against the fit without the previewed item: green when better, red when worse. */
function Delta({ v, b, digits = 1, better = 'up', unit = '' }: { v: number; b?: number; digits?: number; better?: 'up' | 'down' | 'none'; unit?: string }) {
  if (b === undefined || !Number.isFinite(v) || !Number.isFinite(b)) return null
  const d = v - b
  if (Math.abs(d) < 0.5 * 10 ** -digits) return null
  const good = better === 'none' ? null : better === 'up' ? d > 0 : d < 0
  const text = Math.abs(d).toLocaleString(locale(), { maximumFractionDigits: digits })
  return (
    <span className={`delta ${good === null ? '' : good ? 'delta-good' : 'delta-bad'}`} translate="no">
      {d > 0 ? '+' : '−'}
      {text}
      {unit}
    </span>
  )
}

/** A resource card: used / total with a bar; amber when nearly full, red when over. */
function ResourceCard({ label, used, total, unit, prev }: { label: string; used: number; total: number; unit: string; prev?: number }) {
  const over = used > total + 1e-6
  const near = !over && total > 0 && total - used < total * 0.03
  const pct = total ? Math.min(100, (used / total) * 100) : used ? 100 : 0
  return (
    <div className={`stat metric ${over ? 'metric-over' : near ? 'metric-near' : ''}`}>
      <div className="metric-head">
        <span className="stat-label">{label}</span>
        <Delta v={used} b={prev} better="down" />
      </div>
      <div className="metric-mono">
        {n1(used)} / {n1(total)} {unit}
      </div>
      <div className={`progress ${over ? 'over' : near ? 'near' : ''}`}>
        <div style={{ width: `${pct}%` }} />
      </div>
      {over ? (
        <div className="stat-sub bad">{`не хватает ${n1(used - total)} ${unit}`}</div>
      ) : near ? (
        <div className="stat-sub metric-warn">{`осталось ${n1(total - used)} ${unit}`}</div>
      ) : (
        <div className="stat-sub">{`свободно ${n1(total - used)} ${unit}`}</div>
      )}
    </div>
  )
}

/** The numbers a pilot checks first, above the editor; they follow the previewed module too. */
function FitMetrics({ stats: s, base: b }: { stats: FitStats; base?: FitStats }) {
  const damage = s.offense.weapons.reduce((acc, w) => acc.map((x, i) => x + w.damage[i] / (w.cycle || 1)) as number[], [0, 0, 0, 0])
  const damageTotal = damage.reduce((a, x) => a + x, 0)
  return (
    <div className={`fit-metrics ${b ? 'previewing' : ''}`}>
      <div className="stat metric dps-tip" tabIndex={0}>
        <div className="metric-head">
          <span className="stat-label">DPS</span>
          <Delta v={s.offense.totalDps} b={b?.offense.totalDps} />
        </div>
        <div className="metric-value accent">{n1(s.offense.totalDps)}</div>
        <div className="stat-sub">{`с перезарядкой ${n1(s.offense.totalDpsReload)}`}</div>
        <DpsTooltip s={s} />
      </div>
      <div className="stat metric">
        <div className="metric-head">
          <span className="stat-label">Залп</span>
          <Delta v={s.offense.totalVolley} b={b?.offense.totalVolley} digits={0} />
        </div>
        <div className="metric-value">{fmtNum(s.offense.totalVolley)}</div>
        {damageTotal > 0 ? (
          <div className="damage-bar" title={damage.map((d, i) => `${DAMAGE_NAMES[i]}: ${Math.round((d / damageTotal) * 100)}%`).join(', ')}>
            {damage.map((d, i) => (d > 0 ? <span key={i} className={`dmg-seg dmg-${RES_CLASS[i]}`} style={{ width: `${(d / damageTotal) * 100}%` }} /> : null))}
          </div>
        ) : (
          <div className="stat-sub">нет оружия</div>
        )}
      </div>
      <div className="stat metric">
        <div className="metric-head">
          <span className="stat-label">Эффективное HP</span>
          <Delta v={s.defense.ehp} b={b?.defense.ehp} digits={0} />
        </div>
        <div className="metric-value">{fmtNum(s.defense.ehp)}</div>
        <div className="stat-sub">{b ? `было ${fmtNum(b.defense.ehp)}` : `${fmtNum(s.defense.hp)} HP без сопротивлений`}</div>
      </div>
      <ResourceCard label="Процессор" used={s.ship.cpu.used} total={s.ship.cpu.total} unit="tf" prev={b?.ship.cpu.used} />
      <ResourceCard label="Энергосеть" used={s.ship.power.used} total={s.ship.power.total} unit="MW" prev={b?.ship.power.used} />
    </div>
  )
}

function StatsPanel({
  stats: s,
  base: b,
  fit,
  preview
}: {
  stats: FitStats
  /** Stats of the actual fit while `stats` shows a preview */
  base?: FitStats
  fit: FitSpec
  preview?: { id: number; stats?: FitStats; blocked?: string } | null
}) {
  const damage = s.offense.weapons.reduce((acc, w) => acc.map((x, i) => x + w.damage[i] / (w.cycle || 1)) as number[], [0, 0, 0, 0])
  const damageTotal = damage.reduce((a, b) => a + b, 0)
  return (
    <div className={`stats-panel ${b ? 'previewing' : ''}`}>
      {preview && (
        <div className={`preview-banner ${preview.blocked ? 'blocked' : ''}`}>
          {preview.blocked ? (
            <>
              <span>Нельзя установить:</span> <TypeName id={preview.id} /> — {preview.blocked}
            </>
          ) : (
            <>
              <span>Предпросмотр:</span> + <TypeName id={preview.id} />
            </>
          )}
        </div>
      )}
      {s.problems.length > 0 && (
        <div className="warn-box">
          {s.problems.map((p, i) => (
            <div key={i}>⚠ {p}</div>
          ))}
        </div>
      )}

      <section>
        <h4>Ресурсы</h4>
        <Bar attr={ICON.calibration} label="Калибровка" used={s.ship.calibration.used} total={s.ship.calibration.total} digits={0} prev={b?.ship.calibration.used} />
        <div className="res-row">
          <span className="with-icon">
            <AttrIcon attr={ICON.turrets} size={20} />
            Турели {s.ship.turrets.used}/{s.ship.turrets.total}
          </span>
          <span className="with-icon">
            <AttrIcon attr={ICON.launchers} size={20} />
            Пусковые {s.ship.launchers.used}/{s.ship.launchers.total}
          </span>
        </div>
        {s.ship.droneBandwidth.total > 0 && (
          <Bar attr={ICON.droneBandwidth} label="Канал дронов" used={s.ship.droneBandwidth.used} total={s.ship.droneBandwidth.total} unit=" Мбит/с" digits={0} />
        )}
        {s.ship.droneBay.total > 0 && <Bar attr={ICON.droneBay} label="Отсек дронов" used={s.ship.droneBay.used} total={s.ship.droneBay.total} unit=" м³" digits={0} />}
      </section>

      <section>
        <h4>Огневая мощь</h4>
        {damageTotal > 0 && (
          <div className="damage-profile">
            {damage.map((d, i) => (
              <span key={i} className={`dmg dmg-${RES_CLASS[i]}`} title={`${DAMAGE_NAMES[i]}: ${n1(d)} DPS`}>
                <AttrIcon attr={ICON.damage[i]} size={18} />
                {Math.round((d / damageTotal) * 100)}%
              </span>
            ))}
          </div>
        )}
        {s.offense.weapons.length ? (
          <div className="weapon-list">
            {groupWeapons(s.offense.weapons).map((w) => (
              <div className="weapon-row" key={`${w.kind}-${w.typeId}-${w.chargeTypeId}`}>
                <div className="weapon-name">
                  {w.count > 1 && <span className="qty">{w.count}×</span>}
                  <TypeLink id={w.typeId} />
                </div>
                <b className="weapon-dps">{n1(w.dps)} DPS</b>
                <div className="weapon-sub muted small">
                  {w.chargeTypeId ? <TypeName id={w.chargeTypeId} /> : <span />}
                  <span className="with-icon">
                    <AttrIcon attr={w.kind === 'missile' ? ICON.explosionRadius : ICON.optimal} size={16} />
                    {w.kind === 'missile'
                      ? `${km(w.optimal ?? 0)} · ${fmtNum(w.explosionRadius ?? 0)} м`
                      : w.optimal !== undefined
                        ? `${km(w.optimal)} + ${km(w.falloff ?? 0)}`
                        : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">Нет активного оружия с зарядами.</p>
        )}
      </section>

      <section>
        <h4>Системы защиты</h4>
        <table className="table compact resist-table">
          <thead>
            <tr>
              <th />
              {ICON.resist.map((a, i) => (
                <th key={a} title={`${DAMAGE_NAMES[i]} урон`}>
                  <AttrIcon attr={a} size={20} />
                </th>
              ))}
              <th className="num">EHP</th>
            </tr>
          </thead>
          <tbody>
            <Layer name="Щит" attr={ICON.shield} l={s.defense.shield} prev={b?.defense.shield} />
            <Layer name="Броня" attr={ICON.armor} l={s.defense.armor} prev={b?.defense.armor} />
            <Layer name="Корпус" attr={ICON.hull} l={s.defense.hull} prev={b?.defense.hull} />
          </tbody>
        </table>
        <div className="kv-list">
          <KV attr={ICON.shieldRecharge} label="Регенерация щита">
            {n1(s.defense.passiveShieldRegen)} HP/с · {fmtNum(s.defense.shieldRechargeSec)} с
            <Delta v={s.defense.passiveShieldRegen} b={b?.defense.passiveShieldRegen} />
          </KV>
          {s.defense.shieldBoost > 0 && (
            <KV attr={ICON.shield} label="Накачка щита">
              {n1(s.defense.shieldBoost)} HP/с
              <Delta v={s.defense.shieldBoost} b={b?.defense.shieldBoost} />
            </KV>
          )}
          {s.defense.armorRepair > 0 && (
            <KV attr={ICON.armor} label="Ремонт брони">
              {n1(s.defense.armorRepair)} HP/с
              <Delta v={s.defense.armorRepair} b={b?.defense.armorRepair} />
            </KV>
          )}
          {s.defense.activeTankEhp > 0 && <KV label="Активный танк">{n1(s.defense.activeTankEhp)} EHP/с
              <Delta v={s.defense.activeTankEhp} b={b?.defense.activeTankEhp} />
            </KV>}
        </div>
      </section>

      <section>
        <h4>Накопитель энергии</h4>
        <div className="kv-list">
          <KV attr={ICON.capacitor} label="Ёмкость">
            {fmtNum(s.capacitor.capacity)} ГДж
            <Delta v={s.capacitor.capacity} b={b?.capacitor.capacity} digits={0} />
          </KV>
          <KV attr={ICON.recharge} label="Перезарядка">
            {n1(s.capacitor.rechargeSec)} с
            <Delta v={s.capacitor.rechargeSec} b={b?.capacitor.rechargeSec} better="down" />
          </KV>
          <KV label="Расход / пик регена">
            {n2(s.capacitor.usePerSecond)} / {n2(s.capacitor.peakRecharge)} ГДж/с
            <Delta v={s.capacitor.usePerSecond} b={b?.capacitor.usePerSecond} digits={2} better="down" />
          </KV>
          <KV label="Стабильность" className={s.capacitor.stable ? 'good' : 'bad'}>
            {s.capacitor.stable ? `стабилен ${((s.capacitor.stableLevel ?? 1) * 100).toFixed(1)}%` : `кончится за ${fmtDuration((s.capacitor.lastsSec ?? 0) * 1000)}`}
            {s.capacitor.stable && b?.capacitor.stable && (
              <Delta v={(s.capacitor.stableLevel ?? 1) * 100} b={(b.capacitor.stableLevel ?? 1) * 100} unit="%" />
            )}
          </KV>
        </div>
      </section>

      <section>
        <h4>Ходовые характеристики</h4>
        <div className="kv-list">
          <KV attr={ICON.velocity} label="Скорость">
            {n1(s.navigation.maxVelocity)} м/с
            <Delta v={s.navigation.maxVelocity} b={b?.navigation.maxVelocity} />
          </KV>
          <KV attr={ICON.agility} label="Разгон до варпа">
            {n2(s.navigation.alignSec)} с · {n2(s.navigation.agility)}x
            <Delta v={s.navigation.alignSec} b={b?.navigation.alignSec} digits={2} better="down" />
          </KV>
          <KV label="Скорость варпа">{n2(s.navigation.warpSpeed)} а.е./с</KV>
          <KV attr={ICON.signature} label="Сигнатура">
            {n1(s.navigation.signatureRadius)} м
            <Delta v={s.navigation.signatureRadius} b={b?.navigation.signatureRadius} better="down" />
          </KV>
          <KV attr={ICON.mass} label="Масса">
            {fmtNum(s.navigation.mass / 1000)} т
            <Delta v={s.navigation.mass / 1000} b={b ? b.navigation.mass / 1000 : undefined} digits={0} better="down" />
          </KV>
        </div>
      </section>

      <section>
        <h4>Целеуказание</h4>
        <div className="kv-list">
          <KV attr={ICON.targetRange} label="Дальность захвата">
            {km(s.targeting.maxRange)}
            <Delta v={s.targeting.maxRange / 1000} b={b ? b.targeting.maxRange / 1000 : undefined} unit=" км" />
          </KV>
          <KV attr={ICON.scanRes} label="Разрешение сканера">
            {n1(s.targeting.scanResolution)} мм
            <Delta v={s.targeting.scanResolution} b={b?.targeting.scanResolution} />
          </KV>
          <KV attr={ICON.maxTargets} label="Целей одновременно">
            {s.targeting.maxTargets}
            <Delta v={s.targeting.maxTargets} b={b?.targeting.maxTargets} digits={0} />
          </KV>
          <KV attr={SENSOR_ATTR[s.targeting.sensorType]} label={`Сенсоры (${s.targeting.sensorType})`}>
            {n2(s.targeting.sensorStrength)}
            <Delta v={s.targeting.sensorStrength} b={b?.targeting.sensorStrength} digits={2} />
          </KV>
          <KV attr={ICON.cargo} label="Грузовой отсек">
            {fmtNum(s.ship.cargo)} м³
            <Delta v={s.ship.cargo} b={b?.ship.cargo} digits={0} />
          </KV>
        </div>
      </section>
      <FitCost fit={fit} />
      <p className="muted small">Расчёт по данным догмы SDE: навыки, бонусы корпуса, модули, заряды, импланты, штрафы за стакинг. Модулей: {fit.modules.length}.</p>
    </div>
  )
}

function groupWeapons(list: FitStats['offense']['weapons']) {
  const out = new Map<string, FitStats['offense']['weapons'][number]>()
  for (const w of list) {
    const key = `${w.kind}-${w.typeId}-${w.chargeTypeId ?? ''}`
    const prev = out.get(key)
    if (prev) out.set(key, { ...prev, count: prev.count + w.count, dps: prev.dps + w.dps, volley: prev.volley + w.volley })
    else out.set(key, { ...w })
  }
  return [...out.values()].sort((a, b) => b.dps - a.dps)
}
