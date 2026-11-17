// What other ships do to the fit (Pyfa's projected effects): webs and painters, remote shield and armor repairs,
// energy neutralizers. Strengths are the modules' own with every skill at V, without the carrier's hull bonus.

import type { FitProjected, FitSpec, FitStats, ProjectedKind } from '../../../shared/fit'
import { useLang } from '../AppContext'
import { locale, translate } from '../i18n'
import { getBasic, tn, useTypeBasics } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { chargesFor } from '../lib/fitting'
import { Glyph } from './Glyph'
import { AttachedFits } from './AttachedFits'
import { AddFitSelect } from '../pages/FitTools'

const n1 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 })
const n0 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 0 })
const KIND_LABEL: Record<ProjectedKind, string> = {
  web: 'Стазис-вебы',
  paint: 'Подсветка целей',
  shieldRep: 'Удалённая накачка щита',
  armorRep: 'Удалённый ремонт брони',
  neut: 'Нейтрализаторы',
  damp: 'Глушилки сенсоров',
  td: 'Разрушители наводки (турели)',
  gd: 'Разрушители наведения (ракеты)',
  ecm: 'ECM'
}
const ORDER: ProjectedKind[] = ['web', 'paint', 'neut', 'damp', 'td', 'gd', 'ecm', 'shieldRep', 'armorRep']

/** One projected module: how many, and the hull carrying them (its bonuses make them stronger). */
function ProjectedRow({
  entry,
  name,
  onCount,
  onHull,
  onScript
}: {
  entry: FitProjected
  name: (id: number) => string
  onCount: (by: number) => void
  onHull: (shipTypeId: number | undefined) => void
  onScript: (chargeTypeId: number | undefined) => void
}) {
  const hulls = useAsync(() => window.api.fit.projectedHulls(entry.typeId), [entry.typeId])
  const scripts = useAsync(() => chargesFor(entry.typeId), [entry.typeId])
  useTypeBasics([...(hulls.data ?? []).map((h) => h.shipTypeId), ...(scripts.data ?? [])])
  return (
    <div className="projected-row">
      <div className="projected-line">
        <span className="grow">{name(entry.typeId)}</span>
        <span className="drone-ctrl">
          <button className="ghost small" onClick={() => onCount(-1)}>
            −
          </button>
          {entry.count}
          <button className="ghost small" onClick={() => onCount(1)}>
            +
          </button>
        </span>
        <button className="ghost small danger" onClick={() => onCount(-entry.count)}>
          <Glyph name="close" size={14} />
        </button>
      </div>
      {!!scripts.data?.length && (
        <select value={entry.chargeTypeId ?? 0} onChange={(e) => onScript(Number(e.target.value) || undefined)} title="Скрипт: что модуль ослабляет сильнее">
          <option value={0}>Без скрипта</option>
          {scripts.data.map((c) => (
            <option key={c} value={c}>
              {name(c)}
            </option>
          ))}
        </select>
      )}
      {!!hulls.data?.length && (
        <select value={entry.shipTypeId ?? 0} onChange={(e) => onHull(Number(e.target.value) || undefined)} title="Корпус, на котором стоит модуль: его бонусы усиливают модуль">
          <option value={0}>Корпус без бонуса</option>
          {hulls.data.map((h) => (
            <option key={h.shipTypeId} value={h.shipTypeId}>
              {`${name(h.shipTypeId)} — ${n1(Math.abs(h.amount))}`}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

export function ProjectedPanel({ fit, stats, onChange }: { fit: FitSpec; stats?: FitStats | null; onChange: (fit: FitSpec) => void }) {
  const lang = useLang()
  const opts = useAsync(() => window.api.fit.projectedOptions(), [])
  const list = fit.projected ?? []
  useTypeBasics([...(opts.data ?? []).map((o) => o.typeId), ...list.map((p) => p.typeId)])
  const name = (id: number) => tn(getBasic(id)?.n, lang) || `#${id}`
  const set = (next: FitSpec['projected']) => onChange({ ...fit, projected: next?.length ? next : undefined })
  const add = (typeId: number) => set(list.some((p) => p.typeId === typeId) ? list.map((p) => (p.typeId === typeId ? { ...p, count: p.count + 1 } : p)) : [...list, { typeId, count: 1 }])
  const change = (typeId: number, by: number) => set(list.map((p) => (p.typeId === typeId ? { ...p, count: p.count + by } : p)).filter((p) => p.count > 0))
  const p = stats?.projected
  const fits = fit.projectedFits ?? []
  const setFits = (next: NonNullable<FitSpec['projectedFits']>) => onChange({ ...fit, projectedFits: next.length ? next : undefined })

  return (
    <div className="projected-panel">
      {list.map((x) => (
        <ProjectedRow
          key={x.typeId}
          entry={x}
          name={name}
          onCount={(by) => change(x.typeId, by)}
          onHull={(shipTypeId) => set(list.map((p) => (p.typeId === x.typeId ? { ...p, shipTypeId } : p)))}
          onScript={(chargeTypeId) => set(list.map((p) => (p.typeId === x.typeId ? { ...p, chargeTypeId } : p)))}
        />
      ))}
      <AttachedFits
        list={fits}
        onCount={(i, by) => setFits(fits.map((x, k) => (k === i ? { ...x, count: x.count + by } : x)).filter((x) => x.count > 0))}
        onRemove={(i) => setFits(fits.filter((_, k) => k !== i))}
      />
      <AddFitSelect label={translate('+ целый фит (логист, рекон)…')} onAdd={(f) => setFits([...fits, { fit: stripAttached(f), count: 1 }])} />
      <select value="" onChange={(e) => Number(e.target.value) && add(Number(e.target.value))}>
        <option value="">+ эффект от другого корабля…</option>
        {ORDER.map((kind) => (
          <optgroup key={kind} label={translate(KIND_LABEL[kind])}>
            {(opts.data ?? [])
              .filter((o) => o.kind === kind)
              .sort((a, b) => a.amount - b.amount)
              .map((o) => (
                <option key={o.typeId} value={o.typeId}>
                  {name(o.typeId)}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {p && (
        <div className="projected-sum small">
          {p.speedMult !== 1 && (
            <div>
              <span>{translate('Скорость')}</span> <b>{`${n0(stats!.navigation.maxVelocity / p.speedMult)} → ${n0(stats!.navigation.maxVelocity)} м/с`}</b>
            </div>
          )}
          {p.sigMult !== 1 && (
            <div>
              <span>{translate('Сигнатура')}</span> <b>{`${n0(stats!.navigation.signatureRadius / p.sigMult)} → ${n0(stats!.navigation.signatureRadius)} м`}</b>
            </div>
          )}
          {p.shieldRep > 0 && (
            <div>
              <span>{translate('Накачка щита извне')}</span> <b>{`+${n1(p.shieldRep)} HP/с`}</b>
            </div>
          )}
          {p.armorRep > 0 && (
            <div>
              <span>{translate('Ремонт брони извне')}</span> <b>{`+${n1(p.armorRep)} HP/с`}</b>
            </div>
          )}
          {p.lockMult !== 1 && (
            <div>
              <span>{translate('Дальность захвата')}</span> <b>{`${n1(stats!.targeting.maxRange / p.lockMult / 1000)} → ${n1(stats!.targeting.maxRange / 1000)} км`}</b>
            </div>
          )}
          {p.scanMult !== 1 && (
            <div>
              <span>{translate('Разрешение сканера')}</span> <b>{`${n0(stats!.targeting.scanResolution / p.scanMult)} → ${n0(stats!.targeting.scanResolution)} мм`}</b>
            </div>
          )}
          {p.disruptors > 0 && (
            <div>
              <span>{translate('Разрушители уже учтены в уроне, дальности и графике')}</span>
            </div>
          )}
          {p.ecmChance > 0 && (
            <div>
              <span>{translate('Шанс глушения ECM за цикл')}</span> <b>{`${n0(p.ecmChance * 100)}%`}</b>
            </div>
          )}
          {p.neut > 0 && (
            <div>
              <span>{translate('Нейтрализация')}</span> <b>{`${n1(p.neut)} ГДж/с`}</b>
            </div>
          )}
        </div>
      )}
      <div className="muted small">{translate('Сила модулей со всеми навыками V и бонусами выбранного корпуса. Сопротивление фита вебам, подсветке, нейтрализации и внешнему ремонту учтено.')}</div>
    </div>
  )
}

/** A fit attached to another carries only what it runs itself: its own attached fits are dropped. */
export const stripAttached = (f: FitSpec): FitSpec => ({ ...f, projected: undefined, projectedFits: undefined, boosterFits: undefined, fleet: undefined })
