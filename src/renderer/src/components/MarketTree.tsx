import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { MarketLevel } from '../../../shared/sde'
import { useLang } from '../AppContext'
import { imageUrl } from '../lib/esi'
import { primeBasics, tn, type Lang } from '../lib/sde'
import { Icon } from './Icon'
import { useInfo } from './InfoContext'

type Order = 'name' | 'size'

const levelCache = new Map<string, Promise<MarketLevel>>()

function loadLevel(parent: number | null, order: Order, lang: Lang, filterKey?: string): Promise<MarketLevel> {
  const key = `${parent}|${order}|${lang}|${filterKey ?? ''}`
  let pending = levelCache.get(key)
  if (!pending) {
    pending = window.api.sde.marketChildren(parent, order, lang, filterKey).then((level) => {
      primeBasics(Object.fromEntries(level.types.map((t) => [t.id, t])))
      return level
    })
    pending.catch(() => levelCache.delete(key))
    levelCache.set(key, pending)
  }
  return pending
}

/** Short label of a meta group, as the game marks items (T2, faction…). */
const META_BADGE: Record<number, string> = { 2: 'T2', 3: 'S', 4: 'F', 5: 'O', 6: 'D', 14: 'T3' }

interface TreeCtx {
  order: Order
  filterKey?: string
  expanded: Set<number>
  toggle: (id: number) => void
  selected?: number
  mode: 'pick' | 'add'
  onPick: (typeId: number) => void
  /** Scroll the selected item into view once it is rendered (after revealing it). */
  scrollToSelected: React.MutableRefObject<boolean>
}

const Ctx = createContext<TreeCtx | null>(null)

/**
 * The in-game market tree: groups → subgroups → items, loaded level by level from the SDE.
 * 'pick' mode: click an item to pick it. 'add' mode (fitting): "+" or double-click adds it.
 * The ⓘ button opens Show Info. With `filter`, only those items (and groups containing them) are shown.
 */
export function MarketTree({
  root = null,
  order = 'name',
  selected,
  onPick,
  mode = 'pick',
  filter,
  className = ''
}: {
  /** Market group to start from (null = the whole market) */
  root?: number | null
  order?: Order
  /** Highlighted item; the tree opens down to it */
  selected?: number
  onPick: (typeId: number) => void
  mode?: 'pick' | 'add'
  /** Show only these items; `key` must change whenever `ids` do */
  filter?: { key: string; ids: number[] }
  className?: string
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [readyKey, setReadyKey] = useState<string | undefined>(undefined)
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

  // Register the filter with the main process before loading filtered levels.
  const filterKey = filter?.key
  useEffect(() => {
    if (!filter) return
    let live = true
    void window.api.sde.setMarketFilter(filter.key, filter.ids).then(() => live && setReadyKey(filter.key))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey])

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

  if (filter && readyKey !== filter.key) return <div className="muted small">…</div>
  return (
    <Ctx.Provider value={{ order, filterKey, expanded, toggle, selected, mode, onPick, scrollToSelected }}>
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
    void loadLevel(parent, ctx.order, lang, ctx.filterKey).then((l) => live && setLevel(l))
    return () => {
      live = false
    }
  }, [parent, ctx.order, lang, ctx.filterKey])

  const indent = 4 + depth * 14
  if (!level) return <div className="mt-row muted" style={{ paddingLeft: indent + 18 }}>…</div>
  // A level with a single group and nothing else adds no information: show its contents instead.
  if (level.groups.length === 1 && !level.types.length) return <Level parent={level.groups[0].id} depth={depth} />
  if (!level.groups.length && !level.types.length) return <div className="mt-row muted small" style={{ paddingLeft: indent }}>Ничего не найдено</div>
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
        const badge = t.meta ? META_BADGE[t.meta] : undefined
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
            style={{ paddingLeft: indent + (ctx.mode === 'add' ? 0 : 18) }}
            onClick={ctx.mode === 'pick' ? () => ctx.onPick(t.id) : undefined}
            onDoubleClick={ctx.mode === 'add' ? () => ctx.onPick(t.id) : undefined}
          >
            {ctx.mode === 'add' && (
              <button
                className="ghost small add-btn"
                title="Установить"
                onClick={(e) => {
                  e.stopPropagation()
                  ctx.onPick(t.id)
                }}
              >
                +
              </button>
            )}
            <img className="type-icon" src={imageUrl.typeIcon(t.id, 32)} width={24} height={24} alt="" loading="lazy" />
            <span className="mt-name" title={tn(t.n, lang)}>
              {tn(t.n, lang)}
            </span>
            {badge && <span className={`meta-badge meta-${t.meta}`}>{badge}</span>}
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
