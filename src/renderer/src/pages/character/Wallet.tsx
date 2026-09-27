import { useState } from 'react'
import { TypeLink } from '../../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, Stat, Tabs } from '../../components/ui'
import { esi, resolveLocations, resolveNames } from '../../lib/esi'
import { LocationName } from '../../components/LocationName'
import { fmtDate, fmtIsk, fmtNum } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'

interface JournalEntry {
  id: number
  date: string
  ref_type: string
  amount?: number
  balance?: number
  description: string
  first_party_id?: number
  second_party_id?: number
  reason?: string
}

interface Transaction {
  transaction_id: number
  date: string
  type_id: number
  quantity: number
  unit_price: number
  is_buy: boolean
  location_id: number
  client_id: number
}

const REF_TYPES: Record<string, string> = {
  market_transaction: 'Сделка на рынке',
  market_escrow: 'Залог ордера',
  brokers_fee: 'Брокерская комиссия',
  transaction_tax: 'Налог с продаж',
  bounty_prizes: 'Награды за NPC',
  ess_escrow_transfer: 'Выплата ESS',
  agent_mission_reward: 'Награда за миссию',
  agent_mission_time_bonus_reward: 'Бонус за скорость',
  player_donation: 'Перевод от игрока',
  player_trading: 'Обмен',
  corporation_account_withdrawal: 'Выплата корпорации',
  insurance: 'Страховка',
  industry_job_tax: 'Налог на производство',
  planetary_import_tax: 'Налог на импорт PI',
  planetary_export_tax: 'Налог на экспорт PI',
  contract_price: 'Контракт: цена',
  contract_reward: 'Контракт: награда',
  contract_collateral: 'Контракт: залог',
  contract_brokers_fee: 'Контракт: комиссия',
  contract_sales_tax: 'Контракт: налог',
  contract_price_payment_corp: 'Контракт: оплата корпорации',
  jump_clone_installation_fee: 'Установка джамп-клона',
  jump_clone_activation_fee: 'Прыжок клона',
  reprocessing_tax: 'Налог на переработку',
  daily_goal_payouts: 'Ежедневные цели',
  skill_purchase: 'Покупка навыка',
  structure_gate_jump: 'Прыжок через Ansiblex',
  project_discovery_reward: 'Project Discovery',
  corporate_reward_payout: 'Выплата корпорации'
}

export default function Wallet({ id }: { id: number }) {
  const [tab, setTab] = useState<'journal' | 'tx'>('journal')
  const { data, error, loading } = useAsync(async () => {
    const auth = { characterId: id }
    const [balance, journal, tx] = await Promise.all([
      esi<number>(`/characters/${id}/wallet/`, auth),
      esi<JournalEntry[]>(`/characters/${id}/wallet/journal/`, { ...auth, allPages: true }).catch(() => [] as JournalEntry[]),
      esi<Transaction[]>(`/characters/${id}/wallet/transactions/`, auth).catch(() => [] as Transaction[])
    ])
    const names = await resolveNames(tx.map((t) => t.client_id))
    const locations = await resolveLocations(tx.map((t) => t.location_id), id)
    return { balance, journal, tx, names, locations }
  }, [id])

  if (loading) return <Loading />
  if (!data) return <ErrorBox error={error} />

  const month = Date.now() - 30 * 86400_000
  const recent = data.journal.filter((j) => new Date(j.date).getTime() > month)
  const income = recent.reduce((s, j) => s + Math.max(0, j.amount ?? 0), 0)
  const expense = recent.reduce((s, j) => s + Math.min(0, j.amount ?? 0), 0)
  const byType = new Map<string, number>()
  recent.forEach((j) => byType.set(j.ref_type, (byType.get(j.ref_type) ?? 0) + (j.amount ?? 0)))
  const topSources = [...byType.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8)

  return (
    <>
      <div className="stats-row">
        <Stat label="Баланс" value={fmtIsk(data.balance, true)} sub={fmtIsk(data.balance)} />
        <Stat label="Доход за 30 дней" value={<span className="good">{fmtIsk(income, true)}</span>} />
        <Stat label="Расход за 30 дней" value={<span className="bad">{fmtIsk(expense, true)}</span>} />
        <Stat label="Итого за 30 дней" value={fmtIsk(income + expense, true)} />
      </div>

      {topSources.length > 0 && (
        <Card title="Основные статьи за 30 дней">
          <table className="table compact">
            <tbody>
              {topSources.map(([type, sum]) => (
                <tr key={type}>
                  <td>{REF_TYPES[type] ?? type.replace(/_/g, ' ')}</td>
                  <td className={`num ${sum >= 0 ? 'good' : 'bad'}`}>{fmtIsk(sum, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Tabs
        tabs={[
          { id: 'journal', label: `Журнал (${data.journal.length})` },
          { id: 'tx', label: `Сделки на рынке (${data.tx.length})` }
        ]}
        value={tab}
        onChange={setTab}
      />
      <Card>
        {tab === 'journal' ? (
          !data.journal.length ? (
            <Empty>Записей нет</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Тип</th>
                  <th>Описание</th>
                  <th className="num">Сумма</th>
                  <th className="num">Баланс</th>
                </tr>
              </thead>
              <tbody>
                {data.journal.slice(0, 500).map((j) => (
                  <tr key={j.id}>
                    <td className="muted small nowrap">{fmtDate(j.date)}</td>
                    <td className="small">{REF_TYPES[j.ref_type] ?? j.ref_type.replace(/_/g, ' ')}</td>
                    <td className="small">{j.description}</td>
                    <td className={`num ${(j.amount ?? 0) >= 0 ? 'good' : 'bad'}`}>{fmtIsk(j.amount ?? 0, true)}</td>
                    <td className="num muted">{fmtIsk(j.balance ?? 0, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : !data.tx.length ? (
          <Empty>Сделок нет</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Предмет</th>
                <th className="num">Кол-во</th>
                <th className="num">Цена</th>
                <th className="num">Сумма</th>
                <th>Контрагент</th>
                <th>Где</th>
              </tr>
            </thead>
            <tbody>
              {data.tx.map((t) => (
                <tr key={t.transaction_id}>
                  <td className="muted small nowrap">{fmtDate(t.date)}</td>
                  <td>
                    <TypeLink id={t.type_id} />
                  </td>
                  <td className="num">{fmtNum(t.quantity)}</td>
                  <td className="num">{fmtIsk(t.unit_price)}</td>
                  <td className={`num ${t.is_buy ? 'bad' : 'good'}`}>
                    {t.is_buy ? '−' : '+'}
                    {fmtIsk(t.unit_price * t.quantity, true)}
                  </td>
                  <td className="small">{data.names.get(t.client_id)}</td>
                  <td className="muted small">{data.locations.has(t.location_id) && <LocationName id={t.location_id} name={data.locations.get(t.location_id)!} characterId={id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  )
}
