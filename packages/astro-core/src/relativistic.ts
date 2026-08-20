/**
 * Relativistic cruise between stars.
 *
 * The brachistochrone profile: accelerate at constant proper acceleration to
 * the midpoint, flip, decelerate the rest of the way, arriving at rest. It is
 * the fastest constant-thrust transfer and the standard way to state an
 * interstellar trip time.
 *
 * Two clocks disagree, and a navigator has to report both:
 *   - coordinate time, what an observer at the origin measures
 *   - proper time, what the crew measures
 *
 * For constant proper acceleration a over a distance x, starting from rest:
 *   coordinate time  t   = sqrt( (x/c)^2 + 2x/a )
 *   proper time      tau = (c/a) * arccosh( a*x/c^2 + 1 )
 *   Lorentz factor   g   = 1 + a*x/c^2
 *
 * Applied twice, over x = d/2 each.
 */

import { C_M_S, G0, JULIAN_YEAR_S, LIGHT_YEAR_M } from './constants.js'

export interface CruiseParams {
  distanceLy: number
  /** Proper acceleration, in multiples of standard gravity. */
  properAccelerationG: number
}

export interface CruiseResult {
  /** Trip time measured at the origin, years. */
  coordinateTimeYears: number
  /** Trip time measured aboard the ship, years. */
  properTimeYears: number
  /** Lorentz factor at turnover, where the ship is fastest. */
  peakLorentzFactor: number
  /** Peak speed as a fraction of c. */
  peakVelocityFractionC: number
  /**
   * Proper delta-v, m/s: the integral of proper acceleration over proper time.
   * This is rapidity times c, not a coordinate velocity change — it is the
   * quantity the relativistic rocket equation consumes, and it is unbounded.
   */
  deltaVMs: number
}

/** Trip time and energy cost of a constant-thrust flip-and-burn transfer. */
export function brachistochroneCruise(params: CruiseParams): CruiseResult {
  const { distanceLy, properAccelerationG } = params
  if (!(distanceLy > 0)) throw new Error('Cruise distance must be positive.')
  if (!(properAccelerationG > 0)) throw new Error('Proper acceleration must be positive.')

  const d = distanceLy * LIGHT_YEAR_M
  const a = properAccelerationG * G0
  const halfDistance = d / 2

  const coordinateSeconds =
    2 * Math.sqrt((halfDistance / C_M_S) ** 2 + (2 * halfDistance) / a)

  const gamma = 1 + (a * halfDistance) / (C_M_S * C_M_S)
  const properSeconds = 2 * (C_M_S / a) * Math.acosh(gamma)

  return {
    coordinateTimeYears: coordinateSeconds / JULIAN_YEAR_S,
    properTimeYears: properSeconds / JULIAN_YEAR_S,
    peakLorentzFactor: gamma,
    peakVelocityFractionC: Math.sqrt(1 - 1 / (gamma * gamma)),
    deltaVMs: a * properSeconds,
  }
}

/**
 * Propellant mass ratio (wet/dry) for a given proper delta-v.
 *
 * The relativistic rocket equation keeps the classical exponential form when
 * delta-v is expressed as rapidity, which is what `brachistochroneCruise`
 * returns. The consequence is brutal and worth surfacing to the user: any
 * relativistic cruise on chemical propulsion demands a mass ratio with more
 * digits than there are atoms in the observable universe.
 */
export function massRatioForDeltaV(deltaVMs: number, exhaustVelocityMs: number): number {
  if (!(exhaustVelocityMs > 0)) throw new Error('Exhaust velocity must be positive.')
  return Math.exp(deltaVMs / exhaustVelocityMs)
}

/**
 * Base-10 logarithm of the propellant mass ratio.
 *
 * `massRatioForDeltaV` overflows to Infinity once delta-v exceeds about 709
 * exhaust velocities, which every interesting relativistic mission does by a
 * wide margin. Reporting "Infinity" to a user throws away the only
 * interesting fact; the exponent is the story. A briefing should say
 * "10^108,000", not "impossible".
 */
export function log10MassRatioForDeltaV(
  deltaVMs: number,
  exhaustVelocityMs: number,
): number {
  if (!(exhaustVelocityMs > 0)) throw new Error('Exhaust velocity must be positive.')
  return deltaVMs / exhaustVelocityMs / Math.LN10
}
