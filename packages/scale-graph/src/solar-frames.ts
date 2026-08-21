/**
 * Solar system frames, anchored to the real ephemeris.
 *
 * Builds a barycentric root ('ssb') with a child frame per major body, each
 * positioned by `astronomy-engine` (VSOP87, validated against JPL Horizons)
 * through `@stellarai/astro-core`. Advancing time re-anchors the same frames
 * rather than rebuilding the graph, so anything holding a frame reference —
 * the camera, a plotted trajectory, an orbit line — survives the update.
 *
 * Every body frame uses metres as its unit. That is the whole point of the
 * nested-frame design: a camera near a planet resolves millimetres in that
 * planet's frame no matter where the planet is in the galaxy.
 */

import { heliocentricState, type PlanetId } from '@stellarai/astro-core'
import { AU_M, type ScaleGraph } from './index.js'

/** Bodies given frames, in no significant order. */
const BODIES: readonly PlanetId[] = [
  'sun',
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
]

/** Root frame id: the solar system barycentre. Units: AU. */
export const SSB_FRAME = 'ssb'

/**
 * Create the solar system's frame tree at an epoch.
 *
 * The root uses AU as its unit so body origins are numbers of order 1-40,
 * comfortably exact in Float64. Body frames use metres.
 */
export function buildSolarSystemFrames(graph: ScaleGraph, epoch: Date): void {
  graph.addFrame({
    id: SSB_FRAME,
    parent: null,
    originInParent: { x: 0, y: 0, z: 0 },
    unitM: AU_M,
  })
  for (const body of BODIES) {
    const s = heliocentricState(body, epoch)
    graph.addFrame({
      id: body,
      parent: SSB_FRAME,
      originInParent: {
        x: s.positionM.x / AU_M,
        y: s.positionM.y / AU_M,
        z: s.positionM.z / AU_M,
      },
      unitM: 1,
    })
  }
}

/** Re-anchor every body frame to its position at a new epoch. */
export function updateSolarSystemFrames(graph: ScaleGraph, epoch: Date): void {
  for (const body of BODIES) {
    const s = heliocentricState(body, epoch)
    try {
      graph.setFrameOrigin(body, {
        x: s.positionM.x / AU_M,
        y: s.positionM.y / AU_M,
        z: s.positionM.z / AU_M,
      })
    } catch (e) {
      throw new Error(
        `Cannot update solar system frames: frame '${body}' is missing. ` +
          `Was buildSolarSystemFrames called on this graph first?`,
        { cause: e },
      )
    }
  }
}
