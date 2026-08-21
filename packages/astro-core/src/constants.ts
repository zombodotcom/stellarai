/** Physical and astronomical constants shared across the solver. */

/** Speed of light in vacuum, m/s. Exact — it defines the metre. */
export const C_M_S = 299792458

/** Standard gravity, m/s^2. Exact by definition. */
export const G0 = 9.80665

/** Julian light year, metres. Exact: c times 365.25 days. */
export const LIGHT_YEAR_M = 9.4607304725808e15

/** Julian year, seconds. Exact. */
export const JULIAN_YEAR_S = 31557600

/** Parsecs per light year. */
export const PC_PER_LY = 0.3066013937752

/** Light years per parsec. */
export const LY_PER_PC = 3.2615637769

/** One km/s expressed in parsecs per Julian year (~1.0227e-6). */
export const KM_S_IN_PC_PER_YR = JULIAN_YEAR_S / ((LIGHT_YEAR_M / 1000) * LY_PER_PC)
