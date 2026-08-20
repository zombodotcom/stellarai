import { describe, expect, test } from 'vitest'
import { StarIndex, findRoute, type StarNode } from '../src/routing.js'

const star = (id: string, x: number, y: number, z = 0): StarNode => ({
  id,
  positionPc: { x, y, z },
})

function randomField(count: number, span: number, seed: number): StarNode[] {
  let a = seed
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const stars: StarNode[] = []
  for (let i = 0; i < count; i++) {
    stars.push(star(`s${i}`, rand() * span, rand() * span, rand() * span))
  }
  return stars
}

describe('StarIndex', () => {
  test('routes through a prebuilt index exactly as findRoute does', () => {
    const stars = [star('a', 0, 0), star('b', 4, 0), star('c', 8, 0), star('d', 12, 0)]
    const index = new StarIndex(stars, 5)

    const viaIndex = index.route('a', 'd')!
    const viaFunction = findRoute({ stars, originId: 'a', destinationId: 'd', maxJumpPc: 5 })!

    expect(viaIndex.hops.map((h) => h.id)).toEqual(viaFunction.hops.map((h) => h.id))
    expect(viaIndex.totalDistancePc).toBeCloseTo(viaFunction.totalDistancePc, 12)
  })

  test('reports how many stars it indexed and at what jump range', () => {
    const index = new StarIndex(randomField(1000, 50, 3), 6)
    expect(index.size).toBe(1000)
    expect(index.maxJumpPc).toBe(6)
  })

  test('serves many queries from one build', () => {
    const stars = randomField(5000, 60, 11)
    stars.push(star('origin', 0, 0, 0))
    stars.push(star('target', 60, 60, 60))
    const index = new StarIndex(stars, 6)

    const first = index.route('origin', 'target')
    const second = index.route('origin', 'target')
    const reversed = index.route('target', 'origin')

    expect(first).not.toBeNull()
    expect(second!.totalDistancePc).toBeCloseTo(first!.totalDistancePc, 12)
    expect(reversed!.totalDistancePc).toBeCloseTo(first!.totalDistancePc, 6)
  })

  // The whole point of the class. At catalog scale the index build dominates
  // a query completely -- the A* search itself settles a couple of hundred
  // stars in microseconds. Both figures are measured in the same run on the
  // same machine, so the ratio is meaningful even though absolute timings
  // are not.
  test('amortises the index build across repeated queries', () => {
    const stars = randomField(100_000, 120, 5)
    stars.push(star('origin', 0, 0, 0))
    stars.push(star('target', 120, 120, 120))
    const QUERIES = 10

    const rebuildStart = Date.now()
    for (let i = 0; i < QUERIES; i++) {
      findRoute({
        stars,
        originId: 'origin',
        destinationId: 'target',
        maxJumpPc: 6,
        heuristicWeight: 1.5,
      })
    }
    const rebuildMs = Date.now() - rebuildStart

    const index = new StarIndex(stars, 6)
    const reuseStart = Date.now()
    for (let i = 0; i < QUERIES; i++) {
      index.route('origin', 'target', { heuristicWeight: 1.5 })
    }
    const reuseMs = Date.now() - reuseStart

    expect(reuseMs * 3).toBeLessThan(rebuildMs)
  })

  // Cell size equals the jump range the index was built for. A shorter jump
  // is safe -- the cells are merely larger than they need to be, so the
  // neighbour sweep checks extra candidates and rejects them on distance. A
  // longer jump is not: real neighbours would sit outside the 27 cells the
  // sweep looks at and be silently missed.
  test('allows a query with a shorter jump range than it was built for', () => {
    const stars = [star('a', 0, 0), star('b', 4, 0), star('c', 8, 0)]
    const index = new StarIndex(stars, 10)
    const route = index.route('a', 'c', { maxJumpPc: 5 })!
    expect(route.hops.map((h) => h.id)).toEqual(['a', 'b', 'c'])
  })

  test('refuses a query with a longer jump range than it was built for', () => {
    const index = new StarIndex([star('a', 0, 0), star('b', 4, 0)], 5)
    expect(() => index.route('a', 'b', { maxJumpPc: 20 })).toThrow(/jump range|rebuild|built for/i)
  })

  test('rejects a non-positive jump range at construction', () => {
    expect(() => new StarIndex([star('a', 0, 0)], 0)).toThrow(/jump range/i)
  })

  test('rejects unknown star ids', () => {
    const index = new StarIndex([star('a', 0, 0)], 5)
    expect(() => index.route('nope', 'a')).toThrow(/not found/i)
    expect(() => index.route('a', 'nope')).toThrow(/not found/i)
  })
})
