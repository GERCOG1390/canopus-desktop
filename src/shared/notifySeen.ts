// Which notifications were already shown, kept between runs so each is shown once.

const MONTH_MS = 30 * 86400_000
/** Price alerts stay fired until the price crosses back (the check re-arms them), however long that takes. */
const KEPT = /^price-/

/** The record without one-off notifications older than a month. */
export function forgetOld(seen: Record<string, number>, now: number): Record<string, number> {
  return Object.fromEntries(Object.entries(seen).filter(([key, at]) => KEPT.test(key) || now - at < MONTH_MS))
}
