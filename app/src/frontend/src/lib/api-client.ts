import { ErrorCode, type WireError } from '@app/contracts';
import { attachCsrfHeader } from './csrf';

interface ApiErrorInit {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
  retryAfterMs?: number;
  requestId?: string;
  body?: unknown;
}

/**
 * Structured API error raised by `apiFetch` on any non-2xx response.
 *
 * Always carries a `code: ErrorCode` so components can branch on
 * semantic failure modes without parsing strings. The raw `body` is
 * preserved for diagnostic logging.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly retryAfterMs?: number;
  public readonly requestId?: string;
  public readonly body: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message || `API Error ${init.status}`);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.retryAfterMs = init.retryAfterMs;
    this.requestId = init.requestId;
    this.body = init.body;
  }
}

/** Narrow helper — true iff `err` is an `ApiError` with the given code. */
export function isErrorCode(err: unknown, code: ErrorCode): boolean {
  return err instanceof ApiError && err.code === code;
}

function isWireError(v: unknown): v is WireError {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.code !== 'string') return false;
  if (typeof o.message !== 'string') return false;
  // Check code is one of the known ErrorCode values
  return (Object.values(ErrorCode) as string[]).includes(o.code);
}

/**
 * Parses a non-OK `Response` into an `ApiError`. Attempts to read the
 * body as a `WireError`; falls back to UPSTREAM_UNAVAILABLE for
 * non-conforming payloads (network errors, plain text, HTML error pages).
 */
export async function parseError(response: Response): Promise<ApiError> {
  let raw: unknown = undefined;
  try {
    const text = await response.text();
    if (text) {
      try {
        raw = JSON.parse(text);
      } catch {
        raw = text;
      }
    }
  } catch {
    // body read failed — keep raw undefined
  }

  if (isWireError(raw)) {
    return new ApiError({
      status: response.status,
      code: raw.code,
      message: raw.message,
      details: raw.details,
      retryAfterMs: raw.retryAfterMs,
      requestId: raw.requestId,
      body: raw,
    });
  }

  return new ApiError({
    status: response.status,
    code: ErrorCode.UPSTREAM_UNAVAILABLE,
    message: response.statusText || 'Upstream unavailable',
    body: raw,
  });
}

const BASE_URL = import.meta.env.VITE_BFF_URL ?? '';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET';
  const baseHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    ...init?.headers,
  };
  const headers = attachCsrfHeader(method, baseHeaders);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      method,
      credentials: 'include',
      headers,
    });
  } catch (networkErr) {
    throw new ApiError({
      status: 0,
      code: ErrorCode.UPSTREAM_UNAVAILABLE,
      message: networkErr instanceof Error ? networkErr.message : 'Network error',
    });
  }

  if (!res.ok) {
    throw await parseError(res);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export { ErrorCode } from '@app/contracts';
