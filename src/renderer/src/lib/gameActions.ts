// Things Canopus can do in the game client through ESI: open windows, save fits, mail, contacts…

import type { FitSpec, Slot } from '../../../shared/fit'
import type { CharacterAuth } from '../../../shared/types'
import { esi } from './esi'

export const SCOPE = {
  openWindow: 'esi-ui.open_window.v1',
  waypoint: 'esi-ui.write_waypoint.v1',
  writeFits: 'esi-fittings.write_fittings.v1',
  readMail: 'esi-mail.read_mail.v1',
  sendMail: 'esi-mail.send_mail.v1',
  organizeMail: 'esi-mail.organize_mail.v1',
  readContacts: 'esi-characters.read_contacts.v1',
  writeContacts: 'esi-characters.write_contacts.v1',
  readFleet: 'esi-fleets.read_fleet.v1',
  writeFleet: 'esi-fleets.write_fleet.v1',
  readCalendar: 'esi-calendar.read_calendar_events.v1',
  respondCalendar: 'esi-calendar.respond_calendar_events.v1'
} as const

export const hasScope = (who: CharacterAuth | null, scope: string): boolean => !!who?.scopes.includes(scope)

const post = (who: CharacterAuth, path: string, body?: unknown) => esi(path, { method: 'POST', characterId: who.id, body })

/** Opens the market window of an item in the game client. */
export const openMarketInGame = (who: CharacterAuth, typeId: number) => post(who, `/ui/openwindow/marketdetails/?type_id=${typeId}`)

/** Opens Show Info (item, character, corporation, alliance, system…) in the game client. */
export const openInfoInGame = (who: CharacterAuth, targetId: number) => post(who, `/ui/openwindow/information/?target_id=${targetId}`)

export const openContractInGame = (who: CharacterAuth, contractId: number) => post(who, `/ui/openwindow/contract/?contract_id=${contractId}`)

/** Opens a new mail window in the game, filled in (the player still presses Send there). */
export const openNewMailInGame = (who: CharacterAuth, mail: { recipients: number[]; subject: string; body: string }) =>
  post(who, '/ui/openwindow/newmail/', { recipients: mail.recipients, subject: mail.subject.slice(0, 1000), body: mail.body.slice(0, 10000) })

export const setDestinationInGame = (who: CharacterAuth, systemId: number, add = false) =>
  post(who, `/ui/autopilot/waypoint/?add_to_beginning=false&clear_other_waypoints=${!add}&destination_id=${systemId}`)

const FLAG_PREFIX: Record<Slot, string> = { hi: 'HiSlot', med: 'MedSlot', lo: 'LoSlot', rig: 'RigSlot', sub: 'SubSystemSlot' }

/** A Canopus fit as the game's saved fitting: modules in their slots, charges and drones in the holds. */
export function toGameFitting(fit: FitSpec, description = 'Canopus') {
  const counters: Record<Slot, number> = { hi: 0, med: 0, lo: 0, rig: 0, sub: 0 }
  const items: { type_id: number; flag: string; quantity: number }[] = []
  const charges = new Map<number, number>()
  for (const m of fit.modules) items.push({ type_id: m.typeId, flag: `${FLAG_PREFIX[m.slot]}${counters[m.slot]++}`, quantity: 1 })
  for (const m of fit.modules) if (m.chargeTypeId) charges.set(m.chargeTypeId, (charges.get(m.chargeTypeId) ?? 0) + 1)
  for (const [type_id, n] of charges) items.push({ type_id, flag: 'Cargo', quantity: n })
  for (const d of fit.drones) items.push({ type_id: d.typeId, flag: 'DroneBay', quantity: d.count })
  for (const c of fit.cargo ?? []) items.push({ type_id: c.typeId, flag: 'Cargo', quantity: c.qty })
  return { name: (fit.name || 'Canopus').slice(0, 50), description: description.slice(0, 500), ship_type_id: fit.shipTypeId, items }
}

/** Saves a fit into the character's fittings in the game; returns its fitting ID. */
export async function saveFitToGame(who: CharacterAuth, fit: FitSpec): Promise<number> {
  const r = (await post(who, `/characters/${who.id}/fittings/`, toGameFitting(fit))) as { fitting_id: number }
  return r.fitting_id
}

export const deleteGameFit = (who: CharacterAuth, fittingId: number) => esi(`/characters/${who.id}/fittings/${fittingId}/`, { method: 'DELETE', characterId: who.id })

/** Adds contacts with a standing (ESI takes up to 100 IDs per call). */
export async function addContacts(who: CharacterAuth, ids: number[], standing: number): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    await esi(`/characters/${who.id}/contacts/?standing=${standing}`, { method: 'POST', characterId: who.id, body: ids.slice(i, i + 100) })
  }
}

export const editContacts = (who: CharacterAuth, ids: number[], standing: number) =>
  esi(`/characters/${who.id}/contacts/?standing=${standing}`, { method: 'PUT', characterId: who.id, body: ids })

export const deleteContacts = (who: CharacterAuth, ids: number[]) =>
  esi(`/characters/${who.id}/contacts/?${ids.map((id) => `contact_ids=${id}`).join('&')}`, { method: 'DELETE', characterId: who.id })
