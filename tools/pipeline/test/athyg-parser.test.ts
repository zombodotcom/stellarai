import { describe, expect, test } from 'vitest'
import { parseAthygCsv } from '../src/athyg-parser.js'

// The real AT-HYG v4.0 header, verbatim from the published file.
const HEADER =
  'id,tyc,gaia,hyg,hip,hd,hr,gl,bayer,flam,con,proper,ra,dec,pos_src,dist,x0,y0,z0,dist_src,mag,absmag,ci,mag_src,rv,rv_src,pmra,pmdec,pm_src,vx,vy,vz,spect,spect_src'

const SOL =
  '1,,,0,,,,,,,,Sol,0.0,0.0,OTHER,4.85e-06,4.85e-06,0.0,0.0,OTHER,-26.74,4.831,,OTHER,0.0,OTHER,0.0,0.0,OTHER,0.0,0.0,0.0,G2 V,OTHER'

const TYCHO_STAR =
  '2,4669-731-1,2443095153084654208,,,224701,,,,,Psc,,2.263e-05,-5.49436227,T,509.1956,506.8562,0.003,-48.7544,G_R3,9.239,0.705,1.117,T,-17.371,G_R3,22.5,-11.3,G_R3,-19.9,54.31,-25.49,G8 IV,T'

describe('parseAthygCsv', () => {
  test('parses a real Tycho-2 row into a star record', () => {
    const stars = parseAthygCsv([HEADER, TYCHO_STAR].join('\n'))
    expect(stars.length).toBe(1)
    const s = stars[0]!
    expect(s.id).toBe(2)
    expect(s.xPc).toBeCloseTo(506.8562, 4)
    expect(s.yPc).toBeCloseTo(0.003, 4)
    expect(s.zPc).toBeCloseTo(-48.7544, 4)
    expect(s.vxKmS).toBeCloseTo(-19.9, 2)
    expect(s.vyKmS).toBeCloseTo(54.31, 2)
    expect(s.vzKmS).toBeCloseTo(-25.49, 2)
    expect(s.mag).toBeCloseTo(9.239, 3)
    expect(s.colorIndex).toBeCloseTo(1.117, 3)
  })

  test('excludes Sol, which belongs to the solar tier, not the star catalog', () => {
    const stars = parseAthygCsv([HEADER, SOL, TYCHO_STAR].join('\n'))
    expect(stars.map((s) => s.id)).toEqual([2])
  })

  test('defaults missing velocity components to zero rather than dropping the star', () => {
    // ~10% of AT-HYG stars lack radial velocity and so lack vx/vy/vz.
    // A missing velocity is not a reason to lose the position.
    const noVel = TYCHO_STAR.replace('-19.9,54.31,-25.49', ',,')
    const stars = parseAthygCsv([HEADER, noVel].join('\n'))
    expect(stars.length).toBe(1)
    expect(stars[0]!.vxKmS).toBe(0)
    expect(stars[0]!.vyKmS).toBe(0)
    expect(stars[0]!.vzKmS).toBe(0)
  })

  test('defaults a missing colour index to zero', () => {
    const noCi = [
      HEADER,
      TYCHO_STAR.replace(',1.117,', ',,'),
    ].join('\n')
    const stars = parseAthygCsv(noCi)
    expect(stars[0]!.colorIndex).toBe(0)
  })

  test('drops rows with no usable position', () => {
    const noPos = TYCHO_STAR.replace('509.1956,506.8562,0.003,-48.7544', ',,,')
    const stars = parseAthygCsv([HEADER, noPos].join('\n'))
    expect(stars.length).toBe(0)
  })

  test('drops rows with no magnitude, which cannot be LOD-banded', () => {
    const noMag = TYCHO_STAR.replace(',9.239,', ',,')
    const stars = parseAthygCsv([HEADER, noMag].join('\n'))
    expect(stars.length).toBe(0)
  })

  test('handles quoted fields containing commas', () => {
    const quoted = TYCHO_STAR.replace(',Psc,', ',"Alpha, Beta",')
    const stars = parseAthygCsv([HEADER, quoted].join('\n'))
    expect(stars.length).toBe(1)
    expect(stars[0]!.xPc).toBeCloseTo(506.8562, 4)
  })

  test('reports how many rows were dropped and why', () => {
    const noPos = TYCHO_STAR.replace('509.1956,506.8562,0.003,-48.7544', ',,,')
    const result = parseAthygCsv([HEADER, SOL, TYCHO_STAR, noPos].join('\n'), {
      collectStats: true,
    })
    expect(result.length).toBe(1)
    expect(result.stats).toEqual({ parsed: 1, droppedNoPosition: 1, droppedNoMagnitude: 0, droppedSol: 1 })
  })

  test('rejects a file whose header is missing required columns', () => {
    expect(() => parseAthygCsv('a,b,c\n1,2,3')).toThrow(/column/i)
  })
})

describe('name collection', () => {
  const NAMED =
    '71681,,,71454,71681,128620,5459,559A,Alp1,,Cen,Rigil Kentaurus,14.66,-60.83,H,1.3248,-0.4967,-0.4227,-1.1522,H,-0.01,4.38,0.71,H,-21.4,H,-3679.25,473.67,H,-29.29,1.71,13.99,G2 V,H'
  const HEADER =
    'id,tyc,gaia,hyg,hip,hd,hr,gl,bayer,flam,con,proper,ra,dec,pos_src,dist,x0,y0,z0,dist_src,mag,absmag,ci,mag_src,rv,rv_src,pmra,pmdec,pm_src,vx,vy,vz,spect,spect_src'
  const UNNAMED =
    '2,4669-731-1,2443095153084654208,,,224701,,,,,Psc,,2.263e-05,-5.49436227,T,509.1956,506.8562,0.003,-48.7544,G_R3,9.239,0.705,1.117,T,-17.371,G_R3,22.5,-11.3,G_R3,-19.9,54.31,-25.49,G8 IV,T'

  test('collects proper names alongside the records when asked', () => {
    const result = parseAthygCsv([HEADER, NAMED, UNNAMED].join('\n'), { collectNames: true })
    expect(result.length).toBe(2)
    expect(result.names).toEqual([{ id: 71681, name: 'Rigil Kentaurus', mag: -0.01 }])
  })

  test('does not collect names for stars that were dropped', () => {
    const droppedNamed = NAMED.replace('-0.4967,-0.4227,-1.1522', ',,')
    const result = parseAthygCsv([HEADER, droppedNamed].join('\n'), { collectNames: true })
    expect(result.length).toBe(0)
    expect(result.names).toEqual([])
  })
})
