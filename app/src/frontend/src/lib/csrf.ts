/**
 * CSRF token helper.
 *
 * The BFF issues a non-HttpOnly `csrf` cookie alongside the signed session
 * cookie. For mutating requests (POST/PUT/PATCH/DELETE) we echo the cookie
 * value back as an `X-CSRF-Token` header — classic double-submit pattern.
 *
 * The value is re-read on every call so rotation mid-session works without a
 * page reload.
 */

export const CSRF_COOKIE_NAME = 'csrf';
export const CSRF_HEADER_NAME = 'X-CSRF-Token';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const isMutatingMethod = (method: string | undefined): boolean =>
  !!method && MUTATING_METHODS.has(method.toUpperCase());

/** Returns the current value of the `csrf` cookie, or `null` if absent. */
export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${CSRF_COOKIE_NAME}=`;
  const parts = document.cookie ? document.cookie.split(';') : [];
  for (const raw of parts) {
    const c = raw.trim();
    if (c.startsWith(prefix)) {
      const v = c.slice(prefix.length);
      return v ? decodeURIComponent(v) : null;
    }
  }
  return null;
}

/**
 * Returns a headers object with the CSRF token attached, but only for
 * mutating methods. Safe to spread into an existing headers bag.
 */
export function attachCsrfHeader(
  method: string | undefined,
  headers: HeadersInit | undefined,
): HeadersInit {
  if (!isMutatingMethod(method)) return headers ?? {};
  const token = readCsrfToken();
  if (!token) return headers ?? {};
  return {
    ...(headers ?? {}),
    [CSRF_HEADER_NAME]: token,
  };
}
