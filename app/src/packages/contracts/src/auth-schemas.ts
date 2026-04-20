/**
 * Shared auth input schemas — the single source of truth for password, email,
 * username and TOTP rules across frontend (zod) and backend (class-validator
 * caps that mirror the same bounds).
 *
 * Frontend imports the zod schemas directly. BFF + auth-service NestJS DTOs
 * import the named constants (PASSWORD_MIN/PASSWORD_MAX/EMAIL_MAX/...) and the
 * TOTP_REGEX so that class-validator decorators enforce the same bounds and
 * characters — rules never drift between client and server.
 *
 * Rationale (EPIC-14 / OWASP C5 — input validation):
 *  - `MaxLength` caps everywhere cut off pathological payloads (memory DoS,
 *    log-flood, downstream tokeniser overruns).
 *  - TOTP is explicitly `^\d{6}$` — previously server-side `@IsString()` alone
 *    let arbitrary strings through; now only 6 decimal digits pass.
 *  - Password complexity (lowercase + uppercase + digit) on *registration*
 *    and *reset* paths, NOT on login (see login-schema.md in spec §14). A
 *    weak pre-policy password must still be able to log in; forcing the
 *    rule there would lock out existing accounts.
 */

import { z } from 'zod';

/** Lower bound — 8 chars is OWASP's minimum recommended for bcrypt flows. */
export const PASSWORD_MIN = 8;
/** Upper bound — anything > 128 chars is a payload attack, not a user. */
export const PASSWORD_MAX = 128;
/** RFC 5321 §4.5.3.1.3 caps the full address at 254 octets. */
export const EMAIL_MAX = 254;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
/** Six decimal digits, no spaces, no separators. */
export const TOTP_REGEX = /^\d{6}$/;
/** Letters, digits, dot, dash, underscore — matches NestJS DTO Matches() regex. */
export const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

/**
 * Strong-password zod schema. Use on registration, password-change,
 * password-reset-confirm. Do NOT use on login — existing users with
 * pre-policy passwords must still be able to authenticate.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, 'At least 8 characters')
  .max(PASSWORD_MAX, 'Too long')
  .regex(/[a-z]/, 'Needs a lowercase letter')
  .regex(/[A-Z]/, 'Needs an uppercase letter')
  .regex(/\d/, 'Needs a digit');

export const emailSchema = z.string().email('Enter a valid email').max(EMAIL_MAX, 'Email too long');

export const totpSchema = z.string().regex(TOTP_REGEX, 'Six digits');

export const usernameSchema = z
  .string()
  .min(USERNAME_MIN, 'Username must be at least 3 characters')
  .max(USERNAME_MAX, 'Username must be at most 32 characters')
  .regex(USERNAME_REGEX, 'Letters, digits, dot, dash, underscore only');
