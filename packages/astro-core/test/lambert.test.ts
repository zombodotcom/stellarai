import { describe, expect, test } from 'vitest'
import { solveLambert } from '../src/lambert.js'
import type { Vec3 } from '../src/frames.js'

/** Heliocentric gravitational parameter, m^3/s^2. */
const MU_SUN = 1.32712440018e20
const AU = 1.495978707e11

const mag = (v: Vec3) => Math.hypot(v.x, v.y, v.z)
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z

describe('solveLambert', () => {
  // A circular orbit is the one case where the answer is known in closed form
  // without needing a propagator: if r1 and r2 sit on the same circle and the
  // time of flight is exactly the arc's share of the period, the transfer IS
  // that circle, so v1 must be the circular velocity, perpendicular to r1.
  test('recovers circular velocity for a quarter-revolution transfer', () => {
    const r = AU
    const vCirc = Math.sqrt(MU_SUN / r)
    const period = 2 * Math.PI * Math.sqrt(r ** 3 / MU_SUN)

    const r1: Vec3 = { x: r, y: 0, z: 0 }
    const r2: Vec3 = { x: 0, y: r, z: 0 }
    const tof = period / 4

    const { v1, v2 } = solveLambert({ r1, r2, timeOfFlightS: tof, mu: MU_SUN })

    expect(mag(v1)).toBeCloseTo(vCirc, 3)
    expect(mag(v2)).toBeCloseTo(vCirc, 3)
    // Circular means velocity is perpendicular to radius everywhere.
    expect(dot(v1, r1) / (mag(v1) * r)).toBeCloseTo(0, 9)
    expect(v1.y).toBeGreaterThan(0)
  })

  test('recovers circular velocity across a range of transfer angles', () => {
    const r = AU
    const vCirc = Math.sqrt(MU_SUN / r)
    const period = 2 * Math.PI * Math.sqrt(r ** 3 / MU_SUN)

    for (const angleDeg of [20, 60, 120, 200, 300]) {
      const theta = (angleDeg * Math.PI) / 180
      const r1: Vec3 = { x: r, y: 0, z: 0 }
      const r2: Vec3 = { x: r * Math.cos(theta), y: r * Math.sin(theta), z: 0 }
      const tof = (theta / (2 * Math.PI)) * period

      const { v1 } = solveLambert({ r1, r2, timeOfFlightS: tof, mu: MU_SUN })
      expect(mag(v1) / vCirc).toBeCloseTo(1, 6)
    }
  })

  // A near-Hohmann Earth->Mars transfer. Textbook departure delta-v from a
  // 1 AU circular orbit is ~2.94 km/s with a ~259 day flight.
  test('reproduces the Earth-to-Mars Hohmann departure delta-v', () => {
    const rEarth = AU
    const rMars = 1.524 * AU
    const aTransfer = (rEarth + rMars) / 2
    const tof = Math.PI * Math.sqrt(aTransfer ** 3 / MU_SUN)

    // 179 deg rather than 180: an exactly half-revolution transfer leaves the
    // orbital plane undefined, so we approach it instead of sitting on it.
    const theta = (179 * Math.PI) / 180
    const r1: Vec3 = { x: rEarth, y: 0, z: 0 }
    const r2: Vec3 = { x: rMars * Math.cos(theta), y: rMars * Math.sin(theta), z: 0 }

    const { v1 } = solveLambert({ r1, r2, timeOfFlightS: tof, mu: MU_SUN })

    const vEarth = Math.sqrt(MU_SUN / rEarth)
    const departureDeltaV = Math.abs(mag(v1) - vEarth)
    expect(departureDeltaV).toBeGreaterThan(2800)
    expect(departureDeltaV).toBeLessThan(3100)
    expect(tof / 86400).toBeCloseTo(259, 0)
  })

  test('conserves orbital energy between the two endpoints', () => {
    const r1: Vec3 = { x: AU, y: 0, z: 0 }
    const r2: Vec3 = { x: 0.4 * AU, y: 1.1 * AU, z: 0.05 * AU }
    const tof = 180 * 86400

    const { v1, v2 } = solveLambert({ r1, r2, timeOfFlightS: tof, mu: MU_SUN })

    // Vis-viva: the same semi-major axis must fall out at both ends.
    const a1 = 1 / (2 / mag(r1) - mag(v1) ** 2 / MU_SUN)
    const a2 = 1 / (2 / mag(r2) - mag(v2) ** 2 / MU_SUN)
    expect(a1 / a2).toBeCloseTo(1, 6)
  })

  test('finds a retrograde solution when asked for one', () => {
    const r = AU
    const period = 2 * Math.PI * Math.sqrt(r ** 3 / MU_SUN)
    const r1: Vec3 = { x: r, y: 0, z: 0 }
    const r2: Vec3 = { x: 0, y: r, z: 0 }

    // Going the long way round, 270 deg retrograde, takes 3/4 of a period.
    const { v1 } = solveLambert({
      r1,
      r2,
      timeOfFlightS: (3 * period) / 4,
      mu: MU_SUN,
      retrograde: true,
    })
    expect(v1.y).toBeLessThan(0)
    expect(mag(v1) / Math.sqrt(MU_SUN / r)).toBeCloseTo(1, 6)
  })

  test('refuses a transfer angle of exactly 180 degrees', () => {
    // The transfer plane is undefined when r1 and r2 are antiparallel.
    const r1: Vec3 = { x: AU, y: 0, z: 0 }
    const r2: Vec3 = { x: -1.5 * AU, y: 0, z: 0 }
    expect(() =>
      solveLambert({ r1, r2, timeOfFlightS: 200 * 86400, mu: MU_SUN }),
    ).toThrow(/plane|180|degenerate/i)
  })

  test('rejects a non-positive time of flight', () => {
    const r1: Vec3 = { x: AU, y: 0, z: 0 }
    const r2: Vec3 = { x: 0, y: AU, z: 0 }
    expect(() => solveLambert({ r1, r2, timeOfFlightS: 0, mu: MU_SUN })).toThrow()
  })
})
