import { describe, expect, test } from 'vitest'
import { buildChunkPlan } from '../src/chunker.js'
import type { StarRecord } from '../src/format.js'

const star = (id: number, mag: number, x = 0): StarRecord => ({
  id,
  xPc: x,
  yPc: 0,
  zPc: 0,
  vxKmS: 0,
  vyKmS: 0,
  vzKmS: 0,
  mag,
  colorIndex: 0,
})

describe('buildChunkPlan', () => {
  test('splits stars into magnitude bands, brightest band first', () => {
    const stars = [star(1, 9.5), star(2, 1.2), star(3, 5.5), star(4, 7.1), star(5, -1.4)]
    const plan = buildChunkPlan(stars, { bandEdges: [4, 6, 8], maxStarsPerChunk: 1000 })

    expect(plan.bands.length).toBe(4)
    expect(plan.bands[0]!.chunks[0]!.stars.map((s) => s.id).sort()).toEqual([2, 5])
    expect(plan.bands[1]!.chunks[0]!.stars.map((s) => s.id)).toEqual([3])
    expect(plan.bands[2]!.chunks[0]!.stars.map((s) => s.id)).toEqual([4])
    expect(plan.bands[3]!.chunks[0]!.stars.map((s) => s.id)).toEqual([1])
  })

  test('caps chunk size so no single fetch is enormous', () => {
    const stars = Array.from({ length: 2500 }, (_, i) => star(i, 5))
    const plan = buildChunkPlan(stars, { bandEdges: [4, 6], maxStarsPerChunk: 1000 })
    const middleBand = plan.bands[1]!
    expect(middleBand.chunks.length).toBe(3)
    expect(middleBand.chunks[0]!.stars.length).toBe(1000)
    expect(middleBand.chunks[2]!.stars.length).toBe(500)
  })

  test('loses no stars and duplicates none', () => {
    const stars = Array.from({ length: 5000 }, (_, i) => star(i, (i % 160) / 10 - 2))
    const plan = buildChunkPlan(stars, { bandEdges: [2, 5, 8, 11], maxStarsPerChunk: 700 })

    const seen = new Set<number>()
    for (const band of plan.bands)
      for (const chunk of band.chunks)
        for (const s of chunk.stars) {
          expect(seen.has(s.id)).toBe(false)
          seen.add(s.id)
        }
    expect(seen.size).toBe(5000)
  })

  test('produces a manifest that fully describes every chunk', () => {
    const stars = [star(1, 3, -10), star(2, 3, 40), star(3, 7, 5)]
    const plan = buildChunkPlan(stars, { bandEdges: [5], maxStarsPerChunk: 10 })

    expect(plan.manifest.formatVersion).toBe(1)
    expect(plan.manifest.totalStars).toBe(3)
    const first = plan.manifest.chunks[0]!
    expect(first.file).toMatch(/\.bin$/)
    expect(first.count).toBe(2)
    expect(first.magMax).toBeLessThanOrEqual(5)
    // Bounds cover the chunk's stars so a loader can cull without decoding.
    expect(first.bounds.minX).toBeLessThanOrEqual(-10)
    expect(first.bounds.maxX).toBeGreaterThanOrEqual(40)
    // Manifest entries and plan chunks correspond one to one, in order.
    const planFiles = plan.bands.flatMap((b) => b.chunks.map((c) => c.file))
    expect(plan.manifest.chunks.map((c) => c.file)).toEqual(planFiles)
  })

  test('rejects unsorted band edges', () => {
    expect(() => buildChunkPlan([], { bandEdges: [6, 4], maxStarsPerChunk: 10 })).toThrow(
      /sorted|ascending/i,
    )
  })

  test('rejects a non-positive chunk cap', () => {
    expect(() => buildChunkPlan([], { bandEdges: [4], maxStarsPerChunk: 0 })).toThrow(/chunk/i)
  })
})
