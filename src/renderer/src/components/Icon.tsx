import { useEffect, useState } from 'react'

let attrIconsPromise: Promise<Record<number, number>> | null = null
let attrIcons: Record<number, number> | null = null

function loadAttrIcons(): Promise<Record<number, number>> {
  if (!attrIconsPromise) {
    attrIconsPromise = window.api.sde
      .attributeIcons()
      .then((m) => (attrIcons = m))
      .catch((e) => {
        attrIconsPromise = null
        throw e
      })
  }
  return attrIconsPromise
}

/** Game UI icon by SDE iconID, served from the local icon cache (evei://). */
export function Icon({ id, size = 20, title, className = '' }: { id?: number; size?: number; title?: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (!id || failed) return <span className={`ui-icon placeholder ${className}`} style={{ width: size, height: size }} />
  return (
    <img
      className={`ui-icon ${className}`}
      src={`evei://icon/${id}`}
      width={size}
      height={size}
      alt=""
      title={title}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

/** The icon the game shows next to a dogma attribute. */
export function AttrIcon({ attr, size = 20, title }: { attr: number; size?: number; title?: string }) {
  const [map, setMap] = useState(attrIcons)
  useEffect(() => {
    if (!map) void loadAttrIcons().then(setMap).catch(() => {})
  }, [map])
  return <Icon id={map?.[attr]} size={size} title={title} />
}
