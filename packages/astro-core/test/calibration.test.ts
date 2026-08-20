import { describe, expect, test } from 'vitest'
import { StarIndex, type StarNode } from '../src/routing.js'

function uniformField(count: number, span: number, seed: number): StarNode[] {
  let a = seed
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const stars: StarNode[] = []
  for (let i = 0; i < count; i++) {
    stars.push({
      id: `s${i}`,
      positionPc: { x: rand() * span, y: rand() * span, z: rand() * span },
    })
  }
  return stars
}

describe('calibrateHeuristicWeight', () => {
  // A route through a jump-limited graph is always at least as long as the
  // straight line, and in a random field it settles to a characteristic
  // ratio -- the graph's stretch. That ratio is the correct heuristic
  // weight: large enough to prune hard, small enough that the answer stays
  // essentially optimal.
  //
  // Measured on a 2.55M-star uniform field at 4 pc jump range, the stretch
  // is 1.059, and w=1.06 settles 8,487 stars against exact A*'s 387,148 --
  // 95x less search for a route 0.14% off optimal. The shipped default of
  // 1.5 gives up 6.34% by comparison. Guessing the weight was leaving most
  // of the quality on the table.
  test('reports a stretch above 1 and well below the old 1.5 default', () => {
    const index = new StarIndex(uniformField(40_000, 80, 5), 5)
    const c = index.calibrateHeuristicWeight({ samples: 12, seed: 1 })

    expect(c.medianStretch).toBeGreaterThan(1)
    expect(c.medianStretch).toBeLessThan(1.3)
    expect(c.recommendedWeight).toBeGreaterThanOrEqual(c.medianStretch)
    expect(c.recommendedWeight).toBeLessThan(1.5)
  })

  test('is deterministic for a given seed', () => {
    const index = new StarIndex(uniformField(20_000, 60, 7), 5)
    const a = index.calibrateHeuristicWeight({ samples: 8, seed: 42 })
    const b = index.calibrateHeuristicWeight({ samples: 8, seed: 42 })
    expect(b.recommendedWeight).toBeCloseTo(a.recommendedWeight, 12)
    expect(b.medianStretch).toBeCloseTo(a.medianStretch, 12)
  })

  test('reports how many pairs it actually managed to route', () => {
    const index = new StarIndex(uniformField(20_000, 60, 11), 5)
    const c = index.calibrateHeuristicWeight({ samples: 10, seed: 3 })
    expect(c.samples).toBeGreaterThan(0)
    expect(c.samples).toBeLessThanOrEqual(10)
  })

  // The whole point: routing at the calibrated weight should be much
  // cheaper than exact while staying close to the exact answer.
  test('the calibrated weight prunes hard and stays near optimal', () => {
    const stars = uniformField(60_000, 90, 13)
    stars.push({ id: 'origin', positionPc: { x: 0, y: 0, z: 0 } })
    stars.push({ id: 'target', positionPc: { x: 90, y: 90, z: 90 } })
    const index = new StarIndex(stars, 5)

    const c = index.calibrateHeuristicWeight({ samples: 12, seed: 2 })
    const exact = index.route('origin', 'target')!
    const tuned = index.route('origin', 'target', { heuristicWeight: c.recommendedWeight })!

    expect(tuned.starsExplored).toBeLessThan(exact.starsExplored)
    expect(tuned.totalDistancePc).toBeLessThanOrEqual(
      exact.totalDistancePc * c.recommendedWeight,
    )
    // And in practice it should be far closer than the bound permits.
    expect(tuned.totalDistancePc / exact.totalDistancePc).toBeLessThan(1.05)
  })

  test('refuses to calibrate a graph too sparse to route anything', () => {
    // Stars far beyond jump range of each other: no pair can be routed, so
    // there is no stretch to measure. Returning a made-up 1.0 would be
    // worse than admitting it.
    const stars: StarNode[] = [
      { id: 'a', positionPc: { x: 0, y: 0, z: 0 } },
      { id: 'b', positionPc: { x: 500, y: 0, z: 0 } },
      { id: 'c', positionPc: { x: 0, y: 500, z: 0 } },
    ]
    const index = new StarIndex(stars, 2)
    expect(() => index.calibrateHeuristicWeight({ samples: 5, seed: 1 })).toThrow(
      /could not route|no connected|too sparse/i,
    )
  })

  test('rejects a non-positive sample count', () => {
    const index = new StarIndex(uniformField(1000, 40, 1), 5)
    expect(() => index.calibrateHeuristicWeight({ samples: 0 })).toThrow(/sample/i)
  })
})

describe('calibration samples short routes', () => {
  // Stretch is a property of the field's density and jump range, not of any
  // particular pair, so calibration should measure it on SHORT routes --
  // cheap to solve exactly -- and carry the result to long ones. Sampling
  // uniformly random pairs instead picks pairs that are typically far apart,
  // making every sample a full-cost exact search. On a 2.55M-star catalog
  // that took 36.6 seconds: the difference between a calibration call
  // somebody runs and one nobody does.
  //
  // The load-bearing claim is that sampling is bounded by the JUMP RANGE,
  // not by the size of the catalog. Under uniform sampling the median
  // separation grows with the span; under band-limited sampling it does not.
  // Same density and jump range, two very different volumes:
  test('keeps sampled separations bounded as the catalog grows', () => {
    const density = 0.08 // stars per cubic parsec, held constant
    const small = new StarIndex(
      uniformField(Math.round(density * 60 ** 3), 60, 21),
      5,
    )
    const large = new StarIndex(
      uniformField(Math.round(density * 140 ** 3), 140, 21),
      5,
    )

    const cs = small.calibrateHeuristicWeight({ samples: 10, seed: 4 })
    const cl = large.calibrateHeuristicWeight({ samples: 10, seed: 4 })

    // The large cube is 2.33x the span. Uniform sampling would carry that
    // straight into the separations; band-limiting must not.
    expect(cl.medianSeparationPc).toBeLessThan(cs.medianSeparationPc * 1.6)
    // And both must stay inside the jump-range-derived band.
    expect(cs.medianSeparationPc).toBeLessThanOrEqual(20 * 5)
    expect(cl.medianSeparationPc).toBeLessThanOrEqual(20 * 5)
  })

  test('still measures a stretch consistent with uniform sampling', () => {
    // Short-route calibration must not bias the answer. A short route has
    // fewer hops and so slightly more relative detour, which makes it
    // conservative -- acceptable, since a slightly high weight only widens
    // the proven bound, it never breaks it.
    const index = new StarIndex(uniformField(80_000, 100, 21), 5)
    const c = index.calibrateHeuristicWeight({ samples: 12, seed: 4 })
    expect(c.medianStretch).toBeGreaterThan(1)
    expect(c.medianStretch).toBeLessThan(1.25)
  })
})
