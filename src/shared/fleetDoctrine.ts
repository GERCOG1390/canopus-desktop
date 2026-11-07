// A fleet against a doctrine, by hull: ESI shows what ship each member flies, not its fit or their skills.

export interface FleetMemberShip {
  character_id: number
  ship_type_id: number
}

export interface FleetDoctrineCheck<M> {
  /** Every hull of the doctrine with how many fly it, in the doctrine's order */
  hulls: { type: number; count: number }[]
  offDoctrine: M[]
  onDoctrine: number
  total: number
  share: number
}

export function compareFleet<M extends FleetMemberShip>(members: M[], doctrineHulls: number[]): FleetDoctrineCheck<M> {
  const wanted = [...new Set(doctrineHulls)]
  const hulls = wanted.map((type) => ({ type, count: members.filter((m) => m.ship_type_id === type).length }))
  const onDoctrine = hulls.reduce((s, h) => s + h.count, 0)
  return {
    hulls,
    offDoctrine: members.filter((m) => !wanted.includes(m.ship_type_id)),
    onDoctrine,
    total: members.length,
    share: members.length ? onDoctrine / members.length : 0
  }
}
