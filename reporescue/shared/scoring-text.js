/**
 * Shareable scoring documentation strings.
 *
 * Kept in one module so the methodology page, README and API agree on the
 * weights. `DIMENSION_WEIGHTS` is re-exported from the domain types to avoid a
 * second source of truth.
 */
export { DIMENSION_WEIGHTS } from "./constants.js";
export const SCORE_FORMULA_TEXT = "total = round(100 × Σ earned check points / Σ applicable check points). Dimension score = round(100 × Σ earned within dimension / Σ applicable weight within dimension). Partial credit = 50% of a check's weight. Not-applicable checks are excluded from both numerator and denominator; coverage = Σ applicable weights.";
