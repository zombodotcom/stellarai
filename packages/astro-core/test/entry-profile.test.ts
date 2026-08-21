import { describe, expect, test } from 'vitest'
import { ballisticEntryProfile, sampleEntryTrajectory } from '../src/entry.js'

const params = {
  body: 'mars' as const,
  entryVelocityMs: 7260,
  flightPathAngleDeg: -13.65,
  ballisticCoefficientKgM2: 63,
  noseRadiusM: 0.6638,
}

describe('sampleEntryTrajectory', () => {
  test('returns monotonically descending altitudes', () => {
    const points = sampleEntryTrajectory(params, 100)
    expect(points.length).toBe(100)
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.altitudeM).toBeLessThan(points[i - 1]!.altitudeM)
    }
  })

  test('starts near entry velocity and only ever slows down', () => {
    const points = sampleEntryTrajectory(params, 200)
    expect(points[0]!.velocityMs).toBeGreaterThan(0.99 * params.entryVelocityMs)
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.velocityMs).toBeLessThanOrEqual(points[i - 1]!.velocityMs)
    }
  })

  // The sampled curve must agree with the closed-form peaks it comes from.
  // If the maxima of the sampled arrays drift from ballisticEntryProfile's
  // analytic values, one of the two is wrong.
  test('reproduces the analytic peak deceleration in value and altitude', () => {
    const profile = ballisticEntryProfile(params)
    const points = sampleEntryTrajectory(params, 4000)

    let best = points[0]!
    for (const p of points) if (p.decelerationMs2 > best.decelerationMs2) best = p

    expect(best.decelerationMs2).toBeCloseTo(profile.peakDeceleration.valueMs2, -1)
    expect(Math.abs(best.altitudeM - profile.peakDeceleration.altitudeM)).toBeLessThan(500)
  })

  test('reproduces the analytic peak heat flux in value and altitude', () => {
    const profile = ballisticEntryProfile(params)
    const points = sampleEntryTrajectory(params, 4000)

    let best = points[0]!
    for (const p of points) if (p.heatFluxWm2 > best.heatFluxWm2) best = p

    expect(best.heatFluxWm2 / profile.peakHeatFlux.valueWm2).toBeCloseTo(1, 2)
    expect(Math.abs(best.altitudeM - profile.peakHeatFlux.altitudeM)).toBeLessThan(500)
  })

  test('spans from thin air down to dense air around both peaks', () => {
    const profile = ballisticEntryProfile(params)
    const points = sampleEntryTrajectory(params, 100)
    const top = points[0]!.altitudeM
    const bottom = points[points.length - 1]!.altitudeM
    expect(top).toBeGreaterThan(profile.peakHeatFlux.altitudeM)
    expect(bottom).toBeLessThan(profile.peakDeceleration.altitudeM)
  })

  test('shares input validation with the closed form', () => {
    expect(() =>
      sampleEntryTrajectory({ ...params, flightPathAngleDeg: 10 }, 100),
    ).toThrow(/flight path angle/i)
  })

  test('rejects a sample count below two', () => {
    expect(() => sampleEntryTrajectory(params, 1)).toThrow(/sample/i)
  })
})
