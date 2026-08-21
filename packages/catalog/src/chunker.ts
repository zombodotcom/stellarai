/**
 * Chunk planning: split a star catalog into magnitude-banded, size-capped
 * chunks with a manifest a loader can act on without decoding anything.
 *
 * Magnitude is the right first LOD axis for a viewer that starts at Sol:
 * the brightest stars matter from everywhere, the faintest only up close.
 * Bands are fetched brightest-first, so the sky fills in the order a dark
 * -adapting eye would see it. Chunk bounds are recorded so a later spatial
 * scheme (per-band octree) can slot in without changing the binary format
 * or the manifest shape.
 */

import type { StarRecord } from './format.js'

export interface ChunkPlanOptions {
  /**
   * Magnitude boundaries between bands, ascending. Edges [4, 6, 8] produce
   * four bands: mag < 4, 4-6, 6-8, and 8 or fainter.
   */
  bandEdges: readonly number[]
  /** Upper limit on stars per chunk file. */
  maxStarsPerChunk: number
}

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export interface PlannedChunk {
  /** File name the chunk will be written to. */
  file: string
  stars: StarRecord[]
}

export interface PlannedBand {
  magMin: number
  magMax: number
  chunks: PlannedChunk[]
}

export interface ManifestChunk {
  file: string
  count: number
  magMin: number
  magMax: number
  bounds: Bounds
}

export interface CatalogManifest {
  formatVersion: 1
  totalStars: number
  chunks: ManifestChunk[]
}

export interface ChunkPlan {
  bands: PlannedBand[]
  manifest: CatalogManifest
}

function boundsOf(stars: readonly StarRecord[]): Bounds {
  const b: Bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  }
  for (const s of stars) {
    if (s.xPc < b.minX) b.minX = s.xPc
    if (s.xPc > b.maxX) b.maxX = s.xPc
    if (s.yPc < b.minY) b.minY = s.yPc
    if (s.yPc > b.maxY) b.maxY = s.yPc
    if (s.zPc < b.minZ) b.minZ = s.zPc
    if (s.zPc > b.maxZ) b.maxZ = s.zPc
  }
  return b
}

/** Plan the chunking of a catalog. Pure; writing files is the caller's job. */
export function buildChunkPlan(
  stars: readonly StarRecord[],
  options: ChunkPlanOptions,
): ChunkPlan {
  const { bandEdges, maxStarsPerChunk } = options

  for (let i = 1; i < bandEdges.length; i++) {
    if (bandEdges[i]! <= bandEdges[i - 1]!) {
      throw new Error(`Band edges must be sorted ascending; got ${bandEdges.join(', ')}.`)
    }
  }
  if (!(maxStarsPerChunk > 0)) {
    throw new Error(`Max stars per chunk must be positive; got ${maxStarsPerChunk}.`)
  }

  // Band boundaries: [-inf, e0), [e0, e1), ..., [eN, +inf)
  const bands: PlannedBand[] = []
  for (let i = 0; i <= bandEdges.length; i++) {
    bands.push({
      magMin: i === 0 ? -Infinity : bandEdges[i - 1]!,
      magMax: i === bandEdges.length ? Infinity : bandEdges[i]!,
      chunks: [],
    })
  }

  const grouped: StarRecord[][] = bands.map(() => [])
  for (const s of stars) {
    let index = bandEdges.length
    for (let i = 0; i < bandEdges.length; i++) {
      if (s.mag < bandEdges[i]!) {
        index = i
        break
      }
    }
    grouped[index]!.push(s)
  }

  const manifestChunks: ManifestChunk[] = []
  let totalStars = 0

  bands.forEach((band, bandIndex) => {
    const members = grouped[bandIndex]!
    totalStars += members.length
    for (let start = 0; start < members.length; start += maxStarsPerChunk) {
      const chunkStars = members.slice(start, start + maxStarsPerChunk)
      const part = Math.floor(start / maxStarsPerChunk)
      const file = `band${bandIndex}-part${part}.bin`
      band.chunks.push({ file, stars: chunkStars })
      manifestChunks.push({
        file,
        count: chunkStars.length,
        magMin: band.magMin,
        magMax: band.magMax,
        bounds: boundsOf(chunkStars),
      })
    }
  })

  return {
    bands,
    manifest: { formatVersion: 1, totalStars, chunks: manifestChunks },
  }
}
