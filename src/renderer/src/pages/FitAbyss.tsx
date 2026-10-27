// Abyssal Deadspace planner: the fit in a filament's weather (resist hole, HP / speed / capacitor bonus,
// turret range penalty) and against each abyssal faction's NPCs: time to kill, DPS taken, neuts and e-war.

import { useState } from 'react'
import type { AbyssFaction, AbyssFitSide, AbyssWeather } from '../../../shared/abyss'
import { ABYSS_TIERS, ABYSS_WEATHERS, tierStrengths, WEATHER_HOLE } from '../../../shared/abyss'
import type { FitSpec, SkillSource } from '../../../shared/fit'
import { Empty, ErrorBox, Loading, Tabs } from '../components/ui'
import { useAsync } from '../lib/useAsync'
import { locale } from '../i18n'

const WEATHER_LABEL: Record<AbyssWeather, string> = {
  electrical: 'Электрическая — дыра в ЭМ',
  dark: 'Тёмная — дальность турелей',
  exotic: 'Экзотическая — дыра в кинетике',
  firestorm: 'Огненная — дыра в термике',
  gamma: 'Гамма — дыра во взрыве'
}

const WEATHER_BONUS: Record<AbyssWeather, string> = {
  electrical: 'Бонус: перезарядка накопителя вдвое быстрее (и у NPC).',
  dark: 'Бонус: +50% к максимальной скорости (и у NPC, когда догоняют).',
  exotic: 'Бонус: +50% к разрешению сканера (и у NPC).',
  firestorm: 'Бонус: +50% к HP брони (и у NPC).',
  gamma: 'Бонус: +50% к HP щитов (и у NPC).'
}

const FACTION_LABEL: Record<AbyssFaction, string> = {
  triglavian: 'Триглавы',
  drifter: 'Дрифтеры',
  sleeper: 'Слиперы',
  rogue_drone: 'Восставшие дроны',
  sansha: 'Санша',
  angel: 'Ангелы',
  edencom: 'EDENCOM'
}

const EWAR_LABEL: Record<string, string> = {
  web: 'сеть',
  paint: 'подсветка',
  scram: 'скрамблер',
  damp: 'демпфер',
  track: 'сбивает наведение',
  guide: 'сбивает ракеты',
  remote: 'чинит своих',
  chain: 'цепная молния'
}

const LAYER_LABEL = { shield: 'щит', armor: 'броня', hull: 'корпус' }
const DAMAGE = ['ЭМ', 'Терм', 'Кин', 'Взр']

const n0 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 0 })
const n1 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 })
const sec = (s: number) => (!Number.isFinite(s) ? '∞' : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${n0(s)} с`)

function cap(s: AbyssFitSide): string {
  return s.capStable ? `${n0((s.capLevel ?? 0) * 100)}%` : sec(s.capLasts ?? 0)
}

export function FitAbyss({ fit, skills }: { fit: FitSpec; skills: SkillSource }) {
  const [weather, setWeather] = useState<AbyssWeather>('electrical')
  const [tier, setTier] = useState(4)
  const strengths = tierStrengths(tier)
  const [strengthPick, setStrength] = useState<number | null>(null)
  // The worse roll of the tier unless one is chosen.
  const strength = strengthPick !== null && strengths.includes(strengthPick) ? strengthPick : strengths[1]
  const [faction, setFaction] = useState<AbyssFaction>('triglavian')
  const report = useAsync(() => window.api.fit.abyss(fit, skills, weather, strength), [fit, skills, weather, strength])

  if (!fit.modules.length && !fit.drones.length) return <Empty>Соберите фит — планировщик покажет, как он поведёт себя в Бездне.</Empty>
  const r = report.data
  const hole = WEATHER_HOLE[weather]
  const f = r?.factions.find((x) => x.faction === faction) ?? r?.factions[0]

  return (
    <div className="abyss">
      <div className="row wrap">
        <select value={weather} onChange={(e) => setWeather(e.target.value as AbyssWeather)}>
          {ABYSS_WEATHERS.map((w) => (
            <option key={w} value={w}>
              {WEATHER_LABEL[w]}
            </option>
          ))}
        </select>
        <select value={tier} onChange={(e) => setTier(Number(e.target.value))}>
          {ABYSS_TIERS.map((name, i) => (
            <option key={name} value={i}>
              {`T${i} ${name}`}
            </option>
          ))}
        </select>
        <span className="muted">Сила штрафа:</span>
        {strengths.map((s) => (
          <button key={s} className={`chip-btn ${strength === s ? 'active' : ''}`} onClick={() => setStrength(s)}>
            {`−${s}%`}
          </button>
        ))}
      </div>
      <div className="muted small">
        {WEATHER_BONUS[weather]} Сила штрафа выпадает случайно: до T3 — 30% или 50%, с T4 — 50% или 70%. По умолчанию — худший вариант.
      </div>
      <ErrorBox error={report.error} />
      {!r ? (
        <Loading />
      ) : (
        <>
          <table className="table compact">
            <thead>
              <tr>
                <th />
                <th className="num">Обычный космос</th>
                <th className="num">В погоде</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Сопротивления (<span>{LAYER_LABEL[r.layer]}</span>)
                </td>
                <td className="num">{r.normal.resist.map((x) => n0(x * 100)).join(' / ')}</td>
                <td className="num">
                  {r.inWeather.resist.map((x, k) => (
                    <span key={k} className={k === hole ? 'bad' : ''}>
                      {`${k ? ' / ' : ''}${n0(x * 100)}`}
                    </span>
                  ))}
                </td>
              </tr>
              <tr>
                <td>EHP</td>
                <td className="num">{n0(r.normal.ehp)}</td>
                <td className="num">{n0(r.inWeather.ehp)}</td>
              </tr>
              <tr>
                <td>Ремонт, HP/с</td>
                <td className="num">{n1(r.normal.repair)}</td>
                <td className="num">{n1(r.inWeather.repair)}</td>
              </tr>
              <tr>
                <td>Накопитель</td>
                <td className="num">{cap(r.normal)}</td>
                <td className={`num ${r.inWeather.capStable ? 'good' : ''}`}>{cap(r.inWeather)}</td>
              </tr>
              <tr>
                <td>Урон (DPS)</td>
                <td className="num">{n0(r.normal.dps)}</td>
                <td className="num">{n0(r.inWeather.dps)}</td>
              </tr>
              <tr>
                <td>Дальность оружия, км</td>
                <td className="num">{n1(r.normal.reach / 1000)}</td>
                <td className={`num ${r.inWeather.reach < r.normal.reach - 1 ? 'bad' : ''}`}>{n1(r.inWeather.reach / 1000)}</td>
              </tr>
              <tr>
                <td>Скорость, м/с</td>
                <td className="num">{n0(r.normal.speed)}</td>
                <td className="num">{n0(r.inWeather.speed)}</td>
              </tr>
            </tbody>
          </table>

          <Tabs tabs={r.factions.map((x) => ({ id: x.faction, label: FACTION_LABEL[x.faction] }))} value={f?.faction ?? faction} onChange={setFaction} />
          {f && (
            <>
              <div className="row wrap">
                <span>
                  Медиана убийства: <b>{sec(f.ttkMedian)}</b>
                </span>
                <span>
                  Самый опасный бьёт на <b className={f.worstTaken > r.inWeather.repair ? 'bad' : 'good'}>{n0(f.worstTaken)}</b> DPS сквозь ваши сопротивления,
                  ремонт — <b>{n0(r.inWeather.repair)}</b> HP/с
                </span>
              </div>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>NPC</th>
                    <th className="num">HP</th>
                    <th className="num">Убить за</th>
                    <th className="num">Попадает</th>
                    <th className="num">Бьёт по вам</th>
                    <th>Тип урона</th>
                    <th className="num">Нейтрит, ГДж/с</th>
                    <th>Ещё</th>
                  </tr>
                </thead>
                <tbody>
                  {f.npcs.map((n) => {
                    const total = n.types.reduce((s, x) => s + x, 0)
                    return (
                      <tr key={n.id}>
                        <td>{n.name}</td>
                        <td className="num">{n0(n.hp)}</td>
                        <td className={`num ${Number.isFinite(n.ttk) ? '' : 'bad'}`}>{sec(n.ttk)}</td>
                        <td className={`num ${n.application < 0.5 ? 'bad' : ''}`}>{`${n0(Math.min(1, n.application) * 100)}%`}</td>
                        <td className={`num ${n.taken > r.inWeather.repair ? 'bad' : ''}`}>{n0(n.taken)}</td>
                        <td className="small muted">
                          {total > 0
                            ? n.types
                                .map((x, k) => [x, k] as const)
                                .filter(([x]) => x / total >= 0.15)
                                .map(([x, k]) => `${DAMAGE[k]} ${n0((x / total) * 100)}%`)
                                .join(' · ')
                            : '—'}
                        </td>
                        <td className={`num ${n.neut >= 10 ? 'bad' : ''}`}>{n.neut ? n1(n.neut) : ''}</td>
                        <td className="small">{n.ewar.map((e) => EWAR_LABEL[e] ?? e).join(', ')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
          <div className="muted small">
            По каждому NPC отдельно: состава комнат в данных игры нет. Урон NPC — на бумаге (все выстрелы попадают, дезинтеграторы разогнаны), «бьёт по вам» — после
            ваших сопротивлений в погоде. Погода действует и на NPC: их дыра в сопротивлении и бонус к HP учтены. Время убийства — без перелётов и перезарядки, с
            самопочинкой NPC.
          </div>
        </>
      )}
    </div>
  )
}
