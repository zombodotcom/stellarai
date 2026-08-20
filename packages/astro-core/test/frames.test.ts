import { describe, expect, test } from 'vitest'
import { galacticToIcrs, icrsToGalactic } from '../src/frames.js'

describe('icrsToGalactic', () => {
  // The North Galactic Pole is, by definition, galactic latitude +90 deg.
  // Its J2000 equatorial position is the defining constant of the frame.
  test('maps the North Galactic Pole to b = +90 deg', () => {
    const { b } = icrsToGalactic(192.85948, 27.12825)
    expect(b).toBeCloseTo(90, 4)
  })

  // Independent reference check: Sgr A*, the Galactic Centre, sits a few
  // arcminutes off the nominal (0, 0) origin. Published galactic coordinates
  // are l = 359.9442 deg, b = -0.0462 deg. This pins the frame constants —
  // if NGP_RA/NGP_DEC/NCP_L were wrong, this is what would catch it.
  test('places Sgr A* at its published galactic coordinates', () => {
    const { l, b } = icrsToGalactic(266.41683, -29.00781)
    expect(l).toBeCloseTo(359.9442, 3)
    expect(b).toBeCloseTo(-0.0462, 3)
  })
})

describe('galacticToIcrs', () => {
  test('maps galactic latitude +90 deg back to the North Galactic Pole', () => {
    const { ra, dec } = galacticToIcrs(0, 90)
    expect(ra).toBeCloseTo(192.85948, 4)
    expect(dec).toBeCloseTo(27.12825, 4)
  })

  test('round-trips ICRS -> galactic -> ICRS for an arbitrary direction', () => {
    const ra0 = 83.82208 // Betelgeuse
    const dec0 = 7.407064
    const { l, b } = icrsToGalactic(ra0, dec0)
    const { ra, dec } = galacticToIcrs(l, b)
    expect(ra).toBeCloseTo(ra0, 9)
    expect(dec).toBeCloseTo(dec0, 9)
  })
})
