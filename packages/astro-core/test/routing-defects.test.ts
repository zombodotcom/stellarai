import { describe, expect, test } from 'vitest'
import { StarIndex, type StarNode } from '../src/routing.js'

const star = (id: string, x: number, y: number, z = 0): StarNode => ({
  id,
  positionPc: { x, y, z },
})

describe('heuristic weight validation', () => {
  // Found by adversarial review. `Infinity >= 1` is true, so an infinite
  // weight passed validation. The heuristic at the destination is
  // distance(goal, goal) === 0 exactly, so the priority became
  // Infinity * 0 === NaN. Every NaN comparison is false, so MinHeap's
  // sift-up never breaks and the NaN entry bubbles to the root and is
  // popped next regardless of its true rank -- terminating the search at
  // the destination before cheaper paths are examined.
  //
  // Measured before the fix: this exact input returned A -> C at cost 1000
  // where the optimum is A -> B -> C at cost 2. A 500x worse route, with
  // no error raised. Silently returning a wrong answer is the worst
  // failure mode a navigator can have.
  test('rejects an infinite weight instead of silently returning a wrong route', () => {
    const stars = [star('A', 0, 0), star('B', 1, 0), star('C', 2, 0)]
    const index = new StarIndex(stars, 5)
    expect(() => index.route('A', 'C', { heuristicWeight: Infinity })).toThrow(/finite/i)
  })

  test('rejects a NaN weight', () => {
    const index = new StarIndex([star('A', 0, 0), star('B', 1, 0)], 5)
    expect(() => index.route('A', 'B', { heuristicWeight: NaN })).toThrow(/weight/i)
  })

  test('still accepts large finite weights, which are legitimate', () => {
    // A near-greedy weight is a legitimate fast-preview setting, so only
    // Infinity is refused. A -> C direct and A -> B -> C both cost 2 here,
    // so assert the cost rather than a particular hop list.
    const stars = [star('A', 0, 0), star('B', 1, 0), star('C', 2, 0)]
    const index = new StarIndex(stars, 5)
    const route = index.route('A', 'C', { heuristicWeight: 1000 })!
    expect(route.totalDistancePc).toBeCloseTo(2, 9)
  })

  // The regression the Infinity bug would have produced, pinned directly:
  // with a jump cost that makes the direct hop expensive, the search must
  // route around it rather than terminate on first sight of the destination.
  test('takes the cheap indirect route when the direct hop is expensive', () => {
    const stars = [star('A', 0, 0), star('B', 1, 0), star('C', 2, 0)]
    const index = new StarIndex(stars, 5)
    const route = index.route('A', 'C', {
      jumpCost: (from, to, d) => (from.id === 'A' && to.id === 'C' ? 1000 : d),
    })!
    expect(route.hops.map((h) => h.id)).toEqual(['A', 'B', 'C'])
    expect(route.totalDistancePc).toBeCloseTo(2, 9)
  })
})

describe('reentrancy', () => {
  // Found by adversarial review. StarIndex reuses best/cameFrom/settled/queue
  // and the neighbour scratch array across calls, resetting them per query.
  // That makes sequential reuse safe but not reentrant: a jumpCost callback
  // that queries the same index wipes the outer search's state mid-flight
  // and leaves it iterating a neighbour array that no longer belongs to it.
  //
  // The jumpCost doc actively invites context lookups, so this is a
  // plausible thing for a caller to write. Throwing a clear error beats
  // silently corrupting the answer.
  test('refuses a jumpCost that queries the same index', () => {
    const stars = [star('A', 0, 0), star('B', 1, 0), star('C', 2, 0)]
    const index = new StarIndex(stars, 5)

    expect(() =>
      index.route('A', 'C', {
        jumpCost: (from, to, d) => {
          index.route('A', 'B')
          return d
        },
      }),
    ).toThrow(/reentran|already running|in use/i)
  })

  test('recovers cleanly after a jumpCost throws', () => {
    const stars = [star('A', 0, 0), star('B', 1, 0), star('C', 2, 0)]
    const index = new StarIndex(stars, 5)

    expect(() =>
      index.route('A', 'C', {
        jumpCost: () => {
          throw new Error('boom')
        },
      }),
    ).toThrow('boom')

    // The index must not be left wedged by the throw.
    const route = index.route('A', 'C')!
    expect(route.hops.map((h) => h.id)).toEqual(['A', 'C'])
  })

  test('allows sequential queries and separate indexes over the same stars', () => {
    const stars = [star('A', 0, 0), star('B', 1, 0), star('C', 2, 0)]
    const outer = new StarIndex(stars, 5)
    const inner = new StarIndex(stars, 5)

    // Querying a *different* index from inside jumpCost is fine.
    const route = outer.route('A', 'C', {
      jumpCost: (from, to, d) => {
        inner.route('A', 'B')
        return d
      },
    })!
    expect(route.hops.map((h) => h.id)).toEqual(['A', 'C'])
  })
})
