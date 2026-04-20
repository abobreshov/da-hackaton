/**
 * Numeric validation bounds surfaced as named constants so DTOs (class-validator)
 * and zod schemas (frontend) share a single source of truth. Drift between
 * FE and BE min/max values is a classic "works on dev, rejected in prod"
 * footgun — these exports + the grep-gate in `gate/inline-drift.spec.ts`
 * make such drift visible at test time.
 *
 * Re-exported from `auth-schemas.ts` so non-auth consumers (future: message
 * length, attachment size, etc.) can import from a neutrally-named place
 * without pulling the whole zod schema graph, while still keeping a single
 * source of truth.
 */

/** Lower bound — 8 chars is OWASP's minimum recommended for bcrypt flows. */
export const PASSWORD_MIN = 8;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
