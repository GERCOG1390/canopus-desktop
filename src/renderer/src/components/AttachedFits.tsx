// Whole fits attached to the one being edited (a logistics cruiser repairing it, a booster running bursts): ship,
// name, how many of them, remove.

import type { FitSpec } from '../../../shared/fit'
import { Glyph } from './Glyph'
import { TypeLink } from './TypeLink'

export function AttachedFits({ list, onCount, onRemove }: { list: { fit: FitSpec; count?: number }[]; onCount?: (i: number, by: number) => void; onRemove: (i: number) => void }) {
  return (
    <>
      {list.map((x, i) => (
        <div key={i} className="projected-row">
          <div className="projected-line">
            <TypeLink id={x.fit.shipTypeId} size={20} />
            <span className="grow muted small" translate="no">
              {x.fit.name}
            </span>
            {onCount && x.count !== undefined && (
              <span className="drone-ctrl">
                <button className="ghost small" onClick={() => onCount(i, -1)}>
                  −
                </button>
                {x.count}
                <button className="ghost small" onClick={() => onCount(i, 1)}>
                  +
                </button>
              </span>
            )}
            <button className="ghost small danger" onClick={() => onRemove(i)}>
              <Glyph name="close" size={14} />
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
