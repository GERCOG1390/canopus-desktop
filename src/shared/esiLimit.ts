// ESI's rate limits: a killmail-group route (wars, killmails) has 3600 tokens per 15 minutes per client, 2 per
// success, and a scan that runs out of them breaks every other request of that group until they come back.

/** Seconds to wait when this request error means ESI is limiting us, null for any other error. */
export function limitedFor(message: string): number | null {
  if (!/^(420|429)\b/.test(message)) return null
  const m = message.match(/retry-after=(\d+)/)
  return m ? Number(m[1]) : 60
}
