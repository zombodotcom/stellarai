/**
 * Habitable-zone bounds from stellar luminosity.
 *
 * The conservative liquid-water zone scales as sqrt(L): flux at distance
 * d is L/d^2, so the distance receiving a given flux moves as sqrt(L).
 * Anchored at the Kopparapu et al. (2013) conservative solar bounds:
 * runaway greenhouse at 0.953 AU, maximum greenhouse at 1.374 AU. The
 * simple scaling ignores the modest spectral-type correction; for a
 * navigator's "is that planet in the zone" readout it is honest enough,
 * and the UI labels it an estimate.
 */

export interface HabitableZone {
  innerAu: number
  outerAu: number
}

const SOLAR_INNER_AU = 0.953
const SOLAR_OUTER_AU = 1.374

/** Conservative habitable-zone bounds for a star of log10(L/Lsun). */
export function habitableZoneAu(log10Lum: number): HabitableZone {
  const scale = Math.sqrt(10 ** log10Lum)
  return { innerAu: SOLAR_INNER_AU * scale, outerAu: SOLAR_OUTER_AU * scale }
}
