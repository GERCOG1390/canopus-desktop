import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  reload: () => void
}

/** Runs `fn` whenever `deps` change; stale results from earlier runs are dropped. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const run = useRef(0)

  useEffect(() => {
    const id = ++run.current
    setLoading(true)
    setError(null)
    fn()
      .then((d) => id === run.current && setData(d))
      .catch((e: Error) => id === run.current && setError(e.message))
      .finally(() => id === run.current && setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, error, loading, reload }
}

/** Re-renders every `ms` milliseconds (for countdowns). */
export function useTick(ms = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
