/**
 * Interstellar intercept — aim where the star will be, not where it is.
 *
 * A voyage takes coordinate time T(d); during T the star moves v*T. The
 * solver iterates d -> |p + v*T(d)| to a fixed point. Star speeds are
 * always << c, so the map is a strong contraction and converges fast.
 */

import { describe, expect, it } from 'vitest'
import { G0, LY_PER_PC, brachistochroneCruise } from '../src/index.js'
import { solveIntercept } from '../src/intercept.js'

const ONE_G = G0

describe('solveIntercept', () => {
  it('reproduces the plain cruise exactly for a stationary star', () => {
    const position = { x: 3, y: 4, z: 0 } // 5 pc away
    const result = solveIntercept({
      positionPc: position,
      velocityKmS: { x: 0, y: 0, z: 0 },
      accelMs2: ONE_G,
    })
    const cruise = brachistochroneCruise({ distanceLy: 5 * LY_PER_PC, properAccelerationG: 1 })
    expect(result.coordinateYears).toBeCloseTo(cruise.coordinateTimeYears, 10)
    expect(result.driftPc).toBeCloseTo(0, 12)
    expect(result.leadAngleRad).toBeCloseTo(0, 12)
    expect(result.arrivalPositionPc.x).toBeCloseTo(3, 12)
    expect(result.arrivalPositionPc.y).toBeCloseTo(4, 12)
  })

  it('takes longer to catch a radially receding star', () => {
    const still = solveIntercept({
      positionPc: { x: 10, y: 0, z: 0 },
      velocityKmS: { x: 0, y: 0, z: 0 },
      accelMs2: ONE_G,
    })
    const receding = solveIntercept({
      positionPc: { x: 10, y: 0, z: 0 },
      velocityKmS: { x: 100, y: 0, z: 0 },
      accelMs2: ONE_G,
    })
    const approaching = solveIntercept({
      positionPc: { x: 10, y: 0, z: 0 },
      velocityKmS: { x: -100, y: 0, z: 0 },
      accelMs2: ONE_G,
    })
    expect(receding.coordinateYears).toBeGreaterThan(still.coordinateYears)
    expect(approaching.coordinateYears).toBeLessThan(still.coordinateYears)
  })

  it('leads a transversely moving star on the correct side', () => {
    const result = solveIntercept({
      positionPc: { x: 10, y: 0, z: 0 },
      velocityKmS: { x: 0, y: 50, z: 0 },
      accelMs2: ONE_G,
    })
    // Star moves toward +y, so the aim point sits at positive y.
    expect(result.arrivalPositionPc.y).toBeGreaterThan(0)
    expect(result.leadAngleRad).toBeGreaterThan(0)
    // Drift equals speed times trip time (uniform motion).
    const cruise = result.coordinateYears
    const KM_S_PC_YR = 1 / 977_792 // ~1.02271e-6 pc/yr per km/s
    expect(result.driftPc).toBeCloseTo(50 * KM_S_PC_YR * cruise, 6)
  })

  it("moves a Barnard's-Star-class fast mover a sane distance", () => {
    // ~1.8 pc away, ~110 km/s space velocity: an 1-g trip takes ~4.5 yr
    // coordinate time, so the drift should be ~5e-4 pc — small but real.
    const result = solveIntercept({
      positionPc: { x: 1.8, y: 0, z: 0 },
      velocityKmS: { x: -110, y: 0, z: 0 },
      accelMs2: ONE_G,
    })
    expect(result.driftPc).toBeGreaterThan(1e-4)
    expect(result.driftPc).toBeLessThan(1e-2)
    expect(result.iterations).toBeLessThan(20)
  })

  it('converges even for slow ships over long hauls', () => {
    // 0.01 g to a star 100 pc out: centuries of coordinate time.
    const result = solveIntercept({
      positionPc: { x: 100, y: 0, z: 0 },
      velocityKmS: { x: 0, y: 200, z: 0 },
      accelMs2: 0.01 * ONE_G,
    })
    expect(result.iterations).toBeLessThan(30)
    // Self-consistency: cruise time over the arrival distance matches.
    const d = Math.hypot(
      result.arrivalPositionPc.x,
      result.arrivalPositionPc.y,
      result.arrivalPositionPc.z,
    )
    const check = brachistochroneCruise({ distanceLy: d * LY_PER_PC, properAccelerationG: 0.01 })
    expect(result.coordinateYears).toBeCloseTo(check.coordinateTimeYears, 6)
  })

  it('rejects a star at the origin', () => {
    expect(() =>
      solveIntercept({
        positionPc: { x: 0, y: 0, z: 0 },
        velocityKmS: { x: 0, y: 0, z: 0 },
        accelMs2: ONE_G,
      }),
    ).toThrow()
  })
})
