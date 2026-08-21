import { describe, expect, test } from 'vitest'
import { propagateKepler } from '../src/kepler.js'
import { solveLambert } from '../src/lambert.js'
import type { Vec3 } from '../src/frames.js'

const MU_SUN = 1.32712440018e20
const AU = 1.495978707e11

const mag = (v: Vec3) => Math.hypot(v.x, v.y, v.z)

describe('propagateKepler', () => {
  test('carries a circular orbit a quarter period to the known position', () => {
    const r = AU
    const vCirc = Math.sqrt(MU_SUN / r)
    const period = 2 * Math.PI * Math.sqrt(r ** 3 / MU_SUN)

    const state = propagateKepler(
      { x: r, y: 0, z: 0 },
      { x: 0, y: vCirc, z: 0 },
      period / 4,
      MU_SUN,
    )

    expect(state.position.x / r).toBeCloseTo(0, 6)
    expect(state.position.y / r).toBeCloseTo(1, 6)
    expect(state.velocity.x / vCirc).toBeCloseTo(-1, 6)
    expect(state.velocity.y / vCirc).toBeCloseTo(0, 6)
  })

  test('returns the initial state for zero elapsed time', () => {
    const state = propagateKepler(
      { x: AU, y: 0, z: 0.1 * AU },
      { x: 1000, y: 25000, z: -500 },
      0,
      MU_SUN,
    )
    expect(state.position.x).toBeCloseTo(AU, 3)
    expect(state.velocity.y).toBeCloseTo(25000, 6)
  })

  // The propagator and the Lambert solver must agree: propagating Lambert's
  // departure state for the time of flight has to land on the arrival
  // position. This closes the loop between the two independently-implemented
  // pieces of conic machinery.
  test('closes the loop with the Lambert solver', () => {
    const r1: Vec3 = { x: AU, y: 0, z: 0 }
    const r2: Vec3 = { x: 0.3 * AU, y: 1.2 * AU, z: 0.05 * AU }
    const tof = 200 * 86400

    const { v1 } = solveLambert({ r1, r2, timeOfFlightS: tof, mu: MU_SUN })
    const arrived = propagateKepler(r1, v1, tof, MU_SUN)

    expect(arrived.position.x / AU).toBeCloseTo(r2.x / AU, 3)
    expect(arrived.position.y / AU).toBeCloseTo(r2.y / AU, 3)
    expect(arrived.position.z / AU).toBeCloseTo(r2.z / AU, 3)
  })

  test('conserves energy along a full elliptic revolution', () => {
    const r0: Vec3 = { x: AU, y: 0, z: 0 }
    const v0: Vec3 = { x: 0, y: 35000, z: 2000 }
    const energy = (p: Vec3, v: Vec3) => (mag(v) ** 2) / 2 - MU_SUN / mag(p)
    const e0 = energy(r0, v0)

    for (const days of [50, 200, 500, 900]) {
      const s = propagateKepler(r0, v0, days * 86400, MU_SUN)
      expect(energy(s.position, s.velocity) / e0).toBeCloseTo(1, 9)
    }
  })

  test('handles a hyperbolic trajectory', () => {
    // Above escape speed at 1 AU (42.1 km/s): energy must stay positive and
    // the craft must keep receding.
    const r0: Vec3 = { x: AU, y: 0, z: 0 }
    const v0: Vec3 = { x: 0, y: 50000, z: 0 }
    const near = propagateKepler(r0, v0, 100 * 86400, MU_SUN)
    const far = propagateKepler(r0, v0, 400 * 86400, MU_SUN)
    expect(mag(far.position)).toBeGreaterThan(mag(near.position))
    expect((mag(far.velocity) ** 2) / 2 - MU_SUN / mag(far.position)).toBeGreaterThan(0)
  })

  test('propagates backward in time', () => {
    const r0: Vec3 = { x: AU, y: 0, z: 0 }
    const v0: Vec3 = { x: 0, y: 30000, z: 0 }
    const forward = propagateKepler(r0, v0, 100 * 86400, MU_SUN)
    const back = propagateKepler(forward.position, forward.velocity, -100 * 86400, MU_SUN)
    expect(back.position.x / AU).toBeCloseTo(1, 6)
    expect(back.position.y / AU).toBeCloseTo(0, 6)
  })

  test('rejects a degenerate state', () => {
    expect(() =>
      propagateKepler({ x: 0, y: 0, z: 0 }, { x: 0, y: 30000, z: 0 }, 86400, MU_SUN),
    ).toThrow(/position/i)
  })
})
