/**
 * Interstellar intercept — aim where the star will be when you arrive.
 *
 * A brachistochrone voyage over distance d takes coordinate time T(d);
 * during T the star travels v * T. The consistent aim point is the fixed
 * point of d -> |p + v * T(d)|. Stellar speeds are always << c while the
 * ship's mean speed is a respectable fraction of c, so the map is a
 * strong contraction: a handful of iterations reaches machine precision.
 *
 * The star is treated as moving uniformly (galactic orbital curvature is
 * negligible over any plausible trip) and times are solar-system
 * coordinate times — the same clock the cruise solver's
 * `coordinateYears` already reports.
 */

import { G0, KM_S_IN_PC_PER_YR, LY_PER_PC } from './constants.js'
import type { Vec3 } from './frames.js'
import { brachistochroneCruise } from './relativistic.js'

export interface InterceptParams {
  /** Star position today, parsecs (Sol-centred galactic frame). */
  positionPc: Vec3
  /** Star space velocity, km/s, same axes. */
  velocityKmS: Vec3
  /** Ship's constant proper acceleration, m/s^2. */
  accelMs2: number
}

export interface InterceptSolution {
  /** Where the star (and ship) will be at arrival, parsecs. */
  arrivalPositionPc: Vec3
  /** Coordinate (Earth) years the intercept trip takes. */
  coordinateYears: number
  /** How far the star moves during the trip, parsecs. */
  driftPc: number
  /** Angle between "aim at where it is" and "aim at where it will be". */
  leadAngleRad: number
  /** Fixed-point iterations used. */
  iterations: number
}

const MAX_ITERATIONS = 50
/** Convergence: distance change per iteration, in parsecs (~3 km). */
const TOLERANCE_PC = 1e-13

const mag = (v: Vec3): number => Math.hypot(v.x, v.y, v.z)

export function solveIntercept(params: InterceptParams): InterceptSolution {
  const { positionPc, velocityKmS, accelMs2 } = params
  const startDistance = mag(positionPc)
  if (!(startDistance > 0)) {
    throw new Error('Star must not be at the origin.')
  }

  const velocityPcYr: Vec3 = {
    x: velocityKmS.x * KM_S_IN_PC_PER_YR,
    y: velocityKmS.y * KM_S_IN_PC_PER_YR,
    z: velocityKmS.z * KM_S_IN_PC_PER_YR,
  }

  const cruiseYears = (distancePc: number): number =>
    brachistochroneCruise({
      distanceLy: distancePc * LY_PER_PC,
      properAccelerationG: accelMs2 / G0,
    }).coordinateTimeYears

  let distance = startDistance
  let years = 0
  let iterations = 0
  for (; iterations < MAX_ITERATIONS; iterations++) {
    years = cruiseYears(distance)
    const next = mag({
      x: positionPc.x + velocityPcYr.x * years,
      y: positionPc.y + velocityPcYr.y * years,
      z: positionPc.z + velocityPcYr.z * years,
    })
    const change = Math.abs(next - distance)
    distance = next
    if (change < TOLERANCE_PC) {
      iterations++
      break
    }
  }
  // One final time evaluation so years matches the converged distance.
  years = cruiseYears(distance)

  const arrival: Vec3 = {
    x: positionPc.x + velocityPcYr.x * years,
    y: positionPc.y + velocityPcYr.y * years,
    z: positionPc.z + velocityPcYr.z * years,
  }
  const driftPc = mag({
    x: arrival.x - positionPc.x,
    y: arrival.y - positionPc.y,
    z: arrival.z - positionPc.z,
  })

  const arrivalMag = mag(arrival)
  const cosLead =
    (positionPc.x * arrival.x + positionPc.y * arrival.y + positionPc.z * arrival.z) /
    (startDistance * arrivalMag)
  const leadAngleRad = Math.acos(Math.min(1, Math.max(-1, cosLead)))

  return {
    arrivalPositionPc: arrival,
    coordinateYears: years,
    driftPc,
    leadAngleRad,
    iterations,
  }
}
