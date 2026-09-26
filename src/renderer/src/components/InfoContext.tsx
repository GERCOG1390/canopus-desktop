import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

interface InfoState {
  /** History of opened type IDs; `index` points at the one on screen. */
  stack: number[]
  index: number
  open: (typeId: number) => void
  back: () => void
  forward: () => void
  close: () => void
}

const Ctx = createContext<InfoState | null>(null)

export function InfoProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<number[]>([])
  const [index, setIndex] = useState(-1)

  const open = useCallback(
    (typeId: number) => {
      setStack((s) => {
        const base = s.slice(0, index + 1)
        if (base[base.length - 1] === typeId) return base
        const next = [...base, typeId].slice(-50)
        setIndex(next.length - 1)
        return next
      })
    },
    [index]
  )
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])
  const forward = useCallback(() => setIndex((i) => Math.min(stack.length - 1, i + 1)), [stack.length])
  const close = useCallback(() => {
    setStack([])
    setIndex(-1)
  }, [])

  return <Ctx.Provider value={{ stack, index, open, back, forward, close }}>{children}</Ctx.Provider>
}

export function useInfo(): InfoState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useInfo outside InfoProvider')
  return ctx
}
