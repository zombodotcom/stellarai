/**
 * Launch window search — the "porkchop" scan.
 *
 * Sweeps a grid of departure dates against a grid of flight times, solving
 * Lambert's problem at each node and costing the result. What comes back is
 * the answer to the question a user actually asks: "when should I leave, and
 * what will it cost me?"
 *
 * Delta-v here is heliocentric: the change needed relative to the departure
 * body's own orbital motion, and the mismatch on arrival. It excludes the
 * escape and capture burns, which depend on parking orbit altitude and belong
 * to a mission design the navigator does not assume.
 */

import { heliocentricState, type PlanetId } from './ephemeris.js'
import { MU_SUN } from './ephemeris.js'
import { solveLambert } from './lambert.js'
import type { Vec3 } from './frames.js'

const DAY_MS = 86_400_000

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const mag = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)

export interface TransferSearch {
  origin: PlanetId
  destination: PlanetId
  departureStart: Date
  departureEnd: Date
  minFlightDays: number
  maxFlightDays: number
  departureStepDays?: number
  flightTimeStepDays?: number
}

export interface TransferOption {
  departure: Date
  arrival: Date
  flightTimeDays: number
  /** Speed change needed at departure, relative to the origin body, m/s. */
  departureDeltaVMs: number
  /** Speed mismatch on arrival, relative to the destination body, m/s. */
  arrivalDeltaVMs: number
  totalDeltaVMs: number
  /** Characteristic energy at departure, km^2/s^2 — the conventional unit. */
  departureC3Km2S2: number
}

/** Scan a departure-date by flight-time grid, cheapest transfer first. */
export function findTransferWindows(search: TransferSearch): TransferOption[] {
  const {
    origin,
    destination,
    departureStart,
    departureEnd,
    minFlightDays,
    maxFlightDays,
    departureStepDays = 5,
    flightTimeStepDays = 10,
  } = search

  if (origin === destination) {
    throw new Error('Origin and destination are the same body; there is nothing to transfer to.')
  }
  if (departureEnd.getTime() <= departureStart.getTime()) {
    throw new Error('Departure window end must be after its start.')
  }
  if (!(minFlightDays > 0) || maxFlightDays < minFlightDays) {
    throw new Error('Flight time range must be positive and ordered.')
  }
  if (!(departureStepDays > 0) || !(flightTimeStepDays > 0)) {
    throw new Error('Grid steps must be positive.')
  }

  const options: TransferOption[] = []

  for (
    let t = departureStart.getTime();
    t <= departureEnd.getTime();
    t += departureStepDays * DAY_MS
  ) {
    const departure = new Date(t)
    const originState = heliocentricState(origin, departure)

    for (let tof = minFlightDays; tof <= maxFlightDays; tof += flightTimeStepDays) {
      const arrival = new Date(t + tof * DAY_MS)
      const destState = heliocentricState(destination, arrival)

      let solution
      try {
        solution = solveLambert({
          r1: originState.positionM,
          r2: destState.positionM,
          timeOfFlightS: tof * 86_400,
          mu: MU_SUN,
        })
      } catch {
        // Degenerate geometry — most often a transfer angle near 180 degrees,
        // where the orbital plane is undefined. Step over it; the grid has
        // plenty of other nodes.
        continue
      }

      const departureDeltaVMs = mag(sub(solution.v1, originState.velocityMs))
      const arrivalDeltaVMs = mag(sub(solution.v2, destState.velocityMs))

      if (!Number.isFinite(departureDeltaVMs) || !Number.isFinite(arrivalDeltaVMs)) continue

      options.push({
        departure,
        arrival,
        flightTimeDays: tof,
        departureDeltaVMs,
        arrivalDeltaVMs,
        totalDeltaVMs: departureDeltaVMs + arrivalDeltaVMs,
        departureC3Km2S2: (departureDeltaVMs / 1000) ** 2,
      })
    }
  }

  options.sort((a, b) => a.totalDeltaVMs - b.totalDeltaVMs)
  return options
}
