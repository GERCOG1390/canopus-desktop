// Boosters on a fit: take one in a click, see what it gives, tick the side effects that struck.

import { useEffect, useMemo, useState } from 'react'
import type { BoosterInfo, BoosterLine } from '../../../shared/boosters'
import type { FitBooster, FitSpec, FitStats, SkillSource } from '../../../shared/fit'
import { useLang } from '../AppContext'
import { locale, translate } from '../i18n'
import { loadBoosters, withBooster } from '../lib/fitting'
import { getBasic, tn, type Lang } from '../lib/sde'
import { Glyph } from './Glyph'
import { typeImage } from './TypeLink'

const n = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 })

const signed = (l: BoosterLine, v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${n(Math.abs(v))}${l.percent ? '%' : ''}`

/** One bonus or penalty: as it works with the pilot's skills, and the item's own figure when they differ. */
function Line({ l, lang, applied }: { l: BoosterLine; lang: Lang; applied?: number }) {
  const differs = applied !== undefined && Math.abs(applied - l.value) > 1e-6
  return (
    <>
      <b>{signed(l, differs ? applied : l.value)}</b>
      {differs ? ` (${translate('база')} ${signed(l, l.value)})` : ''} {tn(l.name, lang)}
    </>
  )
}

const chanceText = (base: number, now?: number): string =>
  ` · ${translate('шанс')} ${n((now ?? base) * 100)}%${now !== undefined && Math.abs(now - base) > 1e-6 ? ` (${translate('база')} ${n(base * 100)}%)` : ''}`

/** The boosters of a fit, with a picker for more. */
export function BoosterPanel({ fit, skills, onChange, compact = false }: { fit: FitSpec; skills?: SkillSource; onChange: (fit: FitSpec) => void; compact?: boolean }) {
  const lang = useLang()
  const [all, setAll] = useState<Map<number, BoosterInfo> | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void loadBoosters()
      .then(setAll)
      .catch((e) => setError(String(e?.message ?? e)))
  }, [])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [onlyMarket, setOnlyMarket] = useState(true)
  const taken = fit.boosters ?? []
  // What the skills make of each booster: the engine's figures, for this fit.
  const [applied, setApplied] = useState<Map<number, NonNullable<FitStats['boosters']>[number]>>(new Map())
  const askKey = JSON.stringify([fit.shipTypeId, taken.map((b) => b.typeId), skills])
  useEffect(() => {
    if (!taken.length || !skills) return setApplied(new Map())
    let live = true
    void window.api.fit.calculate(fit, skills).then((s) => live && setApplied(new Map((s.boosters ?? []).map((b) => [b.typeId, b]))))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey])

  const list = useMemo(() => {
    if (!all) return []
    const q = query.trim().toLowerCase()
    return [...all.values()]
      .filter((b) => !onlyMarket || b.market || q)
      .filter((b) => {
        if (!q) return true
        const name = getBasic(b.id)?.n
        return !!name && (name[0].toLowerCase().includes(q) || name[1].toLowerCase().includes(q) || b.main.some((l) => l.name.some((x) => x.toLowerCase().includes(q))))
      })
      .sort((a, b) => Number(!!b.market) - Number(!!a.market) || tn(getBasic(a.id)?.n, lang).localeCompare(tn(getBasic(b.id)?.n, lang)))
  }, [all, query, onlyMarket, lang])

  const setSide = (typeId: number, effect: number, on: boolean) =>
    onChange({
      ...fit,
      boosters: taken.map((b) => (b.typeId !== typeId ? b : { ...b, side: on ? [...(b.side ?? []), effect] : (b.side ?? []).filter((e) => e !== effect) }))
    })
  const remove = (typeId: number) => onChange({ ...fit, boosters: taken.filter((b) => b.typeId !== typeId) })
  const take = (b: BoosterInfo) => {
    if (!all) return
    onChange(withBooster(fit, b, all))
    setOpen(false)
    setQuery('')
  }

  return (
    <div className={`booster-panel ${compact ? 'compact' : ''}`}>
      {taken.map((fb: FitBooster) => {
        const info = all?.get(fb.typeId)
        return (
          <div className="booster-row" key={fb.typeId}>
            <div className="booster-head">
              <span className="booster-name">
                <img className="type-icon" src={typeImage(fb.typeId, undefined, 24)} width={24} height={24} alt="" loading="lazy" />
                <span translate="no">{tn(getBasic(fb.typeId)?.n, lang) || `#${fb.typeId}`}</span>
              </span>
              {info?.slot ? <span className="muted small">{`${translate('слот')} ${info.slot}`}</span> : null}
              <button className="ghost small danger" title="Убрать" onClick={() => remove(fb.typeId)}>
                <Glyph name="close" size={12} />
              </button>
            </div>
            {info && (
              <ul className="booster-lines">
                {info.main.map((l) => (
                  <li key={l.attr} className="good">
                    <Line l={l} lang={lang} applied={applied.get(fb.typeId)?.values[l.attr]} />
                  </li>
                ))}
                {info.side.map((l) => (
                  <li key={l.effect} className="booster-side">
                    <label>
                      <input type="checkbox" checked={!!fb.side?.includes(l.effect)} onChange={(e) => setSide(fb.typeId, l.effect, e.target.checked)} />
                      <span>
                        <Line l={l} lang={lang} applied={applied.get(fb.typeId)?.values[l.attr]} />
                      </span>
                      <span className="muted small">{chanceText(info.chance, applied.get(fb.typeId)?.chance)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
      {taken.some((b) => all?.get(b.typeId)?.side.length) && <p className="muted small">Побочные эффекты выпадают случайно: отметьте те, что сработали. Сила и шанс показаны с учётом навыков.</p>}
      {error && <p className="bad small">{error}</p>}
      {!open ? (
        <button className="ghost small" onClick={() => setOpen(true)} disabled={!all}>
          <Glyph name="flame" size={13} /> Принять бустер
        </button>
      ) : (
        <div className="booster-picker">
          <div className="row">
            <input autoFocus className="booster-search" placeholder="Бустер или бонус (рус/англ)…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="small booster-market">
              <input type="checkbox" checked={onlyMarket} onChange={(e) => setOnlyMarket(e.target.checked)} /> только с рынка
            </label>
            <button className="ghost small" onClick={() => setOpen(false)}>
              Закрыть
            </button>
          </div>
          <ul className="booster-list">
            {list.slice(0, 200).map((b) => (
              <li key={b.id} className="booster-pick" title={translate('Принять')} onClick={() => take(b)}>
                <img className="type-icon" src={typeImage(b.id, undefined, 20)} width={20} height={20} alt="" loading="lazy" />
                <span className="booster-pick-name" translate="no">
                  {tn(getBasic(b.id)?.n, lang)}
                </span>
                <span className="muted small grow">
                  {b.main.slice(0, 2).map((l, i) => (
                    <span key={l.attr}>
                      {i ? '; ' : ''}
                      <Line l={l} lang={lang} />
                    </span>
                  ))}
                  {!b.market ? ` · ${translate('не с рынка')}` : ''}
                </span>
              </li>
            ))}
            {list.length > 200 && <li className="muted small">{`${translate('ещё')} ${list.length - 200}`}</li>}
            {!list.length && <li className="muted small">Ничего не найдено</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
