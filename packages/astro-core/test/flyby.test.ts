import { describe, expect, test } from 'vitest'
import {
  MIN_FLYBY_RADIUS_M,
  PLANET_GM,
  flybyTurnAngleRad,
  poweredFlybyDeltaV,
} from '../src/flyby.js'

describe('flybyTurnAngleRad', () => {
  // delta = 2 asin(1 / (1 + rp v_inf^2 / mu)) — the patched-conic turn angle.
  test('matches the closed form for a Venus flyby', () => {
    const mu = PLANET_GM.venus
    const rp = 6_351_800 // 300 km altitude
    const vInf = 5000
    const expected = 2 * Math.asin(1 / (1 + (rp * vInf * vInf) / mu))
    expect(flybyTurnAngleRad('venus', vInf, rp)).toBeCloseTo(expected, 12)
  })

  test('slower approaches bend more', () => {
    const rp = MIN_FLYBY_RADIUS_M.jupiter
    expect(flybyTurnAngleRad('jupiter', 3000, rp)).toBeGreaterThan(
      flybyTurnAngleRad('jupiter', 15000, rp),
    )
  })

  test('massive planets bend more at equal approach', () => {
    expect(
      flybyTurnAngleRad('jupiter', 8000, MIN_FLYBY_RADIUS_M.jupiter),
    ).toBeGreaterThan(flybyTurnAngleRad('mars', 8000, MIN_FLYBY_RADIUS_M.mars))
  })

  test('rejects a flyby below the minimum safe radius', () => {
    expect(() =>
      flybyTurnAngleRad('venus', 5000, MIN_FLYBY_RADIUS_M.venus * 0.5),
    ).toThrow(/radius/i)
  })
})

describe('poweredFlybyDeltaV', () => {
  const mkV = (x: number, y: number) => ({ x, y, z: 0 })

  test('is zero for a turn the planet can provide free', () => {
    // Incoming and outgoing v-infinity equal in magnitude, small turn:
    // gravity alone does it, no burn needed.
    const vIn = mkV(5000, 0)
    const angle = flybyTurnAngleRad('jupiter', 5000, MIN_FLYBY_RADIUS_M.jupiter)
    const usable = Math.min(angle * 0.9, Math.PI / 4)
    const vOut = mkV(5000 * Math.cos(usable), 5000 * Math.sin(usable))
    expect(poweredFlybyDeltaV('jupiter', vIn, vOut)).toBeCloseTo(0, 6)
  })

  test('charges for speed mismatch between the asymptotes', () => {
    const dv = poweredFlybyDeltaV('venus', mkV(5000, 0), mkV(6000, 0))
    expect(dv).toBeGreaterThan(0)
    expect(dv).toBeLessThanOrEqual(1000 + 1e-6)
  })

  test('charges for turning beyond the maximum bend', () => {
    // Mars is light: a fast approach can barely bend. Demanding a right
    // angle must cost real delta-v.
    const vIn = mkV(10000, 0)
    const vOut = mkV(0, 10000)
    const dv = poweredFlybyDeltaV('mars', vIn, vOut)
    expect(dv).toBeGreaterThan(1000)
  })

  test('never exceeds the direct vector difference', () => {
    // The worst case is burning the whole change yourself; the planet can
    // only help.
    const vIn = mkV(7000, 1000)
    const vOut = mkV(-2000, 8000)
    const direct = Math.hypot(vOut.x - vIn.x, vOut.y - vIn.y)
    for (const body of ['venus', 'earth', 'mars', 'jupiter'] as const) {
      expect(poweredFlybyDeltaV(body, vIn, vOut)).toBeLessThanOrEqual(direct + 1e-6)
    }
  })
})
