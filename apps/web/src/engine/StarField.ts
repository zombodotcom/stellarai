/**
 * The star field: streams catalog chunks and renders them as points.
 *
 * Chunks arrive brightest-band-first, so the naked-eye sky appears in the
 * first ~200 KB while the faint mass streams behind it — the order a
 * dark-adapting eye would fill it in.
 *
 * Positions are heliocentric parsecs in the catalog; here they are scaled to
 * AU and parented under the solar-system barycentre group, so the existing
 * camera-relative rebasing covers them. Float32 resolution at 500 pc is
 * ~8 AU — an error a hundred times smaller than a pixel at that distance.
 * Precision needs and available precision fall off together.
 *
 * Colour comes from B-V via blackbody temperature; size from magnitude, in
 * a shader, so one draw call carries an entire chunk.
 */

import * as THREE from 'three'
import { decodeChunk, type CatalogManifest } from '@stellarai/catalog'

/** Astronomical units per parsec. */
const AU_PER_PC = 206_264.8

/** Approximate blackbody temperature for a B-V colour index (Ballesteros). */
function bvToTemperature(bv: number): number {
  const clamped = Math.min(2.5, Math.max(-0.4, bv))
  return 4600 * (1 / (0.92 * clamped + 1.7) + 1 / (0.92 * clamped + 0.62))
}

/** Rough blackbody chromaticity, good enough for star tinting. */
function temperatureToColor(kelvin: number): [number, number, number] {
  const t = kelvin / 100
  let r: number
  let g: number
  let b: number
  if (t <= 66) {
    r = 255
    g = 99.47 * Math.log(t) - 161.12
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04
  } else {
    r = 329.7 * (t - 60) ** -0.1332
    g = 288.12 * (t - 60) ** -0.0755
    b = 255
  }
  const clamp = (v: number) => Math.min(255, Math.max(0, v)) / 255
  return [clamp(r), clamp(g), clamp(b)]
}

const VERTEX_SHADER = /* glsl */ `
  attribute float mag;
  attribute vec3 starColor;
  varying vec3 vColor;
  varying float vMag;
  void main() {
    vColor = starColor;
    vMag = mag;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Brighter stars draw larger; the scale is perceptual, not physical.
    float size = clamp(9.0 - mag * 0.85, 1.0, 10.0);
    gl_PointSize = size;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  varying float vMag;
  void main() {
    // Soft round point: fade by distance from centre.
    vec2 fromCentre = gl_PointCoord - vec2(0.5);
    float d = length(fromCentre) * 2.0;
    float alpha = smoothstep(1.0, 0.35, d);
    // Fainter stars render dimmer as well as smaller.
    float brightness = clamp(1.2 - vMag * 0.07, 0.25, 1.0);
    gl_FragColor = vec4(vColor * brightness, alpha);
    if (alpha < 0.02) discard;
  }
`

export interface StarFieldStatus {
  chunksLoaded: number
  chunksTotal: number
  starsLoaded: number
}

export interface LoadedStar {
  id: number
  xPc: number
  yPc: number
  zPc: number
  mag: number
}

export class StarField {
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  private status: StarFieldStatus = { chunksLoaded: 0, chunksTotal: 0, starsLoaded: 0 }
  onProgress: ((status: StarFieldStatus) => void) | null = null

  /**
   * Every decoded star, kept for routing and lookup. Positions in parsecs.
   * ~867k entries costs on the order of 100 MB -- acceptable on desktop; a
   * typed-array layout is the known optimisation if it ever matters.
   */
  readonly stars: LoadedStar[] = []
  private readonly starById = new Map<number, LoadedStar>()

  /** True once every chunk has been fetched (or failed and been skipped). */
  loadingDone = false

  byId(id: number): LoadedStar | undefined {
    return this.starById.get(id)
  }

  /**
   * Stream every chunk in manifest order (brightest band first) into the
   * given parent group. Chunks appear as they arrive; a failed chunk is
   * skipped with a warning rather than sinking the whole sky.
   */
  async load(parent: THREE.Group, baseUrl = '/catalog'): Promise<void> {
    const manifestResponse = await fetch(`${baseUrl}/manifest.json`)
    if (!manifestResponse.ok) {
      throw new Error(`Catalog manifest not found at ${baseUrl}/manifest.json`)
    }
    const manifest = (await manifestResponse.json()) as CatalogManifest
    this.status.chunksTotal = manifest.chunks.length

    for (const chunk of manifest.chunks) {
      try {
        const response = await fetch(`${baseUrl}/${chunk.file}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const stars = decodeChunk(await response.arrayBuffer())
        for (const s of stars) {
          const loaded: LoadedStar = { id: s.id, xPc: s.xPc, yPc: s.yPc, zPc: s.zPc, mag: s.mag }
          this.stars.push(loaded)
          this.starById.set(s.id, loaded)
        }
        parent.add(this.buildPoints(stars))
        this.status.chunksLoaded++
        this.status.starsLoaded += stars.length
        this.onProgress?.(this.status)
      } catch (error) {
        console.warn(`Catalog chunk ${chunk.file} failed to load:`, error)
      }
    }
    this.loadingDone = true
  }

  private buildPoints(stars: ReturnType<typeof decodeChunk>): THREE.Points {
    const count = stars.length
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const mags = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      const s = stars[i]!
      positions[i * 3] = s.xPc * AU_PER_PC
      positions[i * 3 + 1] = s.yPc * AU_PER_PC
      positions[i * 3 + 2] = s.zPc * AU_PER_PC
      const [r, g, b] = temperatureToColor(bvToTemperature(s.colorIndex))
      colors[i * 3] = r
      colors[i * 3 + 1] = g
      colors[i * 3 + 2] = b
      mags[i] = s.mag
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('starColor', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('mag', new THREE.BufferAttribute(mags, 1))

    return new THREE.Points(geometry, this.material)
  }
}
