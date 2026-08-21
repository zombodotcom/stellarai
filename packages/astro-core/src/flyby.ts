/**
 * Gravity-assist flyby physics, patched-conic.
 *
 * A flyby is a hyperbolic pass: the spacecraft arrives with some velocity
 * relative to the planet (v-infinity), swings around, and leaves with the
 * same relative SPEED but a rotated direction. The planet pays the energy
 * from its own orbital motion — which, in the sun frame, is how Mariner 10
 * reached Mercury and Voyager left the solar system.
 *
 * The maximum bend is set by how close you dare fly:
 *
 *   delta_max = 2 asin( 1 / (1 + rp v_inf^2 / mu) )
 *
 * Slow approaches over heavy planets bend a lot; fast approaches over light
 * planets barely notice. When the mission needs more than gravity gives —
 * more turn, or a different outgoing speed — the difference is charged as a
 * powered-flyby delta-v, so a sequence search can price infeasibility
 * instead of merely rejecting it.
 */

import type { Vec3 } from './frames.js'

export type FlybyBody =
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'

/** Gravitational parameters, m^3/s^2 (IAU / JPL values). */
export const PLANET_GM: Record<FlybyBody, number> = {
  mercury: 2.2032e13,
  venus: 3.24859e14,
  earth: 3.986004418e14,
  mars: 4.282837e13,
  jupiter: 1.26686534e17,
  saturn: 3.7931187e16,
  uranus: 5.793939e15,
  neptune: 6.836529e15,
}

/**
 * Minimum safe flyby periapsis, metres: planet radius plus a margin for
 * atmosphere (or, for the giants, radiation belts and ring plane clutter).
 */
export const MIN_FLYBY_RADIUS_M: Record<FlybyBody, number> = {
  mercury: 2_640_000, // 200 km altitude
  venus: 6_351_800, // 300 km — above the atmosphere
  earth: 6_671_000, // 300 km
  mars: 3_589_500, // 200 km
  jupiter: 214_400_000, // 3 Jupiter radii — radiation belts
  saturn: 120_536_000, // 2 Saturn radii — ring clearance
  uranus: 51_118_000, // 2 radii
  neptune: 49_528_000, // 2 radii
}

/**
 * Turn angle of an unpowered flyby, radians, for a given periapsis radius.
 */
export function flybyTurnAngleRad(body: FlybyBody, vInfMs: number, periapsisM: number): number {
  const minimum = MIN_FLYBY_RADIUS_M[body]
  if (periapsisM < minimum) {
    throw new Error(
      `Flyby periapsis ${(periapsisM / 1000).toFixed(0)} km at ${body} is below the ` +
        `minimum safe radius ${(minimum / 1000).toFixed(0)} km.`,
    )
  }
  if (!(vInfMs > 0)) throw new Error('Hyperbolic excess speed must be positive.')
  return 2 * Math.asin(1 / (1 + (periapsisM * vInfMs * vInfMs) / PLANET_GM[body]))
}

const mag = (v: Vec3): number => Math.hypot(v.x, v.y, v.z)
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

/**
 * Delta-v a flyby must burn to leave with `vInfOut` after arriving with
 * `vInfIn` (planet-relative asymptotic velocities).
 *
 * An unpowered flyby can rotate v-infinity by up to the maximum turn angle
 * at the minimum safe radius but cannot change its magnitude. The cheapest
 * powered strategy for the remainder is well approximated by: burn the
 * speed difference, plus turn the excess angle beyond gravity's share at
 * the (smaller of the two) asymptotic speeds. Capped by the direct vector
 * difference, since one big burn is always available.
 */
export function poweredFlybyDeltaV(body: FlybyBody, vInfIn: Vec3, vInfOut: Vec3): number {
  const speedIn = mag(vInfIn)
  const speedOut = mag(vInfOut)
  if (!(speedIn > 0) || !(speedOut > 0)) {
    throw new Error('Flyby asymptotic speeds must be positive.')
  }

  const cosTurn = Math.min(1, Math.max(-1, dot(vInfIn, vInfOut) / (speedIn * speedOut)))
  const requiredTurn = Math.acos(cosTurn)

  // Gravity's free contribution, at the deepest safe pass, at the slower of
  // the two speeds (conservative: the real optimum splits the burn).
  const slower = Math.min(speedIn, speedOut)
  const freeTurn = flybyTurnAngleRad(body, slower, MIN_FLYBY_RADIUS_M[body])

  const excessTurn = Math.max(0, requiredTurn - freeTurn)
  const speedChange = Math.abs(speedOut - speedIn)
  // Turning by theta at speed v costs ~2 v sin(theta/2).
  const turnCost = 2 * slower * Math.sin(excessTurn / 2)

  const estimate = speedChange + turnCost
  const direct = Math.hypot(vInfOut.x - vInfIn.x, vInfOut.y - vInfIn.y, vInfOut.z - vInfIn.z)
  return Math.min(estimate, direct)
}
