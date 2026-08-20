/**
 * Lambert's problem: given two position vectors and a time of flight, find the
 * conic that connects them, and therefore the velocity needed at each end.
 *
 * This is the workhorse behind every in-system transfer and every porkchop
 * plot. Solved here with universal variables and Stumpff functions, following
 * the standard formulation (Bate-Mueller-White; Vallado ch. 7), which handles
 * elliptic, parabolic and hyperbolic transfers with one set of equations
 * rather than branching on conic type.
 *
 * The iteration variable is psi = alpha * chi^2, the universal anomaly
 * squared over the semi-major axis. psi > 0 is elliptic, psi < 0 hyperbolic,
 * psi = 0 parabolic. Time of flight increases monotonically with psi, so a
 * plain bisection converges reliably without a good initial guess.
 */

import type { Vec3 } from './frames.js'

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const mag = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)

/**
 * Stumpff function C(psi). Series expansion near zero, where the closed forms
 * lose all their significant digits to cancellation.
 */
function stumpffC(psi: number): number {
  if (psi > 1e-6) {
    const s = Math.sqrt(psi)
    return (1 - Math.cos(s)) / psi
  }
  if (psi < -1e-6) {
    const s = Math.sqrt(-psi)
    return (Math.cosh(s) - 1) / -psi
  }
  return 1 / 2 - psi / 24 + (psi * psi) / 720
}

/** Stumpff function S(psi). */
function stumpffS(psi: number): number {
  if (psi > 1e-6) {
    const s = Math.sqrt(psi)
    return (s - Math.sin(s)) / Math.sqrt(psi ** 3)
  }
  if (psi < -1e-6) {
    const s = Math.sqrt(-psi)
    return (Math.sinh(s) - s) / Math.sqrt((-psi) ** 3)
  }
  return 1 / 6 - psi / 120 + (psi * psi) / 5040
}

export interface LambertParams {
  /** Position at departure, metres, centred on the attracting body. */
  r1: Vec3
  /** Position at arrival, metres. */
  r2: Vec3
  timeOfFlightS: number
  /** Gravitational parameter of the central body, m^3/s^2. */
  mu: number
  /** Take the long way round, opposite the reference direction. */
  retrograde?: boolean
}

export interface LambertSolution {
  /** Velocity required at r1, m/s. */
  v1: Vec3
  /** Velocity on arrival at r2, m/s. */
  v2: Vec3
}

const MAX_ITERATIONS = 200
const TOLERANCE_S = 1e-6

/** Solve Lambert's problem for a single-revolution transfer. */
export function solveLambert(params: LambertParams): LambertSolution {
  const { r1, r2, timeOfFlightS: dt, mu, retrograde = false } = params

  if (!(dt > 0)) throw new Error('Time of flight must be positive.')
  if (!(mu > 0)) throw new Error('Gravitational parameter must be positive.')

  const magR1 = mag(r1)
  const magR2 = mag(r2)
  if (magR1 === 0 || magR2 === 0) throw new Error('Position vectors must be non-zero.')

  const cosDeltaNu = Math.min(1, Math.max(-1, dot(r1, r2) / (magR1 * magR2)))

  // An antiparallel pair leaves the transfer plane undefined: infinitely many
  // conics connect them. Refuse rather than pick one arbitrarily.
  if (cosDeltaNu < -1 + 1e-12) {
    throw new Error(
      'Transfer angle is 180 degrees: the orbital plane is degenerate and Lambert ' +
        'has no unique solution. Offset the arrival position slightly.',
    )
  }
  if (cosDeltaNu > 1 - 1e-12) {
    throw new Error('Transfer angle is zero: departure and arrival positions coincide.')
  }

  // Sign of the transfer, from the out-of-plane component of r1 x r2.
  const h = cross(r1, r2)
  const prograde = retrograde ? h.z < 0 : h.z >= 0
  const sinDeltaNu = (prograde ? 1 : -1) * Math.sqrt(1 - cosDeltaNu * cosDeltaNu)

  const A = sinDeltaNu * Math.sqrt((magR1 * magR2) / (1 - cosDeltaNu))
  if (A === 0) throw new Error('Degenerate geometry: cannot construct a transfer orbit.')

  // Bisect on psi. Time of flight rises monotonically with psi, so the only
  // care needed is keeping y positive on the low side.
  let psiLow = -4 * Math.PI * Math.PI
  let psiHigh = 4 * Math.PI * Math.PI
  let psi = 0
  let y = 0

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const c2 = stumpffC(psi)
    const c3 = stumpffS(psi)

    y = magR1 + magR2 + (A * (psi * c3 - 1)) / Math.sqrt(c2)

    // A positive A with negative y means psi is too low for this geometry.
    if (A > 0 && y < 0) {
      psiLow = psi
      psi = (psi + psiHigh) / 2
      continue
    }

    const chi = Math.sqrt(y / c2)
    const dtComputed = (chi ** 3 * c3 + A * Math.sqrt(y)) / Math.sqrt(mu)

    if (Math.abs(dtComputed - dt) < TOLERANCE_S) break

    if (dtComputed < dt) psiLow = psi
    else psiHigh = psi
    psi = (psiLow + psiHigh) / 2
  }

  // Lagrange coefficients give the velocities directly.
  const f = 1 - y / magR1
  const g = A * Math.sqrt(y / mu)
  const gDot = 1 - y / magR2

  if (g === 0) throw new Error('Lambert solver failed to converge on this geometry.')

  return {
    v1: {
      x: (r2.x - f * r1.x) / g,
      y: (r2.y - f * r1.y) / g,
      z: (r2.z - f * r1.z) / g,
    },
    v2: {
      x: (gDot * r2.x - r1.x) / g,
      y: (gDot * r2.y - r1.y) / g,
      z: (gDot * r2.z - r1.z) / g,
    },
  }
}
