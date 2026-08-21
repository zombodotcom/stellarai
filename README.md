# StellarAI

**Fly through 867,492 real stars. Plot jump routes between them. Plan a real
Mars mission. All in a browser, all free, every number from tested physics.**

StellarAI is an open-source 3D stellar navigator. It answers questions that
currently have no good home on the web:

- *"What's the route from Sol to Aldebaran with 6-parsec jumps?"* — 4 jumps,
  21.23 pc, drawn through the actual stars, in 2 ms.
- *"How long to Proxima Centauri at 1 g?"* — ship clock 3.5 years, Earth
  clock 5.9 years, peak 94.97% c, and the honest fuel verdict (10⁴⁸× ship
  mass on a fusion drive — not happening).
- *"When is the next Mars launch window and what does arrival look like?"* —
  scans 7,791 real transfers in ~100 ms, finds the actual 2026 window
  (depart Nov 2, C3 = 9.3 km²/s²), draws the transfer arc, and gives the
  entry corridor: peak deceleration and heating validated against Mars
  Pathfinder flight data.

Every route is a **shareable URL**:
`?to=Aldebaran&jump=6&accel=1&route=1` rebuilds the whole plan on load.

## Principles

1. **Free, forever.** Static site, no accounts, no server, no tracking. MIT
   for code; catalog data stays CC BY-SA 4.0 per its source.
2. **Numbers come from physics code, never from vibes.** The solvers are
   validated against JPL Horizons, Mars Pathfinder and Galileo probe flight
   data, and textbook relativity. 159 unit tests. Where a model has known
   error (Allen–Eggers overestimates peak g by ~15–35%), the UI says so.
3. **Real data.** Stars are AT-HYG v4.0 (Tycho-2 × Gaia DR3), including
   every star within 100 light years regardless of brightness — which is
   why Proxima Centauri (mag 11.2) is here. Planet positions are VSOP87.

## What's inside

| | |
|---|---|
| Live solar system | VSOP87 ephemerides, time control up to a year per second |
| Star field | 867,492 stars streamed as 23 MB of binary chunks, brightest first; B-V blackbody colours; 619 IAU-named stars labelled; click any star to select it |
| Interstellar routing | Weighted A* over a spatial hash — bounded suboptimality, calibrated against the catalog's measured stretch |
| Relativistic cruise | Flip-and-burn brachistochrone, both clocks, rapidity-based fuel mass ratio |
| Mission planner | Lambert/porkchop launch-window scan for any planet pair, transfer arc drawn via universal-variable Kepler propagation |
| Atmospheric entry | Allen–Eggers closed form with Sutton–Graves heating for Earth, Mars, Venus, Titan, Jupiter — live sliders, re-solves every input event |
| Works on phones | Full-bleed sky, panels collapse into a tab bar |

## Architecture

```
packages/astro-core   pure TypeScript physics — no DOM, no network, fully unit-tested
packages/scale-graph  nested reference frames: mm precision on the ISS to Mpc, ~10^22 of range
packages/catalog      26-byte binary star record + magnitude-banded chunking
apps/web              Astro + three.js; panels are thin — they ask solvers and display
tools/pipeline        AT-HYG CSV -> binary chunks + names sidecar (one command)
```

The precision story is the interesting part: Float64 metres lose metre-scale
detail beyond ~1 AU (at the galactic centre a double resolves to 33 km), so
positions live in nested local frames and resolve through the lowest common
ancestor — required precision and available precision fall off together.

## Run it

```sh
npm install
npm run build-catalog -w @stellarai/pipeline   # downloads AT-HYG (~70 MB), builds chunks
npm run dev                                    # http://localhost:4321
npm test                                       # 159 tests
```

Deploy (Cloudflare Pages, free tier, unlimited bandwidth): see
[DEPLOY.md](DEPLOY.md).

## Honest positioning

Others have built pieces of this: [100,000 Stars](https://stars.chromeexperiments.com/)
(2012, 100k stars, no physics), [Overview Effekt](https://www.overvieweffekt.com/tools/interstellar-map)
(119k stars with point-to-point relativistic times),
[starexplorer.space](https://starexplorer.space) (2.5M-row AT-HYG database,
not a navigable map), [Gaia Sky](https://gaiasky.space/) (billions of stars,
desktop install), NASA's [Eyes](https://science.nasa.gov/eyes/) (solar
system, no stars beyond exoplanet hosts), and the beloved
[KSP transfer planner](https://alexmoon.github.io/ksp/) (fictional planets).

What we believe is new here: **multi-hop route planning across a real star
catalog in a browser**, a **live launch-window planner for the real solar
system**, and the three of them — stars, transfers, entry — in one place,
open source, with the test suite to check us.

## Data attribution

Star data derives from [AT-HYG](https://www.astronexus.com/projects/at-hyg)
v4.0 by David Nash (CC BY-SA 4.0), which builds on Tycho-2, Gaia DR3, and
HYG. See [tools/pipeline/ATTRIBUTION.md](tools/pipeline/ATTRIBUTION.md).

## License

MIT for all code. Derived catalog chunks carry CC BY-SA 4.0 from AT-HYG.
