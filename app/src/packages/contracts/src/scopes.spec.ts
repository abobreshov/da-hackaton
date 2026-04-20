import {
  assertMessageScope,
  isMessageScope,
  type MessageScope,
} from './scopes';

describe('MessageScope — runtime XOR guards', () => {
  describe('isMessageScope (pure predicate)', () => {
    it('accepts a room-scope shape', () => {
      expect(isMessageScope({ roomId: 42 })).toBe(true);
    });

    it('accepts a DM-scope shape', () => {
      expect(isMessageScope({ dmUserId: 7 })).toBe(true);
    });

    it('rejects a payload carrying BOTH keys (XOR violation)', () => {
      expect(isMessageScope({ roomId: 1, dmUserId: 2 })).toBe(false);
    });

    it('rejects a payload carrying NEITHER key', () => {
      expect(isMessageScope({})).toBe(false);
    });

    it('rejects non-numeric roomId', () => {
      expect(isMessageScope({ roomId: '42' })).toBe(false);
    });

    it('rejects non-numeric dmUserId', () => {
      expect(isMessageScope({ dmUserId: true })).toBe(false);
    });

    it('rejects null / primitives outright', () => {
      expect(isMessageScope(null)).toBe(false);
      expect(isMessageScope(undefined)).toBe(false);
      expect(isMessageScope(42)).toBe(false);
      expect(isMessageScope('roomId')).toBe(false);
    });
  });

  describe('assertMessageScope (throws + narrows)', () => {
    it('is a no-op for a valid room-scope and narrows the type', () => {
      const raw: unknown = { roomId: 9 };
      assertMessageScope(raw);
      // After the assertion raw is typed as MessageScope; use it structurally.
      const s: MessageScope = raw;
      expect(s).toEqual({ roomId: 9 });
    });

    it('is a no-op for a valid DM-scope', () => {
      const raw: unknown = { dmUserId: 3 };
      assertMessageScope(raw);
      const s: MessageScope = raw;
      expect(s).toEqual({ dmUserId: 3 });
    });

    it('throws TypeError when BOTH keys are provided', () => {
      expect(() => assertMessageScope({ roomId: 1, dmUserId: 2 })).toThrow(
        TypeError,
      );
      expect(() => assertMessageScope({ roomId: 1, dmUserId: 2 })).toThrow(
        /exactly one of roomId or dmUserId/,
      );
    });

    it('throws TypeError when NEITHER key is provided', () => {
      expect(() => assertMessageScope({})).toThrow(TypeError);
      expect(() => assertMessageScope({})).toThrow(
        /exactly one of roomId or dmUserId/,
      );
    });

    it('throws TypeError for wrong value types', () => {
      expect(() => assertMessageScope({ roomId: 'abc' })).toThrow(TypeError);
      expect(() => assertMessageScope({ dmUserId: null })).toThrow(TypeError);
      expect(() => assertMessageScope(null)).toThrow(TypeError);
    });
  });
});
