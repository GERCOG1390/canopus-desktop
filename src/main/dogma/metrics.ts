// The numbers the optimizer compares a fit by (DPS, tank, speed, application...). Pure: also bundled into
// the iOS app (Canopus Tools/dogma-js).

import type { FitMetrics, FitStats } from '../../shared/fit'

export function fitMetrics(s: FitStats): FitMetrics {
  const sh = s.ship
  // DPS-weighted averages over the weapons that have the property.
  const avg = (pick: (w: FitStats['offense']['weapons'][number]) => number | undefined) => {
    let sum = 0
    let weight = 0
    for (const w of s.offense.weapons) {
      const v = pick(w)
      if (v === undefined || !Number.isFinite(v)) continue
      sum += v * w.dps
      weight += w.dps
    }
    return weight ? sum / weight : 0
  }
  return {
    dps: s.offense.totalDps,
    ehp: s.defense.ehp,
    activeTank: s.defense.activeTankEhp,
    speed: s.navigation.maxVelocity,
    align: s.navigation.alignSec,
    lockRange: s.targeting.maxRange,
    scanRes: s.targeting.scanResolution,
    signature: s.navigation.signatureRadius,
    range: avg((w) => (w.kind === 'turret' ? (w.optimal ?? 0) + (w.falloff ?? 0) : w.kind === 'missile' || w.kind === 'vorton' ? w.optimal : undefined)),
    tracking: avg((w) => (w.kind === 'turret' ? w.tracking : undefined)),
    explosionRadius: avg((w) => (w.kind === 'missile' || w.kind === 'vorton' ? w.explosionRadius : undefined)),
    explosionVelocity: avg((w) => (w.kind === 'missile' || w.kind === 'vorton' ? w.explosionVelocity : undefined)),
    capStable: s.capacitor.stable,
    capLevel: s.capacitor.stableLevel ?? 0,
    capLasts: s.capacitor.lastsSec ?? 0,
    fits: sh.cpu.used <= sh.cpu.total + 1e-6 && sh.power.used <= sh.power.total + 1e-6 && sh.calibration.used <= sh.calibration.total + 1e-6
  }
}
