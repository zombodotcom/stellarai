/**
 * Relativistic aberration and Doppler — what a traveler actually sees.
 *
 * Validated against the textbook results: longitudinal Doppler
 * sqrt((1+beta)/(1-beta)), and the "half the sky crowds forward" result
 * that a star at 90 degrees appears at cos(theta') = beta.
 */

import { describe, expect, it } from 'vitest'
import { aberrateAngleRad, dopplerFactor } from '../src/relativity-view.js'

describe('aberrateAngleRad', () => {
  it('is the identity at beta = 0', () => {
    for (const theta of [0, 0.3, Math.PI / 2, 2.5, Math.PI]) {
      expect(aberrateAngleRad(theta, 0)).toBeCloseTo(theta, 12)
    }
  })

  it('moves a star at 90 degrees to cos(theta_prime) = beta', () => {
    // The classic headlight result: the hemisphere boundary shifts forward.
    for (const beta of [0.1, 0.5, 0.9, 0.99]) {
      const thetaPrime = aberrateAngleRad(Math.PI / 2, beta)
      expect(Math.cos(thetaPrime)).toBeCloseTo(beta, 12)
    }
  })

  it('leaves the exact forward and backward directions fixed', () => {
    expect(aberrateAngleRad(0, 0.9)).toBeCloseTo(0, 12)
    expect(aberrateAngleRad(Math.PI, 0.9)).toBeCloseTo(Math.PI, 12)
  })

  it('always pulls stars toward the direction of motion', () => {
    for (const theta of [0.2, 1.0, 2.0, 3.0]) {
      expect(aberrateAngleRad(theta, 0.6)).toBeLessThan(theta)
    }
  })

  it('rejects beta outside [0, 1)', () => {
    expect(() => aberrateAngleRad(1, -0.1)).toThrow()
    expect(() => aberrateAngleRad(1, 1)).toThrow()
  })
})

describe('dopplerFactor', () => {
  it('is 1 everywhere at beta = 0', () => {
    for (const theta of [0, 1, Math.PI]) {
      expect(dopplerFactor(theta, 0)).toBeCloseTo(1, 12)
    }
  })

  it('reproduces the longitudinal Doppler shift dead ahead', () => {
    for (const beta of [0.1, 0.5, 0.9]) {
      const expected = Math.sqrt((1 + beta) / (1 - beta))
      expect(dopplerFactor(0, beta)).toBeCloseTo(expected, 12)
    }
  })

  it('reproduces the reciprocal shift dead astern', () => {
    const beta = 0.5
    const expected = Math.sqrt((1 - beta) / (1 + beta))
    expect(dopplerFactor(Math.PI, beta)).toBeCloseTo(expected, 12)
  })

  it('blueshifts a star at rest-frame 90 degrees by gamma', () => {
    // That star appears forward of 90 in the ship frame, hence blueshift.
    const beta = 0.8
    const gamma = 1 / Math.sqrt(1 - beta * beta)
    expect(dopplerFactor(Math.PI / 2, beta)).toBeCloseTo(gamma, 12)
  })

  it('redshifts by 1/gamma the star seen at 90 degrees in the SHIP frame', () => {
    // theta' = 90 corresponds to rest-frame cos(theta) = -beta; there the
    // classic transverse time-dilation redshift appears.
    const beta = 0.8
    const gamma = 1 / Math.sqrt(1 - beta * beta)
    const theta = Math.acos(-beta)
    expect(aberrateAngleRad(theta, beta)).toBeCloseTo(Math.PI / 2, 12)
    expect(dopplerFactor(theta, beta)).toBeCloseTo(1 / gamma, 12)
  })
})
