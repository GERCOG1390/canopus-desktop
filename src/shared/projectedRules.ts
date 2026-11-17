// How strongly a neutralizer bites a ship: its amount × the ship's resistance to energy warfare, and for
// neutralizers with a signature resolution (capital ones: 8000 m) scaled down by the ship's signature against it.

export function neutBite(amount: number, resistance: number, signature: number, sigResolution?: number): number {
  const size = sigResolution && sigResolution > 0 ? Math.min(1, signature / sigResolution) : 1
  return amount * resistance * size
}

/**
 * Chance that ECM breaks the ship's locks in a cycle: each jammer's strength against the ship's sensor type
 * (× the ship's ECM resistance) over its sensor strength, and the jammers rolled one by one.
 */
export function ecmJamChance(strengths: number[], resistance: number, sensorStrength: number): number {
  if (sensorStrength <= 0) return strengths.some((s) => s > 0) ? 1 : 0
  const miss = strengths.reduce((p, s) => p * (1 - Math.min(1, (s * resistance) / sensorStrength)), 1)
  return 1 - miss
}
