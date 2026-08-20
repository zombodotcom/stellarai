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
 * hierarchies are documented as performing poorly on exactly that class,
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
 *
 * ## Build the index once
 *
 * At catalog scale the index build dominates everything else: over 2.55M
 * stars a weighted query settles about 200 stars in microseconds, while
 * building the hash takes ~1.9 seconds. Use {@link StarIndex} to pay that
 * once and keep it. {@link findRoute} is the one-shot convenience wrapper and
 * rebuilds every call, which is fine for a handful of stars and wasteful for
 * a catalog.
 */

import type { Vec3 } from './frames.js'

export interface StarNode {
  id: string
  name?: string
  /** Position in parsecs, any consistent cartesian frame. */
  positionPc: Vec3
}

export interface RouteOptions {
  /**
   * Maximum distance a single jump may cover, parsecs. Defaults to the range
   * the index was built for. May be lowered per query but never raised.
   */
  maxJumpPc?: number
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

export interface RouteSearch extends RouteOptions {
  stars: StarNode[]
  originId: string
  destinationId: string
  /** Maximum distance a single jump may cover, parsecs. */
  maxJumpPc: number
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

/** Binary min-heap keyed on cost. Small and sufficient; no dependency needed. */
class MinHeap {
  private readonly index: number[] = []
  private readonly cost: number[] = []

  get size(): number {
    return this.index.length
  }

  clear(): void {
    this.index.length = 0
    this.cost.length = 0
  }

  push(index: number, cost: number): void {
    this.index.push(index)
    this.cost.push(cost)
    let i = this.index.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.cost[parent]! <= this.cost[i]!) break
      this.swap(parent, i)
      i = parent
    }
  }

  /** Pops the lowest-cost entry, returning its node index, or -1 if empty. */
  pop(): number {
    if (this.index.length === 0) return -1
    const top = this.index[0]!
    const lastIndex = this.index.pop()!
    const lastCost = this.cost.pop()!

    if (this.index.length > 0) {
      this.index[0] = lastIndex
      this.cost[0] = lastCost
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let smallest = i
        if (l < this.cost.length && this.cost[l]! < this.cost[smallest]!) smallest = l
        if (r < this.cost.length && this.cost[r]! < this.cost[smallest]!) smallest = r
        if (smallest === i) break
        this.swap(smallest, i)
        i = smallest
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const ti = this.index[a]!
    this.index[a] = this.index[b]!
    this.index[b] = ti
    const tc = this.cost[a]!
    this.cost[a] = this.cost[b]!
    this.cost[b] = tc
  }
}

/**
 * A star catalog prepared for repeated route queries.
 *
 * Building this is the expensive part; querying it is not. Over a 2.55M-star
 * field the build takes about 1.9 seconds while a weighted query settles
 * roughly 200 stars in microseconds, so a caller that rebuilds per query pays
 * essentially the entire cost every time.
 *
 * The index holds a reference to the star array and assumes it does not
 * change. Mutating or reordering that array after construction invalidates
 * the index; build a new one instead.
 */
export class StarIndex {
  private readonly cells = new Map<number, number[]>()
  private readonly idToIndex = new Map<string, number>()
  private readonly neighbourScratch: number[] = []

  /** Per-query scratch, allocated once. At catalog scale these are tens of
   * megabytes each, so reallocating them per query would undo the point. */
  private readonly best: Float64Array
  private readonly cameFrom: Int32Array
  private readonly settled: Uint8Array
  private readonly queue = new MinHeap()

  /**
   * Guards the shared scratch state. `best`, `cameFrom`, `settled`, `queue`
   * and `neighbourScratch` are reused across queries, which makes sequential
   * calls cheap but makes the class non-reentrant. A `jumpCost` callback that
   * queries this same index would reset that state mid-search and leave the
   * outer query walking a neighbour array that is no longer its own.
   */
  private running = false

  constructor(
    private readonly stars: readonly StarNode[],
    /** Jump range this index was built for, parsecs. Also the cell size. */
    readonly maxJumpPc: number,
  ) {
    if (!(maxJumpPc > 0)) throw new Error('Maximum jump range must be positive.')

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i]!
      this.idToIndex.set(s.id, i)
      const p = s.positionPc
      const key = hashCell(
        Math.floor(p.x / maxJumpPc),
        Math.floor(p.y / maxJumpPc),
        Math.floor(p.z / maxJumpPc),
      )
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(i)
      else this.cells.set(key, [i])
    }

    this.best = new Float64Array(stars.length)
    this.cameFrom = new Int32Array(stars.length)
    this.settled = new Uint8Array(stars.length)
  }

  /** Number of stars indexed. */
  get size(): number {
    return this.stars.length
  }

  /**
   * Indices of every star within `radius` of a position.
   *
   * The returned array is reused between calls; copy it if you need to keep
   * it. `radius` must not exceed the index's cell size, or genuine neighbours
   * would lie outside the 27 cells swept here and be silently missed.
   */
  private within(p: Vec3, radius: number): readonly number[] {
    const cell = this.maxJumpPc
    const cx = Math.floor(p.x / cell)
    const cy = Math.floor(p.y / cell)
    const cz = Math.floor(p.z / cell)
    const found = this.neighbourScratch
    found.length = 0

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.cells.get(hashCell(cx + dx, cy + dy, cz + dz))
          if (!bucket) continue
          for (let k = 0; k < bucket.length; k++) {
            const i = bucket[k]!
            if (distance(p, this.stars[i]!.positionPc) <= radius) found.push(i)
          }
        }
      }
    }
    return found
  }

  /** Shortest route between two stars, under this index's jump range. */
  route(originId: string, destinationId: string, options: RouteOptions = {}): Route | null {
    const { heuristicWeight = 1, jumpCost } = options
    const jumpRange = options.maxJumpPc ?? this.maxJumpPc

    if (!(jumpRange > 0)) throw new Error('Maximum jump range must be positive.')
    if (jumpRange > this.maxJumpPc) {
      throw new Error(
        `Query jump range ${jumpRange} pc exceeds the ${this.maxJumpPc} pc range this ` +
          `index was built for. Neighbours beyond the cell size would be missed. ` +
          `Rebuild the index at the longer range.`,
      )
    }
    if (!(heuristicWeight >= 1)) {
      throw new Error(
        `Heuristic weight must be at least 1; got ${heuristicWeight}. ` +
          `A weight below 1 slows the search without buying anything, ` +
          `since a weight of 1 already searches exactly.`,
      )
    }
    // Infinity passes the check above, and then poisons the search: the
    // heuristic at the destination is distance(goal, goal) === 0 exactly, so
    // the priority becomes Infinity * 0 === NaN. Every comparison against NaN
    // is false, so the heap's sift-up never terminates and the NaN entry
    // bubbles to the root, popping the destination ahead of cheaper paths.
    // Measured on a three-star graph, this returned a route 500x worse than
    // optimal with no error raised.
    if (!Number.isFinite(heuristicWeight)) {
      throw new Error(
        `Heuristic weight must be finite; got ${heuristicWeight}. An infinite ` +
          `weight produces a NaN search priority at the destination and silently ` +
          `returns a non-optimal route. For near-greedy behaviour use a large ` +
          `finite weight, which keeps the suboptimality bound meaningful.`,
      )
    }

    const originIndex = this.idToIndex.get(originId)
    const destinationIndex = this.idToIndex.get(destinationId)
    if (originIndex === undefined) throw new Error(`Origin star not found: ${originId}`)
    if (destinationIndex === undefined) {
      throw new Error(`Destination star not found: ${destinationId}`)
    }

    if (originIndex === destinationIndex) {
      return {
        hops: [this.stars[originIndex]!],
        totalDistancePc: 0,
        jumpCount: 0,
        starsExplored: 1,
      }
    }

    if (this.running) {
      throw new Error(
        'StarIndex.route is already running on this index. Its search state is ' +
          'shared between queries, so a jumpCost callback must not query the same ' +
          'index reentrantly. Use a second StarIndex over the same stars instead.',
      )
    }

    const { best, cameFrom, settled, queue } = this
    best.fill(Infinity)
    cameFrom.fill(-1)
    settled.fill(0)
    queue.clear()

    const goal = this.stars[destinationIndex]!.positionPc
    best[originIndex] = 0
    queue.push(originIndex, heuristicWeight * distance(this.stars[originIndex]!.positionPc, goal))

    let starsExplored = 0

    this.running = true
    try {
      while (queue.size > 0) {
        const currentIndex = queue.pop()
        if (currentIndex < 0) break
        if (settled[currentIndex]) continue
        settled[currentIndex] = 1
        starsExplored++
        if (currentIndex === destinationIndex) break

        const fromStar = this.stars[currentIndex]!
        const here = fromStar.positionPc
        const costHere = best[currentIndex]!

        const neighbours = this.within(here, jumpRange)
        for (let n = 0; n < neighbours.length; n++) {
          const neighbour = neighbours[n]!
          if (settled[neighbour]) continue
          const toStar = this.stars[neighbour]!
          const step = distance(here, toStar.positionPc)
          const edge = jumpCost ? jumpCost(fromStar, toStar, step) : step
          const candidate = costHere + edge
          if (candidate < best[neighbour]!) {
            best[neighbour] = candidate
            cameFrom[neighbour] = currentIndex
            queue.push(neighbour, candidate + heuristicWeight * distance(toStar.positionPc, goal))
          }
        }
      }
    } finally {
      // Must clear even if a user jumpCost throws, or the index is wedged.
      this.running = false
    }

    if (!Number.isFinite(best[destinationIndex]!)) return null

    const hops: StarNode[] = []
    for (let i: number = destinationIndex; i !== -1; i = cameFrom[i]!) {
      hops.push(this.stars[i]!)
    }
    hops.reverse()

    return {
      hops,
      totalDistancePc: best[destinationIndex]!,
      jumpCount: hops.length - 1,
      starsExplored,
    }
  }
}

/**
 * Shortest route between two stars, building a throwaway index.
 *
 * Convenient for one-shot queries and for small star sets. For anything at
 * catalog scale, or for more than one query over the same stars, build a
 * {@link StarIndex} once and call its `route` method instead: the index build
 * is essentially the whole cost of a query.
 */
export function findRoute(search: RouteSearch): Route | null {
  const { stars, originId, destinationId, maxJumpPc, heuristicWeight, jumpCost } = search
  const index = new StarIndex(stars, maxJumpPc)
  const options: RouteOptions = {}
  if (heuristicWeight !== undefined) options.heuristicWeight = heuristicWeight
  if (jumpCost !== undefined) options.jumpCost = jumpCost
  return index.route(originId, destinationId, options)
}
