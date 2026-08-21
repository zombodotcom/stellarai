/**
 * Relativistic aberration and Doppler shift — the traveler's sky.
 *
 * A ship at speed beta sees every star's direction rotated toward the
 * direction of motion (aberration) and its light shifted and brightened
 * or dimmed (Doppler). Both are exact special-relativity results:
 *
 *   cos theta' = (cos theta + beta) / (1 + beta cos theta)
 *   delta      = gamma (1 + beta cos theta)
 *
 * derived from the photon four-momentum boost, with theta the REST-frame
 * (catalog) angle between the star's direction and the ship's velocity.
 * The theta = 90deg tests pin both conventions: that star moves forward
 * to cos(theta') = beta and blueshifts by gamma.
 *
 * Convention used throughout: theta is the angle between the star's
 * direction (as catalogued, rest frame) and the ship's velocity; theta'
 * is where the traveler sees it. theta = 0 is dead ahead.
 */

/** Where a star catalogued at angle `thetaRad` from the velocity vector appears to the traveler. */
export function aberrateAngleRad(thetaRad: number, beta: number): number {
  if (!(beta >= 0) || beta >= 1) {
    throw new Error(`beta must be in [0, 1); got ${String(beta)}`)
  }
  const cosTheta = Math.cos(thetaRad)
  const cosPrime = (cosTheta + beta) / (1 + beta * cosTheta)
  return Math.acos(Math.min(1, Math.max(-1, cosPrime)))
}

/**
 * Doppler factor delta for light from a star at rest-frame angle
 * `thetaRad` ahead: observed frequency = delta * emitted frequency.
 * Ahead (theta=0): blueshift sqrt((1+beta)/(1-beta)). Astern: reciprocal.
 */
export function dopplerFactor(thetaRad: number, beta: number): number {
  if (!(beta >= 0) || beta >= 1) {
    throw new Error(`beta must be in [0, 1); got ${String(beta)}`)
  }
  const gamma = 1 / Math.sqrt(1 - beta * beta)
  return gamma * (1 + beta * Math.cos(thetaRad))
}
