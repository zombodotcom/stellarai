/**
 * Interplanetary transfer planner — the porkchop scan, made clickable.
 *
 * Pick origin and destination planets and a departure year; the panel scans
 * the launch-window grid with the tested solver (thousands of Lambert
 * solves, a few hundred milliseconds), lists the cheapest windows, and on
 * selection draws the actual transfer trajectory through the 3D scene by
 * sampling the Kepler propagator along the leg.
 *
 * Every number is solver output. The panel formats; it never computes.
 */

import {
  AU_M,
  MU_SUN,
  findTransferWindows,
  heliocentricState,
  propagateKepler,
  solveLambert,
  type PlanetId,
  type TransferOption,
} from '@stellarai/astro-core'

const PLANETS: readonly PlanetId[] = [
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
]

export interface TransferPanelHost {
  plotTransfer(pointsAu: Array<{ x: number; y: number; z: number }>): void
  clearTransfer(): void
  setEpoch?(epoch: Date): void
}

export class TransferPanel {
  private readonly root: HTMLElement
  private options: TransferOption[] = []

  constructor(
    container: HTMLElement,
    private readonly host: TransferPanelHost,
  ) {
    this.root = document.createElement('div')
    this.root.id = 'transfer-panel'
    // Static markup only; dynamic values go through textContent / DOM APIs.
    this.root.innerHTML = `
      <h2>mission planner</h2>
      <div class="row">
        <label>from</label>
        <select data-k="origin"></select>
        <label>to</label>
        <select data-k="destination"></select>
      </div>
      <div class="row">
        <label>depart</label>
        <input type="number" data-k="year" min="2026" max="2060" step="1" value="2026" />
        <button data-k="scan">find launch windows</button>
      </div>
      <div class="windows" data-v="windows"></div>
      <div class="note" data-v="note"></div>
    `
    container.appendChild(this.root)

    const originSelect = this.q<HTMLSelectElement>('[data-k="origin"]')
    const destSelect = this.q<HTMLSelectElement>('[data-k="destination"]')
    for (const p of PLANETS) {
      originSelect.add(new Option(p, p))
      destSelect.add(new Option(p, p))
    }
    originSelect.value = 'earth'
    destSelect.value = 'mars'

    this.q<HTMLButtonElement>('[data-k="scan"]').addEventListener('click', () => this.scan())
  }

  private q<T extends Element>(sel: string): T {
    return this.root.querySelector<T>(sel)!
  }

  private note(text: string): void {
    this.q<HTMLElement>('[data-v="note"]').textContent = text
  }

  private scan(): void {
    const origin = this.q<HTMLSelectElement>('[data-k="origin"]').value as PlanetId
    const destination = this.q<HTMLSelectElement>('[data-k="destination"]').value as PlanetId
    const year = Number(this.q<HTMLInputElement>('[data-k="year"]').value)

    if (origin === destination) {
      this.note('origin and destination are the same planet')
      return
    }

    this.note('scanning launch windows…')
    this.q<HTMLElement>('[data-v="windows"]').replaceChildren()

    // Let the message paint before a few hundred ms of Lambert solving.
    requestAnimationFrame(() => {
      const started = performance.now()
      // Outer-planet transfers take years; scale the flight-time grid to the
      // destination rather than pretending one range fits all.
      const slow = ['jupiter', 'saturn', 'uranus', 'neptune'].includes(destination) ||
        ['jupiter', 'saturn', 'uranus', 'neptune'].includes(origin)
      const options = findTransferWindows({
        origin,
        destination,
        departureStart: new Date(Date.UTC(year, 0, 1)),
        departureEnd: new Date(Date.UTC(year + 2, 0, 1)),
        minFlightDays: slow ? 400 : 80,
        maxFlightDays: slow ? 4200 : 500,
        departureStepDays: 5,
        flightTimeStepDays: slow ? 30 : 8,
      })
      const ms = performance.now() - started

      this.options = options.slice(0, 5)
      if (this.options.length === 0) {
        this.note('no transfers found in this window')
        return
      }
      this.note(
        `${options.length.toLocaleString()} transfers scanned in ${ms.toFixed(0)} ms — ` +
          `top windows below, click one to plot it`,
      )
      this.renderWindows(origin, destination)
      this.select(0, origin, destination)
    })
  }

  private renderWindows(origin: PlanetId, destination: PlanetId): void {
    const list = this.q<HTMLElement>('[data-v="windows"]')
    list.replaceChildren()
    this.options.forEach((option, i) => {
      const row = document.createElement('button')
      row.className = 'window-row'
      row.textContent =
        `${option.departure.toISOString().slice(0, 10)}  ` +
        `${String(option.flightTimeDays).padStart(4)} d  ` +
        `Δv ${(option.totalDeltaVMs / 1000).toFixed(2)} km/s  ` +
        `C3 ${option.departureC3Km2S2.toFixed(1)}`
      row.addEventListener('click', () => this.select(i, origin, destination))
      list.appendChild(row)
    })
  }

  private select(index: number, origin: PlanetId, destination: PlanetId): void {
    const option = this.options[index]
    if (!option) return

    for (const [i, el] of [...this.q<HTMLElement>('[data-v="windows"]').children].entries()) {
      el.classList.toggle('selected', i === index)
    }

    // Re-solve the chosen leg and sample the conic for drawing.
    const departState = heliocentricState(origin, option.departure)
    const arriveState = heliocentricState(destination, option.arrival)
    const tofS = option.flightTimeDays * 86_400

    let lambert
    try {
      lambert = solveLambert({
        r1: departState.positionM,
        r2: arriveState.positionM,
        timeOfFlightS: tofS,
        mu: MU_SUN,
      })
    } catch {
      this.note('selected transfer is degenerate; pick another window')
      return
    }

    const SAMPLES = 128
    const points: Array<{ x: number; y: number; z: number }> = []
    for (let i = 0; i <= SAMPLES; i++) {
      const s = propagateKepler(departState.positionM, lambert.v1, (i / SAMPLES) * tofS, MU_SUN)
      points.push({ x: s.position.x / AU_M, y: s.position.y / AU_M, z: s.position.z / AU_M })
    }
    this.host.plotTransfer(points)
    // Show the sky as it will be at departure.
    this.host.setEpoch?.(option.departure)
  }
}
