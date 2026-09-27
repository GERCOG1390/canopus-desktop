import { useEffect, useState } from 'react'
import { locationSystem } from '../lib/esi'
import { Sec } from './ui'

const secCache = new Map<number, Promise<number | null>>()

function locationSec(id: number, characterId: number | null): Promise<number | null> {
  let pending = secCache.get(id)
  if (!pending) {
    pending = locationSystem(id, characterId)
      .then((sys) => (sys ? window.api.sde.system(sys) : null))
      .then((s) => s?.sec ?? null)
      .catch(() => null)
    secCache.set(id, pending)
  }
  return pending
}

/** A station / structure / system name prefixed with its system's security status, as in the game. */
export function LocationName({ id, name, characterId = null }: { id: number; name: string; characterId?: number | null }) {
  const [sec, setSec] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    setSec(null)
    void locationSec(id, characterId).then((s) => live && setSec(s))
    return () => {
      live = false
    }
  }, [id, characterId])
  return (
    <span className="location-name">
      {sec !== null && <Sec value={sec} />}
      <span>{name}</span>
    </span>
  )
}
