// Updates from GitHub Releases.

export const RELEASES_REPO = 'GERCOG1390/canopus-desktop'

/**
 * How this copy was started: an installed app, the portable exe, a macOS app in a writable folder,
 * or a dev / unpacked build or a Mac app run from the dmg (check only).
 */
export type UpdateKind = 'installer' | 'portable' | 'mac' | 'manual'

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error'
  current: string
  kind: UpdateKind
  /** The newer version, when there is one. */
  version?: string
  /** Release notes (Markdown as written on GitHub). */
  notes?: string
  /** Release page on GitHub. */
  page?: string
  /** Download size in bytes. */
  size?: number
  /** 0..1 while downloading. */
  progress?: number
  message?: string
  checkedAt?: string
}

/** Compares "1.2.3" versions (a leading "v" is ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return Math.sign(d)
  }
  return 0
}
