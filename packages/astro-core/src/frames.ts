/**
 * Coordinate frame transforms.
 *
 * Every other module in this package depends on these. Errors here are silent
 * and poisonous: a star lands in the wrong place and nothing throws.
 */

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

/** J2000 equatorial position of the North Galactic Pole, in degrees. */
const NGP_RA = 192.85948
const NGP_DEC = 27.12825
/** Galactic longitude of the North Celestial Pole, in degrees. */
const NCP_L = 122.93192

export interface Galactic {
  /** Galactic longitude, degrees in [0, 360). */
  l: number
  /** Galactic latitude, degrees in [-90, +90]. */
  b: number
}

/** Convert ICRS/J2000 equatorial coordinates (degrees) to galactic (degrees). */
export function icrsToGalactic(raDeg: number, decDeg: number): Galactic {
  const ra = raDeg * DEG
  const dec = decDeg * DEG
  const ngpRa = NGP_RA * DEG
  const ngpDec = NGP_DEC * DEG

  const sinB =
    Math.sin(ngpDec) * Math.sin(dec) +
    Math.cos(ngpDec) * Math.cos(dec) * Math.cos(ra - ngpRa)
  const b = Math.asin(Math.min(1, Math.max(-1, sinB)))

  const y = Math.cos(dec) * Math.sin(ra - ngpRa)
  const x =
    Math.cos(ngpDec) * Math.sin(dec) -
    Math.sin(ngpDec) * Math.cos(dec) * Math.cos(ra - ngpRa)

  const l = NCP_L - Math.atan2(y, x) * RAD

  return { l: normalizeDegrees(l), b: b * RAD }
}

/** Wrap an angle in degrees into [0, 360). */
export function normalizeDegrees(deg: number): number {
  const wrapped = deg % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

export interface Equatorial {
  /** Right ascension, degrees in [0, 360). */
  ra: number
  /** Declination, degrees in [-90, +90]. */
  dec: number
}

/** Convert galactic coordinates (degrees) to ICRS/J2000 equatorial (degrees). */
export function galacticToIcrs(lDeg: number, bDeg: number): Equatorial {
  const l = lDeg * DEG
  const b = bDeg * DEG
  const ngpRa = NGP_RA * DEG
  const ngpDec = NGP_DEC * DEG
  const ncpL = NCP_L * DEG

  const sinDec =
    Math.sin(ngpDec) * Math.sin(b) +
    Math.cos(ngpDec) * Math.cos(b) * Math.cos(ncpL - l)
  const dec = Math.asin(Math.min(1, Math.max(-1, sinDec)))

  const y = Math.cos(b) * Math.sin(ncpL - l)
  const x =
    Math.cos(ngpDec) * Math.sin(b) -
    Math.sin(ngpDec) * Math.cos(b) * Math.cos(ncpL - l)

  const ra = ngpRa * RAD + Math.atan2(y, x) * RAD

  return { ra: normalizeDegrees(ra), dec: dec * RAD }
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * Astrometric velocity constant: km/s per (arcsec/yr x parsec).
 * Equal to one AU in km divided by the number of seconds in a Julian year.
 */
export const AU_KM_PER_YEAR_TO_KM_S = 4.740470446

/**
 * Distance in parsecs from parallax in milliarcseconds.
 *
 * Returns null for a non-positive parallax. Gaia legitimately contains
 * negative parallaxes for faint or distant sources — inverting one would put
 * the star behind the observer, so callers must handle the absence explicitly
 * rather than receive a plausible-looking wrong number.
 */
export function parallaxToDistancePc(parallaxMas: number): number | null {
  if (!(parallaxMas > 0)) return null
  return 1000 / parallaxMas
}

export interface StarAstrometry {
  raDeg: number
  decDeg: number
  parallaxMas: number
  /** Proper motion in RA, already multiplied by cos(dec). Gaia's `pmra`. */
  pmRaMasPerYr: number
  pmDecMasPerYr: number
  radialVelocityKmS: number
}

export interface StateVector {
  /** ICRS cartesian position, parsecs. */
  position: Vec3
  /** ICRS cartesian velocity, km/s. */
  velocity: Vec3
}

/**
 * Full 3D state vector for a star from its catalog astrometry.
 *
 * Position alone is a picture; a navigator needs velocity. Returns null when
 * the parallax gives no usable distance.
 */
export function starStateVector(a: StarAstrometry): StateVector | null {
  const distancePc = parallaxToDistancePc(a.parallaxMas)
  if (distancePc === null) return null

  const ra = a.raDeg * DEG
  const dec = a.decDeg * DEG
  const cosRa = Math.cos(ra)
  const sinRa = Math.sin(ra)
  const cosDec = Math.cos(dec)
  const sinDec = Math.sin(dec)

  // Orthonormal basis at the star: outward, east, north.
  const radial: Vec3 = { x: cosDec * cosRa, y: cosDec * sinRa, z: sinDec }
  const east: Vec3 = { x: -sinRa, y: cosRa, z: 0 }
  const north: Vec3 = { x: -sinDec * cosRa, y: -sinDec * sinRa, z: cosDec }

  // Proper motion (mas/yr) at a known distance becomes a transverse velocity.
  const k = AU_KM_PER_YEAR_TO_KM_S * distancePc / 1000
  const vEast = k * a.pmRaMasPerYr
  const vNorth = k * a.pmDecMasPerYr
  const vRadial = a.radialVelocityKmS

  return {
    position: {
      x: radial.x * distancePc,
      y: radial.y * distancePc,
      z: radial.z * distancePc,
    },
    velocity: {
      x: radial.x * vRadial + east.x * vEast + north.x * vNorth,
      y: radial.y * vRadial + east.y * vEast + north.y * vNorth,
      z: radial.z * vRadial + east.z * vEast + north.z * vNorth,
    },
  }
}
