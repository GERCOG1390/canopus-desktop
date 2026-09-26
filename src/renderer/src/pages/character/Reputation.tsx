import { Card, Empty, Loading, Stat } from '../../components/ui'
import { esi, imageUrl, resolveNames } from '../../lib/esi'
import { fmtDate, fmtDuration, fmtNum } from '../../lib/format'
import { useAsync, useTick } from '../../lib/useAsync'
import { ScopeHint } from '.'

interface Standing {
  from_id: number
  from_type: 'agent' | 'npc_corp' | 'faction'
  standing: number
}

const settle = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null)

export default function Reputation({ id }: { id: number }) {
  const now = useTick(30_000)
  const { data, loading } = useAsync(async () => {
    const auth = { characterId: id }
    const [standings, loyalty, fatigue] = await Promise.all([
      settle(esi<Standing[]>(`/characters/${id}/standings/`, auth)),
      settle(esi<{ corporation_id: number; loyalty_points: number }[]>(`/characters/${id}/loyalty/points/`, auth)),
      settle(esi<{ jump_fatigue_expire_date?: string; last_jump_date?: string; last_update_date?: string }>(`/characters/${id}/fatigue/`, auth))
    ])
    const names = await resolveNames([...(standings ?? []).map((s) => s.from_id), ...(loyalty ?? []).map((l) => l.corporation_id)])
    return { standings, loyalty, fatigue, names }
  }, [id])

  if (loading || !data) return <Loading />
  const { standings, loyalty, fatigue, names } = data
  const fatigueLeft = fatigue?.jump_fatigue_expire_date ? new Date(fatigue.jump_fatigue_expire_date).getTime() - now : 0

  const groups: [Standing['from_type'], string][] = [
    ['faction', 'Фракции'],
    ['npc_corp', 'NPC-корпорации'],
    ['agent', 'Агенты']
  ]

  return (
    <>
      <div className="stats-row">
        <Stat
          label="Усталость от прыжков"
          value={!fatigue ? '—' : fatigueLeft > 0 ? fmtDuration(fatigueLeft) : 'нет'}
          sub={fatigue?.last_jump_date ? `последний прыжок: ${fmtDate(fatigue.last_jump_date)}` : undefined}
        />
        <Stat label="Корпораций с LP" value={loyalty?.length ?? '—'} sub={loyalty ? `всего ${fmtNum(loyalty.reduce((s, l) => s + l.loyalty_points, 0))} LP` : undefined} />
      </div>

      <div className="two-col">
        <Card title="Очки лояльности (LP)">
          {!loyalty ? (
            <ScopeHint scope="esi-characters.read_loyalty.v1" />
          ) : !loyalty.length ? (
            <Empty>Нет LP</Empty>
          ) : (
            <table className="table compact">
              <tbody>
                {[...loyalty]
                  .sort((a, b) => b.loyalty_points - a.loyalty_points)
                  .map((l) => (
                    <tr key={l.corporation_id}>
                      <td>
                        <img className="type-icon" src={imageUrl.corpLogo(l.corporation_id, 32)} width={20} height={20} alt="" /> {names.get(l.corporation_id)}
                      </td>
                      <td className="num">{fmtNum(l.loyalty_points)} LP</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Репутация (стендинги)">
          {!standings ? (
            <ScopeHint scope="esi-characters.read_standings.v1" />
          ) : (
            groups.map(([type, label]) => {
              const list = standings.filter((s) => s.from_type === type).sort((a, b) => b.standing - a.standing)
              if (!list.length) return null
              return (
                <details key={type} open={type !== 'agent'}>
                  <summary>
                    {label} <span className="muted">({list.length})</span>
                  </summary>
                  <table className="table compact">
                    <tbody>
                      {list.map((s) => (
                        <tr key={s.from_id}>
                          <td>{names.get(s.from_id) ?? s.from_id}</td>
                          <td className={`num ${s.standing > 0 ? 'good' : s.standing < 0 ? 'bad' : ''}`}>{s.standing.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )
            })
          )}
        </Card>
      </div>
    </>
  )
}
