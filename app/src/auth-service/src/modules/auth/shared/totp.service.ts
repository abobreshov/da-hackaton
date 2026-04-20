import { Injectable, Logger } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { CacheService } from '../../../cache/cache.service';

/**
 * TOTP verification + single-use replay guard.
 *
 * otplib's default window (±0 steps, ~30s) means the same 6-digit code
 * remains valid for the full step. Without further action a captured code
 * can be re-submitted during that window for a second successful login.
 *
 * `verifyWithReplayGuard` pairs the cryptographic verify with an atomic
 * Redis SET NX EX to ensure each accepted code is redeemable exactly once
 * per user.
 *
 * Redis key: `used-totp:{userId}:{code}`  TTL 90s  value `1`
 * (90 s > otplib window so no edge case where an old code slips through.)
 *
 * Failure policy: FAIL-CLOSED by default. If the Redis SET throws (outage,
 * connection error) we reject verification. Admin paths always fail-closed;
 * customer paths can opt into fail-open via `failOpen = true` if the caller
 * wants to preserve login availability at the cost of second-factor strength.
 * MVP ships fail-closed everywhere.
 */
@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);
  private readonly REPLAY_TTL = 90; // seconds

  constructor(private readonly cache?: CacheService) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  async generateQrCode(email: string, secret: string, issuer = 'App'): Promise<string> {
    const otpauth = authenticator.keyuri(email, issuer, secret);
    return QRCode.toDataURL(otpauth);
  }

  /**
   * Raw cryptographic verify. Kept exported for callers that already
   * perform their own replay protection (tests, one-time flows).
   */
  verify(token: string, secret: string): boolean {
    return authenticator.verify({ token, secret });
  }

  /**
   * Verify a TOTP code and burn it for `REPLAY_TTL` seconds so the same
   * code cannot be re-used by an attacker within the otplib acceptance
   * window. Returns:
   *   - true   if code is valid AND not already seen
   *   - false  if code is invalid OR has been seen recently
   *
   * Redis errors → fail-closed (returns false) unless `failOpen=true`.
   */
  async verifyWithReplayGuard(
    userId: number,
    code: string,
    secret: string,
    opts: { scope?: 'a' | 'u'; failOpen?: boolean } = {},
  ): Promise<boolean> {
    if (!this.verify(code, secret)) return false;

    if (!this.cache) {
      // No cache wired → can't protect against replay. Admin must never land
      // here (module wiring error) — fail-closed. Log loudly.
      this.logger.error(
        'TotpService.verifyWithReplayGuard called without a CacheService; rejecting code to fail-closed.',
      );
      return false;
    }

    const key = this.replayKey(opts.scope ?? 'u', userId, code);
    try {
      const stored = await this.cache.setNx(key, '1', this.REPLAY_TTL);
      if (!stored) {
        this.logger.warn(
          `TOTP replay rejected for ${opts.scope ?? 'u'}:${userId} (code already used)`,
        );
        return false;
      }
      return true;
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown';
      if (opts.failOpen) {
        this.logger.warn(
          `TOTP replay-guard Redis failure (fail-open): ${msg}. Accepting code for ${opts.scope ?? 'u'}:${userId}.`,
        );
        return true;
      }
      this.logger.error(
        `TOTP replay-guard Redis failure (fail-closed): ${msg}. Rejecting login for ${opts.scope ?? 'u'}:${userId}.`,
      );
      return false;
    }
  }

  private replayKey(scope: 'a' | 'u', userId: number, code: string): string {
    return `used-totp:${scope}:${userId}:${code}`;
  }
}
