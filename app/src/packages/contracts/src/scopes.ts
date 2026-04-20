/**
 * Message-scope XOR contract.
 *
 * Every chat message is scoped to EXACTLY ONE of:
 *   - a room (`roomId`)   — group conversation
 *   - a direct peer (`dmUserId`) — private thread
 *
 * Carrying both simultaneously is ambiguous (which audience?) and carrying
 * neither is meaningless (to whom?). The backend therefore treats the two
 * keys as a discriminated XOR — see `mng/specs/` message routing notes.
 *
 * This module exports:
 *   - `MessageScope`         — the TS union capturing the XOR at compile time.
 *   - `isMessageScope`       — runtime predicate (for guards / serializers).
 *   - `assertMessageScope`   — throws `TypeError` with a precise message when
 *                              the XOR is violated. Use in NestJS DTO
 *                              pipes / RPC handlers to fail fast before the
 *                              payload reaches the DB layer.
 */

export type MessageScope = { roomId: number } | { dmUserId: number };

/**
 * Narrow type-predicate. Accepts `unknown` so callers can pipe raw JSON
 * straight in without pre-validation. Returns `false` for anything that
 * isn't a plain object with *exactly* one of the two scope keys set to a
 * finite number.
 */
export function isMessageScope(value: unknown): value is MessageScope {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;

  const hasRoom = 'roomId' in obj && obj.roomId !== undefined;
  const hasDm = 'dmUserId' in obj && obj.dmUserId !== undefined;

  // XOR — exactly one must be present.
  if (hasRoom === hasDm) return false;

  if (hasRoom) {
    return typeof obj.roomId === 'number' && Number.isFinite(obj.roomId);
  }
  return typeof obj.dmUserId === 'number' && Number.isFinite(obj.dmUserId);
}

/**
 * Asserting variant — throws `TypeError` with a precise, user-safe message
 * when the XOR invariant is violated. The message is intentionally stable
 * (prefixed with `'message must have exactly one of roomId or dmUserId'`)
 * so BFF exception mappers can translate it into a VALIDATION_FAILED wire
 * error without parsing the raw throw.
 */
export function assertMessageScope(s: unknown): asserts s is MessageScope {
  if (!isMessageScope(s)) {
    throw new TypeError(
      'message must have exactly one of roomId or dmUserId',
    );
  }
}
