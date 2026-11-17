// The pilot's own market fees at a hub: sales tax by Accounting, broker fee by Broker Relations and the pilot's
// standings with the station's owner corporation and its faction (owner and faction from ESI). Without a
// character: all skills V and no standings. Pages start their fee fields from it; the fields stay editable.

import { useEffect, useState } from 'react'
import { brokerPct, salesTaxPct } from '../../../shared/industryRules'
import { useApp } from '../AppContext'
import { useCharacter } from '../CharacterContext'
import { esi } from './esi'
import { ACCOUNTING_ID, BROKER_RELATIONS_ID } from './skillIds'
import { HUBS } from './market'

const ownerCache = new Map<number, Promise<{ corp: number; faction?: number }>>()
function stationOwner(stationId: number): Promise<{ corp: number; faction?: number }> {
  if (!ownerCache.has(stationId)) {
    ownerCache.set(
      stationId,
      esi<{ owner: number }>(`/universe/stations/${stationId}/`).then(async (s) => ({
        corp: s.owner,
        faction: (await esi<{ faction_id?: number }>(`/corporations/${s.owner}/`).catch(() => ({}) as { faction_id?: number })).faction_id
      }))
    )
  }
  return ownerCache.get(stationId)!
}

export interface TradeFees {
  tax: number
  broker: number
  /** Where the figures come from, for a hint under the fields */
  basis: string
}

export function useTradeFees(stationId = HUBS[0].stationId): TradeFees {
  const { active } = useApp()
  const char = useCharacter()
  const level = (id: number) => (char.skills ? (char.skills.get(id)?.active ?? 0) : 5)
  const [standing, setStanding] = useState<{ faction: number; corp: number } | null>(null)
  useEffect(() => {
    setStanding(null)
    if (!active) return
    let live = true
    void Promise.all([stationOwner(stationId), esi<{ from_id: number; standing: number }[]>(`/characters/${active.id}/standings/`, { characterId: active.id })])
      .then(([owner, list]) => {
        const of = (id?: number) => list.find((s) => s.from_id === id)?.standing ?? 0
        if (live) setStanding({ faction: of(owner.faction), corp: of(owner.corp) })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [active?.id, stationId])
  const tax = Number(salesTaxPct(level(ACCOUNTING_ID)).toFixed(2))
  const broker = Number(brokerPct(level(BROKER_RELATIONS_ID), standing?.faction ?? 0, standing?.corp ?? 0).toFixed(2))
  const basis = char.skills ? (standing ? 'навыки и стендинги персонажа' : 'навыки персонажа') : 'все навыки V, без стендингов'
  return { tax, broker, basis }
}

/** Sets a page's fee fields from the pilot's fees whenever those change (the pilot can still type over them). */
export function useFeeDefaults(fees: TradeFees, setTax: (v: number) => void, setBroker?: (v: number) => void): void {
  useEffect(() => {
    setTax(fees.tax)
    setBroker?.(fees.broker)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fees.tax, fees.broker])
}
