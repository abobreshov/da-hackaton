import { Injectable } from '@nestjs/common';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import { AccessTokenClaims, parseSub } from '@app/contracts';
import { env } from '../../../config/environment';

/**
 * Re-export the shared claim shape so other auth-service modules
 * (customer-auth.controller, TCP handlers) don't have to reach into
 * `@app/contracts` for a single type.
 */
export type { AccessTokenClaims };

/**
 * Back-compat alias used by older call sites. Removed once every consumer
 * reads `claims.sub` + `claims.type` directly — current as of the OIDC
 * migration batch in mng/specs/16-deferred-backlog.md.
 */
export type AdminJwtPayload = AccessTokenClaims;
export type UserJwtPayload = AccessTokenClaims;

@Injectable()
export class JwtService {
  constructor(private readonly jwt: NestJwtService) {}

  /**
   * Mint an admin access token. `sub` must be `a:<id>` (enforced so
   * downstream consumers can rely on the prefix to route RBAC).
   */
  signAdmin(claims: Omit<AccessTokenClaims, 'iat' | 'exp'>): string {
    if (parseSub(claims.sub).type !== 'admin' || claims.type !== 'admin') {
      throw new Error('signAdmin: sub must be an admin principal (a:<id>)');
    }
    return this.jwt.sign(claims, {
      secret: env.JWT_ADMIN_SECRET,
      expiresIn: env.JWT_ACCESS_TOKEN_EXPIRATION,
    } as any);
  }

  verifyAdmin(token: string): AccessTokenClaims {
    return this.jwt.verify<AccessTokenClaims>(token, { secret: env.JWT_ADMIN_SECRET });
  }

  /**
   * Mint a customer access token. `sub` must be `u:<id>`.
   */
  signUser(claims: Omit<AccessTokenClaims, 'iat' | 'exp'>): string {
    if (parseSub(claims.sub).type !== 'user' || claims.type !== 'user') {
      throw new Error('signUser: sub must be a user principal (u:<id>)');
    }
    return this.jwt.sign(claims, {
      secret: env.JWT_CUSTOMER_SECRET,
      expiresIn: env.JWT_ACCESS_TOKEN_EXPIRATION,
    } as any);
  }

  verifyUser(token: string): AccessTokenClaims {
    return this.jwt.verify<AccessTokenClaims>(token, { secret: env.JWT_CUSTOMER_SECRET });
  }
}
