/**
 * Deep-space backdrop: the Milky Way beyond the catalog, plus companions.
 *
 * The AT-HYG catalog is a local bubble — nearly all of it within ~2 kpc of
 * Sol. Zoom past that and space used to go empty, which reads as a bug.
 * This backdrop fills the gap with an ILLUSTRATIVE point-cloud Milky Way
 * shaped by real structural parameters (Sol 8,178 pc from Sagittarius A*,
 * exponential disk with ~2.6 kpc scale length, ~300 pc scale height,
 * central bar at ~27 degrees, four logarithmic spiral arms at ~12.5 degree
 * pitch), and the real companions at their true positions and distances:
 * the Large and Small Magellanic Clouds — and, much further out, one more
 * that travelers must find for themselves.
 *
 * Honesty rule: these points are a density model, not catalog stars. The
 * cloud is hollowed out within 1.5 kpc of Sol so everything you see near
 * home remains real AT-HYG data; the backdrop only takes over where the
 * catalog genuinely ends.
 */

import * as THREE from 'three'

const AU_PER_PC = 206_264.8

/** Deterministic PRNG so the galaxy looks the same on every visit. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Gaussian via Box-Muller. */
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/** Galactic (l, b in degrees, d in pc) to our Sol-centred galactic XYZ, pc. */
function galacticToXyz(lDeg: number, bDeg: number, dPc: number): { x: number; y: number; z: number } {
  const l = (lDeg * Math.PI) / 180
  const b = (bDeg * Math.PI) / 180
  return {
    x: dPc * Math.cos(b) * Math.cos(l),
    y: dPc * Math.cos(b) * Math.sin(l),
    z: dPc * Math.sin(b),
  }
}

const GC_DISTANCE_PC = 8178 // GRAVITY collaboration (2019)
const SUN_HEIGHT_PC = 20.8 // Sol sits slightly above the plane
const DISK_SCALE_LENGTH_PC = 2600
const DISK_SCALE_HEIGHT_PC = 300
const DISK_RADIUS_PC = 20_000
const HOLE_RADIUS_PC = 1500 // keep the local bubble pure catalog
const ARM_PITCH_RAD = (12.5 * Math.PI) / 180
const BAR_ANGLE_RAD = (27 * Math.PI) / 180
const BAR_HALF_LENGTH_PC = 2500

interface CloudSpec {
  count: number
  seed: number
  /** Emit one point in galactocentric pc (galaxy plane = xy). */
  sample(rng: () => number, out: { x: number; y: number; z: number; warm: number }): void
}

/** Milky Way density model, galactocentric. `warm` picks the color blend. */
const MILKY_WAY: CloudSpec = {
  count: 48_000,
  seed: 20260821,
  sample(rng, out) {
    const which = rng()
    if (which < 0.18) {
      // Bulge: roughly spherical, ~1.2 kpc.
      out.x = gaussian(rng) * 900
      out.y = gaussian(rng) * 750
      out.z = gaussian(rng) * 550
      out.warm = 1
      return
    }
    if (which < 0.3) {
      // Bar: elongated, rotated from the Sun-centre line.
      const along = gaussian(rng) * BAR_HALF_LENGTH_PC
      const across = gaussian(rng) * 550
      out.x = along * Math.cos(BAR_ANGLE_RAD) - across * Math.sin(BAR_ANGLE_RAD)
      out.y = along * Math.sin(BAR_ANGLE_RAD) + across * Math.cos(BAR_ANGLE_RAD)
      out.z = gaussian(rng) * 400
      out.warm = 0.9
      return
    }
    // Disk: exponential in radius; arm membership perturbs the angle.
    let r = 0
    do {
      r = -DISK_SCALE_LENGTH_PC * Math.log(Math.max(rng() * rng(), 1e-9))
    } while (r > DISK_RADIUS_PC || r < 800)
    let phi = rng() * 2 * Math.PI
    if (rng() < 0.62) {
      // Snap toward the nearest of four logarithmic arms, with scatter.
      const arm = Math.floor(rng() * 4)
      const armPhi = Math.log(r / 3000) / Math.tan(ARM_PITCH_RAD) + (arm * Math.PI) / 2
      phi = armPhi + gaussian(rng) * 0.16
      out.warm = 0.15 + rng() * 0.2 // arms skew blue
    } else {
      out.warm = 0.55 + rng() * 0.3
    }
    // Scale height flares gently outward.
    const h = DISK_SCALE_HEIGHT_PC * (0.7 + (0.8 * r) / DISK_RADIUS_PC)
    out.x = r * Math.cos(phi)
    out.y = r * Math.sin(phi)
    out.z = gaussian(rng) * h
  },
}

/** An irregular dwarf blob (the Magellanic Clouds). */
function dwarfSpec(count: number, seed: number, radiusPc: number): CloudSpec {
  return {
    count,
    seed,
    sample(rng, out) {
      out.x = gaussian(rng) * radiusPc
      out.y = gaussian(rng) * radiusPc * 0.8
      out.z = gaussian(rng) * radiusPc * 0.5
      out.warm = 0.3 + rng() * 0.4
    },
  }
}

/** An inclined disk galaxy, seen from outside (Andromeda). */
function spiralSpec(count: number, seed: number, radiusPc: number): CloudSpec {
  return {
    count,
    seed,
    sample(rng, out) {
      let r = 0
      do {
        r = -(radiusPc / 3.2) * Math.log(Math.max(rng() * rng(), 1e-9))
      } while (r > radiusPc)
      const phi = rng() * 2 * Math.PI
      out.x = r * Math.cos(phi)
      out.y = r * Math.sin(phi)
      out.z = gaussian(rng) * (radiusPc * 0.045)
      out.warm = r < radiusPc * 0.2 ? 0.9 : 0.25 + rng() * 0.3
    },
  }
}

const WARM = new THREE.Color(0xffd9a6)
const COOL = new THREE.Color(0xaecbff)

function buildCloud(
  spec: CloudSpec,
  placePoint: (p: { x: number; y: number; z: number }) => { x: number; y: number; z: number },
  opacity: number,
  sizePx: number,
): THREE.Points {
  const rng = mulberry32(spec.seed)
  const positions = new Float32Array(spec.count * 3)
  const colors = new Float32Array(spec.count * 3)
  const scratch = { x: 0, y: 0, z: 0, warm: 0.5 }
  const color = new THREE.Color()
  let written = 0
  for (let i = 0; i < spec.count; i++) {
    spec.sample(rng, scratch)
    const p = placePoint(scratch)
    // Hollow out the neighbourhood where the real catalog lives.
    if (Math.hypot(p.x, p.y, p.z) < HOLE_RADIUS_PC) continue
    positions[written * 3] = p.x * AU_PER_PC
    positions[written * 3 + 1] = p.y * AU_PER_PC
    positions[written * 3 + 2] = p.z * AU_PER_PC
    color.copy(COOL).lerp(WARM, scratch.warm)
    colors[written * 3] = color.r
    colors[written * 3 + 1] = color.g
    colors[written * 3 + 2] = color.b
    written++
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, written * 3), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, written * 3), 3))
  const material = new THREE.PointsMaterial({
    size: sizePx,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return points
}

/** Rotate a galactocentric point into Sol-centred coordinates. */
function milkyWayPlacement(p: { x: number; y: number; z: number }): {
  x: number
  y: number
  z: number
} {
  // Galactocentric x points from the centre toward Sol; our frame's x
  // points from Sol toward the centre, so flip and translate.
  return {
    x: GC_DISTANCE_PC - p.x,
    y: p.y,
    z: p.z - SUN_HEIGHT_PC,
  }
}

/** Place a companion's local cloud at its true galactic position. */
function companionPlacement(
  lDeg: number,
  bDeg: number,
  dPc: number,
  tiltRad = 0,
): (p: { x: number; y: number; z: number }) => { x: number; y: number; z: number } {
  const centre = galacticToXyz(lDeg, bDeg, dPc)
  const cosT = Math.cos(tiltRad)
  const sinT = Math.sin(tiltRad)
  return (p) => ({
    x: centre.x + p.x,
    y: centre.y + p.y * cosT - p.z * sinT,
    z: centre.z + p.y * sinT + p.z * cosT,
  })
}

/**
 * Build the whole backdrop and attach it to the given group (the SSB group,
 * whose children are positioned in barycentric AU — same as the star field).
 */
export function addGalaxyBackdrop(parent: THREE.Object3D): void {
  parent.add(buildCloud(MILKY_WAY, milkyWayPlacement, 0.55, 1.6))
  // LMC and SMC at their true positions (McConnachie 2012 distances).
  parent.add(
    buildCloud(dwarfSpec(3200, 41, 2200), companionPlacement(280.5, -32.9, 49_970), 0.6, 1.5),
  )
  parent.add(
    buildCloud(dwarfSpec(1600, 42, 1500), companionPlacement(302.8, -44.3, 61_900), 0.6, 1.5),
  )
  // And one more, much further out, for those who keep going. (M31: real
  // position, real distance, 77-degree inclination.)
  parent.add(
    buildCloud(
      spiralSpec(7000, 43, 22_000),
      companionPlacement(121.2, -21.6, 765_000, (77 * Math.PI) / 180),
      0.5,
      1.4,
    ),
  )
}
