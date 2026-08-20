/**
 * Nested reference frames and camera-relative rebasing.
 *
 * ## The problem, stated precisely
 *
 * StellarAI spans roughly 10^22 in distance, from a spacecraft skimming an
 * atmosphere to a galaxy at 300 Mpc. The obvious failure is Float32: it holds
 * about 7 significant digits, so at 1 kiloparsec its resolution is around 7 AU
 * and a planet does not merely jitter, it ceases to have a distinguishable
 * position.
 *
 * The less obvious failure — and the one that decides this design — is that
 * **Float64 is not enough either**. Measured resolution of a Float64 holding
 * an absolute position in metres:
 *
 *   Earth radius   9.3e-10 m      1 pc      4.0e+0 m
 *   1 AU           3.1e-05 m      8 kpc     3.3e+4 m
 *                                 1 Mpc     4.2e+6 m
 *
 * At the galactic centre a Float64 metre coordinate resolves to 33 km. So
 * `positionMetres + 1` is a no-op out there, in double precision. The detail
 * is destroyed at STORAGE time, and no amount of camera-relative rebasing at
 * render time can recover what was never stored.
 *
 * ## The fix
 *
 * Store every position **relative to a local parent frame**, in that frame's
 * own units. A spacecraft one metre above Earth is stored as ~6.4e6 in Earth's
 * frame, where Float64 resolves to nanometres — not as ~2.5e20 in a galactic
 * frame, where it resolves to tens of kilometres.
 *
 * To render, walk both the object and the camera up to their lowest common
 * ancestor, accumulating in Float64, and subtract there. The error introduced
 * is proportional to the scale of that common ancestor — which is precisely
 * the regime where the object is far away and precision does not matter.
 * Precision requirements and available precision fall off together.
 *
 * This is how Gaia Sky and OpenSpace solve it. There is no cheaper way.
 *
 * ## Tiers
 *
 * Frames fix precision; tiers fix the depth buffer. No single depth range can
 * span 10^22, so the scene is drawn in several passes, each with its own depth
 * range and its own natural unit, composited back to front.
 */

/** Astronomical unit, metres (exact, IAU 2012). */
export const AU_M = 1.495978707e11

/** Parsec, metres. */
export const PC_M = 3.0856775814913673e16

/** Kiloparsec, metres. */
export const KPC_M = 1000 * PC_M

/** Megaparsec, metres. */
export const MPC_M = 1e6 * PC_M

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Frame {
  id: string
  /** Parent frame id, or null for the single root. */
  parent: string | null
  /** Origin of this frame, expressed in the PARENT frame's units. */
  originInParent: Vec3
  /** Metres per unit inside this frame. */
  unitM: number
}

export interface Position {
  frame: string
  /** Coordinates in the named frame's units. */
  x: number
  y: number
  z: number
}

export type TierId = 'solar' | 'stellar' | 'galactic' | 'extragalactic'

export interface Tier {
  id: TierId
  /** Natural unit of this tier, in metres. */
  unitM: number
  nearM: number
  farM: number
}

/**
 * The four render tiers, ordered outward.
 *
 * Ranges overlap deliberately: a hard boundary would make objects pop between
 * passes as the camera moves. Each tier's far/near ratio stays under 1e9, and
 * far/unit stays under 1e6 so Float32 has digits left for detail.
 */
const TIERS: readonly Tier[] = [
  // A planetary surface out to the outer solar system (~670 AU).
  { id: 'solar', unitM: AU_M, nearM: 1e6, farM: 1e14 },
  // Nearby stars out to a few hundred parsecs.
  { id: 'stellar', unitM: PC_M, nearM: 1e13, farM: 1e19 },
  // Galactic structure and the Magellanic Clouds (~3 Mpc).
  { id: 'galactic', unitM: KPC_M, nearM: 1e18, farM: 1e23 },
  // The local universe.
  { id: 'extragalactic', unitM: MPC_M, nearM: 1e22, farM: 1e28 },
]

export class ScaleGraph {
  private readonly frames = new Map<string, Frame>()
  private root: string | null = null
  private camera: Position | null = null

  // ---- frames -------------------------------------------------------------

  addFrame(frame: Frame): void {
    if (this.frames.has(frame.id)) {
      throw new Error(`Frame already defined: ${frame.id}`)
    }
    if (!(frame.unitM > 0)) {
      throw new Error(`Frame ${frame.id} must have a positive unit; got ${frame.unitM}.`)
    }
    if (frame.parent === null) {
      if (this.root !== null) {
        throw new Error(
          `Frame ${frame.id} declares no parent, but ${this.root} is already the root. ` +
            `The frame graph must have exactly one root.`,
        )
      }
      this.root = frame.id
    } else if (!this.frames.has(frame.parent)) {
      throw new Error(`Frame ${frame.id} names parent ${frame.parent}, which is not defined.`)
    }
    this.frames.set(frame.id, frame)
  }

  private frame(id: string): Frame {
    const found = this.frames.get(id)
    if (!found) throw new Error(`Unknown frame: ${id}`)
    return found
  }

  /** Frame ids from the given frame up to the root, inclusive. */
  private chainToRoot(id: string): string[] {
    const chain: string[] = []
    let current: string | null = id
    while (current !== null) {
      if (chain.includes(current)) {
        throw new Error(`Frame graph contains a cycle at ${current}.`)
      }
      chain.push(current)
      current = this.frame(current).parent
    }
    return chain
  }

  /**
   * Express a position in an ancestor frame's units.
   *
   * Each step scales the child's coordinates into parent units and adds the
   * child's origin. Done in Float64 throughout; the accumulated magnitude —
   * and so the precision loss — grows only as we climb toward larger frames.
   */
  private liftTo(position: Position, ancestorId: string): Vec3 {
    let current = this.frame(position.frame)
    let v: Vec3 = { x: position.x, y: position.y, z: position.z }

    while (current.id !== ancestorId) {
      const parentId = current.parent
      if (parentId === null) {
        throw new Error(`Frame ${ancestorId} is not an ancestor of ${position.frame}.`)
      }
      const parent = this.frame(parentId)
      const scale = current.unitM / parent.unitM
      v = {
        x: v.x * scale + current.originInParent.x,
        y: v.y * scale + current.originInParent.y,
        z: v.z * scale + current.originInParent.z,
      }
      current = parent
    }
    return v
  }

  /** Lowest frame that is an ancestor of both, or the root. */
  private lowestCommonAncestor(a: string, b: string): string {
    const chainA = this.chainToRoot(a)
    const chainB = new Set(this.chainToRoot(b))
    for (const id of chainA) {
      if (chainB.has(id)) return id
    }
    throw new Error(`Frames ${a} and ${b} share no common ancestor.`)
  }

  // ---- camera -------------------------------------------------------------

  setCamera(position: Position): void {
    this.frame(position.frame) // validate eagerly
    this.camera = { ...position }
  }

  getCamera(): Position {
    if (this.camera === null) throw new Error('Camera has not been set.')
    return { ...this.camera }
  }

  /**
   * Offset from the camera to a position, in metres, ready to downcast.
   *
   * Both are lifted to their lowest common ancestor and subtracted there, so
   * a nearby object resolves through a nearby frame and keeps its detail.
   */
  toRenderSpace(position: Position): Vec3 {
    if (this.camera === null) throw new Error('Camera has not been set.')

    const anchorId = this.lowestCommonAncestor(position.frame, this.camera.frame)
    const anchor = this.frame(anchorId)

    const target = this.liftTo(position, anchorId)
    const eye = this.liftTo(this.camera, anchorId)

    return {
      x: (target.x - eye.x) * anchor.unitM,
      y: (target.y - eye.y) * anchor.unitM,
      z: (target.z - eye.z) * anchor.unitM,
    }
  }

  // ---- tiers --------------------------------------------------------------

  get tiers(): readonly Tier[] {
    return TIERS
  }

  tier(id: TierId): Tier {
    const found = TIERS.find((t) => t.id === id)
    if (!found) throw new Error(`Unknown tier: ${String(id)}`)
    return found
  }

  /**
   * The tier a given distance from the camera belongs to.
   *
   * Distances beyond the outermost tier clamp rather than throw: a navigator
   * asked about something implausibly far should still draw it at the edge of
   * the sky, not fail.
   */
  tierForDistance(distanceM: number): Tier {
    for (const tier of TIERS) {
      if (distanceM <= tier.farM) return tier
    }
    return TIERS[TIERS.length - 1]!
  }

  /** Scale a metre offset into a tier's own units, ready for the GPU. */
  toTierUnits(tierId: TierId, offsetM: Vec3): Vec3 {
    const { unitM } = this.tier(tierId)
    return { x: offsetM.x / unitM, y: offsetM.y / unitM, z: offsetM.z / unitM }
  }
}
