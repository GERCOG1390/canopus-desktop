// What the character is worth: the wallet, assets and implants at Jita sell, sell orders at their own price,
// the ISK held in buy orders. Each part loads on its own, so a missing permission leaves only that line empty.

import { useCharacter } from '../../CharacterContext'
import { TypeLink } from '../../components/TypeLink'
import { Card, ErrorBox, Loading } from '../../components/ui'
import { esi } from '../../lib/esi'
import { fmtIsk, fmtNum } from '../../lib/format'
import { jitaPrices } from '../../lib/market'
import { useAsync } from '../../lib/useAsync'
import { computeWealth, type WealthInput } from '../../../../shared/wealth'

const COLORS = { wallet: 'var(--accent)', assets: 'var(--dmg-em)', sell: 'var(--warn)', escrow: 'var(--dmg-ex)', head: 'var(--bad)', clones: 'var(--dmg-ki)' }

export default function Wealth({ id }: { id: number }) {
  const char = useCharacter()
  const { data, error, loading, reload } = useAsync(async () => {
    const auth = { characterId: id }
    const [wallet, assets, orders, clones] = await Promise.all([
      esi<number>(`/characters/${id}/wallet/`, auth).catch(() => null),
      esi<NonNullable<WealthInput['assets']>>(`/characters/${id}/assets/`, { ...auth, allPages: true }).catch(() => null),
      esi<NonNullable<WealthInput['orders']>>(`/characters/${id}/orders/`, auth).catch(() => null),
      esi<{ jump_clones: { implants: number[] }[] }>(`/characters/${id}/clones/`, auth).catch(() => null)
    ])
    const implants = char.implants ?? null
    const cloneImplants = clones ? clones.jump_clones.flatMap((c) => c.implants) : null
    const ids = [...new Set([...(assets ?? []).map((a) => a.type_id), ...(implants ?? []), ...(cloneImplants ?? [])])]
    const market = ids.length ? await jitaPrices(ids) : new Map()
    const prices = new Map(ids.map((t) => [t, market.get(t)?.sell.best ?? 0]))
    return {
      wealth: computeWealth({ wallet, assets, orders, implants, cloneImplants, prices }),
      stacks: assets?.length,
      sellCount: orders?.filter((o) => !o.is_buy_order).length,
      buyCount: orders?.filter((o) => o.is_buy_order).length,
      cloneCount: clones?.jump_clones.length
    }
  }, [id, char.implants?.join(',')])

  if (loading && !data) return <Loading />
  if (!data) return <ErrorBox error={error} />
  const w = data.wealth
  const rows = [
    { key: 'wallet', label: 'Кошелёк', value: w.wallet },
    { key: 'assets', label: 'Ассеты', value: w.assets, sub: data.stacks === undefined ? undefined : `стеков: ${fmtNum(data.stacks)}` },
    { key: 'sell', label: 'Ордера на продажу', value: w.sell, sub: data.sellCount === undefined ? undefined : `ордеров: ${data.sellCount}` },
    { key: 'escrow', label: 'Эскроу buy-ордеров', value: w.escrow, sub: data.buyCount === undefined ? undefined : `ордеров: ${data.buyCount}` },
    { key: 'head', label: 'Импланты в голове', value: w.head },
    { key: 'clones', label: 'Импланты в джамп-клонах', value: w.clones, sub: data.cloneCount === undefined ? undefined : `клонов: ${data.cloneCount}` }
  ] as const

  return (
    <>
      <Card
        title="Капитал"
        actions={
          <button className="ghost" onClick={reload}>
            Обновить
          </button>
        }
      >
        <div className="stat-value" style={{ fontSize: 32, marginBottom: 10 }}>
          {fmtIsk(w.total, true)}
        </div>
        {w.total > 0 && (
          <div style={{ display: 'flex', gap: 2, height: 10, borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
            {rows
              .filter((r) => (r.value ?? 0) > 0)
              .map((r) => (
                <div key={r.key} style={{ flexGrow: r.value ?? 0, flexBasis: 2, background: COLORS[r.key] }} />
              ))}
          </div>
        )}
        <table className="table compact">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 8, background: COLORS[r.key] }} />
                  {r.label}
                  {'sub' in r && r.sub && <span className="muted small">{` · ${r.sub}`}</span>}
                </td>
                <td className="num muted">{r.value !== null && w.total > 0 ? `${Math.round((r.value / w.total) * 100)}%` : ''}</td>
                <td className="num">{r.value === null ? <span className="muted small">нет доступа</span> : fmtIsk(r.value, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Ассеты и импланты — по Jita sell (копии чертежей не считаются); ордера на продажу — по их цене; buy-ордера — по ISK в эскроу. Не входят: контракты, PLEX в хранилище аккаунта, имущество и ордера корпорации.</p>
        {w.unpriced > 0 && <p className="warn-text small">{`Без цены в Jita: ${w.unpriced} видов предметов, они посчитаны как 0.`}</p>}
      </Card>
      {w.top.length > 0 && (
        <Card title="Самые дорогие предметы">
          <table className="table compact">
            <tbody>
              {w.top.map((t) => (
                <tr key={t.id}>
                  <td>
                    <TypeLink id={t.id} size={24} />
                  </td>
                  <td className="num">{fmtIsk(t.value, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}
