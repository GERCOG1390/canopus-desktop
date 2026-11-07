// Mutaplasmids: pick a module and a mutaplasmid, see each attribute's range — the module's own value times the
// mutaplasmid's multipliers — and set where each roll landed to get the abyssal module's numbers.

import { useEffect, useMemo, useState } from 'react'
import { useApp, useLang } from '../AppContext'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, Loading, SearchBox } from '../components/ui'
import { formatValue } from '../lib/dogma'
import { searchTypesSde, tn } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { extremeRoll, isBetter, rolledValue } from '../../../shared/mutaplasmid'
import type { MutaRange } from '../../../shared/sde'

export default function Mutaplasmids() {
  const { sde } = useApp()
  const lang = useLang()
  const [module, setModule] = useState<{ id: number; name: string } | null>(null)
  const [chosen, setChosen] = useState<number | null>(null)
  const [rolls, setRolls] = useState<Record<number, number>>({})
  const mutable = useAsync(() => window.api.sde.mutableTypes(), [sde.state, sde.build])
  const set = useMemo(() => new Set(mutable.data ?? []), [mutable.data])
  const options = useAsync(async () => (module ? window.api.sde.mutaplasmidsFor(module.id) : []), [module?.id, sde.build])
  const option = options.data?.find((o) => o.id === chosen) ?? options.data?.[0]

  // A new mutaplasmid starts in the middle of every range.
  useEffect(() => setRolls({}), [option?.id])

  if (sde.state === 'downloading' || sde.state === 'building') {
    return <Loading label={`База SDE обновляется${sde.progress ? ` — ${Math.round(sde.progress * 100)}%` : ''}…`} />
  }
  if (mutable.data && !mutable.data.length) return <Empty>В базе SDE нет мутаплазмидов. Обновите базу в «Настройках» (раздел SDE).</Empty>

  const setAll = (good: boolean) => setRolls(Object.fromEntries((option?.ranges ?? []).map((r) => [r.attr, extremeRoll(r.base, r.high, good)])))
  const unit = (r: MutaRange) => tn(r.unitName, lang)
  const show = (r: MutaRange, value: number) => formatValue(value, r.unit, unit(r))

  return (
    <>
      <Card title="Мутаплазмиды">
        <div className="calc-form">
          <label className="wide">
            Модуль
            <SearchBox
              placeholder="10MN Afterburner II, Large Shield Extender II…"
              search={async (q) => (await searchTypesSde(q, lang)).filter((t) => set.has(t.id))}
              onSelect={(t) => {
                setModule(t)
                setChosen(null)
              }}
            />
          </label>
        </div>
        {module && !options.loading && !options.data?.length && <p className="muted small">К этому модулю мутаплазмиды не применяются.</p>}
        {options.data && options.data.length > 0 && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {options.data.map((o) => (
              <button key={o.id} className={`chip-btn small ${option?.id === o.id ? 'active' : ''}`} onClick={() => setChosen(o.id)} translate="no">
                {tn(o.n, lang).replace(/ Mutaplasmid$/, '')}
              </button>
            ))}
          </div>
        )}
      </Card>
      {option && (
        <Card
          title={tn(option.n, lang)}
          actions={
            <>
              <button className="ghost small" onClick={() => setAll(false)}>
                Худший
              </button>
              <button className="ghost small" onClick={() => setRolls({})}>
                Середина
              </button>
              <button className="ghost small" onClick={() => setAll(true)}>
                Лучший
              </button>
            </>
          }
        >
          <p className="muted small">
            <TypeLink id={module?.id ?? 0} size={18} /> → <TypeLink id={option.result} size={18} />
          </p>
          <table className="table compact">
            <thead>
              <tr>
                <th>Атрибут</th>
                <th className="num">Мин.</th>
                <th style={{ width: '32%' }} />
                <th className="num">Макс.</th>
                <th className="num">Исходный</th>
                <th className="num">Ролл</th>
                <th className="num">Изменение</th>
              </tr>
            </thead>
            <tbody>
              {option.ranges.map((r) => {
                const roll = rolls[r.attr] ?? 0.5
                const value = rolledValue(r.base, r.min, r.max, roll)
                const change = r.base ? (value / r.base - 1) * 100 : 0
                const flat = Math.abs(change) < 0.05
                const cls = flat ? '' : isBetter(value, r.base, r.high) ? 'good' : 'bad'
                return (
                  <tr key={r.attr}>
                    <td>{tn(r.name, lang)}</td>
                    <td className="num muted small">{show(r, rolledValue(r.base, r.min, r.max, 0))}</td>
                    <td>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={roll}
                        style={{ width: '100%', accentColor: 'var(--accent)' }}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          setRolls((x) => ({ ...x, [r.attr]: v }))
                        }}
                      />
                    </td>
                    <td className="num muted small">{show(r, rolledValue(r.base, r.min, r.max, 1))}</td>
                    <td className="num muted small">{show(r, r.base)}</td>
                    <td className={`num ${cls}`}>{show(r, value)}</td>
                    <td className={`num small ${cls}`}>{`${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="muted small">
            Каждый атрибут роллится независимо между минимальным и максимальным множителем мутаплазмида от значения исходного модуля. Поставьте ползунок туда, куда выпал ваш ролл,
            — или посмотрите, что дадут лучший и худший.
          </p>
        </Card>
      )}
    </>
  )
}
