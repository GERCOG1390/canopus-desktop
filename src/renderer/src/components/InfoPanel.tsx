import { useEffect, useMemo, useState } from 'react'
import type { BlueprintActivity, Bonus, InfoBundle, ReqNode, SkillReq } from '../../../shared/sde'
import { useApp, useLang } from '../AppContext'
import { useCharacter } from '../CharacterContext'
import { ACTIVITY_RU, ATTR_NAMES, CATEGORY_RU, formatValue, spForLevel, spPerMinute, trainingMs } from '../lib/dogma'
import { imageUrl } from '../lib/esi'
import { fmtDuration, fmtIsk, fmtNum, ROMAN } from '../lib/format'
import { useFitting } from '../lib/fitting'
import { HUBS, hubPrices } from '../lib/market'
import { CATEGORY, primeBasics, tn, type Lang } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { useInfo } from './InfoContext'
import { LevelPips, MissingSkillsBox, SkillStatusIcon } from './skills'
import { RichText, TypeLink, typeImage } from './TypeLink'
import { ErrorBox, Loading, Tabs } from './ui'

type TabId = 'desc' | 'attrs' | 'req' | 'skill' | 'mastery' | 'vars' | 'industry' | 'reprocess' | 'market'

export function InfoPanel() {
  const { stack, index, back, forward, close } = useInfo()
  const typeId = stack[index]

  useEffect(() => {
    if (typeId === undefined) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.altKey && e.key === 'ArrowLeft') back()
      if (e.altKey && e.key === 'ArrowRight') forward()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [typeId, back, forward, close])

  if (typeId === undefined) return null
  return (
    <>
      <div className="info-backdrop" onClick={close} />
      <aside className="info-panel">
        <div className="info-nav">
          <button className="ghost small" disabled={index <= 0} onClick={back} title="Назад (Alt+←)">
            ←
          </button>
          <button className="ghost small" disabled={index >= stack.length - 1} onClick={forward} title="Вперёд (Alt+→)">
            →
          </button>
          <span className="muted small grow">Информация</span>
          <button className="ghost small" onClick={close} title="Закрыть (Esc)">
            ✕
          </button>
        </div>
        <InfoView key={typeId} typeId={typeId} />
      </aside>
    </>
  )
}

function flattenReqs(nodes: ReqNode[], out: Record<number, SkillReq> = {}): Record<number, SkillReq> {
  for (const n of nodes) {
    if ((out[n.skill]?.level ?? 0) < n.level) out[n.skill] = { level: n.level, rank: n.rank, primary: n.primary, secondary: n.secondary }
    flattenReqs(n.children, out)
  }
  return out
}

function InfoView({ typeId }: { typeId: number }) {
  const lang = useLang()
  const { openFit } = useFitting()
  const { close } = useInfo()
  const { data, error, loading } = useAsync(async () => {
    const b = await window.api.sde.info(typeId)
    primeBasics(b.refs)
    return b
  }, [typeId])
  const [tab, setTab] = useState<TabId>('desc')

  if (loading) return <Loading />
  if (!data) return <ErrorBox error={error} />
  const b = data
  const t = b.type
  const isShip = b.category.id === CATEGORY.SHIP
  const reqs = flattenReqs(b.requirements)

  const tabs: { id: TabId; label: string }[] = [{ id: 'desc', label: 'Описание' }]
  if (b.attributes.length) tabs.push({ id: 'attrs', label: 'Атрибуты' })
  if (b.requirements.length) tabs.push({ id: 'req', label: 'Требования' })
  if (b.skill) tabs.push({ id: 'skill', label: 'Навык' })
  if (b.masteries) tabs.push({ id: 'mastery', label: 'Мастерство' })
  if (b.variations.length) tabs.push({ id: 'vars', label: 'Вариации' })
  if (b.producedBy || b.blueprint || b.usedIn.length) tabs.push({ id: 'industry', label: 'Производство' })
  if (b.reprocess?.length) tabs.push({ id: 'reprocess', label: 'Переработка' })
  if (t.mg) tabs.push({ id: 'market', label: 'Рынок' })
  const current = tabs.some((x) => x.id === tab) ? tab : 'desc'

  return (
    <div className="info-body">
      <header className="info-head">
        <img
          src={isShip ? imageUrl.typeRender(t.id, 128) : typeImage(t.id, b.category.id, 64)}
          width={isShip ? 112 : 64}
          height={isShip ? 112 : 64}
          alt=""
        />
        <div className="grow">
          <h2>{tn(t.n, lang)}</h2>
          {lang === 1 && t.n[1] !== t.n[0] && <div className="muted small">{t.n[0]}</div>}
          <div className="muted">
            {tn(b.category.n, lang)} › {tn(b.group.n, lang)}
          </div>
          <div className="badges">
            {b.meta && <span className={`meta-badge meta-${t.meta}`}>{tn(b.meta, lang)}</span>}
            {t.ml !== undefined && t.ml > 0 && <span className="meta-badge">Мета {t.ml}</span>}
            {b.race && <span className="meta-badge">{tn(b.race, lang)}</span>}
            {b.faction && <span className="meta-badge">{tn(b.faction, lang)}</span>}
            {!t.pub && <span className="meta-badge">не публикуется</span>}
          </div>
          {isShip && (
            <button
              className="small fit-open-btn"
              onClick={() => {
                close()
                openFit({ shipTypeId: t.id, name: `${tn(t.n, lang)} fit`, modules: [], drones: [], implants: [] })
              }}
            >
              Открыть в фитинге
            </button>
          )}
        </div>
      </header>

      {b.requirements.length > 0 && <MissingSkillsBox reqs={reqs} title="Использование" />}

      <Tabs tabs={tabs} value={current} onChange={setTab} />
      <div className="info-tab">
        {current === 'desc' && <DescriptionTab b={b} lang={lang} />}
        {current === 'attrs' && <AttributesTab b={b} lang={lang} />}
        {current === 'req' && <RequirementsTab nodes={b.requirements} />}
        {current === 'skill' && <SkillTab b={b} lang={lang} />}
        {current === 'mastery' && <MasteryTab b={b} lang={lang} />}
        {current === 'vars' && <VariationsTab b={b} />}
        {current === 'industry' && <IndustryTab b={b} />}
        {current === 'reprocess' && <ReprocessTab b={b} />}
        {current === 'market' && <MarketTab typeId={t.id} />}
      </div>
    </div>
  )
}

// ---------------- Description ----------------

function DescriptionTab({ b, lang }: { b: InfoBundle; lang: Lang }) {
  const t = b.type
  return (
    <>
      {b.description ? (
        <div className="description">
          <RichText text={tn(b.description, lang)} />
        </div>
      ) : (
        <p className="muted">Описание отсутствует.</p>
      )}

      {b.traits && (b.traits.skills?.length || b.traits.role?.length || b.traits.misc?.length) ? (
        <section className="traits">
          <h4>Особенности</h4>
          {b.traits.skills?.map((s) => (
            <div key={s.skill} className="trait-block">
              <div className="trait-title">
                Бонусы за каждый уровень навыка <TypeLink id={s.skill} icon={false} />:
              </div>
              <ul>
                {s.bonuses.map((x, i) => (
                  <BonusLine key={i} bonus={x} lang={lang} unitSuffix={x.u === 105 ? '%' : ''} />
                ))}
              </ul>
            </div>
          ))}
          {b.traits.role?.length ? (
            <div className="trait-block">
              <div className="trait-title">Ролевые бонусы:</div>
              <ul>
                {b.traits.role.map((x, i) => (
                  <BonusLine key={i} bonus={x} lang={lang} unitSuffix={x.u === 105 ? '%' : ''} />
                ))}
              </ul>
            </div>
          ) : null}
          {b.traits.misc?.length ? (
            <div className="trait-block">
              <div className="trait-title">Прочие бонусы:</div>
              <ul>
                {b.traits.misc.map((x, i) => (
                  <BonusLine key={i} bonus={x} lang={lang} unitSuffix={x.u === 105 ? '%' : ''} />
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <table className="table compact kv">
        <tbody>
          {b.marketPath.length > 0 && (
            <tr>
              <td>Рынок</td>
              <td>{b.marketPath.map((p) => tn(p, lang)).join(' › ')}</td>
            </tr>
          )}
          {t.vol !== undefined && (
            <tr>
              <td>Объём</td>
              <td>
                {fmtNum3(t.vol)} м³{t.pvol !== undefined && t.pvol !== t.vol && <span className="muted"> (в упаковке {fmtNum3(t.pvol)} м³)</span>}
              </td>
            </tr>
          )}
          {!!t.mass && (
            <tr>
              <td>Масса</td>
              <td>{fmtNum(t.mass)} кг</td>
            </tr>
          )}
          {!!t.cap && (
            <tr>
              <td>Вместимость</td>
              <td>{fmtNum3(t.cap)} м³</td>
            </tr>
          )}
          {t.portion !== undefined && t.portion > 1 && (
            <tr>
              <td>Размер партии</td>
              <td>{t.portion}</td>
            </tr>
          )}
          {!!t.price && (
            <tr>
              <td>Базовая цена</td>
              <td>{fmtIsk(t.price)}</td>
            </tr>
          )}
          <tr>
            <td>type_id</td>
            <td className="mono">{t.id}</td>
          </tr>
        </tbody>
      </table>
    </>
  )
}

const fmtNum3 = (v: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(v)

function BonusLine({ bonus, lang, unitSuffix }: { bonus: Bonus; lang: Lang; unitSuffix: string }) {
  return (
    <li>
      {bonus.b !== undefined && (
        <b className="bonus-value">
          {bonus.b}
          {unitSuffix}{' '}
        </b>
      )}
      <RichText text={tn(bonus.t, lang)} />
    </li>
  )
}

// ---------------- Attributes ----------------

function AttributesTab({ b, lang }: { b: InfoBundle; lang: Lang }) {
  const groups = useMemo(() => {
    const m = new Map<string, InfoBundle['attributes']>()
    for (const a of b.attributes) m.set(a.cat, [...(m.get(a.cat) ?? []), a])
    return [...m.entries()]
  }, [b])
  return (
    <>
      {groups.map(([cat, attrs]) => (
        <section key={cat} className="attr-group">
          <h4>{CATEGORY_RU[cat] ?? cat}</h4>
          <table className="table compact kv">
            <tbody>
              {attrs.map((a) => (
                <tr key={a.id} title={a.tt ? tn(a.tt, lang) : undefined}>
                  <td>{tn(a.n, lang)}</td>
                  <td className="num">
                    <AttrValue a={a} b={b} lang={lang} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {b.effects.length > 0 && (
        <details className="effects">
          <summary className="muted small">Эффекты догмы ({b.effects.length})</summary>
          <div className="mono small muted">{b.effects.join(', ')}</div>
        </details>
      )}
    </>
  )
}

function AttrValue({ a, b, lang }: { a: InfoBundle['attributes'][number]; b: InfoBundle; lang: Lang }) {
  if (a.unit === 116) return <TypeLink id={a.value} />
  if (a.unit === 115) return <>{tn(b.groupNames[a.value], lang) || a.value}</>
  if (a.unit === 119) return <>{tn(b.attrNames[a.value], lang) || a.value}</>
  if ((a.id === 180 || a.id === 181) && ATTR_NAMES[a.value]) return <>{tn(ATTR_NAMES[a.value], lang)}</>
  return <>{formatValue(a.value, a.unit, tn(a.unit ? b.units[a.unit] : undefined, lang))}</>
}

// ---------------- Requirements ----------------

function RequirementsTab({ nodes }: { nodes: ReqNode[] }) {
  return (
    <div className="req-tree">
      <ReqList nodes={nodes} depth={0} />
    </div>
  )
}

function ReqList({ nodes, depth }: { nodes: ReqNode[]; depth: number }) {
  const char = useCharacter()
  return (
    <ul className={depth ? 'req-children' : ''}>
      {nodes.map((n) => {
        const state = char.skills?.get(n.skill)
        const have = state?.active ?? 0
        const rate = spPerMinute(char.attributes, n.primary, n.secondary)
        const ms = have < n.level ? trainingMs(n.rank, n.level, state?.sp ?? 0, rate) : 0
        return (
          <li key={`${n.skill}-${n.level}`}>
            <div className="req-row">
              {char.skills && <SkillStatusIcon have={have} need={n.level} />}
              <TypeLink id={n.skill} icon={false} />
              <b>{ROMAN[n.level]}</b>
              {char.skills && <LevelPips have={have} need={n.level} />}
              {ms > 0 && <span className="muted small">{fmtDuration(ms)}</span>}
            </div>
            {n.children.length > 0 && <ReqList nodes={n.children} depth={depth + 1} />}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------- Skill ----------------

function SkillTab({ b, lang }: { b: InfoBundle; lang: Lang }) {
  const char = useCharacter()
  const s = b.skill!
  const state = char.skills?.get(b.type.id)
  const rate = spPerMinute(char.attributes, s.primary, s.secondary)
  return (
    <>
      <table className="table compact kv">
        <tbody>
          <tr>
            <td>Ранг (множитель)</td>
            <td>{s.rank}x</td>
          </tr>
          <tr>
            <td>Основной атрибут</td>
            <td>{tn(ATTR_NAMES[s.primary], lang)}</td>
          </tr>
          <tr>
            <td>Вторичный атрибут</td>
            <td>{tn(ATTR_NAMES[s.secondary], lang)}</td>
          </tr>
          {rate > 0 && (
            <tr>
              <td>Ваша скорость</td>
              <td>{fmtNum(rate * 60)} SP/час</td>
            </tr>
          )}
          {char.skills && (
            <tr>
              <td>Ваш уровень</td>
              <td>
                <LevelPips have={state?.active ?? 0} trained={state?.trained} /> {fmtNum(state?.sp ?? 0)} SP
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h4>Уровни</h4>
      <table className="table compact">
        <thead>
          <tr>
            <th>Уровень</th>
            <th className="num">Всего SP</th>
            {rate > 0 && <th className="num">Изучить (от текущего)</th>}
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5].map((l) => {
            const have = state?.active ?? 0
            return (
              <tr key={l} className={have >= l ? 'done' : ''}>
                <td>
                  {ROMAN[l]} {have >= l && <span className="st ok">✔</span>}
                </td>
                <td className="num">{fmtNum(spForLevel(s.rank, l))}</td>
                {rate > 0 && <td className="num">{have >= l ? '—' : fmtDuration(trainingMs(s.rank, l, state?.sp ?? 0, rate))}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>

      {b.requiredFor?.length ? (
        <>
          <h4>Открывает</h4>
          {b.requiredFor.map((g) => (
            <details key={g.level} className="unlocks" open={g.types.length <= 12}>
              <summary>
                Уровень {ROMAN[g.level]} <span className="muted">({g.types.length})</span>
              </summary>
              <div className="link-grid">
                {g.types
                  .slice()
                  .sort((a, b2) => tn(b.refs[a]?.n, lang).localeCompare(tn(b.refs[b2]?.n, lang)))
                  .map((id) => (
                    <TypeLink key={id} id={id} />
                  ))}
              </div>
            </details>
          ))}
        </>
      ) : null}
    </>
  )
}

// ---------------- Mastery ----------------

function MasteryTab({ b, lang }: { b: InfoBundle; lang: Lang }) {
  const char = useCharacter()
  const [open, setOpen] = useState<number | null>(null)
  const levels = b.masteries!
  const met = (skills: [number, number][]) => skills.every(([id, lvl]) => char.level(id) >= lvl)
  const achieved = char.skills ? levels.filter((l) => l.certs.every((c) => met(c.skills))).length : null

  return (
    <>
      {achieved !== null && (
        <p>
          Ваш уровень мастерства: <b>{achieved ? ROMAN[achieved] : 'нет'}</b>
        </p>
      )}
      {levels.map((l) => {
        const done = char.skills ? l.certs.every((c) => met(c.skills)) : false
        return (
          <details key={l.level} className="mastery" open={open === l.level} onToggle={(e) => (e.currentTarget.open ? setOpen(l.level) : open === l.level && setOpen(null))}>
            <summary>
              {char.skills && <span className={`st ${done ? 'ok' : 'no'}`}>{done ? '✔' : '✖'}</span>} Мастерство {ROMAN[l.level]}
            </summary>
            {l.certs.map((c) => (
              <div key={c.id} className="cert">
                <div className="cert-title">
                  {char.skills && <span className={`st ${met(c.skills) ? 'ok' : 'no'}`}>{met(c.skills) ? '✔' : '✖'}</span>} {tn(c.n, lang)}
                </div>
                <ul className="cert-skills">
                  {c.skills.map(([id, lvl]) => (
                    <li key={id}>
                      {char.skills && <SkillStatusIcon have={char.level(id)} need={lvl} />} <TypeLink id={id} icon={false} /> <b>{ROMAN[lvl]}</b>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        )
      })}
    </>
  )
}

// ---------------- Variations ----------------

function VariationsTab({ b }: { b: InfoBundle }) {
  const lang = useLang()
  return (
    <table className="table compact">
      <thead>
        <tr>
          <th>Вариант</th>
          <th>Тип</th>
        </tr>
      </thead>
      <tbody>
        {b.variations.map((id) => (
          <tr key={id} className={id === b.type.id ? 'current' : ''}>
            <td>
              <TypeLink id={id} />
            </td>
            <td className="muted">{b.refs[id]?.meta ? <MetaName meta={b.refs[id].meta!} lang={lang} /> : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const META_RU: Record<number, string> = { 1: 'Tech I', 2: 'Tech II', 3: 'Storyline', 4: 'Faction', 5: 'Officer', 6: 'Deadspace', 14: 'Tech III', 15: 'Abyssal', 17: 'Premium', 19: 'Limited Time', 52: 'Structure Faction', 53: 'Structure Tech II', 54: 'Structure Tech I' }
const MetaName = ({ meta }: { meta: number; lang: Lang }) => <>{META_RU[meta] ?? `Meta group ${meta}`}</>

// ---------------- Industry ----------------

function ActivityBlock({ name, a, maxRuns }: { name: string; a: BlueprintActivity; maxRuns?: number }) {
  return (
    <div className="activity">
      <h4>
        {ACTIVITY_RU[name] ?? name} <span className="muted small">· {fmtDuration(a.time * 1000)}</span>
        {maxRuns ? <span className="muted small"> · макс. прогонов {maxRuns}</span> : null}
      </h4>
      {a.prod?.length ? (
        <div className="small">
          Результат:{' '}
          {a.prod.map(([id, qty, prob]) => (
            <span key={id} className="chip">
              <TypeLink id={id} /> ×{qty}
              {prob ? <span className="muted"> ({Math.round(prob * 100)}%)</span> : null}
            </span>
          ))}
        </div>
      ) : null}
      {a.mat?.length ? (
        <table className="table compact">
          <tbody>
            {a.mat.map(([id, qty]) => (
              <tr key={id}>
                <td>
                  <TypeLink id={id} />
                </td>
                <td className="num">{fmtNum(qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {a.skills?.length ? (
        <div className="small">
          Навыки:{' '}
          {a.skills.map(([id, lvl]) => (
            <span key={id} className="chip">
              <TypeLink id={id} icon={false} /> {ROMAN[lvl]}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function IndustryTab({ b }: { b: InfoBundle }) {
  const { navigate } = useApp()
  const { close } = useInfo()
  return (
    <>
      {b.producedBy && (
        <section>
          <div className="row">
            <span>
              Производится по чертежу <TypeLink id={b.producedBy.bp} />
            </span>
            <button
              className="ghost small"
              onClick={() => {
                close()
                navigate('industry', b.type.id)
              }}
            >
              Рассчитать прибыль
            </button>
          </div>
          <ActivityBlock name={b.producedBy.activity} a={b.producedBy.data} maxRuns={b.producedBy.maxRuns} />
        </section>
      )}
      {b.blueprint &&
        Object.entries(b.blueprint.act).map(([name, a]) => <ActivityBlock key={name} name={name} a={a} maxRuns={name === 'manufacturing' ? b.blueprint!.maxRuns : undefined} />)}
      {b.usedIn.length > 0 && (
        <section>
          <h4>Используется в производстве ({b.usedIn.length})</h4>
          <table className="table compact">
            <tbody>
              {b.usedIn.map((u) => (
                <tr key={`${u.bp}-${u.activity}`}>
                  <td>
                    <TypeLink id={u.product} />
                  </td>
                  <td className="muted small">{ACTIVITY_RU[u.activity]}</td>
                  <td className="num">×{fmtNum(u.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

function ReprocessTab({ b }: { b: InfoBundle }) {
  return (
    <>
      <p className="muted small">Выход при 100% эффективности переработки{b.type.portion && b.type.portion > 1 ? ` из ${b.type.portion} единиц` : ''}.</p>
      <table className="table compact">
        <tbody>
          {b.reprocess!.map(([id, qty]) => (
            <tr key={id}>
              <td>
                <TypeLink id={id} />
              </td>
              <td className="num">{fmtNum(qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

// ---------------- Market ----------------

function MarketTab({ typeId }: { typeId: number }) {
  const { navigate } = useApp()
  const { close } = useInfo()
  const { data, error, loading } = useAsync(
    () => Promise.all(HUBS.map((h) => hubPrices(h.stationId, [typeId]).then((m) => ({ hub: h, p: m.get(typeId) })))),
    [typeId]
  )
  if (loading) return <Loading />
  if (!data) return <ErrorBox error={error} />
  return (
    <>
      <table className="table compact">
        <thead>
          <tr>
            <th>Хаб</th>
            <th className="num">Продажа</th>
            <th className="num">Покупка</th>
          </tr>
        </thead>
        <tbody>
          {data.map(({ hub, p }) => (
            <tr key={hub.stationId}>
              <td>{hub.name}</td>
              <td className="num">{p?.sell.best ? fmtIsk(p.sell.best) : '—'}</td>
              <td className="num">{p?.buy.best ? fmtIsk(p.buy.best) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="ghost"
        onClick={() => {
          close()
          navigate('market', typeId)
        }}
      >
        Открыть в разделе «Рынок»
      </button>
    </>
  )
}
