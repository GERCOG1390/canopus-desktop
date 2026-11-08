// How much of a missile's damage lands, by the game's formula: min(1, S/E, (S·Ve / (E·Vt))^drf).
// The second term has a picture: the blast takes E/Ve seconds to reach its full radius, and in that time the target
// moves Vt·E/Ve metres. S·Ve/(E·Vt) is the target's signature over that distance.

export interface MissileShot {
  /** Target signature radius, m */
  sig: number
  /** Target speed, m/s */
  speed: number
  /** Explosion radius, m */
  radius: number
  /** Explosion velocity, m/s */
  velocity: number
  /** Damage reduction factor */
  drf: number
}

export interface MissileApplication {
  /** S/E */
  size: number
  /** S·Ve/(E·Vt), before the drf power; Infinity for a still target */
  speedBase: number
  /** (S·Ve/(E·Vt))^drf */
  speedTerm: number
  /** Share of the damage that lands, 0–1 */
  factor: number
  /** What holds it back */
  limit: 'none' | 'size' | 'speed'
  /** Seconds the blast takes to reach its full radius */
  growSec: number
  /** How far the target moves in that time, m */
  shift: number
}

export function missileApplication(shot: MissileShot): MissileApplication {
  const sig = Math.max(0, shot.sig)
  const speed = Math.max(0, shot.speed)
  const radius = Math.max(1e-6, shot.radius)
  const velocity = Math.max(1e-6, shot.velocity)
  const size = sig / radius
  const speedBase = speed > 0 ? (sig * velocity) / (radius * speed) : Infinity
  const speedTerm = speedBase === Infinity ? Infinity : speedBase ** shot.drf
  const factor = Math.max(0, Math.min(1, size, speedTerm))
  const limit = factor >= 1 ? 'none' : size <= speedTerm ? 'size' : 'speed'
  const growSec = radius / velocity
  return { size, speedBase, speedTerm, factor, limit, growSec, shift: speed * growSec }
}
