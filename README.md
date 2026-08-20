# StellarAI

A conversational 3D stellar navigator that runs in a browser.

Ask it to plot a course and it returns a real Lambert transfer, a real
relativistic cruise leg, and a real Allen–Eggers atmospheric entry profile —
then flies the camera there.

**Every number comes from unit-tested physics code. The language model selects
tools, supplies parameters, and narrates results; it never produces a
quantity.**

## Why this exists

Three kinds of tool exist today, and none of them overlap:

| | 3D in a browser | Real navigation math | Conversational |
|---|---|---|---|
| [gaia-web](https://github.com/ejtaal/gaia-web), [gaia-3d](https://github.com/simonpfish/gaia-3d) | yes | no | no |
| [GalacticNavigator](https://codeberg.org/arda-guler/GalacticNavigator), [Interstellar-Mission-Planner](https://github.com/atomicKloc/Interstellar-Mission-Planner) | no | yes | no |
| [Gaia Sky](https://gaiasky.space/), [OpenSpace](https://www.openspaceproject.com/), Celestia | desktop only | yes | no |
| **StellarAI** | **yes** | **yes** | **yes** |

## Layout

```
packages/astro-core   pure TypeScript physics — no DOM, no network, fully unit-tested
packages/catalog      binary catalog container + LOD octree index
packages/scene-api    typed scene-control contract (renderer implements, AI emits)
apps/web              Astro site + three.js engine
tools/pipeline        dev-time ETL: source catalogs -> binary chunks
functions/            Cloudflare Pages Functions (API key holder, ADQL proxy)
```

## Scale

Positions span roughly 10^22, from the solar system to the extragalactic tier.
Float32 cannot hold that. All positions are stored in Float64 in tier-natural
units and rebased **relative to the camera** before being downcast for the GPU,
with each tier rendered in its own pass. See `apps/web/src/engine/ScaleGraph.ts`.

## Data

| Tier | Source | Objects | Browser payload |
|---|---|---|---|
| Solar system | [astronomy-engine](https://github.com/cosinekitty/astronomy) | ~30 | computed, 0 bytes |
| Exoplanets | [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/) | ~6,400 | ~2 MB |
| Stellar | [AT-HYG v3](https://www.astronexus.com/projects/at-hyg) | 2.55M | ~30 MB, LOD-chunked |
| LMC / SMC | Gaia DR3 cone search | ~150–200k | ~3 MB |
| Extragalactic | [Cosmicflows-4](https://iopscience.iop.org/article/10.3847/1538-4357/abb66b) | 55,877 | ~2 MB |

AT-HYG is the stellar choice because ~90% of its stars carry **3D velocities**.
Position alone is a picture; a navigator needs velocity.

## Develop

```sh
npm install
npm test          # solver test suite
npm run typecheck
npm run dev       # local site
```

## License

MIT for code. Catalog data retains its upstream license — AT-HYG and HYG are
CC BY-SA 4.0; see `tools/pipeline/ATTRIBUTION.md`.
