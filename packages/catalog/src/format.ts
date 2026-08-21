/**
 * Binary star-catalog chunk format — the single source of truth shared by
 * the build pipeline (writer) and the browser loader (reader).
 *
 * Why not JSON: 2.55 million stars as JSON is what gaia-web ships, and it
 * costs 290 MB to 1.4 GB. Why not float64-everything: that is ~80 MB for
 * fields whose precision nobody can see. Each field gets exactly the width
 * its use deserves:
 *
 *   position   Float32 x3   12 B   ~0.1 pc absolute error at 1 kpc — far
 *                                  below the catalog's own distance errors
 *   velocity   Int16    x3   6 B   0.025 km/s steps, range ±819 km/s; the
 *                                  fastest catalog stars are ~600 km/s
 *   id         Uint32        4 B   AT-HYG row id, for lookups and routing
 *   magnitude  Int16         2 B   centimag; Sirius at -1.46 to the faint end
 *   colour     Int16         2 B   centimag B-V
 *
 * 26 bytes per star plus an 8-byte chunk header (magic + version). Little
 * endian throughout — every platform this ships to is little endian, and
 * DataView makes the choice explicit rather than accidental.
 */

/** Bytes per star record. Format version 1. */
export const BYTES_PER_STAR = 26

/** 'STAR' little-endian, plus a format version. */
const MAGIC = 0x52415453
const VERSION = 1
const HEADER_BYTES = 8

/** Velocity quantisation: km/s per Int16 step. ±819 km/s range. */
const VELOCITY_STEP_KMS = 0.025

export interface StarRecord {
  /** Catalog row id (AT-HYG). */
  id: number
  /** ICRS cartesian position, parsecs. */
  xPc: number
  yPc: number
  zPc: number
  /** ICRS cartesian velocity, km/s. */
  vxKmS: number
  vyKmS: number
  vzKmS: number
  /** Apparent magnitude. */
  mag: number
  /** B-V colour index. */
  colorIndex: number
}

/** Encode stars into a transferable binary chunk. */
export function encodeChunk(stars: readonly StarRecord[]): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_BYTES + stars.length * BYTES_PER_STAR)
  const view = new DataView(buffer)
  view.setUint32(0, MAGIC, true)
  view.setUint16(4, VERSION, true)
  view.setUint16(6, 0, true) // reserved
  // Count is implicit in the byte length; the header pins format identity.

  let offset = HEADER_BYTES
  for (const s of stars) {
    view.setUint32(offset, s.id, true)
    view.setFloat32(offset + 4, s.xPc, true)
    view.setFloat32(offset + 8, s.yPc, true)
    view.setFloat32(offset + 12, s.zPc, true)
    view.setInt16(offset + 16, quantise(s.vxKmS / VELOCITY_STEP_KMS), true)
    view.setInt16(offset + 18, quantise(s.vyKmS / VELOCITY_STEP_KMS), true)
    view.setInt16(offset + 20, quantise(s.vzKmS / VELOCITY_STEP_KMS), true)
    view.setInt16(offset + 22, quantise(s.mag * 100), true)
    view.setInt16(offset + 24, quantise(s.colorIndex * 100), true)
    offset += BYTES_PER_STAR
  }
  return buffer
}

function quantise(v: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(v)))
}

/** Decode a chunk back into star records. */
export function decodeChunk(buffer: ArrayBuffer): StarRecord[] {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error('Catalog chunk is truncated: shorter than its header.')
  }
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== MAGIC) {
    throw new Error('Not a catalog chunk: bad magic bytes.')
  }
  const version = view.getUint16(4, true)
  if (version !== VERSION) {
    throw new Error(`Unsupported catalog format version ${version}; expected ${VERSION}.`)
  }
  const payload = buffer.byteLength - HEADER_BYTES
  if (payload % BYTES_PER_STAR !== 0) {
    throw new Error(
      `Catalog chunk is corrupt: payload of ${payload} bytes is not a whole ` +
        `number of ${BYTES_PER_STAR}-byte records.`,
    )
  }

  const count = payload / BYTES_PER_STAR
  const stars: StarRecord[] = new Array(count)
  let offset = HEADER_BYTES
  for (let i = 0; i < count; i++) {
    stars[i] = {
      id: view.getUint32(offset, true),
      xPc: view.getFloat32(offset + 4, true),
      yPc: view.getFloat32(offset + 8, true),
      zPc: view.getFloat32(offset + 12, true),
      vxKmS: view.getInt16(offset + 16, true) * VELOCITY_STEP_KMS,
      vyKmS: view.getInt16(offset + 18, true) * VELOCITY_STEP_KMS,
      vzKmS: view.getInt16(offset + 20, true) * VELOCITY_STEP_KMS,
      mag: view.getInt16(offset + 22, true) / 100,
      colorIndex: view.getInt16(offset + 24, true) / 100,
    }
    offset += BYTES_PER_STAR
  }
  return stars
}
