/**
 * Atmospheric entry panel — live readout over the real solver.
 *
 * Every number displayed comes from @stellarai/astro-core's Allen-Eggers
 * closed form. Because it is closed form, the full trajectory re-samples in
 * microseconds, so the profile redraws on every slider input event with no
 * debouncing and no worker.
 *
 * The plot is altitude (vertical, as flown) against deceleration and heat
 * flux, each normalised to its own peak — the shape and the two peak
 * altitudes are the story; the absolute values live in the readout row.
 */

import {
  ballisticEntryProfile,
  sampleEntryTrajectory,
  type BodyId,
  type EntryParams,
} from '@stellarai/astro-core'

const ENTRY_BODIES: readonly BodyId[] = ['earth', 'mars', 'venus', 'titan', 'jupiter']

/** Slider ranges per body: entry speeds differ by an order of magnitude. */
const VELOCITY_RANGE: Record<BodyId, [number, number, number]> = {
  earth: [6000, 16000, 11000],
  mars: [4000, 9000, 6000],
  venus: [9000, 14000, 11500],
  titan: [4000, 8000, 6000],
  jupiter: [40000, 60000, 47500],
}

export class EntryPanel {
  private readonly root: HTMLElement
  private body: BodyId = 'mars'
  private velocityMs = 6000
  private angleDeg = -13.5
  private beta = 100
  private noseRadiusM = 1

  constructor(container: HTMLElement) {
    this.root = document.createElement('div')
    this.root.id = 'entry-panel'
    this.root.innerHTML = this.markup()
    container.appendChild(this.root)
    this.bind()
    this.recompute()
  }

  // innerHTML is safe here and below ONLY because every interpolated value is
  // internal: number.toFixed output or a body id from the hardcoded
  // ENTRY_BODIES list. If user-entered text ever flows into this panel,
  // switch those paths to textContent.
  private markup(): string {
    const bodyOptions = ENTRY_BODIES.map(
      (b) => `<option value="${b}" ${b === this.body ? 'selected' : ''}>${b}</option>`,
    ).join('')
    return `
      <h2>atmospheric entry</h2>
      <div class="row">
        <label>body</label>
        <select data-k="body">${bodyOptions}</select>
      </div>
      <div class="row"><label>entry speed</label><input type="range" data-k="velocity" /><span data-v="velocity"></span></div>
      <div class="row"><label>path angle</label><input type="range" data-k="angle" min="-45" max="-2" step="0.5" /><span data-v="angle"></span></div>
      <div class="row"><label>ballistic coeff</label><input type="range" data-k="beta" min="20" max="800" step="5" /><span data-v="beta"></span></div>
      <div class="row"><label>nose radius</label><input type="range" data-k="nose" min="0.2" max="5" step="0.1" /><span data-v="nose"></span></div>
      <div class="readout">
        <div><span data-v="peakg"></span><small>peak decel</small></div>
        <div><span data-v="peakq"></span><small>peak heating</small></div>
      </div>
      <svg viewBox="0 0 260 150" data-plot></svg>
      <p class="note">Allen–Eggers closed form. Overestimates peak g by ~15–35% vs flight data; a design tool, not a certification tool.</p>
    `
  }

  private bind(): void {
    const q = <T extends Element>(sel: string) => this.root.querySelector<T>(sel)!

    const velocity = q<HTMLInputElement>('[data-k="velocity"]')
    const applyVelocityRange = () => {
      const [min, max, value] = VELOCITY_RANGE[this.body]
      velocity.min = String(min)
      velocity.max = String(max)
      velocity.step = '100'
      velocity.value = String(value)
      this.velocityMs = value
    }
    applyVelocityRange()

    q<HTMLSelectElement>('[data-k="body"]').addEventListener('change', (e) => {
      this.body = (e.target as HTMLSelectElement).value as BodyId
      applyVelocityRange()
      this.recompute()
    })
    velocity.addEventListener('input', () => {
      this.velocityMs = Number(velocity.value)
      this.recompute()
    })

    const bindRange = (key: string, apply: (v: number) => void, initial: number) => {
      const input = q<HTMLInputElement>(`[data-k="${key}"]`)
      input.value = String(initial)
      input.addEventListener('input', () => {
        apply(Number(input.value))
        this.recompute()
      })
    }
    bindRange('angle', (v) => (this.angleDeg = v), this.angleDeg)
    bindRange('beta', (v) => (this.beta = v), this.beta)
    bindRange('nose', (v) => (this.noseRadiusM = v), this.noseRadiusM)
  }

  private recompute(): void {
    const params: EntryParams = {
      body: this.body,
      entryVelocityMs: this.velocityMs,
      flightPathAngleDeg: this.angleDeg,
      ballisticCoefficientKgM2: this.beta,
      noseRadiusM: this.noseRadiusM,
    }

    const profile = ballisticEntryProfile(params)
    const points = sampleEntryTrajectory(params, 160)

    const set = (key: string, text: string) => {
      this.root.querySelector(`[data-v="${key}"]`)!.textContent = text
    }
    set('velocity', `${(this.velocityMs / 1000).toFixed(1)} km/s`)
    set('angle', `${this.angleDeg.toFixed(1)}°`)
    set('beta', `${this.beta} kg/m²`)
    set('nose', `${this.noseRadiusM.toFixed(1)} m`)
    set(
      'peakg',
      `${profile.peakDeceleration.valueG.toFixed(1)} g @ ${(profile.peakDeceleration.altitudeM / 1000).toFixed(0)} km`,
    )
    set(
      'peakq',
      `${(profile.peakHeatFlux.valueWm2 / 1e4).toFixed(0)} W/cm² @ ${(profile.peakHeatFlux.altitudeM / 1000).toFixed(0)} km`,
    )

    this.drawPlot(points, profile.peakDeceleration.altitudeM, profile.peakHeatFlux.altitudeM)
  }

  private drawPlot(
    points: ReturnType<typeof sampleEntryTrajectory>,
    peakDecelAltM: number,
    peakHeatAltM: number,
  ): void {
    const svg = this.root.querySelector<SVGSVGElement>('[data-plot]')!
    const W = 260
    const H = 150
    const top = points[0]!.altitudeM
    const bottom = points[points.length - 1]!.altitudeM

    const maxA = Math.max(...points.map((p) => p.decelerationMs2))
    const maxQ = Math.max(...points.map((p) => p.heatFluxWm2))

    const y = (altM: number) => 8 + ((top - altM) / (top - bottom)) * (H - 16)
    const path = (value: (p: (typeof points)[number]) => number, max: number) =>
      points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${(8 + (value(p) / max) * (W - 16)).toFixed(1)},${y(p.altitudeM).toFixed(1)}`)
        .join(' ')

    svg.innerHTML = `
      <path d="${path((p) => p.decelerationMs2, maxA)}" fill="none" stroke="#e0764f" stroke-width="1.6" />
      <path d="${path((p) => p.heatFluxWm2, maxQ)}" fill="none" stroke="#e8c25a" stroke-width="1.6" />
      <line x1="0" x2="${W}" y1="${y(peakHeatAltM).toFixed(1)}" y2="${y(peakHeatAltM).toFixed(1)}" stroke="#e8c25a" stroke-dasharray="3 4" stroke-width="0.6" />
      <line x1="0" x2="${W}" y1="${y(peakDecelAltM).toFixed(1)}" y2="${y(peakDecelAltM).toFixed(1)}" stroke="#e0764f" stroke-dasharray="3 4" stroke-width="0.6" />
      <text x="4" y="${(y(peakHeatAltM) - 3).toFixed(1)}" fill="#e8c25a" font-size="7">peak heating ${(peakHeatAltM / 1000).toFixed(0)} km</text>
      <text x="4" y="${(y(peakDecelAltM) - 3).toFixed(1)}" fill="#e0764f" font-size="7">peak g ${(peakDecelAltM / 1000).toFixed(0)} km</text>
    `
  }
}
