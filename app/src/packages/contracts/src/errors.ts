export const ErrorCode = {
  UNAUTHENTICATED:      'UNAUTHENTICATED',
  FORBIDDEN:            'FORBIDDEN',
  NOT_FOUND:            'NOT_FOUND',
  CONFLICT:             'CONFLICT',
  VALIDATION_FAILED:    'VALIDATION_FAILED',
  RATE_LIMITED:         'RATE_LIMITED',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  CSRF_INVALID:         'CSRF_INVALID',
  DM_FROZEN:            'DM_FROZEN',
  FRIEND_REQUIRED:      'FRIEND_REQUIRED',
  BANNED_FROM_ROOM:     'BANNED_FROM_ROOM',
  TOTP_REQUIRED:        'TOTP_REQUIRED',
  TOTP_INVALID:         'TOTP_INVALID',
  INTERNAL:             'INTERNAL',
} as const;
export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

export interface WireError {
  code: ErrorCode;
  message: string;
  details?: unknown;
  retryAfterMs?: number;
  requestId?: string;
}
