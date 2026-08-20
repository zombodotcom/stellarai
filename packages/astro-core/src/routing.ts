/**
 * Interstellar route finding.
 *
 * Given a set of stars and a maximum single-jump range, find the shortest
 * total-distance path from one star to another. The graph is implicit: edges
 * are every pair of stars within jump range, and there are far too many to
 * enumerate.
 *
 * ## Why A*, and why not contraction hierarchies
 *
 * The obvious move for "shortest path is too slow on a big graph" is to reach
 * for the road-network toolbox: contraction hierarchies, hub labelling, ALT.
 * That would be a mistake here, and it is worth writing down why so that
 * nobody re-derives it later.
 *
 * Those techniques exploit the *hierarchy* in road networks. A few motorways
 * carry most long-distance traffic, so contracting unimportant nodes adds few
 * shortcuts. A star field connected by jump range has no such hierarchy: it is
 * a unit-disk graph, where every node looks like every other. Contraction
 * hierarchies are documented as performing poorly on exactly this graph class,
 * because contracting a node forces shortcuts between all of its neighbours
 * and the effect compounds toward a quadratic edge count.
 *
 * So the answer is goal-directed search, not hierarchy. That matches what
 * shipping tools for the same problem converge on: Elite Dangerous long-range
 * routers offer breadth-first search (exact, slow), A* with a speed/quality
 * knob, and greedy (fast, and by their own documentation, bad).
 *
 * ## What makes it tractable
 *
 * 1. A* with straight-line distance as the heuristic. It is admissible and
 *    consistent, since no route between two stars can be shorter than the
 *    direct line, so the result stays optimal while the search sweeps an
 *    ellipsoid between the endpoints rather than a sphere around the origin.
 * 2. `heuristicWeight` above 1 trades optimality for speed under a hard bound:
 *    the route can never exceed that factor times the optimal one. This is
 *    what makes a fast preview mode honest. Greedy nearest-hop chaining offers
 *    no bound at all, and on the five-star graph in the tests it returns
 *    27.9 pc against an optimum of 18.
 * 3. Neighbours come from a uniform spatial hash keyed on cells of the jump
 *    range, so a lookup touches 27 cells rather than millions of stars. An
 *    all-pairs scan of the real 2.55M-star catalog would be 6.5e12 distance
 *    computations and would never return.
 * 4. Edges are generated lazily, only for nodes the search actually settles.
 */

import type { Vec3 } from './frames.js'

export interface StarNode {
  id: string
  name?: string
  /** Position in parsecs, any consistent cartesian frame. */
  positionPc: Vec3
}

export interface RouteSearch {
  stars: StarNode[]
  originId: string
  destinationId: string
  /** Maximum distance a single jump may cover, parsecs. */
  maxJumpPc: number
  /**
   * Multiplier on the straight-line heuristic. 1, the default, searches
   * exactly. Above 1 searches faster and returns a route guaranteed to be
   * within that factor of optimal. Below 1 is refused: it would only slow the
   * search down while buying nothing, since 1 is already exact.
   */
  heuristicWeight?: number
  /**
   * Cost of a single jump, defaulting to its length in parsecs.
   *
   * This hook exists so cost can depend on the star being jumped *from*, not
   * only on distance. Elite Dangerous routers cut a Sol-to-Colonia run from
   * roughly 600 jumps to 213 by routing through neutron stars for a range
   * boost, and the same idea applies to any catalog carrying spectral types.
   *
   * The returned cost must never be below the straight-line distance, or the
   * heuristic stops being admissible and the optimality guarantee is void.
   */
  jumpCost?: (from: StarNode, to: StarNode, distancePc: number) => number
}

export interface Route {
  /** Every star visited, origin first, destination last. */
  hops: StarNode[]
  /** Total route cost, parsecs under the default jump cost. */
  totalDistancePc: number
  /** Number of jumps, i.e. hops.length - 1. */
  jumpCount: number
  /**
   * How many stars the search settled before finishing. Reported because it is
   * the honest measure of search cost: wall-clock timings say as much about
   * the machine as about the algorithm.
   */
  starsExplored: number
}

const distance = (a: Vec3, b: Vec3): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** Integer spatial hash of a cell coordinate triple. */
function hashCell(cx: number, cy: number, cz: number): number {
  return (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791)) | 0
}

/**
 * Uniform spatial hash. Cell size equals the jump range, so every star within
 * range of a query point lies in that point's cell or one of its 26 neighbours.
 *
 * Cells are keyed by an integer hash rather than a template string; building
 * string keys for millions of stars was measurably worse. Hash collisions are
 * harmless, because a colliding cell only adds candidates and every candidate
 * is distance-checked anyway.
 */
class SpatialHash {
  private readonly cells = new Map<number, number[]>()
  private readonly scratch: number[] = []

  constructor(
    private readonly stars: StarNode[],
    private readonly cellSize: number,
  ) {
    for (let i = 0; i < stars.length; i++) {
      const p = stars[i]!.positionPc
      const key = hashCell(
        Math.floor(p.x / cellSize),
        Math.floor(p.y / cellSize),
        Math.floor(p.z / cellSize),
      )
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(i)
      else this.cells.set(key, [i])
    }
  }

  /**
   * Indices of every star within `cellSize` of the given position.
   *
   * The returned array is reused between calls, so copy it if you need to hold
   * on to it. The search consumes it immediately, and not allocating a fresh
   * array per settled node matters at catalog scale.
   */
  within(p: Vec3): readonly number[] {
    const cx = Math.floor(p.x / this.cellSize)
    const cy = Math.floor(p.y / this.cellSize)
    const cz = Math.floor(p.z / this.cellSize)
    const found = this.scratch
    found.length = 0

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.cells.get(hashCell(cx + dx, cy + dy, cz + dz))
          if (!bucket) continue
          for (let k = 0; k < bucket.length; k++) {
            const i = bucket[k]!
            if (distance(p, this.stars[i]!.positionPc) <= this.cellSize) found.push(i)
          }
        }
      }
    }
    return found
  }
}

/** Binary min-heap keyed on cost. Small and sufficient; no dependency needed. */
class MinHeap {
  private readonly items: Array<{ index: number; cost: number }> = []

  get size(): number {
    return this.items.length
  }

  push(index: number, cost: number): void {
    this.items.push({ index, cost })
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.items[parent]!.cost <= this.items[i]!.cost) break
      const tmp = this.items[parent]!
      this.items[parent] = this.items[i]!
      this.items[i] = tmp
      i = parent
    }
  }

  pop(): { index: number; cost: number } | undefined {
    const top = this.items[0]
    const last = this.items.pop()
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let smallest = i
        if (l < this.items.length && this.items[l]!.cost < this.items[smallest]!.cost) {
          smallest = l
        }
        if (r < this.items.length && this.items[r]!.cost < this.items[smallest]!.cost) {
          smallest = r
        }
        if (smallest === i) break
        const tmp = this.items[smallest]!
        this.items[smallest] = this.items[i]!
        this.items[i] = tmp
        i = smallest
      }
    }
    return top
  }
}

/** Shortest total-distance route between two stars under a jump-range limit. */
export function findRoute(search: RouteSearch): Route | null {
  const { stars, originId, destinationId, maxJumpPc, heuristicWeight = 1, jumpCost } = search

  if (!(maxJumpPc > 0)) throw new Error('Maximum jump range must be positive.')
  if (!(heuristicWeight >= 1)) {
    throw new Error(
      `Heuristic weight must be at least 1; got ${heuristicWeight}. ` +
        `A weight below 1 slows the search without buying anything, ` +
        `since a weight of 1 already searches exactly.`,
    )
  }

  const indexById = new Map<string, number>()
  for (let i = 0; i < stars.length; i++) indexById.set(stars[i]!.id, i)

  const originIndex = indexById.get(originId)
  const destinationIndex = indexById.get(destinationId)
  if (originIndex === undefined) throw new Error(`Origin star not found: ${originId}`)
  if (destinationIndex === undefined) {
    throw new Error(`Destination star not found: ${destinationId}`)
  }

  if (originIndex === destinationIndex) {
    return {
      hops: [stars[originIndex]!],
      totalDistancePc: 0,
      jumpCount: 0,
      starsExplored: 1,
    }
  }

  const goal = stars[destinationIndex]!.positionPc
  const hash = new SpatialHash(stars, maxJumpPc)
  const best = new Float64Array(stars.length).fill(Infinity)
  const cameFrom = new Int32Array(stars.length).fill(-1)
  const settled = new Uint8Array(stars.length)

  best[originIndex] = 0
  const queue = new MinHeap()
  queue.push(originIndex, heuristicWeight * distance(stars[originIndex]!.positionPc, goal))

  let starsExplored = 0

  while (queue.size > 0) {
    const current = queue.pop()!
    if (settled[current.index]) continue
    settled[current.index] = 1
    starsExplored++
    if (current.index === destinationIndex) break

    const fromStar = stars[current.index]!
    const here = fromStar.positionPc
    const costHere = best[current.index]!

    const neighbours = hash.within(here)
    for (let n = 0; n < neighbours.length; n++) {
      const neighbour = neighbours[n]!
      if (settled[neighbour]) continue
      const toStar = stars[neighbour]!
      const step = distance(here, toStar.positionPc)
      const edge = jumpCost ? jumpCost(fromStar, toStar, step) : step
      const candidate = costHere + edge
      if (candidate < best[neighbour]!) {
        best[neighbour] = candidate
        cameFrom[neighbour] = current.index
        queue.push(neighbour, candidate + heuristicWeight * distance(toStar.positionPc, goal))
      }
    }
  }

  if (!Number.isFinite(best[destinationIndex]!)) return null

  const hops: StarNode[] = []
  for (let i: number = destinationIndex; i !== -1; i = cameFrom[i]!) {
    hops.push(stars[i]!)
  }
  hops.reverse()

  return {
    hops,
    totalDistancePc: best[destinationIndex]!,
    jumpCount: hops.length - 1,
    starsExplored,
  }
}
