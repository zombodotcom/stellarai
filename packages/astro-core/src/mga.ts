/**
 * Gravity-assist route search.
 *
 * Given an origin, a destination and a departure window, enumerate flyby
 * sequences (direct, and via each candidate body), solve every leg with
 * Lambert over a coarse grid of dates, price each candidate honestly, and
 * return the best of each sequence.
 *
 * The cost model is the mission designer's first-order one:
 *
 *   cost = departure v-infinity            (what your launcher must supply)
 *        + sum of powered flyby delta-v    (what gravity could not provide)
 *        + arrival v-infinity              (what you must shed to capture)
 *
 * Flybys are priced, not rejected: an infeasible turn charges the burn that
 * would fix it, so the search degrades gracefully instead of discarding
 * near-miss geometries. This is a coarse-grid scout, not an optimiser — it
 * exists to answer "is there a cheaper way via another planet, roughly
 * when, and by how much", which it does with the same physics that made
 * Mariner 10 fly via Venus. Refining a chosen route is a later, finer pass.
 *
 * Tree search over longer sequences (VEEGA-class) is deliberately deferred:
 * with one flyby the grid is small enough to sweep exhaustively, which is
 * simpler than MCTS and provably complete over its grid.
 */

import { heliocentricState, MU_SUN, type PlanetId } from './ephemeris.js'
import { solveLambert } from './lambert.js'
import {
  MIN_FLYBY_RADIUS_M,
  PLANET_GM,
  poweredFlybyDeltaV,
  type FlybyBody,
} from './flyby.js'
import type { Vec3 } from './frames.js'

const DAY_MS = 86_400_000
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const mag = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)

export interface AssistedRouteSearch {
  origin: FlybyBody
  destination: FlybyBody
  departureStart: Date
  departureEnd: Date
  /** 0 = direct only; 1 = direct plus single-flyby sequences. */
  maxFlybys: 0 | 1
  /** Candidate flyby bodies; defaults to the inner system plus Jupiter. */
  flybyBodies?: readonly FlybyBody[]
}

export interface RouteLeg {
  from: FlybyBody
  to: FlybyBody
  departure: Date
  arrival: Date
  flightTimeDays: number
}

export interface FlybyDetail {
  body: FlybyBody
  when: Date
  vInfInMs: number
  vInfOutMs: number
  poweredDeltaVMs: number
}

export interface AssistedRoute {
  /** Bodies visited in order, origin first, destination last. */
  sequence: FlybyBody[]
  legs: RouteLeg[]
  flybys: FlybyDetail[]
  departureVInfMs: number
  arrivalVInfMs: number
  totalCostMs: number
}

const DEFAULT_FLYBY_BODIES: readonly FlybyBody[] = ['venus', 'earth', 'mars', 'jupiter']

/** Coarse leg flight-time grid, scaled to how far out the leg reaches. */
function legTofGridDays(a: FlybyBody, b: FlybyBody): number[] {
  const outer: FlybyBody[] = ['jupiter', 'saturn', 'uranus', 'neptune']
  if (outer.includes(a) || outer.includes(b)) {
    return [400, 600, 800, 1100, 1500, 2000, 2700]
  }
  return [60, 90, 120, 160, 210, 270, 340, 420]
}

interface LegSolution {
  departure: Date
  arrival: Date
  flightTimeDays: number
  /** Heliocentric velocity leaving the from-body, m/s. */
  v1: Vec3
  /** Heliocentric velocity arriving at the to-body, m/s. */
  v2: Vec3
}

function solveLeg(from: FlybyBody, to: FlybyBody, departure: Date, tofDays: number): LegSolution | null {
  const arrival = new Date(departure.getTime() + tofDays * DAY_MS)
  const s1 = heliocentricState(from, departure)
  const s2 = heliocentricState(to, arrival)
  try {
    const { v1, v2 } = solveLambert({
      r1: s1.positionM,
      r2: s2.positionM,
      timeOfFlightS: tofDays * 86_400,
      mu: MU_SUN,
    })
    if (!Number.isFinite(v1.x + v2.x)) return null
    return { departure, arrival, flightTimeDays: tofDays, v1, v2 }
  } catch {
    return null
  }
}

/** Search direct and single-flyby routes; best candidate per sequence, sorted. */
export function findAssistedRoutes(search: AssistedRouteSearch): AssistedRoute[] {
  const { origin, destination, departureStart, departureEnd, maxFlybys } = search

  if (maxFlybys !== 0 && maxFlybys !== 1) {
    throw new Error(
      `maxFlybys must be 0 or 1; got ${String(maxFlybys)}. Longer sequences ` +
        `(VEEGA-class) need a finer search than this coarse grid provides.`,
    )
  }
  if (origin === destination) throw new Error('Origin and destination are the same body.')

  // An explicitly requested endpoint flyby is a caller error; the default
  // list simply drops whichever endpoints it happens to contain.
  let flybyBodies: readonly FlybyBody[]
  if (search.flybyBodies) {
    for (const body of search.flybyBodies) {
      if (body === origin || body === destination) {
        throw new Error(
          `Flyby body ${body} is the origin or destination; a flyby via an ` +
            `endpoint is not a flyby.`,
        )
      }
    }
    flybyBodies = search.flybyBodies
  } else {
    flybyBodies = DEFAULT_FLYBY_BODIES.filter((b) => b !== origin && b !== destination)
  }

  const departureStepDays = 10
  const results: AssistedRoute[] = []

  const departureDates: Date[] = []
  for (let t = departureStart.getTime(); t <= departureEnd.getTime(); t += departureStepDays * DAY_MS) {
    departureDates.push(new Date(t))
  }

  // --- Direct ---------------------------------------------------------------
  {
    let best: AssistedRoute | null = null
    for (const departure of departureDates) {
      for (const tof of legTofGridDays(origin, destination)) {
        const leg = solveLeg(origin, destination, departure, tof)
        if (!leg) continue
        const originVel = heliocentricState(origin, departure).velocityMs
        const destVel = heliocentricState(destination, leg.arrival).velocityMs
        const depVInf = mag(sub(leg.v1, originVel))
        const arrVInf = mag(sub(leg.v2, destVel))
        const cost = depVInf + arrVInf
        if (!best || cost < best.totalCostMs) {
          best = {
            sequence: [origin, destination],
            legs: [
              {
                from: origin,
                to: destination,
                departure: leg.departure,
                arrival: leg.arrival,
                flightTimeDays: leg.flightTimeDays,
              },
            ],
            flybys: [],
            departureVInfMs: depVInf,
            arrivalVInfMs: arrVInf,
            totalCostMs: cost,
          }
        }
      }
    }
    if (best) results.push(best)
  }

  // --- Single flyby ---------------------------------------------------------
  if (maxFlybys === 1) {
    for (const via of flybyBodies) {
      let best: AssistedRoute | null = null
      for (const departure of departureDates) {
        for (const tof1 of legTofGridDays(origin, via)) {
          const leg1 = solveLeg(origin, via, departure, tof1)
          if (!leg1) continue

          const originVel = heliocentricState(origin, departure).velocityMs
          const viaVel = heliocentricState(via, leg1.arrival).velocityMs
          const depVInf = mag(sub(leg1.v1, originVel))
          const vInfIn = sub(leg1.v2, viaVel)

          for (const tof2 of legTofGridDays(via, destination)) {
            const leg2 = solveLeg(via, destination, leg1.arrival, tof2)
            if (!leg2) continue

            const vInfOut = sub(leg2.v1, viaVel)
            const powered = poweredFlybyDeltaV(via, vInfIn, vInfOut)

            const destVel = heliocentricState(destination, leg2.arrival).velocityMs
            const arrVInf = mag(sub(leg2.v2, destVel))
            const cost = depVInf + powered + arrVInf

            if (!best || cost < best.totalCostMs) {
              best = {
                sequence: [origin, via, destination],
                legs: [
                  {
                    from: origin,
                    to: via,
                    departure: leg1.departure,
                    arrival: leg1.arrival,
                    flightTimeDays: leg1.flightTimeDays,
                  },
                  {
                    from: via,
                    to: destination,
                    departure: leg2.departure,
                    arrival: leg2.arrival,
                    flightTimeDays: leg2.flightTimeDays,
                  },
                ],
                flybys: [
                  {
                    body: via,
                    when: leg1.arrival,
                    vInfInMs: mag(vInfIn),
                    vInfOutMs: mag(vInfOut),
                    poweredDeltaVMs: powered,
                  },
                ],
                departureVInfMs: depVInf,
                arrivalVInfMs: arrVInf,
                totalCostMs: cost,
              }
            }
          }
        }
      }
      if (best) results.push(best)
    }
  }

  results.sort((a, b) => a.totalCostMs - b.totalCostMs)
  return results
}

export { MIN_FLYBY_RADIUS_M, PLANET_GM }
export type { PlanetId }
