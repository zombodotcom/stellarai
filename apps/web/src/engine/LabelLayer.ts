/**
 * Star name labels, as a pooled HTML overlay.
 *
 * Each frame the named stars are projected to screen space and the best
 * handful get a label from a fixed pool of divs. HTML text beats canvas or
 * SDF text here: 619 candidate labels is nothing to project, only ~20 are
 * ever shown, and the browser's text rendering is free, crisp, and needs no
 * font atlas.
 *
 * Ranking is by apparent magnitude from the *camera*, not from Earth —
 * fly toward Proxima and its label grows in importance as the real sky's
 * would.
 */

import type * as THREE from 'three'

export interface LabelStar {
  name: string
  /** Barycentric position, AU. */
  x: number
  y: number
  z: number
  /** Apparent magnitude from Sol; re-based to camera distance for ranking. */
  mag: number
  distancePcFromSol: number
}

const POOL_SIZE = 20

export class LabelLayer {
  private readonly pool: HTMLDivElement[] = []
  private readonly container: HTMLElement
  stars: LabelStar[] = []

  constructor(container: HTMLElement) {
    this.container = container
    for (let i = 0; i < POOL_SIZE; i++) {
      const div = document.createElement('div')
      div.className = 'star-label'
      div.style.display = 'none'
      container.appendChild(div)
      this.pool.push(div)
    }
  }

  /**
   * Project and place labels. `ssbOffset` is the barycentre's camera-relative
   * render-space position in AU; `cameraDistanceAu` gates label visibility.
   */
  update(
    camera: THREE.Camera,
    ssbOffset: { x: number; y: number; z: number },
    cameraAu: { x: number; y: number; z: number },
  ): void {
    // Ranking by apparent magnitude from the camera is the clutter control:
    // only the twenty brightest-as-seen named stars ever get a label, which
    // reads fine over the solar system and over deep sky alike. An earlier
    // version gated on orbit radius -- the wrong quantity entirely, since
    // travelling moves the focus point, not the orbit distance.
    if (this.stars.length === 0) {
      for (const div of this.pool) div.style.display = 'none'
      return
    }

    const width = this.container.clientWidth
    const height = this.container.clientHeight

    interface Placed {
      star: LabelStar
      sx: number
      sy: number
      score: number
    }
    const placed: Placed[] = []

    for (const star of this.stars) {
      // Position in render space, then through the camera.
      const rx = star.x + ssbOffset.x
      const ry = star.y + ssbOffset.y
      const rz = star.z + ssbOffset.z
      // project via camera matrices without allocating a Vector3 per star
      const e = camera.matrixWorldInverse.elements
      const cx = e[0]! * rx + e[4]! * ry + e[8]! * rz + e[12]!
      const cy = e[1]! * rx + e[5]! * ry + e[9]! * rz + e[13]!
      const cz = e[2]! * rx + e[6]! * ry + e[10]! * rz + e[14]!
      if (cz > 0) continue // behind the camera

      const p = (camera as THREE.PerspectiveCamera).projectionMatrix.elements
      const clipX = p[0]! * cx + p[8]! * cz
      const clipY = p[5]! * cy + p[9]! * cz
      const clipW = -cz
      const ndcX = clipX / clipW
      const ndcY = clipY / clipW
      if (ndcX < -1.05 || ndcX > 1.05 || ndcY < -1.05 || ndcY > 1.05) continue

      // Apparent magnitude from the camera: shift by distance ratio.
      const dx = star.x - cameraAu.x
      const dy = star.y - cameraAu.y
      const dz = star.z - cameraAu.z
      const distPcFromCamera = Math.hypot(dx, dy, dz) / 206_264.8
      const apparent =
        star.mag +
        5 * Math.log10(Math.max(1e-6, distPcFromCamera / Math.max(1e-6, star.distancePcFromSol)))

      placed.push({
        star,
        sx: ((ndcX + 1) / 2) * width,
        sy: ((1 - ndcY) / 2) * height,
        score: apparent,
      })
    }

    placed.sort((a, b) => a.score - b.score)

    for (let i = 0; i < this.pool.length; i++) {
      const div = this.pool[i]!
      const entry = placed[i]
      if (!entry) {
        div.style.display = 'none'
        continue
      }
      div.style.display = 'block'
      div.style.transform = `translate(${entry.sx.toFixed(0)}px, ${entry.sy.toFixed(0)}px)`
      if (div.textContent !== entry.star.name) div.textContent = entry.star.name
    }
  }
}
