/**
 * Interstellar navigation panel.
 *
 * Pick a destination from the 619 IAU-named stars (or any AT-HYG id), fly
 * the camera there, and plot a jump route from Sol using the same weighted-A*
 * StarIndex the test suite exercises at 2.55M-star scale. Every number shown
 * comes from @stellarai/astro-core; this panel only asks and displays.
 *
 * The index is built once, on the first route request, over whatever stars
 * have streamed in by then — plus Sol, which the catalog deliberately
 * excludes but a route from home needs.
 */

import {
  StarIndex,
  brachistochroneCruise,
  log10MassRatioForDeltaV,
  LY_PER_PC,
  type StarNode,
} from '@stellarai/astro-core'
import type { LoadedStar, StarField } from './StarField.js'

interface NamedStar {
  id: number
  name: string
  mag: number
}

export interface NavPanelHost {
  starField: StarField
  travelToStar(star: LoadedStar): void
  setFocus(body: string): void
  frameDistanceAu(d: number): void
  plotRoute(hops: readonly LoadedStar[]): void
  clearRoute(): void
  onStarPicked: ((star: LoadedStar) => void) | null
}

const SOL_ID = 'sol'

export class NavPanel {
  private readonly root: HTMLElement
  private names: NamedStar[] = []
  private index: StarIndex | null = null
  private indexJumpPc = 0

  constructor(
    container: HTMLElement,
    private readonly host: NavPanelHost,
  ) {
    this.root = document.createElement('div')
    this.root.id = 'nav-panel'
    // Static markup only; all dynamic values go through textContent below.
    this.root.innerHTML = `
      <h2>navigation</h2>
      <div class="row">
        <label for="nav-dest">destination</label>
        <input id="nav-dest" list="nav-names" placeholder="Proxima Centauri" autocomplete="off" />
        <datalist id="nav-names"></datalist>
      </div>
      <div class="row">
        <label>jump range</label>
        <input type="range" data-k="jump" min="1" max="20" step="0.5" value="6" />
        <span data-v="jump">6.0 pc</span>
      </div>
      <div class="row buttons">
        <button data-k="travel">travel</button>
        <button data-k="route">plot route from Sol</button>
        <button data-k="home">home</button>
      </div>
      <div class="row">
        <label>ship accel</label>
        <input type="range" data-k="accel" min="-2" max="0.5" step="0.05" value="0" />
        <span data-v="accel">1.0 g</span>
      </div>
      <div class="cruise" data-v="cruise"></div>
      <div class="result" data-v="result"></div>
    `
    container.appendChild(this.root)
    this.bind()
    void this.loadNames().then(() => this.applyUrlState())

    // Clicking a star in the sky selects it as the destination.
    host.onStarPicked = (star) => {
      const named = this.names.find((n) => n.id === star.id)
      this.q<HTMLInputElement>('#nav-dest').value = named ? named.name : String(star.id)
      const distancePc = Math.hypot(star.xPc, star.yPc, star.zPc)
      this.say(
        `${named ? named.name : `star ${star.id}`} — mag ${star.mag.toFixed(1)}, ` +
          `${distancePc.toFixed(2)} pc (${(distancePc * 3.2616).toFixed(1)} ly) from Sol`,
      )
      this.updateCruise()
    }
  }

  private q<T extends Element>(sel: string): T {
    return this.root.querySelector<T>(sel)!
  }

  /**
   * Permalinks: ?to=Vega&jump=6&accel=1&route=1 restores a destination and
   * re-runs the route or travel on load, so every plotted route is a
   * shareable artifact rather than a dead screenshot. State is written with
   * replaceState — no history spam — whenever the user routes or travels.
   */
  private writeUrlState(action: 'route' | 'travel'): void {
    const params = new URLSearchParams()
    const dest = this.q<HTMLInputElement>('#nav-dest').value.trim()
    if (!dest) return
    params.set('to', dest)
    params.set('jump', String(this.jumpRangePc()))
    params.set('accel', this.accelerationG().toPrecision(2))
    params.set(action, '1')
    history.replaceState(null, '', `?${params.toString()}`)
  }

  private applyUrlState(): void {
    const params = new URLSearchParams(location.search)
    const to = params.get('to')
    if (!to) return

    this.q<HTMLInputElement>('#nav-dest').value = to
    const jump = Number(params.get('jump'))
    if (Number.isFinite(jump) && jump >= 1 && jump <= 20) {
      const slider = this.q<HTMLInputElement>('[data-k="jump"]')
      slider.value = String(jump)
      this.q<HTMLElement>('[data-v="jump"]').textContent = `${jump.toFixed(1)} pc`
    }
    const accel = Number(params.get('accel'))
    if (Number.isFinite(accel) && accel > 0) {
      const slider = this.q<HTMLInputElement>('[data-k="accel"]')
      slider.value = String(Math.log10(accel))
      this.q<HTMLElement>('[data-v="accel"]').textContent =
        accel >= 0.1 ? `${accel.toFixed(1)} g` : `${accel.toFixed(2)} g`
    }

    // The destination star may sit in a chunk that has not streamed yet;
    // retry until it resolves or loading is clearly done.
    const wantRoute = params.get('route') === '1'
    const wantTravel = params.get('travel') === '1'
    let attempts = 0
    const tryApply = () => {
      attempts++
      const star = this.findDestination()
      const field = this.host.starField
      const fullyLoaded = field.stars.length > 0 && field.loadingDone
      // Travel only needs the target star; a route needs the whole catalog,
      // or it plans through a partially streamed sky and returns a valid but
      // worse route than a reload would give. Permalinks must be stable.
      if (star && (wantTravel || fullyLoaded)) {
        this.updateCruise()
        if (wantRoute) this.q<HTMLButtonElement>('[data-k="route"]').click()
        else if (wantTravel) this.q<HTMLButtonElement>('[data-k="travel"]').click()
        return
      }
      if (star) this.updateCruise()
      if (attempts < 80) setTimeout(tryApply, 500)
    }
    tryApply()
  }

  private say(text: string): void {
    this.q<HTMLElement>('[data-v="result"]').textContent = text
  }

  private async loadNames(): Promise<void> {
    try {
      const response = await fetch('/catalog/names.json')
      this.names = (await response.json()) as NamedStar[]
      const datalist = this.q<HTMLDataListElement>('#nav-names')
      for (const n of this.names) {
        const option = document.createElement('option')
        option.value = n.name
        datalist.appendChild(option)
      }
    } catch {
      this.say('star names unavailable')
    }
  }

  private jumpRangePc(): number {
    return Number(this.q<HTMLInputElement>('[data-k="jump"]').value)
  }

  /** Ship proper acceleration in g, from the log-scale slider. */
  private accelerationG(): number {
    return 10 ** Number(this.q<HTMLInputElement>('[data-k="accel"]').value)
  }

  /**
   * The relativistic answer to "how long to get there": flip-and-burn at
   * constant proper acceleration, both clocks reported, plus the propellant
   * verdict. All from the tested brachistochrone solver; the panel wording
   * is deliberately concrete about whose clock is whose.
   */
  private updateCruise(): void {
    const el = this.q<HTMLElement>('[data-v="cruise"]')
    const star = this.findDestination()
    if (!star) {
      el.textContent = ''
      return
    }
    const distancePc = Math.hypot(star.xPc, star.yPc, star.zPc)
    if (!(distancePc > 0)) {
      el.textContent = ''
      return
    }

    const g = this.accelerationG()
    const cruise = brachistochroneCruise({
      distanceLy: distancePc * LY_PER_PC,
      properAccelerationG: g,
    })

    const fmtYears = (years: number): string => {
      if (years < 1) return `${(years * 365.25).toFixed(0)} days`
      if (years < 100) return `${years.toFixed(1)} yr`
      return `${Math.round(years).toLocaleString()} yr`
    }

    // Propellant on a very good fusion drive (10,000 km/s exhaust).
    const log10Ratio = log10MassRatioForDeltaV(cruise.deltaVMs, 1e7)
    const fuel =
      log10Ratio > 6
        ? `fuel: 10^${Math.round(log10Ratio).toLocaleString()}x ship mass (fusion) — not happening`
        : `fuel: ${(10 ** log10Ratio).toFixed(1)}x ship mass (fusion)`

    el.textContent =
      `flip-and-burn: ship clock ${fmtYears(cruise.properTimeYears)}, ` +
      `Earth clock ${fmtYears(cruise.coordinateTimeYears)}, ` +
      `peak ${Math.min(99.99, cruise.peakVelocityFractionC * 100).toFixed(2)}% c · ${fuel}`
  }

  private findDestination(): LoadedStar | null {
    const query = this.q<HTMLInputElement>('#nav-dest').value.trim()
    if (!query) return null
    const named = this.names.find((n) => n.name.toLowerCase() === query.toLowerCase())
    if (named) return this.host.starField.byId(named.id) ?? null
    const asId = Number(query)
    if (Number.isInteger(asId)) return this.host.starField.byId(asId) ?? null
    return null
  }

  private ensureIndex(jumpPc: number): StarIndex {
    // The spatial hash is built for a specific jump range and may be queried
    // below it but never above — so rebuild when the slider goes past what
    // the current index was built for.
    if (this.index === null || jumpPc > this.indexJumpPc) {
      const nodes: StarNode[] = this.host.starField.stars.map((s) => ({
        id: String(s.id),
        positionPc: { x: s.xPc, y: s.yPc, z: s.zPc },
      }))
      // Sol: excluded from the catalog (the solar tier owns it), but a route
      // from home has to start somewhere.
      nodes.push({ id: SOL_ID, positionPc: { x: 0, y: 0, z: 0 } })
      this.index = new StarIndex(nodes, jumpPc)
      this.indexJumpPc = jumpPc
    }
    return this.index
  }

  private bind(): void {
    const jump = this.q<HTMLInputElement>('[data-k="jump"]')
    jump.addEventListener('input', () => {
      this.q<HTMLElement>('[data-v="jump"]').textContent = `${Number(jump.value).toFixed(1)} pc`
    })

    const accel = this.q<HTMLInputElement>('[data-k="accel"]')
    accel.addEventListener('input', () => {
      const g = this.accelerationG()
      this.q<HTMLElement>('[data-v="accel"]').textContent =
        g >= 0.1 ? `${g.toFixed(1)} g` : `${g.toFixed(2)} g`
      this.updateCruise()
    })

    this.q<HTMLInputElement>('#nav-dest').addEventListener('change', () => this.updateCruise())

    this.q<HTMLButtonElement>('[data-k="home"]').addEventListener('click', () => {
      this.host.clearRoute()
      this.host.setFocus('sun')
      this.host.frameDistanceAu(12)
      this.say('')
    })

    this.q<HTMLButtonElement>('[data-k="travel"]').addEventListener('click', () => {
      const star = this.findDestination()
      if (!star) {
        this.say('destination not found — pick a name from the list')
        return
      }
      this.host.travelToStar(star)
      this.writeUrlState('travel')
      const distancePc = Math.hypot(star.xPc, star.yPc, star.zPc)
      this.say(`en route: ${(distancePc * 3.2616).toFixed(1)} ly from Sol`)
      this.updateCruise()
    })

    this.q<HTMLButtonElement>('[data-k="route"]').addEventListener('click', () => {
      const star = this.findDestination()
      if (!star) {
        this.say('destination not found — pick a name from the list')
        return
      }
      const jumpPc = this.jumpRangePc()
      this.writeUrlState('route')
      this.say('computing route...')
      // Yield a frame so the message paints before the index build.
      requestAnimationFrame(() => {
        const started = performance.now()
        const index = this.ensureIndex(jumpPc)
        const route = index.route(SOL_ID, String(star.id), {
          maxJumpPc: jumpPc,
          heuristicWeight: 1.1,
        })
        const ms = performance.now() - started

        if (!route) {
          this.host.clearRoute()
          this.say(
            `no route at ${jumpPc.toFixed(1)} pc jump range — ` +
              `increase the range or pick a nearer star`,
          )
          return
        }

        const hops = route.hops
          .map((h) =>
            h.id === SOL_ID
              ? ({ id: 0, xPc: 0, yPc: 0, zPc: 0, mag: 0 } as LoadedStar)
              : this.host.starField.byId(Number(h.id))!,
          )
          .filter(Boolean)
        this.host.plotRoute(hops)
        // Frame the whole route: pull back to its midpoint span.
        this.host.frameDistanceAu(route.totalDistancePc * 206_264.8 * 0.7)
        this.say(
          `${route.jumpCount} jumps, ${route.totalDistancePc.toFixed(2)} pc ` +
            `(${(route.totalDistancePc * 3.2616).toFixed(1)} ly), ` +
            `${route.starsExplored.toLocaleString()} stars searched in ${ms.toFixed(0)} ms`,
        )
      })
    })
  }
}
