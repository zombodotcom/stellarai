/**
 * Two-body propagation with universal variables.
 *
 * Given a state vector and an elapsed time, where is the craft? The same
 * Stumpff-function machinery as the Lambert solver, applied to the initial
 * value problem instead of the boundary value problem: one formulation
 * covers elliptic, parabolic and hyperbolic motion with no branching on
 * conic type (Bate-Mueller-White; Vallado ch. 2).
 *
 * The unknown is the universal anomaly chi, found by Newton iteration on
 * the time-of-flight equation; Lagrange f and g coefficients then give the
 * new state directly. Used to draw transfer trajectories: solve Lambert for
 * the endpoints, then sample this propagator along the leg.
 */

import type { Vec3 } from './frames.js'

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const mag = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)

/** Stumpff C(psi), series near zero where the closed forms cancel. */
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

/** Stumpff S(psi). */
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

export interface PropagatedState {
  position: Vec3
  velocity: Vec3
}

const MAX_ITERATIONS = 60
const TOLERANCE = 1e-12

/**
 * Propagate a two-body state by `dtS` seconds around a body with
 * gravitational parameter `mu` (m^3/s^2). Negative time propagates backward.
 */
export function propagateKepler(r0: Vec3, v0: Vec3, dtS: number, mu: number): PropagatedState {
  const r0Mag = mag(r0)
  if (!(r0Mag > 0)) throw new Error('Initial position must be non-zero.')
  if (!(mu > 0)) throw new Error('Gravitational parameter must be positive.')
  if (dtS === 0) {
    return { position: { ...r0 }, velocity: { ...v0 } }
  }

  const sqrtMu = Math.sqrt(mu)
  const v0Mag = mag(v0)
  const rDotV = dot(r0, v0)
  /** Reciprocal semi-major axis; zero for parabolic, negative hyperbolic. */
  const alpha = 2 / r0Mag - (v0Mag * v0Mag) / mu

  // Initial guess for the universal anomaly (Vallado's recommendations).
  let chi: number
  if (alpha > 1e-12) {
    chi = sqrtMu * dtS * alpha
  } else {
    // Parabolic and hyperbolic starts; a modest guess converges fine with
    // the Newton iteration below.
    chi = (Math.sign(dtS) * sqrtMu) / Math.sqrt(Math.abs(alpha) > 1e-12 ? 1 / Math.abs(alpha) : r0Mag)
    chi *= Math.abs(dtS) ** (1 / 3) * 1e-2
  }

  let c2 = 0
  let c3 = 0
  let r = r0Mag
  let psi = 0

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    psi = chi * chi * alpha
    c2 = stumpffC(psi)
    c3 = stumpffS(psi)

    const chi2 = chi * chi
    const t =
      ((rDotV / sqrtMu) * chi2 * c2 + (1 - alpha * r0Mag) * chi2 * chi * c3 + r0Mag * chi) / sqrtMu

    r = chi2 * c2 + (rDotV / sqrtMu) * chi * (1 - psi * c3) + r0Mag * (1 - psi * c2)

    const delta = (sqrtMu * (dtS - t)) / r
    chi += delta
    if (Math.abs(delta) < TOLERANCE * Math.max(1, Math.abs(chi))) break
  }

  const chi2 = chi * chi
  const f = 1 - (chi2 / r0Mag) * c2
  const g = dtS - (chi2 * chi * c3) / sqrtMu

  const position: Vec3 = {
    x: f * r0.x + g * v0.x,
    y: f * r0.y + g * v0.y,
    z: f * r0.z + g * v0.z,
  }
  const rNew = mag(position)

  const gDot = 1 - (chi2 / rNew) * c2
  const fDot = (sqrtMu / (rNew * r0Mag)) * chi * (psi * c3 - 1)

  return {
    position,
    velocity: {
      x: fDot * r0.x + gDot * v0.x,
      y: fDot * r0.y + gDot * v0.y,
      z: fDot * r0.z + gDot * v0.z,
    },
  }
}
