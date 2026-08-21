import { describe, expect, test } from 'vitest'
import { AU_M, ScaleGraph } from '../src/index.js'
import { buildSolarSystemFrames, updateSolarSystemFrames } from '../src/solar-frames.js'

describe('buildSolarSystemFrames', () => {
  test('creates a barycentric root with a frame per major body', () => {
    const graph = new ScaleGraph()
    buildSolarSystemFrames(graph, new Date('2026-06-15T00:00:00Z'))

    // Every body resolves without throwing, and the Sun is at the root.
    graph.setCamera({ frame: 'ssb', x: 0, y: 0, z: 0 })
    for (const id of ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']) {
      expect(() => graph.toRenderSpace({ frame: id, x: 0, y: 0, z: 0 })).not.toThrow()
    }
  })

  test('places Earth about one AU from the Sun at the build epoch', () => {
    const graph = new ScaleGraph()
    buildSolarSystemFrames(graph, new Date('2026-06-15T00:00:00Z'))
    graph.setCamera({ frame: 'sun', x: 0, y: 0, z: 0 })

    const earth = graph.toRenderSpace({ frame: 'earth', x: 0, y: 0, z: 0 })
    const rAu = Math.hypot(earth.x, earth.y, earth.z) / AU_M
    expect(rAu).toBeGreaterThan(0.98)
    expect(rAu).toBeLessThan(1.02)
  })

  test('gives planet frames metre units so surface work stays precise', () => {
    const graph = new ScaleGraph()
    buildSolarSystemFrames(graph, new Date('2026-06-15T00:00:00Z'))
    // A camera 400 km above Earth must resolve a metre.
    graph.setCamera({ frame: 'earth', x: 6_771_000, y: 0, z: 0 })
    const offset = graph.toRenderSpace({ frame: 'earth', x: 6_771_001, y: 0, z: 0 })
    expect(offset.x).toBeCloseTo(1, 9)
  })
})

describe('updateSolarSystemFrames', () => {
  test('moves the planets as the epoch advances', () => {
    const graph = new ScaleGraph()
    buildSolarSystemFrames(graph, new Date('2026-01-01T00:00:00Z'))
    graph.setCamera({ frame: 'sun', x: 0, y: 0, z: 0 })
    const before = graph.toRenderSpace({ frame: 'earth', x: 0, y: 0, z: 0 })

    updateSolarSystemFrames(graph, new Date('2026-04-01T00:00:00Z'))
    const after = graph.toRenderSpace({ frame: 'earth', x: 0, y: 0, z: 0 })

    // A quarter of an orbit: Earth should have moved on the order of an AU.
    const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)
    expect(moved).toBeGreaterThan(0.5 * AU_M)
    expect(moved).toBeLessThan(2.5 * AU_M)
  })

  test('keeps direction of motion consistent with the real orbit', () => {
    // Earth is nearer the Sun in January than in July -- the same
    // direction-of-time check the ephemeris tests use, now through frames.
    const graph = new ScaleGraph()
    buildSolarSystemFrames(graph, new Date('2026-01-03T00:00:00Z'))
    graph.setCamera({ frame: 'sun', x: 0, y: 0, z: 0 })
    const jan = graph.toRenderSpace({ frame: 'earth', x: 0, y: 0, z: 0 })

    updateSolarSystemFrames(graph, new Date('2026-07-05T00:00:00Z'))
    const jul = graph.toRenderSpace({ frame: 'earth', x: 0, y: 0, z: 0 })

    expect(Math.hypot(jan.x, jan.y, jan.z)).toBeLessThan(Math.hypot(jul.x, jul.y, jul.z))
  })

  test('refuses to update a graph that was never built', () => {
    const graph = new ScaleGraph()
    expect(() => updateSolarSystemFrames(graph, new Date())).toThrow(/built|missing/i)
  })
})
