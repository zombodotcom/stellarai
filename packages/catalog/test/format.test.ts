import { describe, expect, test } from 'vitest'
import {
  BYTES_PER_STAR,
  decodeChunk,
  encodeChunk,
  type StarRecord,
} from '../src/format.js'

const star = (over: Partial<StarRecord> = {}): StarRecord => ({
  id: 12345,
  xPc: 1.5,
  yPc: -2.25,
  zPc: 100.125,
  vxKmS: -12.5,
  vyKmS: 3.25,
  vzKmS: 0.75,
  mag: 4.52,
  colorIndex: 0.65,
  ...over,
})

describe('catalog chunk encoding', () => {
  test('round-trips a star through encode and decode', () => {
    const [out] = decodeChunk(encodeChunk([star()]))
    expect(out!.id).toBe(12345)
    expect(out!.xPc).toBeCloseTo(1.5, 5)
    expect(out!.yPc).toBeCloseTo(-2.25, 5)
    expect(out!.zPc).toBeCloseTo(100.125, 5)
    // Velocity is quantised; centimetre-per-second exactness is not needed
    // for rendering or routing, but 0.1 km/s must survive.
    expect(out!.vxKmS).toBeCloseTo(-12.5, 1)
    expect(out!.vyKmS).toBeCloseTo(3.25, 1)
    expect(out!.vzKmS).toBeCloseTo(0.75, 1)
    // Magnitude and colour are centimag-quantised.
    expect(out!.mag).toBeCloseTo(4.52, 2)
    expect(out!.colorIndex).toBeCloseTo(0.65, 2)
  })

  test('preserves order and count for many stars', () => {
    const stars = Array.from({ length: 1000 }, (_, i) =>
      star({ id: i, xPc: i * 0.1, mag: (i % 150) / 10 - 2 }),
    )
    const out = decodeChunk(encodeChunk(stars))
    expect(out.length).toBe(1000)
    expect(out[0]!.id).toBe(0)
    expect(out[999]!.id).toBe(999)
    expect(out[500]!.xPc).toBeCloseTo(50, 4)
  })

  test('meets the size budget that makes streaming viable', () => {
    // 2.55M stars at this record size must land well under the ~80 MB a
    // float64-everything layout would cost: 26 bytes puts the whole catalog
    // at 66 MB before CDN compression, and LOD means far less is fetched.
    expect(BYTES_PER_STAR).toBeLessThanOrEqual(26)
    const encoded = encodeChunk([star(), star(), star()])
    expect(encoded.byteLength).toBe(3 * BYTES_PER_STAR + 8) // header
  })

  test('survives extreme but real values', () => {
    // Proxima moves fast; some catalog stars exceed 500 km/s. Barnard's Star
    // is mag 9.5; the brightest star is Sirius at -1.46.
    const extreme = star({ vxKmS: -550, mag: -1.46, colorIndex: -0.3 })
    const [out] = decodeChunk(encodeChunk([extreme]))
    expect(out!.vxKmS).toBeCloseTo(-550, 0)
    expect(out!.mag).toBeCloseTo(-1.46, 2)
    expect(out!.colorIndex).toBeCloseTo(-0.3, 2)
  })

  test('rejects a buffer whose length does not match its header', () => {
    const good = encodeChunk([star()])
    const truncated = good.slice(0, good.byteLength - 4)
    expect(() => decodeChunk(truncated)).toThrow(/truncated|length|corrupt/i)
  })

  test('rejects a buffer with the wrong magic bytes', () => {
    const good = encodeChunk([star()])
    const bytes = new Uint8Array(good.slice(0))
    bytes[0] = 0x00
    expect(() => decodeChunk(bytes.buffer)).toThrow(/magic|format/i)
  })

  test('encodes an empty chunk and reads it back', () => {
    expect(decodeChunk(encodeChunk([]))).toEqual([])
  })
})
