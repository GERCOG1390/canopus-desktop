// Skill points as an item: what a million SP costs this character through injectors, and what a month of
// farming SP into injectors brings at today's Jita prices.

import { useState } from 'react'
import { useCharacter } from '../CharacterContext'
import { TypeLink } from '../components/TypeLink'
import { Card, ErrorBox, Loading, Stat } from '../components/ui'
import { fmtIsk, fmtNum } from '../lib/format'
import { jitaPrices } from '../lib/market'
import { useAsync } from '../lib/useAsync'
import { farmMonth, injectorGain, spCost } from '../../../shared/skillFarm'

const PLEX = 44992
const INJECTOR = 40520
const EXTRACTOR = 40519

export default function SkillFarm() {
  const char = useCharacter()
  const [spPerHour, setSpPerHour] = useState(2700)
  const [days, setDays] = useState(30)
  const [salesTax, setSalesTax] = useState(3.37)
  const [plexPerMonth, setPlexPerMonth] = useState(500)
  const [otherCost, setOtherCost] = useState(0)
  const prices = useAsync(() => jitaPrices([PLEX, INJECTOR, EXTRACTOR]), [])
  if (prices.loading && !prices.data) return <Loading />
  if (!prices.data) return <ErrorBox error={prices.error} />
  const sell = (id: number): number => prices.data?.get(id)?.sell.best ?? 0
  const totalSp = char.totalSp || 0
  const m = farmMonth({ spPerHour, days, injectorPrice: sell(INJECTOR), extractorPrice: sell(EXTRACTOR), salesTax: salesTax / 100, plexPrice: sell(PLEX), plexPerMonth, otherCost })
  const num = (value: number, set: (v: number) => void, step: number | string = 1) => (
    <input type="number" min={0} step={step} value={value} onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))} />
  )
  return (
    <>
      <div className="stats-row">
        {[INJECTOR, EXTRACTOR, PLEX].map((id) => (
          <Stat key={id} label="Цены сейчас" value={fmtIsk(sell(id), true)} sub={<TypeLink id={id} size={16} />} />
        ))}
      </div>
      <Card title="Покупка SP инжекторами">
        <div className="stats-row">
          <Stat label="Всего SP" value={fmtNum(totalSp)} />
          <Stat label="Персонаж получит за инжектор" value={fmtNum(injectorGain(totalSp))} />
          <Stat label="Цена 1 млн SP" value={fmtIsk(spCost(sell(INJECTOR), totalSp), true)} />
        </div>
        <p className="muted small">Сколько SP даёт инжектор, зависит от общего числа SP персонажа: до 5 млн — 500 000, до 50 млн — 400 000, до 80 млн — 300 000, больше — 150 000 (EVE University).</p>
      </Card>
      <Card title="Скиллфарм за месяц">
        <div className="calc-form">
          <label>
            SP в час
            {num(spPerHour, setSpPerHour)}
          </label>
          <label>
            Дней в месяце
            {num(days, setDays)}
          </label>
          <label>
            Налог с продаж инжекторов, %
            {num(salesTax, setSalesTax, 0.01)}
          </label>
          <label>
            PLEX за месяц подписки
            {num(plexPerMonth, setPlexPerMonth)}
          </label>
          <label>
            Прочие расходы в месяц, ISK
            {num(otherCost, setOtherCost, 'any')}
          </label>
        </div>
        <div className="stats-row">
          <Stat label="Инжекторов в месяц" value={m.injectors.toFixed(2)} sub={`${fmtNum(m.sp)} SP`} />
          <Stat label="Выручка" value={fmtIsk(m.revenue, true)} />
          <Stat label="Экстракторы" value={fmtIsk(m.extractors, true)} />
          <Stat label="Подписка" value={fmtIsk(m.subscription, true)} />
          <Stat label="Прибыль за месяц" value={<span className={m.profit >= 0 ? 'good' : 'bad'}>{fmtIsk(m.profit, true)}</span>} />
        </div>
        <p className="muted small">Расчёт по лучшим ценам Jita без учёта брокерской комиссии. Месячную цену подписки в PLEX и SP в час (2 700 — оптимальный ремап с имплантами +5) укажите свои. Извлекать SP можно только сверх 5,5 млн на персонаже.</p>
      </Card>
    </>
  )
}
