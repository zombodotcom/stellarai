import { describe, expect, test } from 'vitest'
import { AU_M, heliocentricState } from '../src/ephemeris.js'

const speed = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z)

describe('heliocentricState', () => {
  test('puts Earth about one astronomical unit from the Sun', () => {
    const s = heliocentricState('earth', new Date('2026-06-15T00:00:00Z'))
    const rAu = speed(s.positionM) / AU_M
    expect(rAu).toBeGreaterThan(0.98)
    expect(rAu).toBeLessThan(1.02)
  })

  test('gives Earth its known orbital speed', () => {
    // Earth ranges from 29.29 km/s at aphelion to 30.29 km/s at perihelion.
    const s = heliocentricState('earth', new Date('2026-06-15T00:00:00Z'))
    expect(speed(s.velocityMs)).toBeGreaterThan(29_000)
    expect(speed(s.velocityMs)).toBeLessThan(30_500)
  })

  test('has Earth closer to the Sun in January than in July', () => {
    // Perihelion falls in early January, aphelion in early July. This is a
    // direction-of-time check: it would catch a sign error or a swapped epoch
    // that a magnitude range would sail straight past.
    const jan = heliocentricState('earth', new Date('2026-01-03T00:00:00Z'))
    const jul = heliocentricState('earth', new Date('2026-07-05T00:00:00Z'))
    expect(speed(jan.positionM)).toBeLessThan(speed(jul.positionM))
  })

  test('moves faster at perihelion than at aphelion', () => {
    const jan = heliocentricState('earth', new Date('2026-01-03T00:00:00Z'))
    const jul = heliocentricState('earth', new Date('2026-07-05T00:00:00Z'))
    expect(speed(jan.velocityMs)).toBeGreaterThan(speed(jul.velocityMs))
  })

  test('places Mars inside its known heliocentric range', () => {
    const s = heliocentricState('mars', new Date('2026-06-15T00:00:00Z'))
    const rAu = speed(s.positionM) / AU_M
    expect(rAu).toBeGreaterThan(1.38)
    expect(rAu).toBeLessThan(1.67)
  })

  test('places Jupiter inside its known heliocentric range', () => {
    const s = heliocentricState('jupiter', new Date('2026-06-15T00:00:00Z'))
    const rAu = speed(s.positionM) / AU_M
    expect(rAu).toBeGreaterThan(4.9)
    expect(rAu).toBeLessThan(5.5)
  })

  test('returns the Sun at the origin of its own heliocentric frame', () => {
    const s = heliocentricState('sun', new Date('2026-06-15T00:00:00Z'))
    expect(speed(s.positionM) / AU_M).toBeLessThan(1e-9)
  })

  test('rejects a body it does not know', () => {
    // @ts-expect-error deliberately passing an unsupported body
    expect(() => heliocentricState('tatooine', new Date())).toThrow(/unknown|unsupported/i)
  })
})
