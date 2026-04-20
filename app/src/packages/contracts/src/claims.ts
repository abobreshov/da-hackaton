/**
 * Shared OIDC-shaped session/access-token claim helpers.
 *
 * `sub` ("subject") encodes account type + numeric id in a stable string:
 *   - `u:<userId>`  for customer principals
 *   - `a:<adminId>` for admin principals
 *
 * Keeping it a single field (instead of separate `userId`/`adminId` columns)
 * lines up with RFC 7519 §4.1.2 and OIDC Core §2. Downstream integrations
 * (future SSO / RP, token introspection responses) can consume `sub` directly.
 */

export type AccountType = 'user' | 'admin';

export interface AccessTokenClaims {
  /** `u:<id>` or `a:<id>`. */
  sub: string;
  /** Redundant with sub prefix but explicit for consumers that don't want to parse. */
  type: AccountType;
  email: string;
  /** Display name — optional so admin tokens don't require a name claim. */
  name?: string;
  /** OAuth resource scopes. Admin tokens carry `[]` unless wired otherwise. */
  scopes: string[];
  iat?: number;
  exp?: number;
}

/** Compose a `sub` string from an account type + numeric id. */
export function makeSub(type: AccountType, numericId: number): string {
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error(`makeSub: numericId must be a positive integer, got ${numericId}`);
  }
  return `${type === 'admin' ? 'a' : 'u'}:${numericId}`;
}

/** Parse a `sub` back into its type + numeric id. Throws on malformed input. */
export function parseSub(sub: string): { type: AccountType; numericId: number } {
  if (typeof sub !== 'string') {
    throw new Error(`parseSub: expected string, got ${typeof sub}`);
  }
  const match = /^([ua]):(\d+)$/.exec(sub);
  if (!match) {
    throw new Error(`parseSub: malformed sub "${sub}"`);
  }
  const type: AccountType = match[1] === 'a' ? 'admin' : 'user';
  const numericId = Number(match[2]);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error(`parseSub: non-positive numeric id in "${sub}"`);
  }
  return { type, numericId };
}
