/**
 * Atmospheric entry — Allen & Eggers (1958) closed-form ballistic solution.
 *
 * Assumptions, and therefore limits:
 *   - exponential atmosphere, rho(h) = rho0 * exp(-h/H)
 *   - constant flight path angle through the entry (valid for steep entries)
 *   - no lift, constant drag coefficient
 *   - drag dominates gravity
 *
 * Because it is closed form, a full profile costs microseconds. There is no
 * integrator, no worker thread, and parameters can be dragged live in the UI.
 *
 * The price is accuracy: the model systematically OVERESTIMATES peak
 * deceleration, typically by 15-35% against flight data, because it neglects
 * gravity, planetary curvature, and real density profiles. It is a design and
 * intuition tool, not a certification tool. Callers should present its numbers
 * as such.
 *
 * Derivation of the peaks, for the reader checking this file against the paper:
 *
 *   Let u = rho*H / (2*beta*sin|gamma|), so V = Ve * exp(-u).
 *   Deceleration a = rho*V^2/(2*beta) = (sin|gamma|/H) * u * Ve^2 * exp(-2u).
 *   da/du = 0  =>  u = 1/2  =>  V = Ve*exp(-1/2), a_max = Ve^2 sin|gamma| / (2eH).
 *
 *   Sutton-Graves heat flux q = K * sqrt(rho/Rn) * V^3  ∝  sqrt(u) * exp(-3u).
 *   dq/du = 0  =>  u = 1/6  =>  V = Ve*exp(-1/6), rho = beta sin|gamma| / (3H).
 *
 * Note that beta cancels out of a_max entirely. Ballistic coefficient sets
 * *where* the peak happens, not how hard it hits.
 */

import { G0 } from './constants.js'

export type BodyId = 'earth' | 'mars' | 'venus' | 'titan' | 'jupiter'

interface AtmosphereModel {
  /** Reference density at the datum altitude, kg/m^3. */
  surfaceDensityKgM3: number
  /** Scale height, metres. */
  scaleHeightM: number
  /**
   * Sutton-Graves stagnation-point heating constant, SI.
   * Composition dependent: ~1.7415e-4 for N2/O2 air, ~1.898e-4 for CO2.
   */
  suttonGravesK: number
}

/**
 * Single-layer exponential atmospheres for entry analysis.
 *
 * These are entry-analysis reference values, not full atmosphere models — a
 * single scale height cannot describe a real atmosphere across 100 km. They
 * are chosen to be representative through the altitude band where peak
 * heating and peak deceleration occur, which is what this model needs.
 */
const ATMOSPHERES: Record<BodyId, AtmosphereModel> = {
  earth: { surfaceDensityKgM3: 1.225, scaleHeightM: 7160, suttonGravesK: 1.7415e-4 },
  mars: { surfaceDensityKgM3: 0.02, scaleHeightM: 11100, suttonGravesK: 1.898e-4 },
  venus: { surfaceDensityKgM3: 65, scaleHeightM: 15900, suttonGravesK: 1.898e-4 },
  titan: { surfaceDensityKgM3: 5.4, scaleHeightM: 21000, suttonGravesK: 1.7415e-4 },
  jupiter: { surfaceDensityKgM3: 0.16, scaleHeightM: 27000, suttonGravesK: 1.7415e-4 },
}

/**
 * Below this the constant-flight-path-angle assumption collapses and the
 * formulas return finite but meaningless numbers. Refuse instead.
 */
const MIN_FLIGHT_PATH_ANGLE_DEG = 0.5

export interface EntryParams {
  body: BodyId
  /** Inertial speed at the entry interface, m/s. */
  entryVelocityMs: number
  /** Flight path angle at entry, degrees. Negative means descending. */
  flightPathAngleDeg: number
  /** Ballistic coefficient m/(Cd*A), kg/m^2. */
  ballisticCoefficientKgM2: number
  /** Effective nose radius for stagnation-point heating, metres. */
  noseRadiusM: number
}

export interface PeakDeceleration {
  valueMs2: number
  valueG: number
  altitudeM: number
  velocityMs: number
}

export interface PeakHeatFlux {
  valueWm2: number
  altitudeM: number
  velocityMs: number
}

export interface EntryProfile {
  peakDeceleration: PeakDeceleration
  peakHeatFlux: PeakHeatFlux
}

function validateEntryParams(params: EntryParams): void {
  const { flightPathAngleDeg, ballisticCoefficientKgM2: beta, noseRadiusM, entryVelocityMs: ve } = params
  if (flightPathAngleDeg >= 0) {
    throw new Error(
      `Entry flight path angle must be negative (descending); got ${flightPathAngleDeg} deg.`,
    )
  }
  if (Math.abs(flightPathAngleDeg) < MIN_FLIGHT_PATH_ANGLE_DEG) {
    throw new Error(
      `Flight path angle ${flightPathAngleDeg} deg is too shallow: the Allen-Eggers ` +
        `closed form assumes a constant flight path angle and is invalid for grazing ` +
        `entries below ${MIN_FLIGHT_PATH_ANGLE_DEG} deg.`,
    )
  }
  if (!(beta > 0)) throw new Error('Ballistic coefficient must be positive.')
  if (!(noseRadiusM > 0)) throw new Error('Nose radius must be positive.')
  if (!(ve > 0)) throw new Error('Entry velocity must be positive.')
}

/** Compute the peak deceleration and peak stagnation heat flux of a ballistic entry. */
export function ballisticEntryProfile(params: EntryParams): EntryProfile {
  const {
    body,
    entryVelocityMs: ve,
    flightPathAngleDeg,
    ballisticCoefficientKgM2: beta,
    noseRadiusM,
  } = params

  validateEntryParams(params)

  const atmosphere = ATMOSPHERES[body]
  const { surfaceDensityKgM3: rho0, scaleHeightM: H, suttonGravesK: K } = atmosphere

  const sinGamma = Math.sin(Math.abs(flightPathAngleDeg) * (Math.PI / 180))

  // Peak deceleration. Independent of ballistic coefficient.
  const aMax = (ve * ve * sinGamma) / (2 * Math.E * H)
  const rhoAtPeakDecel = (beta * sinGamma) / H
  const altitudeAtPeakDecel = H * Math.log(rho0 / rhoAtPeakDecel)

  // Peak stagnation heat flux, Sutton-Graves.
  const rhoAtPeakHeat = (beta * sinGamma) / (3 * H)
  const altitudeAtPeakHeat = H * Math.log(rho0 / rhoAtPeakHeat)
  const vAtPeakHeat = ve * Math.exp(-1 / 6)
  const qMax = K * Math.sqrt(rhoAtPeakHeat / noseRadiusM) * vAtPeakHeat ** 3

  return {
    peakDeceleration: {
      valueMs2: aMax,
      valueG: aMax / G0,
      altitudeM: altitudeAtPeakDecel,
      velocityMs: ve * Math.exp(-0.5),
    },
    peakHeatFlux: {
      valueWm2: qMax,
      altitudeM: altitudeAtPeakHeat,
      velocityMs: vAtPeakHeat,
    },
  }
}

export interface EntryTrajectoryPoint {
  altitudeM: number
  velocityMs: number
  decelerationMs2: number
  heatFluxWm2: number
}

/**
 * Sample the full closed-form trajectory, top of the atmosphere to below
 * peak deceleration.
 *
 * The same Allen-Eggers relations that give the peaks give the whole curve:
 * with u = rho*H / (2*beta*sin|gamma|),
 *
 *   V(h) = Ve * exp(-u)
 *   a(h) = rho * V^2 / (2*beta)
 *   q(h) = K * sqrt(rho/Rn) * V^3
 *
 * Still closed form, so thousands of points cost microseconds and a UI can
 * re-sample on every slider movement. The altitude span is chosen from u
 * itself: from u = 0.005 (99.5% of entry velocity remaining) down to u = 4
 * (under 2% remaining), which brackets both peaks (at u = 1/6 and u = 1/2)
 * with margin on both sides.
 */
export function sampleEntryTrajectory(
  params: EntryParams,
  samples: number,
): EntryTrajectoryPoint[] {
  validateEntryParams(params)
  if (!(samples >= 2)) throw new Error(`Sample count must be at least 2; got ${samples}.`)

  const { body, entryVelocityMs: ve, ballisticCoefficientKgM2: beta, noseRadiusM } = params
  const { surfaceDensityKgM3: rho0, scaleHeightM: H, suttonGravesK: K } = ATMOSPHERES[body]
  const sinGamma = Math.sin(Math.abs(params.flightPathAngleDeg) * (Math.PI / 180))

  const altitudeForU = (u: number) => H * Math.log((rho0 * H) / (2 * beta * sinGamma * u))
  const top = altitudeForU(0.005)
  const bottom = altitudeForU(4)

  const points: EntryTrajectoryPoint[] = []
  for (let i = 0; i < samples; i++) {
    const altitudeM = top + (i / (samples - 1)) * (bottom - top)
    const rho = rho0 * Math.exp(-altitudeM / H)
    const u = (rho * H) / (2 * beta * sinGamma)
    const velocityMs = ve * Math.exp(-u)
    points.push({
      altitudeM,
      velocityMs,
      decelerationMs2: (rho * velocityMs * velocityMs) / (2 * beta),
      heatFluxWm2: K * Math.sqrt(rho / noseRadiusM) * velocityMs ** 3,
    })
  }
  return points
}
