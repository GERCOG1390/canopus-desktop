import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { MarketLevel } from '../../../shared/sde'
import { useLang } from '../AppContext'
import { imageUrl } from '../lib/esi'
import { primeBasics, tn, type Lang } from '../lib/sde'
import { Icon } from './Icon'
import { useInfo } from './InfoContext'

type Order = 'name' | 'size'

const levelCache = new Map<string, Promise<MarketLevel>>()

function loadLevel(parent: number | null, order: Order, lang: Lang): Promise<MarketLevel> {
  const key = `${parent}|${order}|${lang}`
  let pending = levelCache.get(key)
  if (!pending) {
    pending = window.api.sde.marketChildren(parent, order, lang).then((level) => {
      primeBasics(Object.fromEntries(level.types.map((t) => [t.id, t])))
      return level
    })
    pending.catch(() => levelCache.delete(key))
    levelCache.set(key, pending)
  }
  return pending
}

interface TreeCtx {
  order: Order
  expanded: Set<number>
  toggle: (id: number) => void
  selected?: number
  onPick: (typeId: number) => void
  /** Scroll the selected item into view once it is rendered (after revealing it). */
  scrollToSelected: React.MutableRefObject<boolean>
}

const Ctx = createContext<TreeCtx | null>(null)

/**
 * The in-game market tree: groups → subgroups → items, loaded level by level from the SDE.
 * Click an item to pick it; the ⓘ button opens Show Info.
 */
export function MarketTree({
  root = null,
  order = 'name',
  selected,
  onPick,
  className = ''
}: {
  /** Market group to start from (null = the whole market) */
  root?: number | null
  order?: Order
  /** Highlighted item; the tree opens down to it */
  selected?: number
  onPick: (typeId: number) => void
  className?: string
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const scrollToSelected = useRef(false)
  const toggle = useCallback(
    (id: number) =>
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    []
  )

  // Open the groups leading to the selected item (e.g. picked from search).
  useEffect(() => {
    if (!selected) return
    let live = true
    void window.api.sde.marketPath(selected).then((path) => {
      if (!live) return
      const start = root === null ? 0 : path.indexOf(root) + 1
      if (root !== null && start === 0) return
      scrollToSelected.current = true
      setExpanded((prev) => new Set([...prev, ...path.slice(start)]))
    })
    return () => {
      live = false
    }
  }, [selected, root])

  return (
    <Ctx.Provider value={{ order, expanded, toggle, selected, onPick, scrollToSelected }}>
      <div className={`market-tree ${className}`}>
        <Level parent={root} depth={0} />
      </div>
    </Ctx.Provider>
  )
}

function Level({ parent, depth }: { parent: number | null; depth: number }) {
  const ctx = useContext(Ctx)!
  const lang = useLang()
  const info = useInfo()
  const [level, setLevel] = useState<MarketLevel | null>(null)
  useEffect(() => {
    let live = true
    void loadLevel(parent, ctx.order, lang).then((l) => live && setLevel(l))
    return () => {
      live = false
    }
  }, [parent, ctx.order, lang])

  const indent = 6 + depth * 16
  if (!level) return <div className="mt-row muted" style={{ paddingLeft: indent + 18 }}>…</div>
  return (
    <>
      {level.groups.map((g) => {
        const open = ctx.expanded.has(g.id)
        return (
          <div key={g.id}>
            <div className={`mt-row mt-group ${open ? 'open' : ''}`} style={{ paddingLeft: indent }} onClick={() => ctx.toggle(g.id)}>
              <span className="mt-caret">{open ? '▾' : '▸'}</span>
              {g.icon ? <Icon id={g.icon} size={20} /> : <span className="mt-icon-gap" />}
              <span className="mt-name">{tn(g.n, lang)}</span>
              <span className="mt-count">{g.count}</span>
            </div>
            {open && <Level parent={g.id} depth={depth + 1} />}
          </div>
        )
      })}
      {level.types.map((t) => {
        const isSelected = ctx.selected === t.id
        return (
          <div
            key={t.id}
            ref={(el) => {
              if (el && isSelected && ctx.scrollToSelected.current) {
                ctx.scrollToSelected.current = false
                el.scrollIntoView({ block: 'center' })
              }
            }}
            className={`mt-row mt-type ${isSelected ? 'selected' : ''}`}
            style={{ paddingLeft: indent + 18 }}
            onClick={() => ctx.onPick(t.id)}
          >
            <img className="type-icon" src={imageUrl.typeIcon(t.id, 32)} width={24} height={24} alt="" loading="lazy" />
            <span className="mt-name">{tn(t.n, lang)}</span>
            <button
              className="mt-info"
              title="Информация"
              onClick={(e) => {
                e.stopPropagation()
                info.open(t.id)
              }}
            >
              i
            </button>
          </div>
        )
      })}
    </>
  )
}
