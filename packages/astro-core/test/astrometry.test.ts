import { describe, expect, test } from 'vitest'
import { parallaxToDistancePc, starStateVector } from '../src/frames.js'

describe('parallaxToDistancePc', () => {
  test('maps one arcsecond of parallax to one parsec, by definition', () => {
    expect(parallaxToDistancePc(1000)).toBeCloseTo(1, 12)
  })

  test('maps Proxima Centauri parallax to its published distance', () => {
    // Gaia DR3 parallax 768.0665 mas.
    expect(parallaxToDistancePc(768.0665)).toBeCloseTo(1.30197, 5)
  })

  test('returns null for a non-positive parallax rather than a negative distance', () => {
    // Gaia contains negative parallaxes for faint/distant sources. Inverting
    // them silently would place stars behind the observer.
    expect(parallaxToDistancePc(0)).toBeNull()
    expect(parallaxToDistancePc(-0.4)).toBeNull()
  })
})

describe('starStateVector', () => {
  test('places a star on the +X axis when it sits at the ICRS origin', () => {
    const s = starStateVector({
      raDeg: 0,
      decDeg: 0,
      parallaxMas: 1000,
      pmRaMasPerYr: 0,
      pmDecMasPerYr: 0,
      radialVelocityKmS: 0,
    })
    expect(s!.position.x).toBeCloseTo(1, 12)
    expect(s!.position.y).toBeCloseTo(0, 12)
    expect(s!.position.z).toBeCloseTo(0, 12)
  })

  test('gives Proxima Centauri its published space velocity', () => {
    // Gaia DR3 astrometry. Tangential velocity from proper motion and
    // distance, combined with radial velocity, gives ~32.6 km/s total.
    const s = starStateVector({
      raDeg: 217.39232,
      decDeg: -62.67607,
      parallaxMas: 768.0665,
      pmRaMasPerYr: -3781.741,
      pmDecMasPerYr: 769.465,
      radialVelocityKmS: -22.204,
    })!
    const speed = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z)
    expect(speed).toBeGreaterThan(32.4)
    expect(speed).toBeLessThan(32.7)
  })

  test('returns null when the parallax cannot give a distance', () => {
    expect(
      starStateVector({
        raDeg: 10,
        decDeg: 10,
        parallaxMas: -1,
        pmRaMasPerYr: 0,
        pmDecMasPerYr: 0,
        radialVelocityKmS: 0,
      }),
    ).toBeNull()
  })
})
