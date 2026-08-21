/**
 * Catalog build: AT-HYG CSV -> binary chunks + manifest.
 *
 * Composition of tested parts — parseAthygCsv, buildChunkPlan, encodeChunk —
 * with the I/O in between. Downloads are cached in data/raw/ (gitignored),
 * output lands in apps/web/public/catalog/ (also gitignored: artifacts are
 * rebuilt, never committed).
 *
 * Default source is the AT-HYG v4.0 magnitude-11 subset: 875,292 stars,
 * every star to mag 11 plus everything within 100 light years regardless of
 * magnitude — which matters, because routing near Sol wants the dim nearby
 * red dwarfs that a bare magnitude cut would lose. The full 2.5M-star
 * catalog is one URL swap away.
 *
 * Run: npm run build-catalog -w @stellarai/pipeline
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { buildChunkPlan, encodeChunk } from '@stellarai/catalog'
import { parseAthygCsv } from './athyg-parser.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')

const SOURCE_URL =
  process.env['ATHYG_URL'] ??
  'https://codeberg.org/astronexus/athyg/media/branch/main/data/subsets/athyg_40_reduced_m11.csv.gz'

const rawDir = join(repoRoot, 'data', 'raw')
const outDir = join(repoRoot, 'apps', 'web', 'public', 'catalog')
const cachePath = join(rawDir, 'athyg.csv.gz')

async function main(): Promise<void> {
  mkdirSync(rawDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })

  if (!existsSync(cachePath)) {
    console.log(`downloading ${SOURCE_URL}`)
    const response = await fetch(SOURCE_URL)
    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status} for ${SOURCE_URL}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    writeFileSync(cachePath, bytes)
    console.log(`cached ${(bytes.byteLength / 1e6).toFixed(1)} MB to ${cachePath}`)
  } else {
    console.log(`using cached ${cachePath}`)
  }

  console.log('parsing...')
  const csv = gunzipSync(readFileSync(cachePath)).toString('utf-8')
  const stars = parseAthygCsv(csv, { collectStats: true })
  console.log(
    `parsed ${stars.length.toLocaleString()} stars`,
    JSON.stringify(stars.stats),
  )

  // Band edges chosen for fetch ordering: naked-eye sky first (~9k stars),
  // then binocular depth, then the faint mass. Chunk cap keeps any single
  // fetch around 1.6 MB before CDN compression.
  const plan = buildChunkPlan(stars, {
    bandEdges: [6.5, 8, 9.5, 11],
    maxStarsPerChunk: 65_536,
  })

  let totalBytes = 0
  for (const band of plan.bands) {
    for (const chunk of band.chunks) {
      const encoded = encodeChunk(chunk.stars)
      writeFileSync(join(outDir, chunk.file), new Uint8Array(encoded))
      totalBytes += encoded.byteLength
    }
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(plan.manifest))

  console.log(
    `wrote ${plan.manifest.chunks.length} chunks, ` +
      `${(totalBytes / 1e6).toFixed(1)} MB total, to ${outDir}`,
  )
  for (const band of plan.bands) {
    const count = band.chunks.reduce((n, c) => n + c.stars.length, 0)
    console.log(
      `  mag ${String(band.magMin).padStart(9)} .. ${String(band.magMax).padEnd(8)} ` +
        `${count.toLocaleString().padStart(9)} stars in ${band.chunks.length} chunk(s)`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
