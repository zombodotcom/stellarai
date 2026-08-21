/**
 * AT-HYG CSV parser.
 *
 * AT-HYG v4.0 ships precomputed ICRS cartesian positions (x0/y0/z0, parsecs)
 * and velocities (vx/vy/vz, km/s), which is exactly what the catalog format
 * stores — no astrometric conversion happens here, only column mapping and
 * triage. Columns are resolved by header name, never by position, so a
 * future schema revision reorders nothing out from under us.
 *
 * Triage rules, each carrying its reason:
 *   - Sol is excluded: the Sun belongs to the solar tier, not the star field.
 *   - No position, no star. A catalog row without x0/y0/z0 cannot be drawn
 *     or routed to.
 *   - No magnitude, no star. Magnitude is the LOD axis; an unbandable star
 *     would never be fetched deterministically.
 *   - Missing velocity defaults to zero: ~10% of rows lack radial velocity,
 *     and losing the position over it would be the wrong trade.
 */

import type { StarRecord } from '@stellarai/catalog'

const REQUIRED_COLUMNS = ['id', 'x0', 'y0', 'z0', 'mag'] as const

export interface ParseStats {
  parsed: number
  droppedNoPosition: number
  droppedNoMagnitude: number
  droppedSol: number
}

export interface ParseOptions {
  collectStats?: boolean
  /** Also collect IAU proper names, for a search sidecar. */
  collectNames?: boolean
}

export interface NamedStar {
  id: number
  name: string
  mag: number
}

export type ParseResult = StarRecord[] & { stats?: ParseStats; names?: NamedStar[] }

/** Split one CSV line, honouring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',')
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else current += ch
  }
  fields.push(current)
  return fields
}

export function parseAthygCsv(csv: string, options: ParseOptions = {}): ParseResult {
  const lines = csv.split(/\r?\n/)
  const header = splitCsvLine(lines[0] ?? '')
  const col = new Map(header.map((name, i) => [name, i]))

  for (const required of REQUIRED_COLUMNS) {
    if (!col.has(required)) {
      throw new Error(
        `AT-HYG header is missing required column '${required}'. ` +
          `Got: ${header.slice(0, 10).join(', ')}...`,
      )
    }
  }

  const iId = col.get('id')!
  const iX = col.get('x0')!
  const iY = col.get('y0')!
  const iZ = col.get('z0')!
  const iMag = col.get('mag')!
  const iCi = col.get('ci') ?? -1
  const iVx = col.get('vx') ?? -1
  const iVy = col.get('vy') ?? -1
  const iVz = col.get('vz') ?? -1
  const iProper = col.get('proper') ?? -1

  const stats: ParseStats = { parsed: 0, droppedNoPosition: 0, droppedNoMagnitude: 0, droppedSol: 0 }
  const stars: ParseResult = [] as ParseResult
  const names: NamedStar[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.length === 0) continue
    const f = splitCsvLine(line)

    // Sol: rendered by the solar tier from the ephemeris, not the catalog.
    if (iProper >= 0 && f[iProper] === 'Sol') {
      stats.droppedSol++
      continue
    }

    const x = Number(f[iX])
    const y = Number(f[iY])
    const z = Number(f[iZ])
    if (f[iX] === '' || f[iY] === '' || f[iZ] === '' || !Number.isFinite(x + y + z)) {
      stats.droppedNoPosition++
      continue
    }

    const mag = Number(f[iMag])
    if (f[iMag] === '' || !Number.isFinite(mag)) {
      stats.droppedNoMagnitude++
      continue
    }

    const num = (index: number): number => {
      if (index < 0) return 0
      const raw = f[index]
      if (raw === undefined || raw === '') return 0
      const v = Number(raw)
      return Number.isFinite(v) ? v : 0
    }

    const id = Number(f[iId])
    const proper = iProper >= 0 ? f[iProper] : undefined
    if (proper !== undefined && proper !== '' && options.collectNames) {
      names.push({ id, name: proper, mag })
    }

    stars.push({
      id,
      xPc: x,
      yPc: y,
      zPc: z,
      vxKmS: num(iVx),
      vyKmS: num(iVy),
      vzKmS: num(iVz),
      mag,
      colorIndex: num(iCi),
    })
    stats.parsed++
  }

  if (options.collectStats) stars.stats = stats
  if (options.collectNames) stars.names = names
  return stars
}
