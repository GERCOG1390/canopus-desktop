// The batched cache behind every type name on screen. Requests made in one tick go out together. A failed
// request (the SDE still building) is not repeated by itself: components re-render on every change and would
// ask again at once, in an endless loop. retry() asks again when the SDE is ready.

export interface BasicsCache<T> {
  get(id: number): T | undefined
  has(id: number): boolean
  request(ids: Iterable<number>): void
  prime(map: Record<number, T>): void
  retry(): void
  subscribe(listener: () => void): () => void
}

export function createBasicsCache<T extends { id: number }>(fetchBasics: (ids: number[]) => Promise<Record<number, T>>): BasicsCache<T> {
  const cache = new Map<number, T>()
  const requested = new Set<number>()
  const listeners = new Set<() => void>()
  let queue = new Set<number>()
  let scheduled = false
  const notify = (): void => listeners.forEach((l) => l())

  const flush = async (): Promise<void> => {
    scheduled = false
    const ids = [...queue]
    queue = new Set()
    if (!ids.length) return
    try {
      Object.values(await fetchBasics(ids)).forEach((b) => cache.set(b.id, b))
      notify()
    } catch {
      // Stay "requested" until retry(), and no notify: nothing changed.
    }
  }

  return {
    get: (id) => cache.get(id),
    has: (id) => cache.has(id),
    request(ids) {
      for (const id of ids) {
        if (!id || cache.has(id) || requested.has(id)) continue
        requested.add(id)
        queue.add(id)
      }
      if (queue.size && !scheduled) {
        scheduled = true
        setTimeout(() => void flush(), 0)
      }
    },
    prime(map) {
      Object.values(map).forEach((b) => cache.set(b.id, b))
    },
    retry() {
      requested.clear()
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
