import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  isMutatingMethod,
  readCsrfToken,
  attachCsrfHeader,
} from './csrf';

/**
 * jsdom keeps document.cookie mutations between tests — reset by clearing every
 * cookie we touch back to an expired date.
 */
function clearAllCookies() {
  const all = document.cookie ? document.cookie.split(';') : [];
  for (const raw of all) {
    const eq = raw.indexOf('=');
    const name = (eq > -1 ? raw.slice(0, eq) : raw).trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

describe('csrf helpers', () => {
  beforeEach(() => {
    clearAllCookies();
  });
  afterEach(() => {
    clearAllCookies();
  });

  describe('isMutatingMethod', () => {
    it('returns true for POST/PUT/PATCH/DELETE (any case)', () => {
      expect(isMutatingMethod('POST')).toBe(true);
      expect(isMutatingMethod('put')).toBe(true);
      expect(isMutatingMethod('Patch')).toBe(true);
      expect(isMutatingMethod('delete')).toBe(true);
    });

    it('returns false for safe methods and undefined', () => {
      expect(isMutatingMethod('GET')).toBe(false);
      expect(isMutatingMethod('HEAD')).toBe(false);
      expect(isMutatingMethod('OPTIONS')).toBe(false);
      expect(isMutatingMethod(undefined)).toBe(false);
      expect(isMutatingMethod('')).toBe(false);
    });
  });

  describe('readCsrfToken', () => {
    it('returns the cookie value when present, url-decoded', () => {
      document.cookie = `${CSRF_COOKIE_NAME}=${encodeURIComponent('abc/123=xyz')}; path=/`;
      expect(readCsrfToken()).toBe('abc/123=xyz');
    });

    it('returns null when the csrf cookie is not present', () => {
      document.cookie = 'other=42; path=/';
      expect(readCsrfToken()).toBeNull();
    });

    it('returns null when there are no cookies at all', () => {
      // document.cookie is empty-string in jsdom after clearing.
      expect(document.cookie).toBe('');
      expect(readCsrfToken()).toBeNull();
    });

    it('returns null when the csrf cookie is set to empty', () => {
      document.cookie = `${CSRF_COOKIE_NAME}=; path=/`;
      // Per the helper, an empty value short-circuits to null (line 28).
      expect(readCsrfToken()).toBeNull();
    });

    it('skips unrelated cookies and finds csrf among many', () => {
      document.cookie = 'a=1; path=/';
      document.cookie = 'b=2; path=/';
      document.cookie = `${CSRF_COOKIE_NAME}=tok-xyz; path=/`;
      expect(readCsrfToken()).toBe('tok-xyz');
    });
  });

  describe('attachCsrfHeader', () => {
    it('returns headers unchanged for safe methods', () => {
      document.cookie = `${CSRF_COOKIE_NAME}=tok; path=/`;
      const base = { 'Content-Type': 'application/json' };
      expect(attachCsrfHeader('GET', base)).toEqual(base);
    });

    it('returns an empty object when method is safe and no headers given', () => {
      expect(attachCsrfHeader('GET', undefined)).toEqual({});
    });

    it('attaches X-CSRF-Token header for mutating methods (case-insensitive)', () => {
      document.cookie = `${CSRF_COOKIE_NAME}=tok-42; path=/`;
      const out = attachCsrfHeader('post', { 'Content-Type': 'application/json' }) as Record<
        string,
        string
      >;
      expect(out[CSRF_HEADER_NAME]).toBe('tok-42');
      expect(out['Content-Type']).toBe('application/json');
    });

    it('attaches X-CSRF-Token even when existing headers bag is undefined', () => {
      document.cookie = `${CSRF_COOKIE_NAME}=tok-42; path=/`;
      const out = attachCsrfHeader('DELETE', undefined) as Record<string, string>;
      expect(out[CSRF_HEADER_NAME]).toBe('tok-42');
    });

    it('returns headers unchanged when mutating but cookie is missing', () => {
      // No csrf cookie set.
      const base = { 'Content-Type': 'application/json' };
      const out = attachCsrfHeader('POST', base);
      expect(out).toEqual(base);
      expect((out as Record<string, string>)[CSRF_HEADER_NAME]).toBeUndefined();
    });

    it('returns {} when mutating with no cookie and no headers provided', () => {
      expect(attachCsrfHeader('PATCH', undefined)).toEqual({});
    });
  });
});
