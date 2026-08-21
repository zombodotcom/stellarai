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

import { StarIndex, type StarNode } from '@stellarai/astro-core'
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
      <div class="result" data-v="result"></div>
    `
    container.appendChild(this.root)
    this.bind()
    void this.loadNames()

    // Clicking a star in the sky selects it as the destination.
    host.onStarPicked = (star) => {
      const named = this.names.find((n) => n.id === star.id)
      this.q<HTMLInputElement>('#nav-dest').value = named ? named.name : String(star.id)
      const distancePc = Math.hypot(star.xPc, star.yPc, star.zPc)
      this.say(
        `${named ? named.name : `star ${star.id}`} — mag ${star.mag.toFixed(1)}, ` +
          `${distancePc.toFixed(2)} pc (${(distancePc * 3.2616).toFixed(1)} ly) from Sol`,
      )
    }
  }

  private q<T extends Element>(sel: string): T {
    return this.root.querySelector<T>(sel)!
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
      const distancePc = Math.hypot(star.xPc, star.yPc, star.zPc)
      this.say(`en route: ${(distancePc * 3.2616).toFixed(1)} ly from Sol`)
    })

    this.q<HTMLButtonElement>('[data-k="route"]').addEventListener('click', () => {
      const star = this.findDestination()
      if (!star) {
        this.say('destination not found — pick a name from the list')
        return
      }
      const jumpPc = this.jumpRangePc()
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
