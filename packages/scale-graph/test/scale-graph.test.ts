import { describe, expect, test } from 'vitest'
import { AU_M, KPC_M, PC_M, ScaleGraph } from '../src/index.js'

/** What a value becomes once it reaches a Float32 GPU buffer. */
const asFloat32 = (v: number) => Math.fround(v)

/**
 * A galaxy -> sun -> earth frame chain, the minimum needed to show why
 * nesting matters. Earth sits 8 kpc from the galactic centre and 1 AU from
 * the Sun, and a spacecraft sits one metre above Earth's surface.
 */
function galaxySunEarth(): ScaleGraph {
  const graph = new ScaleGraph()
  graph.addFrame({ id: 'galaxy', parent: null, originInParent: { x: 0, y: 0, z: 0 }, unitM: KPC_M })
  graph.addFrame({ id: 'sun', parent: 'galaxy', originInParent: { x: 8, y: 0, z: 0 }, unitM: AU_M })
  graph.addFrame({ id: 'earth', parent: 'sun', originInParent: { x: 1, y: 0, z: 0 }, unitM: 1 })
  return graph
}

const EARTH_RADIUS_M = 6_371_000

describe('the precision problem this module exists to solve', () => {
  // Float32 carries ~7 significant digits, so at 1 kpc its resolution is
  // roughly 7 AU. That much is well known. The trap is that Float64 is not
  // enough either: at 8 kpc its resolution is ~33 km, and at 1 Mpc it is
  // ~4,190 km. Storing absolute positions in metres destroys metre-scale
  // detail at STORAGE time, so no amount of camera-relative rebasing can
  // bring it back.
  test('Float32 world coordinates lose a metre at 1 kpc', () => {
    const oneKpc = 1000 * PC_M
    expect(asFloat32(oneKpc + 1) - asFloat32(oneKpc)).toBe(0)
  })

  test('Float64 world coordinates ALSO lose a metre at 1 kpc', () => {
    const oneKpc = 1000 * PC_M
    // This is the finding that forces nested frames. The addition is a no-op.
    expect(oneKpc + 1).toBe(oneKpc)
  })

  test('a nested frame keeps that metre, because the offset is stored locally', () => {
    const graph = galaxySunEarth()
    // Both camera and spacecraft live in Earth's frame, where coordinates are
    // ~6.4e6 m and Float64 resolves to nanometres.
    graph.setCamera({ frame: 'earth', x: EARTH_RADIUS_M, y: 0, z: 0 })
    const offset = graph.toRenderSpace({ frame: 'earth', x: EARTH_RADIUS_M + 1, y: 0, z: 0 })

    expect(offset.x).toBeCloseTo(1, 9)
    expect(asFloat32(offset.x)).toBeCloseTo(1, 6)
  })

  test('keeps the metre even when the camera is a frame away, at the Sun', () => {
    const graph = galaxySunEarth()
    graph.setCamera({ frame: 'sun', x: 1, y: 0, z: 0 })

    const atSurface = graph.toRenderSpace({ frame: 'earth', x: EARTH_RADIUS_M, y: 0, z: 0 })
    const aMetreUp = graph.toRenderSpace({ frame: 'earth', x: EARTH_RADIUS_M + 1, y: 0, z: 0 })

    // Resolved through the Sun frame, where magnitudes are ~1.5e11 m and
    // Float64 resolves to ~3e-5 m. The metre survives comfortably.
    expect(aMetreUp.x - atSurface.x).toBeCloseTo(1, 3)
  })

  test('places the camera itself at the render origin', () => {
    const graph = galaxySunEarth()
    graph.setCamera({ frame: 'earth', x: 123, y: -456, z: 789 })
    const offset = graph.toRenderSpace({ frame: 'earth', x: 123, y: -456, z: 789 })
    expect(offset).toEqual({ x: 0, y: 0, z: 0 })
  })
})

describe('frame resolution', () => {
  test('resolves a position from a child frame into a parent frame', () => {
    const graph = galaxySunEarth()
    graph.setCamera({ frame: 'sun', x: 0, y: 0, z: 0 })
    // Earth's origin is 1 AU from the Sun.
    const earthOrigin = graph.toRenderSpace({ frame: 'earth', x: 0, y: 0, z: 0 })
    expect(earthOrigin.x).toBeCloseTo(AU_M, 0)
  })

  test('resolves through a common ancestor when neither frame contains the other', () => {
    const graph = galaxySunEarth()
    graph.addFrame({ id: 'mars', parent: 'sun', originInParent: { x: 1.524, y: 0, z: 0 }, unitM: 1 })

    graph.setCamera({ frame: 'earth', x: 0, y: 0, z: 0 })
    const mars = graph.toRenderSpace({ frame: 'mars', x: 0, y: 0, z: 0 })

    // Earth and Mars share the Sun as their lowest common ancestor.
    expect(mars.x).toBeCloseTo(0.524 * AU_M, 0)
  })

  test('resolves upward across several levels', () => {
    const graph = galaxySunEarth()
    graph.setCamera({ frame: 'galaxy', x: 0, y: 0, z: 0 })
    const earth = graph.toRenderSpace({ frame: 'earth', x: 0, y: 0, z: 0 })
    expect(earth.x).toBeCloseTo(8 * KPC_M + AU_M, -6)
  })

  test('rejects an unknown frame', () => {
    const graph = galaxySunEarth()
    graph.setCamera({ frame: 'earth', x: 0, y: 0, z: 0 })
    expect(() => graph.toRenderSpace({ frame: 'krypton', x: 0, y: 0, z: 0 })).toThrow(
      /unknown frame/i,
    )
  })

  test('rejects rendering before a camera has been set', () => {
    const graph = galaxySunEarth()
    expect(() => graph.toRenderSpace({ frame: 'earth', x: 0, y: 0, z: 0 })).toThrow(
      /camera/i,
    )
  })

  test('rejects a frame whose parent does not exist', () => {
    const graph = new ScaleGraph()
    expect(() =>
      graph.addFrame({ id: 'moon', parent: 'earth', originInParent: { x: 0, y: 0, z: 0 }, unitM: 1 }),
    ).toThrow(/parent/i)
  })

  test('rejects a duplicate frame id', () => {
    const graph = galaxySunEarth()
    expect(() =>
      graph.addFrame({ id: 'earth', parent: 'sun', originInParent: { x: 2, y: 0, z: 0 }, unitM: 1 }),
    ).toThrow(/already/i)
  })

  test('rejects a non-positive frame unit', () => {
    const graph = galaxySunEarth()
    expect(() =>
      graph.addFrame({ id: 'bad', parent: 'sun', originInParent: { x: 0, y: 0, z: 0 }, unitM: 0 }),
    ).toThrow(/unit/i)
  })

  test('requires exactly one root', () => {
    const graph = galaxySunEarth()
    expect(() =>
      graph.addFrame({ id: 'other', parent: null, originInParent: { x: 0, y: 0, z: 0 }, unitM: 1 }),
    ).toThrow(/root/i)
  })
})

describe('tiers', () => {
  test('exposes a tier per distance regime, ordered outward', () => {
    const graph = new ScaleGraph()
    expect(graph.tiers.map((t) => t.id)).toEqual([
      'solar',
      'stellar',
      'galactic',
      'extragalactic',
    ])
    for (let i = 1; i < graph.tiers.length; i++) {
      expect(graph.tiers[i]!.unitM).toBeGreaterThan(graph.tiers[i - 1]!.unitM)
    }
  })

  // A single depth buffer cannot span 10^22. Each tier renders in its own
  // pass with its own depth range, bounded so depth precision holds within
  // the pass.
  test('gives each tier a bounded depth range', () => {
    const graph = new ScaleGraph()
    for (const tier of graph.tiers) {
      expect(tier.nearM).toBeGreaterThan(0)
      expect(tier.farM).toBeGreaterThan(tier.nearM)
      expect(tier.farM / tier.nearM).toBeLessThan(1e9)
    }
  })

  test('overlaps adjacent tiers so objects do not pop between passes', () => {
    const graph = new ScaleGraph()
    for (let i = 1; i < graph.tiers.length; i++) {
      expect(graph.tiers[i]!.nearM).toBeLessThan(graph.tiers[i - 1]!.farM)
    }
  })

  test('selects the tier a distance belongs to', () => {
    const graph = new ScaleGraph()
    expect(graph.tierForDistance(AU_M).id).toBe('solar')
    expect(graph.tierForDistance(4 * PC_M).id).toBe('stellar')
    expect(graph.tierForDistance(8000 * PC_M).id).toBe('galactic')
    expect(graph.tierForDistance(1e8 * PC_M).id).toBe('extragalactic')
  })

  test('clamps to the outermost tier rather than failing on absurd distances', () => {
    const graph = new ScaleGraph()
    expect(graph.tierForDistance(1e40).id).toBe('extragalactic')
  })

  test('keeps tier-space magnitudes inside comfortable Float32 range', () => {
    const graph = new ScaleGraph()
    for (const tier of graph.tiers) {
      // Float32 holds ~7 digits; staying under 1e6 leaves room for detail.
      expect(tier.farM / tier.unitM).toBeLessThan(1e6)
    }
  })

  test('rejects an unknown tier', () => {
    const graph = new ScaleGraph()
    // @ts-expect-error deliberately passing an unknown tier id
    expect(() => graph.tier('warp')).toThrow(/unknown tier/i)
  })
})
