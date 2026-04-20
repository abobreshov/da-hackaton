import { authenticator } from 'otplib';
import { TotpService } from './totp.service';

describe('TotpService', () => {
  const svc = new TotpService();

  describe('generateSecret', () => {
    it('returns a base32 string of reasonable length', () => {
      const secret = svc.generateSecret();
      // Base32 alphabet per RFC 4648 (otplib uses upper-case A-Z + 2-7).
      expect(secret).toMatch(/^[A-Z2-7]+=*$/);
      expect(secret.length).toBeGreaterThanOrEqual(16);
    });

    it('produces a fresh secret on each call', () => {
      const a = svc.generateSecret();
      const b = svc.generateSecret();
      expect(a).not.toEqual(b);
    });
  });

  describe('generateQrCode', () => {
    it('returns a data-url PNG embedding the otpauth URI', async () => {
      const secret = svc.generateSecret();
      const url = await svc.generateQrCode('user@example.com', secret, 'TestApp');
      expect(url.startsWith('data:image/png;base64,')).toBe(true);
    });
  });

  describe('verify', () => {
    it('returns true for the code generated right now', () => {
      const secret = svc.generateSecret();
      const code = authenticator.generate(secret);
      expect(svc.verify(code, secret)).toBe(true);
    });

    it('returns false for an obviously wrong 6-digit code', () => {
      const secret = svc.generateSecret();
      expect(svc.verify('000000', secret)).toBe(false);
    });

    it('returns false for a non-numeric token', () => {
      const secret = svc.generateSecret();
      expect(svc.verify('abcdef', secret)).toBe(false);
    });

    it('returns false for a code generated with a different secret', () => {
      const victimSecret = svc.generateSecret();
      const attackerSecret = svc.generateSecret();
      const attackerCode = authenticator.generate(attackerSecret);
      expect(svc.verify(attackerCode, victimSecret)).toBe(false);
    });

    it('uses a strict (window=0) time-step check — previous/next step codes are rejected', () => {
      // The current impl calls `authenticator.verify({ token, secret })` with otplib's
      // default window (0). Codes from the adjacent step MUST be rejected.
      const secret = svc.generateSecret();
      const realNow = Date.now;
      try {
        // Generate the code for the *previous* 30s step, then restore the clock to "now".
        Date.now = () => realNow() - 31 * 1000;
        const prevStepCode = authenticator.generate(secret);
        Date.now = realNow;
        expect(svc.verify(prevStepCode, secret)).toBe(false);
      } finally {
        Date.now = realNow;
      }
    });
  });
});
