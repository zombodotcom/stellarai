import { describe, expect, test } from 'vitest'
import { findRoute, type StarNode } from '../src/routing.js'

const star = (id: string, x: number, y: number, z = 0): StarNode => ({
  id,
  positionPc: { x, y, z },
})

describe('findRoute', () => {
  test('goes direct when the destination is inside jump range', () => {
    const stars = [star('a', 0, 0), star('b', 3, 0)]
    const route = findRoute({ stars, originId: 'a', destinationId: 'b', maxJumpPc: 5 })!
    expect(route.hops.map((h) => h.id)).toEqual(['a', 'b'])
    expect(route.jumpCount).toBe(1)
    expect(route.totalDistancePc).toBeCloseTo(3, 9)
  })

  test('chains hops when no single jump can reach', () => {
    const stars = [star('a', 0, 0), star('b', 4, 0), star('c', 8, 0), star('d', 12, 0)]
    const route = findRoute({ stars, originId: 'a', destinationId: 'd', maxJumpPc: 5 })!
    expect(route.hops.map((h) => h.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(route.totalDistancePc).toBeCloseTo(12, 9)
  })

  // The point of running a real shortest-path search rather than repeatedly
  // hopping to the nearest reachable star. Greedy picks 'd' first because it
  // is marginally closer than 'b', and lands on a route half again as long.
  test('finds the shortest route, not the greedy one', () => {
    const stars = [
      star('a', 0, 0),
      star('b', 0, 9),
      star('c', 0, 18),
      star('d', 8, 4),
      star('e', 8, 14),
    ]
    const route = findRoute({ stars, originId: 'a', destinationId: 'c', maxJumpPc: 10 })!

    // Greedy would go a -> d (8.94) before a -> b (9.0), and end up at ~27.9.
    expect(route.hops.map((h) => h.id)).toEqual(['a', 'b', 'c'])
    expect(route.totalDistancePc).toBeCloseTo(18, 9)
  })

  test('returns null when the destination is unreachable', () => {
    const stars = [star('a', 0, 0), star('b', 3, 0), star('far', 500, 0)]
    expect(findRoute({ stars, originId: 'a', destinationId: 'far', maxJumpPc: 5 })).toBeNull()
  })

  test('returns a zero-length route from a star to itself', () => {
    const stars = [star('a', 0, 0), star('b', 3, 0)]
    const route = findRoute({ stars, originId: 'a', destinationId: 'a', maxJumpPc: 5 })!
    expect(route.hops.map((h) => h.id)).toEqual(['a'])
    expect(route.jumpCount).toBe(0)
    expect(route.totalDistancePc).toBe(0)
  })

  test('rejects an unknown origin or destination', () => {
    const stars = [star('a', 0, 0)]
    expect(() =>
      findRoute({ stars, originId: 'nope', destinationId: 'a', maxJumpPc: 5 }),
    ).toThrow(/not found|unknown/i)
    expect(() =>
      findRoute({ stars, originId: 'a', destinationId: 'nope', maxJumpPc: 5 }),
    ).toThrow(/not found|unknown/i)
  })

  test('rejects a non-positive jump range', () => {
    const stars = [star('a', 0, 0), star('b', 1, 0)]
    expect(() => findRoute({ stars, originId: 'a', destinationId: 'b', maxJumpPc: 0 })).toThrow()
  })

  // The real stellar catalog holds 2.55 million stars. Comparing every star
  // against every other is 6.5e12 distance computations and will never
  // return. Neighbour lookup has to be spatially indexed, so this test uses
  // a set large enough that an all-pairs scan cannot pass it.
  test('routes across 50,000 stars without an all-pairs scan', () => {
    const stars: StarNode[] = []
    // mulberry32. A naive LCG is wrong here: `seed * 1103515245` overflows
    // 2^53, the low bits turn to noise, and the sequence collapses to a
    // ~10k cycle -- which would leave this test quietly routing across far
    // fewer distinct positions than its name claims.
    let a = 42
    const rand = () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    const positions = new Set<string>()
    for (let i = 0; i < 50_000; i++) {
      const x = rand() * 100
      const y = rand() * 100
      const z = rand() * 100
      positions.add(`${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`)
      stars.push(star(`s${i}`, x, y, z))
    }
    // Guard the guard: if the generator ever degenerates again, fail loudly
    // rather than silently shrinking the problem this test claims to solve.
    expect(positions.size).toBeGreaterThan(49_900)
    stars.push(star('origin', 0, 0, 0))
    stars.push(star('target', 100, 100, 100))

    const started = Date.now()
    const route = findRoute({
      stars,
      originId: 'origin',
      destinationId: 'target',
      maxJumpPc: 6,
    })
    const elapsedMs = Date.now() - started

    expect(route).not.toBeNull()
    expect(elapsedMs).toBeLessThan(5000)
  })

  // Plain Dijkstra expands a sphere outward in every direction and settles
  // very nearly every star before it happens to reach the target. Straight
  // line distance is an admissible and consistent heuristic here -- no route
  // can ever be shorter than the direct line -- so A* keeps the shortest-path
  // guarantee while searching an ellipsoid between the endpoints instead.
  //
  // This is asserted as a node count rather than a wall clock, so it states
  // the actual algorithmic claim and cannot go flaky on a slow CI runner.
  test('explores far fewer stars than an exhaustive search would', () => {
    const stars: StarNode[] = []
    let a = 7
    const rand = () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (let i = 0; i < 50_000; i++) {
      stars.push(star(`s${i}`, rand() * 100, rand() * 100, rand() * 100))
    }
    stars.push(star('origin', 0, 0, 0))
    stars.push(star('target', 100, 100, 100))

    const route = findRoute({
      stars,
      originId: 'origin',
      destinationId: 'target',
      maxJumpPc: 6,
    })!

    expect(route.starsExplored).toBeLessThan(stars.length * 0.5)
  })

  test('a weighted search stays within its stated suboptimality bound', () => {
    // Weighted A* (f = g + w*h) trades optimality for speed, but the trade is
    // bounded: the route can never exceed w times the optimal one. This is
    // what makes a "fast preview" mode honest rather than a guess. Greedy
    // search, by contrast, offers no bound at all -- on this very graph it
    // returns 27.9 pc against an optimum of 18.
    const stars = [
      star('a', 0, 0),
      star('b', 0, 9),
      star('c', 0, 18),
      star('d', 8, 4),
      star('e', 8, 14),
    ]
    const optimal = findRoute({ stars, originId: 'a', destinationId: 'c', maxJumpPc: 10 })!
    const weighted = findRoute({
      stars,
      originId: 'a',
      destinationId: 'c',
      maxJumpPc: 10,
      heuristicWeight: 2,
    })!
    expect(weighted.totalDistancePc).toBeLessThanOrEqual(optimal.totalDistancePc * 2)
  })

  test('a weighted search settles no more stars than an exact one', () => {
    const stars: StarNode[] = []
    let a = 99
    const rand = () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (let i = 0; i < 30_000; i++) {
      stars.push(star(`s${i}`, rand() * 100, rand() * 100, rand() * 100))
    }
    stars.push(star('origin', 0, 0, 0))
    stars.push(star('target', 100, 100, 100))

    const base = { stars, originId: 'origin', destinationId: 'target', maxJumpPc: 6 }
    const exact = findRoute(base)!
    const fast = findRoute({ ...base, heuristicWeight: 3 })!

    expect(fast.starsExplored).toBeLessThan(exact.starsExplored)
    expect(fast.totalDistancePc).toBeLessThanOrEqual(exact.totalDistancePc * 3)
  })

  test('rejects a heuristic weight below 1, which would break the bound', () => {
    const stars = [star('a', 0, 0), star('b', 3, 0)]
    expect(() =>
      findRoute({
        stars,
        originId: 'a',
        destinationId: 'b',
        maxJumpPc: 5,
        heuristicWeight: 0.5,
      }),
    ).toThrow(/weight/i)
  })

  test('A* still returns the optimal route, not merely a good one', () => {
    // Same graph as the greedy test above. An inadmissible heuristic would
    // break optimality silently, so pin it explicitly.
    const stars = [
      star('a', 0, 0),
      star('b', 0, 9),
      star('c', 0, 18),
      star('d', 8, 4),
      star('e', 8, 14),
    ]
    const route = findRoute({ stars, originId: 'a', destinationId: 'c', maxJumpPc: 10 })!
    expect(route.hops.map((h) => h.id)).toEqual(['a', 'b', 'c'])
    expect(route.totalDistancePc).toBeCloseTo(18, 9)
  })
})
