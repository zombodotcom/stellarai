/**
 * Solar system ephemerides.
 *
 * A thin, unit-normalising wrapper over `astronomy-engine`, which implements
 * VSOP87 and NOVAS C 3.1 and is tested against JPL Horizons upstream. We do
 * not reimplement any of that: writing our own VSOP87 evaluator would be
 * weeks of work to arrive at worse numbers.
 *
 * What this module *does* own is units and frames. astronomy-engine returns
 * AU and AU/day in equatorial J2000; the rest of this package works in SI
 * metres and metres per second. Every field name below carries its unit,
 * because silent unit confusion is the bug class that ruins astrodynamics
 * code — it produces answers that are wrong by a factor nobody notices.
 */

import { Body, HelioState } from 'astronomy-engine'
import type { Vec3 } from './frames.js'

/** Astronomical unit, metres (exact, IAU 2012). */
export const AU_M = 1.495978707e11

/** Seconds in a day. */
const DAY_S = 86400

/** Heliocentric gravitational parameter, m^3/s^2. */
export const MU_SUN = 1.32712440018e20

export type PlanetId =
  | 'sun'
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'
  | 'pluto'

const BODIES: Record<PlanetId, Body> = {
  sun: Body.Sun,
  mercury: Body.Mercury,
  venus: Body.Venus,
  earth: Body.Earth,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
  uranus: Body.Uranus,
  neptune: Body.Neptune,
  pluto: Body.Pluto,
}

export interface SolarSystemState {
  /** Heliocentric position in equatorial J2000, metres. */
  positionM: Vec3
  /** Heliocentric velocity in equatorial J2000, metres per second. */
  velocityMs: Vec3
}

/** Heliocentric state vector of a solar system body at an instant. */
export function heliocentricState(body: PlanetId, when: Date): SolarSystemState {
  const target = BODIES[body]
  if (target === undefined) {
    throw new Error(`Unknown solar system body: ${String(body)}`)
  }

  const s = HelioState(target, when)

  return {
    positionM: { x: s.x * AU_M, y: s.y * AU_M, z: s.z * AU_M },
    velocityMs: {
      x: (s.vx * AU_M) / DAY_S,
      y: (s.vy * AU_M) / DAY_S,
      z: (s.vz * AU_M) / DAY_S,
    },
  }
}
