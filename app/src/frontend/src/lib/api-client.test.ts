import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiError, isErrorCode, parseError } from './api-client';
import { ErrorCode } from '@app/contracts';

const jsonResponse = (body: unknown, status = 200, statusText?: string) =>
  new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });

describe('api-client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('ApiError / isErrorCode', () => {
    it('ApiError carries status/code/message/details/retryAfter/requestId/body', () => {
      const err = new ApiError({
        status: 429,
        code: ErrorCode.RATE_LIMITED,
        message: 'slow down',
        details: { scope: 'login' },
        retryAfterMs: 1500,
        requestId: 'req_1',
        body: { whatever: true },
      });
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ApiError');
      expect(err.status).toBe(429);
      expect(err.code).toBe(ErrorCode.RATE_LIMITED);
      expect(err.message).toBe('slow down');
      expect(err.details).toEqual({ scope: 'login' });
      expect(err.retryAfterMs).toBe(1500);
      expect(err.requestId).toBe('req_1');
      expect(err.body).toEqual({ whatever: true });
    });

    it('ApiError default message uses "API Error <status>" when message empty', () => {
      const err = new ApiError({ status: 500, code: ErrorCode.INTERNAL, message: '' });
      expect(err.message).toBe('API Error 500');
    });

    it('isErrorCode — true only for ApiError with matching code', () => {
      const err = new ApiError({
        status: 401,
        code: ErrorCode.UNAUTHENTICATED,
        message: 'no',
      });
      expect(isErrorCode(err, ErrorCode.UNAUTHENTICATED)).toBe(true);
      expect(isErrorCode(err, ErrorCode.RATE_LIMITED)).toBe(false);
      expect(isErrorCode(new Error('generic'), ErrorCode.UNAUTHENTICATED)).toBe(false);
      expect(isErrorCode(null, ErrorCode.UNAUTHENTICATED)).toBe(false);
    });
  });

  describe('parseError', () => {
    it('maps a conforming WireError body', async () => {
      const res = new Response(
        JSON.stringify({
          code: ErrorCode.VALIDATION_FAILED,
          message: 'bad',
          details: [{ field: 'email', message: 'required' }],
          retryAfterMs: 0,
          requestId: 'r1',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
      const err = await parseError(res);
      expect(err.status).toBe(400);
      expect(err.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(err.message).toBe('bad');
      expect(err.requestId).toBe('r1');
    });

    it('falls back to UPSTREAM_UNAVAILABLE for non-wire JSON bodies', async () => {
      // Lines 87-90: no isWireError match → fallback branch.
      const res = new Response(JSON.stringify({ unexpected: 'shape' }), {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Content-Type': 'application/json' },
      });
      const err = await parseError(res);
      expect(err.status).toBe(502);
      expect(err.code).toBe(ErrorCode.UPSTREAM_UNAVAILABLE);
      expect(err.message).toBe('Bad Gateway');
      expect(err.body).toEqual({ unexpected: 'shape' });
    });

    it('falls back to UPSTREAM_UNAVAILABLE for non-JSON / HTML error pages', async () => {
      const res = new Response('<html>nope</html>', {
        status: 503,
        statusText: '',
        headers: { 'Content-Type': 'text/html' },
      });
      const err = await parseError(res);
      expect(err.status).toBe(503);
      expect(err.code).toBe(ErrorCode.UPSTREAM_UNAVAILABLE);
      // statusText is empty → default "Upstream unavailable".
      expect(err.message).toBe('Upstream unavailable');
      expect(err.body).toBe('<html>nope</html>');
    });

    it('handles empty-body error responses', async () => {
      const res = new Response(null, { status: 500, statusText: 'Internal' });
      const err = await parseError(res);
      expect(err.code).toBe(ErrorCode.UPSTREAM_UNAVAILABLE);
      expect(err.status).toBe(500);
      expect(err.message).toBe('Internal');
      expect(err.body).toBeUndefined();
    });
  });

  describe('apiFetch', () => {
    it('resolves JSON on 2xx', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
      const res = await apiFetch<{ ok: boolean }>('/api/v1/foo');
      expect(res).toEqual({ ok: true });
      const [, init] = fetchMock.mock.calls[0];
      expect((init as RequestInit).credentials).toBe('include');
      expect((init as RequestInit).method).toBe('GET');
    });

    it('returns undefined on 204 No Content', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      const res = await apiFetch('/api/v1/foo', { method: 'POST' });
      expect(res).toBeUndefined();
    });

    it('throws an ApiError with wire-error details on non-OK JSON response', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ code: ErrorCode.CONFLICT, message: 'dup' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(apiFetch('/api/v1/foo', { method: 'POST' })).rejects.toMatchObject({
        status: 409,
        code: ErrorCode.CONFLICT,
        message: 'dup',
      });
    });

    it('wraps a network failure (fetch rejects) as an ApiError with UPSTREAM_UNAVAILABLE', async () => {
      // Lines 114-119: fetch throws → ApiError fallback.
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(apiFetch('/api/v1/foo')).rejects.toMatchObject({
        status: 0,
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: 'Failed to fetch',
      });
    });

    it('wraps a non-Error network rejection with a generic message', async () => {
      fetchMock.mockRejectedValueOnce('boom');
      await expect(apiFetch('/api/v1/foo')).rejects.toMatchObject({
        status: 0,
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: 'Network error',
      });
    });

    it('sends JSON Content-Type by default and preserves caller headers', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
      await apiFetch('/api/v1/foo', {
        method: 'POST',
        headers: { 'X-Custom': '1' },
        body: JSON.stringify({ x: 1 }),
      });
      const [, init] = fetchMock.mock.calls[0];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Custom']).toBe('1');
    });
  });
});
