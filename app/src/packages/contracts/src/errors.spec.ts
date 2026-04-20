import { ErrorCode, type WireError } from './errors';

describe('ErrorCode', () => {
  const expectedCodes = [
    'RATE_LIMITED',
    'NOT_FOUND',
    'FORBIDDEN',
    'CONFLICT',
    'VALIDATION_FAILED',
    'UPSTREAM_UNAVAILABLE',
    'CSRF_INVALID',
    'DM_FROZEN',
    'FRIEND_REQUIRED',
    'BANNED_FROM_ROOM',
    'TOTP_REQUIRED',
    'TOTP_INVALID',
    'UNAUTHENTICATED',
    'INTERNAL',
  ] as const;

  it('contains exactly 14 codes', () => {
    expect(Object.keys(ErrorCode)).toHaveLength(14);
  });

  it('contains all expected codes', () => {
    for (const code of expectedCodes) {
      expect(ErrorCode).toHaveProperty(code);
    }
  });

  it('maps each key to its own string value (key === value)', () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(value).toBe(key);
      expect(typeof value).toBe('string');
    }
  });

  it('has unique values across all codes', () => {
    const values = Object.values(ErrorCode);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('WireError', () => {
  const makeWireError = (e: WireError): WireError => e;

  it('accepts required code + message', () => {
    const e = makeWireError({
      code: ErrorCode.NOT_FOUND,
      message: 'Resource missing',
    });
    expect(e.code).toBe('NOT_FOUND');
    expect(e.message).toBe('Resource missing');
  });

  it('accepts optional details, retryAfterMs, requestId', () => {
    const e = makeWireError({
      code: ErrorCode.RATE_LIMITED,
      message: 'Too many requests',
      details: { scope: 'login' },
      retryAfterMs: 1500,
      requestId: 'req-abc-123',
    });
    expect(e.details).toEqual({ scope: 'login' });
    expect(e.retryAfterMs).toBe(1500);
    expect(e.requestId).toBe('req-abc-123');
  });

  it('allows optional fields to be omitted', () => {
    const e = makeWireError({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Bad input',
    });
    expect(e.details).toBeUndefined();
    expect(e.retryAfterMs).toBeUndefined();
    expect(e.requestId).toBeUndefined();
  });
});
