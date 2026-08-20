import { describe, expect, test } from 'vitest'
import {
  brachistochroneCruise,
  log10MassRatioForDeltaV,
  massRatioForDeltaV,
} from '../src/relativistic.js'

describe('brachistochroneCruise', () => {
  // The canonical worked example: accelerate at 1 g to the midpoint, flip,
  // decelerate the rest of the way to Proxima Centauri at 4.2465 ly.
  // Textbook result is ~3.5 years ship time against ~5.9 years Earth time.
  test('reproduces the 1 g run to Proxima Centauri', () => {
    const r = brachistochroneCruise({ distanceLy: 4.2465, properAccelerationG: 1 })
    expect(r.coordinateTimeYears).toBeCloseTo(5.87, 1)
    expect(r.properTimeYears).toBeCloseTo(3.54, 1)
  })

  test('ship time is always shorter than Earth time', () => {
    const r = brachistochroneCruise({ distanceLy: 4.2465, properAccelerationG: 1 })
    expect(r.properTimeYears).toBeLessThan(r.coordinateTimeYears)
  })

  test('never reaches or exceeds the speed of light', () => {
    const r = brachistochroneCruise({ distanceLy: 30000, properAccelerationG: 3 })
    expect(r.peakVelocityFractionC).toBeLessThan(1)
    expect(r.peakVelocityFractionC).toBeGreaterThan(0.999999)
  })

  test('gives the right Lorentz factor at turnover for the Proxima run', () => {
    const r = brachistochroneCruise({ distanceLy: 4.2465, properAccelerationG: 1 })
    expect(r.peakLorentzFactor).toBeCloseTo(3.19, 1)
  })

  test('collapses to the Newtonian answer for a slow, short hop', () => {
    // A 0.001 ly hop at 0.01 g stays deeply non-relativistic, so total time
    // should approach the Newtonian 2*sqrt(d/a) and ship time should match
    // Earth time to within a part in a thousand.
    const distanceLy = 0.001
    const gs = 0.01
    const r = brachistochroneCruise({ distanceLy, properAccelerationG: gs })

    const c = 299792458
    const lyM = 9.4607304725808e15
    const a = gs * 9.80665
    const newtonianSeconds = 2 * Math.sqrt((distanceLy * lyM) / a)
    const yearSeconds = 31557600

    expect(r.coordinateTimeYears).toBeCloseTo(newtonianSeconds / yearSeconds, 2)
    expect(r.properTimeYears / r.coordinateTimeYears).toBeCloseTo(1, 3)
    expect(r.peakVelocityFractionC).toBeLessThan(0.05)
    void c
  })

  test('a harder burn gets there sooner', () => {
    const gentle = brachistochroneCruise({ distanceLy: 10, properAccelerationG: 0.5 })
    const hard = brachistochroneCruise({ distanceLy: 10, properAccelerationG: 3 })
    expect(hard.coordinateTimeYears).toBeLessThan(gentle.coordinateTimeYears)
    expect(hard.properTimeYears).toBeLessThan(gentle.properTimeYears)
  })

  test('rejects a non-positive distance or acceleration', () => {
    expect(() => brachistochroneCruise({ distanceLy: 0, properAccelerationG: 1 })).toThrow()
    expect(() => brachistochroneCruise({ distanceLy: 4, properAccelerationG: 0 })).toThrow()
  })
})

describe('massRatioForDeltaV', () => {
  test('needs e-fold of propellant for one exhaust velocity of delta-v', () => {
    expect(massRatioForDeltaV(3000, 3000)).toBeCloseTo(Math.E, 9)
  })

  // The tyranny of the rocket equation is the actual headline of any
  // interstellar mission plan, so the solver must be able to state it.
  test('reports an absurd mass ratio for the 1 g Proxima run on chemical propulsion', () => {
    const r = brachistochroneCruise({ distanceLy: 4.2465, properAccelerationG: 1 })
    const chemicalExhaustMs = 4400
    expect(massRatioForDeltaV(r.deltaVMs, chemicalExhaustMs)).toBeGreaterThan(1e100)
  })

  test('rejects a non-positive exhaust velocity', () => {
    expect(() => massRatioForDeltaV(1000, 0)).toThrow()
  })
})

describe('log10MassRatioForDeltaV', () => {
  // Math.exp overflows to Infinity above an argument of ~709, and every
  // interesting relativistic mission blows straight past that. "Mass ratio:
  // Infinity" tells a user nothing; the exponent is the whole story.
  test('reports a finite exponent where the plain ratio overflows', () => {
    const r = brachistochroneCruise({ distanceLy: 4.2465, properAccelerationG: 1 })
    expect(massRatioForDeltaV(r.deltaVMs, 4400)).toBe(Infinity)

    const log10 = log10MassRatioForDeltaV(r.deltaVMs, 4400)
    expect(Number.isFinite(log10)).toBe(true)
    expect(log10).toBeGreaterThan(100_000)
  })

  test('agrees with the plain ratio where the plain ratio is representable', () => {
    expect(log10MassRatioForDeltaV(3000, 3000)).toBeCloseTo(Math.log10(Math.E), 12)
    expect(log10MassRatioForDeltaV(9200, 4600)).toBeCloseTo(Math.log10(massRatioForDeltaV(9200, 4600)), 12)
  })

  test('rejects a non-positive exhaust velocity', () => {
    expect(() => log10MassRatioForDeltaV(1000, 0)).toThrow()
  })
})
