import { useLang } from '../../AppContext'
import { useCharacter } from '../../CharacterContext'
import { AttrIcon } from '../../components/Icon'
import { TypeLink } from '../../components/TypeLink'
import { Card, Empty, ErrorBox, Loading, Stat } from '../../components/ui'
import { ATTR_NAMES, IMPLANT_BONUS, IMPLANT_SLOT_ATTR } from '../../lib/dogma'
import { esi, resolveLocations } from '../../lib/esi'
import { LocationName } from '../../components/LocationName'
import { fmtDate, fmtDuration } from '../../lib/format'
import { tn } from '../../lib/sde'
import { useAsync, useTick } from '../../lib/useAsync'
import { ScopeHint } from '.'

interface Clones {
  home_location?: { location_id: number; location_type: string }
  jump_clones: { jump_clone_id: number; location_id: number; location_type: string; implants: number[]; name?: string }[]
  last_clone_jump_date?: string
  last_station_change_date?: string
}

const INFOMORPH_SYNCHRONIZING = 33399

export default function ClonesTab({ id }: { id: number }) {
  const lang = useLang()
  const char = useCharacter()
  const now = useTick(30_000)

  const { data, error, loading } = useAsync(async () => {
    const clones = await esi<Clones>(`/characters/${id}/clones/`, { characterId: id }).catch(() => null)
    const allImplants = [...(char.implants ?? []), ...(clones?.jump_clones.flatMap((c) => c.implants) ?? [])]
    const implantAttrs = await window.api.sde.dogmaAttrs(allImplants, [IMPLANT_SLOT_ATTR, ...Object.values(IMPLANT_BONUS)])
    const locations = await resolveLocations(
      [clones?.home_location?.location_id ?? 0, ...(clones?.jump_clones.map((c) => c.location_id) ?? [])],
      id
    )
    return { clones, implantAttrs, locations }
  }, [id, char.implants?.join(',')])

  if (loading || char.loading) return <Loading />
  if (!data) return <ErrorBox error={error} />
  const { clones, implantAttrs, locations } = data

  const slot = (implant: number) => implantAttrs[implant]?.[IMPLANT_SLOT_ATTR] ?? 0
  const bySlot = (list: number[]) => [...list].sort((a, b) => slot(a) - slot(b))
  const cooldownMs = (24 - char.level(INFOMORPH_SYNCHRONIZING)) * 3600_000
  const nextJump = clones?.last_clone_jump_date ? new Date(clones.last_clone_jump_date).getTime() + cooldownMs - now : 0

  return (
    <>
      <div className="stats-row">
        <Stat label="Джамп-клонов" value={clones ? clones.jump_clones.length : '—'} />
        <Stat
          label="Прыжок клона"
          value={!clones ? '—' : nextJump > 0 ? fmtDuration(nextJump) : 'доступен'}
          sub={clones?.last_clone_jump_date ? `последний: ${fmtDate(clones.last_clone_jump_date)}` : undefined}
        />
        <Stat
          label="Бесплатных перераспределений"
          value={char.remap?.bonus_remaps ?? '—'}
          sub={char.remap?.accrued_remap_cooldown_date ? `следующее: ${fmtDate(char.remap.accrued_remap_cooldown_date)}` : undefined}
        />
        <Stat label="Домашняя станция" value={<span className="small">{clones?.home_location ? <LocationName id={clones.home_location.location_id} name={locations.get(clones.home_location.location_id) ?? '?'} characterId={id} /> : '—'}</span>} />
      </div>

      <div className="two-col">
        <Card title="Атрибуты">
          {char.attributes ? (
            <table className="table compact">
              <thead>
                <tr>
                  <th>Атрибут</th>
                  <th className="num">Базовый</th>
                  <th className="num">Импланты</th>
                  <th className="num">Итого</th>
                </tr>
              </thead>
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
                      <td className="num">{base}</td>
                      <td className="num good">{total - base ? `+${total - base}` : ''}</td>
                      <td className="num">
                        <b>{total}</b>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <Empty>Нет данных об атрибутах</Empty>
          )}
          {char.remap?.last_remap_date && <p className="muted small">Последнее перераспределение: {fmtDate(char.remap.last_remap_date)}</p>}
        </Card>

        <Card title="Активный клон: импланты">
          {char.implants === null ? (
            <ScopeHint scope="esi-clones.read_implants.v1" />
          ) : char.implants.length ? (
            <ImplantList implants={bySlot(char.implants)} slot={slot} />
          ) : (
            <Empty>Имплантов нет</Empty>
          )}
        </Card>
      </div>

      <Card title="Джамп-клоны">
        {!clones ? (
          <ScopeHint scope="esi-clones.read_clones.v1" />
        ) : !clones.jump_clones.length ? (
          <Empty>Джамп-клонов нет</Empty>
        ) : (
          <div className="grid-cards">
            {clones.jump_clones.map((c) => (
              <div key={c.jump_clone_id} className="subcard">
                <div className="subcard-title">{c.name || <LocationName id={c.location_id} name={locations.get(c.location_id) ?? `Локация ${c.location_id}`} characterId={id} />}</div>
                {c.name && (
                  <div className="muted small">
                    <LocationName id={c.location_id} name={locations.get(c.location_id) ?? ''} characterId={id} />
                  </div>
                )}
                {c.implants.length ? <ImplantList implants={bySlot(c.implants)} slot={slot} /> : <div className="muted small">без имплантов</div>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}

function ImplantList({ implants, slot }: { implants: number[]; slot: (id: number) => number }) {
  return (
    <ul className="plain-list">
      {implants.map((i) => (
        <li key={i}>
          <span className="slot-no">{slot(i) || '—'}</span>
          <TypeLink id={i} size={24} />
        </li>
      ))}
    </ul>
  )
}
