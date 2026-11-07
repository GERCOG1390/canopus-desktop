// ESI gives some ship names as a Python 2 literal — u'Hurricane\xa0— Alexandr Gercog' for
// "Hurricane — Alexandr Gercog" (names with characters outside ASCII). Other text is left alone.

export function decodeEsiName(raw: string): string {
  const m = /^u(['"])([\s\S]*)\1$/.exec(raw)
  if (!m) return raw
  return m[2]
    .replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[\\'"nt])/g, (_all, e: string) => {
      if (e === 'n') return '\n'
      if (e === 't') return '\t'
      if (e.length === 1) return e
      return String.fromCodePoint(parseInt(e.slice(1), 16))
    })
    .replace(/ /g, ' ')
}
