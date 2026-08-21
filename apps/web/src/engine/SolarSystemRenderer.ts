/**
 * Three.js adapter over the scale graph — deliberately thin.
 *
 * All decisions that can be wrong live in tested packages: precision handling
 * in @stellarai/scale-graph, positions in @stellarai/astro-core. This file
 * only moves three.js objects to wherever those packages say they are.
 *
 * The one rendering idea worth documenting: geometry never carries absolute
 * positions. Each reference frame owns a THREE.Group whose children are
 * expressed in frame-local coordinates (orbit lines in AU around the SSB, a
 * planet marker at its own origin). Per frame we set only the GROUP transform,
 * from the scale graph's camera-relative rebasing. That keeps every Float32
 * vertex small while the camera roams 10^22 of range.
 */

import * as THREE from 'three'
import {
  ScaleGraph,
  buildSolarSystemFrames,
  updateSolarSystemFrames,
  AU_M,
  type TierId,
} from '@stellarai/scale-graph'
import { heliocentricState, type PlanetId } from '@stellarai/astro-core'

const PLANETS: readonly PlanetId[] = [
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

/** Display colour per body — approximate true-ish hues. */
const BODY_COLOR: Record<string, number> = {
  sun: 0xfff4e0,
  mercury: 0x9c9488,
  venus: 0xe6d5a8,
  earth: 0x6b93d6,
  mars: 0xc1662e,
  jupiter: 0xc8a87c,
  saturn: 0xe3d1a8,
  uranus: 0x9fd6d2,
  neptune: 0x4f77c9,
  pluto: 0xb8a793,
}

/** Sidereal orbital periods, days — used only to sample closed orbit lines. */
const PERIOD_DAYS: Record<PlanetId, number> = {
  sun: 0,
  mercury: 88,
  venus: 224.7,
  earth: 365.25,
  mars: 687,
  jupiter: 4333,
  saturn: 10759,
  uranus: 30687,
  neptune: 60190,
  pluto: 90560,
}

/**
 * A soft disc texture for planet markers. Sprites without a texture render as
 * squares; a navigator's waypoints should read as bodies, not pixels.
 */
function discTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.8, 'rgba(255,255,255,0.25)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export interface RendererOptions {
  canvas: HTMLCanvasElement
  epoch?: Date
}

export class SolarSystemRenderer {
  readonly graph = new ScaleGraph()
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera3: THREE.PerspectiveCamera
  private readonly frameGroups = new Map<string, THREE.Group>()
  private readonly markerTexture = discTexture()
  private epoch: Date
  /** Simulated seconds per wall-clock second. */
  timeRate = 0
  /** Camera spherical coordinates around the current focus frame. */
  private focus = 'sun'
  private distanceAu = 12
  private theta = 0.6
  private phi = 1.1
  private disposed = false

  constructor(options: RendererOptions) {
    this.epoch = options.epoch ?? new Date()
    buildSolarSystemFrames(this.graph, this.epoch)

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
    })
    this.camera3 = new THREE.PerspectiveCamera(50, 1, 1e-4, 1e5)
    this.scene.background = new THREE.Color(0x02030a)

    this.buildScene()
    this.attachControls(options.canvas)
  }

  // ---- scene construction (frame-local geometry only) ----------------------

  private buildScene(): void {
    // The SSB group carries everything expressed in AU around the barycentre:
    // orbit lines and planet markers. Its transform is set per frame.
    const ssb = new THREE.Group()
    this.frameGroups.set('ssb', ssb)
    this.scene.add(ssb)

    // Sun: a small emissive sphere plus a point light.
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 32, 16),
      new THREE.MeshBasicMaterial({ color: BODY_COLOR['sun'] }),
    )
    sun.name = 'sun'
    ssb.add(sun)
    ssb.add(new THREE.PointLight(0xffffff, 2, 0, 0))

    for (const planet of PLANETS) {
      // Orbit line: one period sampled from the real ephemeris, in AU.
      const points: THREE.Vector3[] = []
      const period = PERIOD_DAYS[planet]
      const samples = 256
      for (let i = 0; i <= samples; i++) {
        const t = new Date(this.epoch.getTime() + (i / samples) * period * 86_400_000)
        const s = heliocentricState(planet, t)
        points.push(
          new THREE.Vector3(s.positionM.x / AU_M, s.positionM.y / AU_M, s.positionM.z / AU_M),
        )
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x33415e, transparent: true, opacity: 0.7 }),
      )
      ssb.add(line)

      // Planet marker: a sprite with constant screen presence. Real planetary
      // discs are sub-pixel at system scale; a navigator needs to see its
      // waypoints.
      const marker = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.markerTexture,
          color: BODY_COLOR[planet],
          sizeAttenuation: false,
        }),
      )
      marker.scale.setScalar(0.012)
      marker.name = planet
      ssb.add(marker)
    }
  }

  // ---- per-frame update ----------------------------------------------------

  private syncFromGraph(): void {
    // Camera: orbiting the focused body at distanceAu.
    const focusOrigin = { frame: this.focus, x: 0, y: 0, z: 0 }
    const off = {
      x: this.distanceAu * Math.cos(this.phi) * Math.cos(this.theta),
      y: this.distanceAu * Math.cos(this.phi) * Math.sin(this.theta),
      z: this.distanceAu * Math.sin(this.phi),
    }
    // Express the camera in the SSB frame: focus origin lifted + offset in AU.
    this.graph.setCamera({ frame: 'ssb', x: 0, y: 0, z: 0 })
    const focusInSsbM = this.graph.toRenderSpace(focusOrigin)
    this.graph.setCamera({
      frame: 'ssb',
      x: focusInSsbM.x / AU_M + off.x,
      y: focusInSsbM.y / AU_M + off.y,
      z: focusInSsbM.z / AU_M + off.z,
    })

    // Rebase the SSB group: its origin, camera-relative, in solar-tier units.
    const tier: TierId = 'solar'
    const ssbOffset = this.graph.toTierUnits(
      tier,
      this.graph.toRenderSpace({ frame: 'ssb', x: 0, y: 0, z: 0 }),
    )
    const ssb = this.frameGroups.get('ssb')!
    ssb.position.set(ssbOffset.x, ssbOffset.y, ssbOffset.z)

    // Planet markers track the live ephemeris (frame-local AU coordinates).
    for (const planet of PLANETS) {
      const s = heliocentricState(planet, this.epoch)
      const marker = ssb.getObjectByName(planet)
      marker?.position.set(s.positionM.x / AU_M, s.positionM.y / AU_M, s.positionM.z / AU_M)
    }

    // three.js camera sits at the render-space origin looking at the focus.
    this.camera3.position.set(0, 0, 0)
    const focusRender = this.graph.toTierUnits(tier, this.graph.toRenderSpace(focusOrigin))
    this.camera3.up.set(0, 0, 1)
    this.camera3.lookAt(focusRender.x, focusRender.y, focusRender.z)
  }

  // ---- loop ----------------------------------------------------------------

  start(): void {
    let last = performance.now()
    const tick = (now: number) => {
      if (this.disposed) return
      const dt = (now - last) / 1000
      last = now

      if (this.timeRate !== 0) {
        this.epoch = new Date(this.epoch.getTime() + this.timeRate * dt * 1000)
        updateSolarSystemFrames(this.graph, this.epoch)
      }

      this.resizeIfNeeded()
      this.syncFromGraph()
      this.renderer.render(this.scene, this.camera3)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  get currentEpoch(): Date {
    return new Date(this.epoch)
  }

  setFocus(body: string): void {
    this.focus = body
  }

  dispose(): void {
    this.disposed = true
    this.renderer.dispose()
  }

  // ---- input ---------------------------------------------------------------

  private attachControls(canvas: HTMLCanvasElement): void {
    let dragging = false
    let lastX = 0
    let lastY = 0

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointerup', (e) => {
      dragging = false
      canvas.releasePointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return
      this.theta -= (e.clientX - lastX) * 0.005
      this.phi = Math.min(1.5, Math.max(-1.5, this.phi + (e.clientY - lastY) * 0.005))
      lastX = e.clientX
      lastY = e.clientY
    })
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.distanceAu = Math.min(
          200,
          Math.max(0.05, this.distanceAu * (e.deltaY > 0 ? 1.15 : 1 / 1.15)),
        )
      },
      { passive: false },
    )
  }

  private resizeIfNeeded(): void {
    const canvas = this.renderer.domElement
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== w || canvas.height !== h) {
      this.renderer.setSize(w, h, false)
      this.camera3.aspect = w / h
      this.camera3.updateProjectionMatrix()
    }
  }
}
