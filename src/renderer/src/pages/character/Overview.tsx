import { useCharacter } from '../../CharacterContext'
import { AttrIcon } from '../../components/Icon'
import { Card, Empty, ErrorBox, Loading, ProgressBar, Sec, Stat } from '../../components/ui'
import { TypeLink } from '../../components/TypeLink'
import { ATTR_NAMES } from '../../lib/dogma'
import { esi, imageUrl, resolveLocations, resolveNames, systemInfo } from '../../lib/esi'
import { fmtDate, fmtDuration, fmtIsk, fmtNum, ROMAN } from '../../lib/format'
import { tn } from '../../lib/sde'
import { useAsync, useTick } from '../../lib/useAsync'
import { useLang } from '../../AppContext'

interface PublicInfo {
  name: string
  corporation_id: number
  alliance_id?: number
  security_status?: number
  birthday: string
  gender?: string
  race_id?: number
  bloodline_id?: number
  description?: string
  title?: string
}

const settle = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null)

export default function Overview({ id }: { id: number }) {
  const now = useTick(1000)
  const lang = useLang()
  const char = useCharacter()
  const { data, error, loading, reload } = useAsync(async () => {
    const auth = { characterId: id }
    const [info, wallet, location, ship, online, history] = await Promise.all([
      esi<PublicInfo>(`/characters/${id}/`),
      settle(esi<number>(`/characters/${id}/wallet/`, auth)),
      settle(esi<{ solar_system_id: number; station_id?: number; structure_id?: number }>(`/characters/${id}/location/`, auth)),
      settle(esi<{ ship_type_id: number; ship_name: string; ship_item_id: number }>(`/characters/${id}/ship/`, auth)),
      settle(esi<{ online: boolean; last_login?: string; last_logout?: string; logins?: number }>(`/characters/${id}/online/`, auth)),
      settle(esi<{ corporation_id: number; start_date: string }[]>(`/characters/${id}/corporationhistory/`))
    ])
    const names = await resolveNames([info.corporation_id, info.alliance_id ?? 0, ...(history ?? []).map((h) => h.corporation_id)])
    const locNames = location ? await resolveLocations([location.station_id ?? 0, location.structure_id ?? 0], id) : new Map<number, string>()
    const system = location ? await systemInfo(location.solar_system_id) : null
    return { info, wallet, location, ship, online, history, names, locNames, system }
  }, [id])

  if (loading && !data) return <Loading />
  if (!data) return <ErrorBox error={error} />
  const { info, wallet, location, ship, online, history, names, locNames, system } = data

  const queue = (char.queue ?? []).filter((q) => !q.finish_date || new Date(q.finish_date).getTime() > now)
  const queueEnd = queue.at(-1)?.finish_date

  return (
    <>
      <ErrorBox error={error} />
      <Card
        className="hero"
        actions={
          <button
            className="ghost"
            onClick={() => {
              reload()
              char.reload()
            }}
          >
            Обновить
          </button>
        }
      >
        <div className="hero-body">
          <img className="portrait" src={imageUrl.portrait(id, 256)} alt="" />
          <div className="hero-main">
            <h2>{info.name}</h2>
            <div className="org">
              <img src={imageUrl.corpLogo(info.corporation_id, 32)} width={20} height={20} alt="" />
              {names.get(info.corporation_id)}
              {info.alliance_id && (
                <>
                  <span className="muted">·</span>
                  <img src={imageUrl.allianceLogo(info.alliance_id, 32)} width={20} height={20} alt="" />
                  {names.get(info.alliance_id)}
                </>
              )}
            </div>
            <div className="muted">
              {online && (online.online ? <span className="online">● в игре</span> : `Последний вход: ${online.last_login ? fmtDate(online.last_login) : '—'}`)}
              {info.security_status !== undefined && <> · Статус безопасности {info.security_status.toFixed(2)}</>}
              {' · '}Создан {fmtDate(info.birthday)}
              {online?.logins ? <> · входов: {fmtNum(online.logins)}</> : null}
            </div>
          </div>
          {ship && (
            <div className="hero-ship">
              <img src={imageUrl.typeRender(ship.ship_type_id, 128)} width={96} height={96} alt="" />
              <div>
                <TypeLink id={ship.ship_type_id} icon={false} />
                <div className="muted">{ship.ship_name}</div>
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="stats-row">
        <Stat label="Кошелёк" value={wallet == null ? '—' : fmtIsk(wallet, true)} sub={wallet == null ? 'нет доступа' : fmtIsk(wallet)} />
        <Stat label="Всего SP" value={fmtNum(char.totalSp)} sub={char.unallocatedSp ? `Нераспределено: ${fmtNum(char.unallocatedSp)}` : `${char.skills?.size ?? 0} навыков`} />
        <Stat
          label="Местоположение"
          value={
            system ? (
              <>
                <Sec value={system.security_status} /> {system.name}
              </>
            ) : (
              '—'
            )
          }
          sub={location?.station_id ? locNames.get(location.station_id) : location?.structure_id ? locNames.get(location.structure_id) : location ? 'в космосе' : undefined}
        />
        <Stat label="Очередь навыков" value={queueEnd ? fmtDuration(new Date(queueEnd).getTime() - now) : 'пусто'} sub={`${queue.length} в очереди`} />
      </div>

      <div className="two-col">
        <Card title="Очередь обучения">
          {char.queue === null && !char.loading && <Empty>Нет доступа к очереди.</Empty>}
          {char.queue && !queue.length && <Empty>Очередь пуста — персонаж ничего не изучает!</Empty>}
          <ul className="queue">
            {queue.map((q, i) => {
              const start = q.start_date ? new Date(q.start_date).getTime() : 0
              const end = q.finish_date ? new Date(q.finish_date).getTime() : 0
              let progress = 0
              if (i === 0 && start && end && q.level_end_sp && q.level_start_sp !== undefined) {
                const frac = Math.max(0, Math.min(1, (now - start) / (end - start)))
                const startSp = q.training_start_sp ?? q.level_start_sp
                progress = (startSp + (q.level_end_sp - startSp) * frac - q.level_start_sp) / (q.level_end_sp - q.level_start_sp)
              }
              return (
                <li key={`${q.skill_id}-${q.finished_level}`}>
                  <div className="queue-row">
                    <span>
                      <TypeLink id={q.skill_id} icon={false} /> <b>{ROMAN[q.finished_level]}</b>
                    </span>
                    <span className="muted">{end ? fmtDuration(end - now) : 'на паузе'}</span>
                  </div>
                  {i === 0 && <ProgressBar value={progress} />}
                </li>
              )
            })}
          </ul>
        </Card>

        <div className="stack">
          <Card title="Атрибуты">
            {char.attributes ? (
              <table className="table compact kv">
                <tbody>
                  {Object.entries(ATTR_NAMES).map(([aid, n]) => {
                    const total = char.attributes![Number(aid)]
                    const base = char.baseAttributes?.[Number(aid)] ?? total
                    return (
                      <tr key={aid}>
                        <td className="attr-name">
                          <AttrIcon attr={Number(aid)} />
                          {tn(n, lang)}
                        </td>
                        <td className="num">
                          <b>{total}</b>
                          {total !== base && <span className="good small"> (+{total - base} импланты)</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <Empty>Нет данных</Empty>
            )}
          </Card>
          <Card title="Активные импланты">
            {char.implants?.length ? (
              <ul className="plain-list">
                {char.implants.map((i) => (
                  <li key={i}>
                    <TypeLink id={i} size={24} />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>{char.implants ? 'Имплантов нет' : 'Нет доступа (esi-clones.read_implants.v1)'}</Empty>
            )}
          </Card>
        </div>
      </div>

      {history && history.length > 0 && (
        <Card title="История корпораций">
          <table className="table compact">
            <tbody>
              {history.map((h, i) => (
                <tr key={`${h.corporation_id}-${h.start_date}`}>
                  <td>
                    <img src={imageUrl.corpLogo(h.corporation_id, 32)} width={20} height={20} alt="" className="type-icon" /> {names.get(h.corporation_id)}
                  </td>
                  <td className="muted num">
                    {fmtDate(h.start_date).slice(0, 10)} — {i === 0 ? 'сейчас' : fmtDate(history[i - 1].start_date).slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}
