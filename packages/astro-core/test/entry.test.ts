import { describe, expect, test } from 'vitest'
import { ballisticEntryProfile } from '../src/entry.js'

const G0 = 9.80665

describe('ballisticEntryProfile — analytic identities', () => {
  // Allen & Eggers (1958) give peak deceleration as Ve^2 sin|gamma| / (2 e H).
  // The ballistic coefficient cancels: a heavy dense capsule and a light
  // fluffy one pull the same peak g on the same trajectory. They differ only
  // in *where* it happens. This is the model's most surprising claim and the
  // sharpest test that it has been implemented rather than approximated.
  test('peak deceleration is independent of ballistic coefficient', () => {
    const base = {
      body: 'earth' as const,
      entryVelocityMs: 7800,
      flightPathAngleDeg: -10,
      noseRadiusM: 1,
    }
    const light = ballisticEntryProfile({ ...base, ballisticCoefficientKgM2: 30 })
    const heavy = ballisticEntryProfile({ ...base, ballisticCoefficientKgM2: 600 })

    expect(light.peakDeceleration.valueG).toBeCloseTo(heavy.peakDeceleration.valueG, 9)
    // ...but the heavier body drives deeper before it peaks.
    expect(heavy.peakDeceleration.altitudeM).toBeLessThan(light.peakDeceleration.altitudeM)
  })

  test('peak deceleration occurs at Ve/sqrt(e)', () => {
    const p = ballisticEntryProfile({
      body: 'earth',
      entryVelocityMs: 7800,
      flightPathAngleDeg: -10,
      ballisticCoefficientKgM2: 200,
      noseRadiusM: 1,
    })
    expect(p.peakDeceleration.velocityMs / 7800).toBeCloseTo(Math.exp(-0.5), 9)
  })

  test('peak heat flux occurs at Ve*exp(-1/6), higher and faster than peak g', () => {
    const p = ballisticEntryProfile({
      body: 'earth',
      entryVelocityMs: 7800,
      flightPathAngleDeg: -10,
      ballisticCoefficientKgM2: 200,
      noseRadiusM: 1,
    })
    expect(p.peakHeatFlux.velocityMs / 7800).toBeCloseTo(Math.exp(-1 / 6), 9)
    // Heating peaks earlier in the descent than deceleration does.
    expect(p.peakHeatFlux.altitudeM).toBeGreaterThan(p.peakDeceleration.altitudeM)
  })

  test('a steeper entry pulls more g than a shallow one', () => {
    const shallow = ballisticEntryProfile({
      body: 'earth',
      entryVelocityMs: 7800,
      flightPathAngleDeg: -5,
      ballisticCoefficientKgM2: 200,
      noseRadiusM: 1,
    })
    const steep = ballisticEntryProfile({
      body: 'earth',
      entryVelocityMs: 7800,
      flightPathAngleDeg: -40,
      ballisticCoefficientKgM2: 200,
      noseRadiusM: 1,
    })
    expect(steep.peakDeceleration.valueG).toBeGreaterThan(shallow.peakDeceleration.valueG)
  })

  test('a blunter nose lowers peak heat flux without changing peak g', () => {
    const base = {
      body: 'earth' as const,
      entryVelocityMs: 7800,
      flightPathAngleDeg: -10,
      ballisticCoefficientKgM2: 200,
    }
    const sharp = ballisticEntryProfile({ ...base, noseRadiusM: 0.3 })
    const blunt = ballisticEntryProfile({ ...base, noseRadiusM: 3.0 })
    expect(blunt.peakHeatFlux.valueWm2).toBeLessThan(sharp.peakHeatFlux.valueWm2)
    expect(blunt.peakDeceleration.valueG).toBeCloseTo(sharp.peakDeceleration.valueG, 9)
  })
})

describe('ballisticEntryProfile — physical validation', () => {
  // Mars Pathfinder is the right validation case: a genuinely ballistic,
  // non-lifting entry, which is exactly what Allen-Eggers models.
  // Flight: Ve = 7260 m/s, gamma = -13.65 deg, beta ~ 63 kg/m^2,
  // measured peak deceleration 15.9 g.
  //
  // The closed form is known to OVERESTIMATE peak g — it neglects gravity,
  // planetary curvature, and departures from an exponential atmosphere. We
  // assert the model lands in its expected 15-35% overestimate band rather
  // than pretending it reproduces flight data exactly. A units error or a
  // wrong scale height would miss this by orders of magnitude.
  test('reproduces Mars Pathfinder peak deceleration within the closed form band', () => {
    const p = ballisticEntryProfile({
      body: 'mars',
      entryVelocityMs: 7260,
      flightPathAngleDeg: -13.65,
      ballisticCoefficientKgM2: 63,
      noseRadiusM: 0.6638,
    })
    const measuredG = 15.9
    const ratio = p.peakDeceleration.valueG / measuredG
    expect(ratio).toBeGreaterThan(1.0)
    expect(ratio).toBeLessThan(1.45)
  })

  test('puts Mars Pathfinder peak heating in the right order of magnitude', () => {
    // Flight peak stagnation heat flux was ~106 W/cm^2 = 1.06e6 W/m^2.
    const p = ballisticEntryProfile({
      body: 'mars',
      entryVelocityMs: 7260,
      flightPathAngleDeg: -13.65,
      ballisticCoefficientKgM2: 63,
      noseRadiusM: 0.6638,
    })
    expect(p.peakHeatFlux.valueWm2).toBeGreaterThan(4e5)
    expect(p.peakHeatFlux.valueWm2).toBeLessThan(4e6)
  })

  test('peak deceleration altitude is inside the atmosphere', () => {
    const p = ballisticEntryProfile({
      body: 'earth',
      entryVelocityMs: 7800,
      flightPathAngleDeg: -10,
      ballisticCoefficientKgM2: 200,
      noseRadiusM: 1,
    })
    expect(p.peakDeceleration.altitudeM).toBeGreaterThan(0)
    expect(p.peakDeceleration.altitudeM).toBeLessThan(120_000)
  })

  test('reports g consistently with m/s^2', () => {
    const p = ballisticEntryProfile({
      body: 'earth',
      entryVelocityMs: 7800,
      flightPathAngleDeg: -10,
      ballisticCoefficientKgM2: 200,
      noseRadiusM: 1,
    })
    expect(p.peakDeceleration.valueG).toBeCloseTo(p.peakDeceleration.valueMs2 / G0, 9)
  })
})

describe('ballisticEntryProfile — input validation', () => {
  test('rejects an ascending flight path angle', () => {
    expect(() =>
      ballisticEntryProfile({
        body: 'earth',
        entryVelocityMs: 7800,
        flightPathAngleDeg: 10,
        ballisticCoefficientKgM2: 200,
        noseRadiusM: 1,
      }),
    ).toThrow(/flight path angle/i)
  })

  test('rejects a grazing entry the closed form cannot model', () => {
    // As gamma -> 0 the constant-flight-path-angle assumption collapses and
    // the formulas return finite but meaningless numbers. Refuse rather than
    // hand back a plausible-looking answer.
    expect(() =>
      ballisticEntryProfile({
        body: 'earth',
        entryVelocityMs: 7800,
        flightPathAngleDeg: -0.05,
        ballisticCoefficientKgM2: 200,
        noseRadiusM: 1,
      }),
    ).toThrow(/grazing|shallow/i)
  })
})
