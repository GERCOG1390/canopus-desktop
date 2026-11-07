// Public contracts of a region: find who sells an item and what's cheaper than Jita. ESI lists contracts
// without contents, so each one looked into is its own request: the newest that pass the filters, up to a limit.

import { useEffect, useRef, useState } from 'react'
import { useApp, useLang } from '../AppContext'
import { GameButton } from '../components/GameButton'
import { TypeLink } from '../components/TypeLink'
import { Card, Empty, ProgressBar, SearchBox, Stat } from '../components/ui'
import { esi, resolveLocations } from '../lib/esi'
import { fmtDate, fmtIsk, fmtNum } from '../lib/format'
import { openContractInGame, SCOPE } from '../lib/gameActions'
import { jitaPrices } from '../lib/market'
import { searchTypesSde, tn } from '../lib/sde'
import { useAsync } from '../lib/useAsync'
import { limitedFor } from '../../../shared/esiLimit'
import { dealOf, pickContracts, sells, type ContractDeal, type PublicContract, type PublicContractItem } from '../../../shared/publicContracts'

/** Contracts looked into per search */
const SCAN_LIMIT = 1500
const CONCURRENCY = 10
/** ESI answers errors for contracts gone by now; many of those and it starts refusing everything */
const MAX_ERRORS = 40
const THE_FORGE = 10000002
/** What contracts contain doesn't change: kept so that a new search or "further" doesn't ask again */
const contents = new Map<number, PublicContractItem[]>()

interface Row {
  contract: PublicContract
  items: PublicContractItem[]
  deal: ContractDeal
  place: string
  /** Jita price of an item */
  unit: (id: number) => number
}

export default function PublicContracts() {
  const { active } = useApp()
  const lang = useLang()
  const regions = useAsync(() => window.api.sde.regions(), [])
  const [region, setRegion] = useState(THE_FORGE)
  const [item, setItem] = useState<{ id: number; name: string } | null>(null)
  const [kind, setKind] = useState<'any' | 'item_exchange' | 'auction'>('any')
  const [minM, setMinM] = useState(0)
  const [maxM, setMaxM] = useState(0)
  const [title, setTitle] = useState('')
  const [sort, setSort] = useState<'gain' | 'price'>('gain')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ rows: Row[]; picked: PublicContract[]; scanned: number; errors: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [waitSeconds, setWaitSeconds] = useState<number | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const run = useRef(0)
  useEffect(
    () => () => {
      run.current++
    },
    []
  )

  /** Looks into the next contracts of the list, from a fresh search or where the last one stopped. */
  const scan = async (given: { picked: PublicContract[]; scanned: number; errors: number } | null) => {
    const me = ++run.current
    setError(null)
    setWaitSeconds(null)
    setOpen(null)
    if (!given) setResult(null)
    setProgress({ done: given?.scanned ?? 0, total: given?.picked.length ?? 0 })
    try {
      const picked =
        given?.picked ?? pickContracts(await esi<PublicContract[]>(`/contracts/public/${region}/`, { allPages: true }), { kind, minPrice: minM * 1e6, maxPrice: maxM * 1e6, title, now: Date.now() })
      const start = given?.scanned ?? 0
      const end = Math.min(picked.length, start + SCAN_LIMIT)
      let next = start
      let done = start
      let errors = 0
      let limited: number | null = null
      setProgress({ done, total: end })
      const worker = async () => {
        while (next < end && errors < MAX_ERRORS && limited === null && run.current === me) {
          const c = picked[next++]
          if (!contents.has(c.contract_id)) {
            try {
              contents.set(c.contract_id, await esi<PublicContractItem[]>(`/contracts/public/items/${c.contract_id}/`, { allPages: true }))
            } catch (e) {
              const wait = limitedFor(e instanceof Error ? e.message : String(e))
              if (wait === null) errors++
              else limited = wait
            }
          }
          done++
          if (done % 10 === 0 && run.current === me) setProgress({ done, total: end })
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
      if (run.current !== me) return
      const matching = picked.slice(0, done).filter((c) => {
        const items = contents.get(c.contract_id)
        return !!items?.length && (!item || sells(items, item.id))
      })
      const ids = new Set(matching.flatMap((c) => (contents.get(c.contract_id) ?? []).map((i) => i.type_id)))
      const prices = await jitaPrices([...ids])
      const places = await resolveLocations(matching.map((c) => c.start_location_id ?? 0), active?.id ?? null)
      if (run.current !== me) return
      const rows = matching.map((contract) => {
        const items = contents.get(contract.contract_id) ?? []
        return {
          contract,
          items,
          deal: dealOf(contract, items, (id) => prices.get(id)?.sell.best ?? 0),
          place: places.get(contract.start_location_id ?? 0) ?? '—',
          unit: (id: number) => prices.get(id)?.sell.best ?? 0
        }
      })
      setWaitSeconds(limited)
      setResult({ rows, picked, scanned: done, errors: (given?.errors ?? 0) + errors })
    } catch (e) {
      if (run.current === me) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (run.current === me) setProgress(null)
    }
  }

  const rows = [...(result?.rows ?? [])].sort((a, b) => (sort === 'gain' ? b.deal.gain - a.deal.gain : a.deal.cost - b.deal.cost)).slice(0, 200)
  return (
    <>
      <Card title="Публичные контракты">
        <div className="calc-form">
          <label>
            Регион
            <select value={region} onChange={(e) => setRegion(Number(e.target.value))}>
              {(regions.data ?? [{ id: THE_FORGE, n: ['The Forge', 'The Forge'] as [string, string] }]).map((r) => (
                <option key={r.id} value={r.id}>
                  {tn(r.n, lang)}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Что продаётся (необязательно)
            <SearchBox placeholder="Например: Rifter, Hobgoblin II, Fernite Carbide" search={(q) => searchTypesSde(q, lang)} onSelect={setItem} initial={item?.name ?? ''} />
          </label>
          <label>
            Тип
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="any">Любой</option>
              <option value="item_exchange">Обмен</option>
              <option value="auction">Аукцион</option>
            </select>
          </label>
          <label>
            Цена от, млн ISK
            <input type="number" min={0} value={minM} onChange={(e) => setMinM(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label>
            Цена до, млн ISK
            <input type="number" min={0} value={maxM} onChange={(e) => setMaxM(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label>
            В названии
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <button onClick={() => void scan(null)} disabled={!!progress}>
            Искать
          </button>
          {item && (
            <button
              className="ghost small"
              onClick={() => {
                setItem(null)
              }}
            >
              {`Без отбора по предмету (${item.name})`}
            </button>
          )}
        </div>
        {progress && (
          <>
            <ProgressBar value={progress.total ? progress.done / progress.total : 0} />
            <p className="muted small">{progress.total ? `Просмотрено ${fmtNum(progress.done)} из ${fmtNum(progress.total)}` : 'Загружаю список контрактов…'}</p>
          </>
        )}
        {error && <p className="warn-text small">{error}</p>}
        {waitSeconds !== null && <p className="warn-text small">{`ESI просит подождать, минут: ${Math.ceil(waitSeconds / 60)}. Что успели прочитать, сохранено.`}</p>}
      </Card>
      {!result && !progress ? (
        <Empty>Выберите регион и нажмите «Искать». Предмет можно не указывать: тогда покажутся самые выгодные контракты.</Empty>
      ) : result ? (
        <>
          <div className="stats-row">
            <Stat label="Подошло под фильтры" value={fmtNum(result.picked.length)} />
            <Stat label="Просмотрено" value={fmtNum(result.scanned)} sub={result.picked.length > result.scanned ? 'самые свежие' : undefined} />
            <Stat label="Найдено" value={fmtNum(result.rows.length)} />
          </div>
          {result.errors > 0 && <p className="warn-text small">{`Не открылось контрактов: ${result.errors}`}</p>}
          {result.picked.length > result.scanned && (
            <div className="row">
              <button className="ghost small" onClick={() => void scan(result)} disabled={!!progress}>
                {`Смотреть дальше: ещё ${fmtNum(Math.min(SCAN_LIMIT, result.picked.length - result.scanned))}`}
              </button>
              <span className="muted small">Или сузьте цену и название: старые контракты просматриваются последними.</span>
            </div>
          )}
          {!result.rows.length && <Empty>Ничего не нашлось.</Empty>}
          {result.rows.length > 0 && <Card title="Контракты">
            <div className="row">
              <button className={`chip-btn small${sort === 'gain' ? ' active' : ''}`} onClick={() => setSort('gain')}>
                Выгоднее всего
              </button>
              <button className={`chip-btn small${sort === 'price' ? ' active' : ''}`} onClick={() => setSort('price')}>
                Дешевле всего
              </button>
            </div>
            <table className="table compact">
              <thead>
                <tr>
                  <th>Содержимое</th>
                  <th>Где</th>
                  <th className="num">Цена</th>
                  <th className="num">В Jita</th>
                  <th className="num">Выгода</th>
                  <th className="num">Истекает</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((r) => {
                  const offered = r.items.filter((i) => i.is_included)
                  const asked = r.items.filter((i) => !i.is_included)
                  const lead = (item && offered.find((i) => i.type_id === item.id)) ?? [...offered].sort((a, b) => b.quantity * r.unit(b.type_id) - a.quantity * r.unit(a.type_id))[0]
                  const id = r.contract.contract_id
                  const main = (
                    <tr key={id}>
                      <td>
                        {lead && <TypeLink id={lead.type_id} size={20} />}
                        {lead && lead.quantity > 1 && <span className="muted small">{` ×${fmtNum(lead.quantity)}`}</span>}
                        {r.items.length > 1 && (
                          <button className="ghost small" onClick={() => setOpen(open === id ? null : id)}>
                            {`Всего позиций: ${r.items.length}`}
                          </button>
                        )}
                        {r.contract.title && <div className="muted small">{r.contract.title}</div>}
                      </td>
                      <td className="small">{r.place}</td>
                      <td className="num">
                        {fmtIsk(r.deal.cost, true)}
                        {r.contract.type === 'auction' && <div className="muted small">{r.contract.buyout ? 'аукцион, выкуп' : 'аукцион, старт'}</div>}
                      </td>
                      <td className="num">
                        {fmtIsk(r.deal.value, true)}
                        {r.deal.unpriced > 0 && <div className="warn-text small">{`без цены: ${r.deal.unpriced}`}</div>}
                      </td>
                      <td className="num">
                        <span className={r.deal.gain >= 0 ? 'good' : 'bad'}>{fmtIsk(r.deal.gain, true)}</span>
                      </td>
                      <td className="num small">{fmtDate(r.contract.date_expired)}</td>
                      <td className="num">
                        <GameButton scope={SCOPE.openWindow} action={(who) => openContractInGame(who, id)} title="Открыть этот контракт в клиенте игры" className="ghost small">
                          Открыть в игре
                        </GameButton>
                      </td>
                    </tr>
                  )
                  if (open !== id) return [main]
                  return [
                    main,
                    <tr key={`${id}-items`}>
                      <td colSpan={7}>
                        <div className="link-grid">
                          {offered.map((i, n) => (
                            <span key={n}>
                              <TypeLink id={i.type_id} size={20} />
                              {` ×${fmtNum(i.quantity)}${i.is_blueprint_copy ? ' (BPC)' : ''}`}
                            </span>
                          ))}
                        </div>
                        {asked.length > 0 && (
                          <>
                            <p className="muted small">Просит взамен:</p>
                            <div className="link-grid">
                              {asked.map((i, n) => (
                                <span key={n}>
                                  <TypeLink id={i.type_id} size={20} />
                                  {` ×${fmtNum(i.quantity)}`}
                                </span>
                              ))}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  ]
                })}
              </tbody>
            </table>
            <p className="muted small">
              Выгода считается по лучшей цене продажи в Jita и не учитывает налог, перевозку и то, что большую партию одной ценой не продать. Копии чертежей и предметы без цены в Jita в
              стоимость не входят. Цена аукциона — выкуп, а если его нет, начальная ставка: итог может оказаться выше. Перед покупкой проверьте контракт в игре, продавцы подменяют похожие
              предметы.
            </p>
          </Card>}
        </>
      ) : null}
    </>
  )
}
