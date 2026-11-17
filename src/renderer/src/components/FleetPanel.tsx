// Fleet boosts on a fit: a booster's hull, the command bursts it runs and its mindlink, with what each burst
// gives. The booster flies with every skill at V; the fit gets the strongest burst of each kind, as in the game.

import type { FitSpec, FleetBoost } from '../../../shared/fit'
import { useLang } from '../AppContext'
import { locale, translate } from '../i18n'
import { getBasic, tn, useTypeBasics } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { Glyph } from './Glyph'
import { typeImage } from './TypeLink'
import { AttachedFits } from './AttachedFits'
import { stripAttached } from './ProjectedPanel'
import { AddFitSelect } from '../pages/FitTools'

const n1 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 })
/** A ship to start with: a shield command ship, the commonest booster. */
const DEFAULT_SHIP = 22468

export function FleetPanel({ fit, onChange }: { fit: FitSpec; onChange: (fit: FitSpec) => void }) {
  const lang = useLang()
  const opts = useAsync(() => window.api.fit.fleetOptions(), [])
  const boost = fit.fleet
  const details = useAsync(async () => (boost?.bursts.length ? await window.api.fit.fleetDetails(boost) : []), [JSON.stringify(boost)])
  useTypeBasics([...(opts.data?.ships ?? []), ...(opts.data?.charges ?? []), ...(opts.data?.mindlinks ?? [])])
  const name = (id: number) => tn(getBasic(id)?.n, lang) || `#${id}`
  const set = (next: FleetBoost | undefined) => onChange({ ...fit, fleet: next })

  const boosterFits = fit.boosterFits ?? []
  const fitBoosters = (
    <>
      <AttachedFits list={boosterFits.map((f) => ({ fit: f }))} onRemove={(i) => onChange({ ...fit, boosterFits: boosterFits.filter((_, k) => k !== i).length ? boosterFits.filter((_, k) => k !== i) : undefined })} />
      <AddFitSelect label={translate('+ бустер из сохранённого фита…')} onAdd={(f) => onChange({ ...fit, boosterFits: [...boosterFits, stripAttached(f)] })} />
    </>
  )

  if (opts.error) return <div className="muted small">{String(opts.error)}</div>
  if (!boost) {
    return (
      <div className="fleet-panel">
        {fitBoosters}
        <button
          className="ghost small"
          disabled={!opts.data}
          onClick={() => set({ shipTypeId: opts.data?.ships.includes(DEFAULT_SHIP) ? DEFAULT_SHIP : (opts.data?.ships[0] ?? DEFAULT_SHIP), bursts: [], implants: [] })}
        >
          + Добавить бустера
        </button>
        <div className="muted small">Командные бёрсты флота: резисты, HP, скорость, сигнатура, дальность захвата.</div>
      </div>
    )
  }

  const ships = [...(opts.data?.ships ?? [])].sort((a, b) => name(a).localeCompare(name(b)))
  const charges = [...(opts.data?.charges ?? [])].sort((a, b) => name(a).localeCompare(name(b)))
  // Bursts grouped by the module that fires them (Shield, Armor, Information, Skirmish), and no more of them than
  // the booster has high slots.
  const families = [...charges.reduce((m, c) => m.set(tn(opts.data?.family[c], lang), [...(m.get(tn(opts.data?.family[c], lang)) ?? []), c]), new Map<string, number[]>())].sort((a, b) => a[0].localeCompare(b[0]))
  const slots = opts.data?.highSlots[boost.shipTypeId] ?? 0
  const full = slots > 0 && boost.bursts.length >= slots
  const toggle = (c: number) => set({ ...boost, bursts: boost.bursts.includes(c) ? boost.bursts.filter((x) => x !== c) : [...boost.bursts, c] })

  return (
    <div className="fleet-panel">
      {fitBoosters}
      <div className="row">
        <img src={typeImage(boost.shipTypeId, 6, 32)} width={24} height={24} alt="" />
        <select value={boost.shipTypeId} onChange={(e) => set({ ...boost, shipTypeId: Number(e.target.value) })} title="Корабль бустера">
          {ships.map((id) => (
            <option key={id} value={id}>
              {name(id)}
            </option>
          ))}
        </select>
        <button className="ghost small danger" title="Убрать бусты" onClick={() => set(undefined)}>
          <Glyph name="close" size={14} />
        </button>
      </div>
      <select value={boost.implants?.[0] ?? 0} onChange={(e) => set({ ...boost, implants: Number(e.target.value) ? [Number(e.target.value)] : [] })} title="Майндлинк бустера">
        <option value={0}>Без майндлинка</option>
        {(opts.data?.mindlinks ?? []).map((id) => (
          <option key={id} value={id}>
            {name(id)}
          </option>
        ))}
      </select>
      {families.map(([family, list]) => (
        <div key={family} className="fleet-family">
          <div className="muted small">{family}</div>
          <div className="fleet-charges">
            {list.map((c) => (
              <button key={c} className={`chip-btn ${boost.bursts.includes(c) ? 'active' : ''}`} disabled={!boost.bursts.includes(c) && full} onClick={() => toggle(c)}>
                {name(c)}
              </button>
            ))}
          </div>
        </div>
      ))}
      {slots > 0 && <div className="muted small">{`${translate('Бёрстов:')} ${boost.bursts.length}/${slots} ${translate('(по числу верхних слотов корабля)')}`}</div>}
      {!!details.data?.length && (
        <div className="fleet-buffs small">
          {details.data.flatMap((d) =>
            d.buffs.map((b) => (
              <div key={`${d.charge}-${b.id}`}>
                <b>{`${n1(Math.abs(b.value))}%`}</b> {b.n ? tn(b.n, lang) : `#${b.id}`}
              </div>
            ))
          )}
        </div>
      )}
      <div className="muted small">{translate('Бустер со всеми навыками V, бёрсты Tech II. Одинаковые бёрсты не складываются: действует сильнейший.')}</div>
    </div>
  )
}
