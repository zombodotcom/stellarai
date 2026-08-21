/**
 * Habitable-zone bounds from stellar luminosity.
 *
 * Simplified conservative Kopparapu bounds: the zone scales as sqrt(L),
 * anchored so the Sun's zone is ~0.95-1.37 AU with Earth inside it.
 */

import { describe, expect, it } from 'vitest'
import { habitableZoneAu } from '../src/habitable.js'

describe('habitableZoneAu', () => {
  it("puts Earth inside the Sun's habitable zone", () => {
    const hz = habitableZoneAu(0) // log10(L/Lsun) = 0
    expect(hz.innerAu).toBeCloseTo(0.953, 2)
    expect(hz.outerAu).toBeCloseTo(1.374, 2)
    expect(hz.innerAu).toBeLessThan(1)
    expect(hz.outerAu).toBeGreaterThan(1)
  })

  it('scales with the square root of luminosity', () => {
    const sun = habitableZoneAu(0)
    const brighter = habitableZoneAu(2) // 100x solar
    expect(brighter.innerAu).toBeCloseTo(sun.innerAu * 10, 6)
    expect(brighter.outerAu).toBeCloseTo(sun.outerAu * 10, 6)
  })

  it('gives a close-in zone for a red dwarf like Proxima (L ~ 0.0016)', () => {
    const hz = habitableZoneAu(Math.log10(0.0016))
    // Proxima b orbits at ~0.049 AU — inside this zone.
    expect(hz.innerAu).toBeLessThan(0.049)
    expect(hz.outerAu).toBeGreaterThan(0.049)
  })
})
