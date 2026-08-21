import { describe, expect, test } from 'vitest'
import { findAssistedRoutes } from '../src/mga.js'

describe('findAssistedRoutes', () => {
  // The reason gravity assists exist: Mercury is brutally expensive to
  // reach directly (huge heliocentric speed change), and a Venus flyby
  // pays for much of it -- Mariner 10, 1973. The search must rediscover
  // this from the physics, not from a lookup table.
  test('finds a Venus flyby to Mercury cheaper than the direct transfer', () => {
    const routes = findAssistedRoutes({
      origin: 'earth',
      destination: 'mercury',
      departureStart: new Date('2026-01-01T00:00:00Z'),
      departureEnd: new Date('2028-01-01T00:00:00Z'),
      maxFlybys: 1,
    })

    expect(routes.length).toBeGreaterThan(0)
    const direct = routes.find((r) => r.sequence.length === 2)
    const viaVenus = routes.find(
      (r) => r.sequence.length === 3 && r.sequence[1] === 'venus',
    )
    expect(direct).toBeDefined()
    expect(viaVenus).toBeDefined()
    expect(viaVenus!.totalCostMs).toBeLessThan(direct!.totalCostMs)
  }, 120_000)

  test('returns routes sorted by ascending total cost', () => {
    const routes = findAssistedRoutes({
      origin: 'earth',
      destination: 'mars',
      departureStart: new Date('2026-06-01T00:00:00Z'),
      departureEnd: new Date('2027-06-01T00:00:00Z'),
      maxFlybys: 1,
    })
    for (let i = 1; i < routes.length; i++) {
      expect(routes[i]!.totalCostMs).toBeGreaterThanOrEqual(routes[i - 1]!.totalCostMs)
    }
  }, 120_000)

  test('describes each route completely enough to draw and brief it', () => {
    const routes = findAssistedRoutes({
      origin: 'earth',
      destination: 'mercury',
      departureStart: new Date('2026-01-01T00:00:00Z'),
      departureEnd: new Date('2027-01-01T00:00:00Z'),
      maxFlybys: 1,
    })
    const assisted = routes.find((r) => r.sequence.length === 3)!
    expect(assisted.legs.length).toBe(2)
    // Leg times chain: each leg departs where and when the previous arrived.
    expect(assisted.legs[1]!.departure.getTime()).toBe(assisted.legs[0]!.arrival.getTime())
    expect(assisted.flybys.length).toBe(1)
    expect(assisted.flybys[0]!.body).toBe(assisted.sequence[1])
    expect(assisted.flybys[0]!.vInfInMs).toBeGreaterThan(0)
    expect(assisted.departureVInfMs).toBeGreaterThan(0)
    expect(assisted.arrivalVInfMs).toBeGreaterThan(0)
    // Total cost is the sum of its published parts.
    expect(assisted.totalCostMs).toBeCloseTo(
      assisted.departureVInfMs +
        assisted.flybys.reduce((s, f) => s + f.poweredDeltaVMs, 0) +
        assisted.arrivalVInfMs,
      6,
    )
  }, 120_000)

  test('rejects a flyby via the origin or destination body', () => {
    expect(() =>
      findAssistedRoutes({
        origin: 'earth',
        destination: 'mars',
        departureStart: new Date('2026-01-01T00:00:00Z'),
        departureEnd: new Date('2026-06-01T00:00:00Z'),
        maxFlybys: 1,
        flybyBodies: ['earth'],
      }),
    ).toThrow(/origin|destination/i)
  })

  test('rejects an unsupported flyby count', () => {
    expect(() =>
      findAssistedRoutes({
        origin: 'earth',
        destination: 'mars',
        departureStart: new Date('2026-01-01T00:00:00Z'),
        departureEnd: new Date('2026-06-01T00:00:00Z'),
        maxFlybys: 3,
      }),
    ).toThrow(/flyby/i)
  })
})
