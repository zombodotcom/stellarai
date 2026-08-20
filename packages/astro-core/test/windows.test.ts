import { describe, expect, test } from 'vitest'
import { findTransferWindows } from '../src/windows.js'

describe('findTransferWindows', () => {
  // Earth->Mars windows recur roughly every 26 months; one falls in late 2026.
  const search = {
    origin: 'earth' as const,
    destination: 'mars' as const,
    departureStart: new Date('2026-09-01T00:00:00Z'),
    departureEnd: new Date('2027-02-01T00:00:00Z'),
    minFlightDays: 120,
    maxFlightDays: 400,
    departureStepDays: 5,
    flightTimeStepDays: 10,
  }

  test('finds a plausible Earth-to-Mars transfer in the late 2026 window', () => {
    const options = findTransferWindows(search)
    expect(options.length).toBeGreaterThan(0)

    const best = options[0]!
    // Heliocentric departure + arrival delta-v for a Hohmann-like Earth->Mars
    // transfer runs about 5.5-6.5 km/s. Allow a wide band: this test is
    // guarding against unit errors and frame mistakes, not tuning a mission.
    expect(best.totalDeltaVMs).toBeGreaterThan(4_000)
    expect(best.totalDeltaVMs).toBeLessThan(12_000)
  })

  test('the cheapest transfer takes a Hohmann-like amount of time', () => {
    const best = findTransferWindows(search)[0]!
    expect(best.flightTimeDays).toBeGreaterThan(120)
    expect(best.flightTimeDays).toBeLessThan(400)
  })

  test('returns options sorted by ascending total delta-v', () => {
    const options = findTransferWindows(search)
    for (let i = 1; i < options.length; i++) {
      expect(options[i]!.totalDeltaVMs).toBeGreaterThanOrEqual(options[i - 1]!.totalDeltaVMs)
    }
  })

  test('arrival is always after departure by exactly the flight time', () => {
    for (const o of findTransferWindows(search).slice(0, 20)) {
      const deltaDays = (o.arrival.getTime() - o.departure.getTime()) / 86_400_000
      expect(deltaDays).toBeCloseTo(o.flightTimeDays, 6)
    }
  })

  test('reports departure C3 consistent with departure delta-v', () => {
    // C3 is the square of hyperbolic excess speed, conventionally in km^2/s^2.
    const best = findTransferWindows(search)[0]!
    expect(best.departureC3Km2S2).toBeCloseTo((best.departureDeltaVMs / 1000) ** 2, 6)
  })

  // The scan grid inevitably contains geometries Lambert cannot solve — most
  // notably transfers near exactly 180 degrees, where the plane is undefined.
  // A porkchop scan must step over those, not die on them.
  test('skips unsolvable geometries instead of throwing', () => {
    expect(() =>
      findTransferWindows({
        origin: 'earth',
        destination: 'mars',
        departureStart: new Date('2026-01-01T00:00:00Z'),
        departureEnd: new Date('2028-01-01T00:00:00Z'),
        minFlightDays: 10,
        maxFlightDays: 900,
        departureStepDays: 11,
        flightTimeStepDays: 7,
      }),
    ).not.toThrow()
  })

  test('rejects a transfer to the origin itself', () => {
    expect(() => findTransferWindows({ ...search, destination: 'earth' })).toThrow(
      /same body|origin|destination/i,
    )
  })

  test('rejects an inverted departure range', () => {
    expect(() =>
      findTransferWindows({
        ...search,
        departureStart: new Date('2027-02-01T00:00:00Z'),
        departureEnd: new Date('2026-09-01T00:00:00Z'),
      }),
    ).toThrow()
  })

  test('rejects an inverted flight time range', () => {
    expect(() =>
      findTransferWindows({ ...search, minFlightDays: 400, maxFlightDays: 120 }),
    ).toThrow()
  })
})
