import { Injectable } from '@nestjs/common';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import { env } from '../../../config/environment';

export interface AdminJwtPayload {
  adminId: number;
  email: string;
  iat?: number;
  exp?: number;
}

export interface UserJwtPayload {
  userId: number;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtService {
  constructor(private readonly jwt: NestJwtService) {}

  signAdmin(payload: Omit<AdminJwtPayload, 'iat' | 'exp'>): string {
    return this.jwt.sign(payload, {
      secret: env.JWT_ADMIN_SECRET,
      expiresIn: env.JWT_ACCESS_TOKEN_EXPIRATION,
    });
  }

  verifyAdmin(token: string): AdminJwtPayload {
    return this.jwt.verify(token, { secret: env.JWT_ADMIN_SECRET });
  }

  signUser(payload: Omit<UserJwtPayload, 'iat' | 'exp'>): string {
    return this.jwt.sign(payload, {
      secret: env.JWT_CUSTOMER_SECRET,
      expiresIn: env.JWT_ACCESS_TOKEN_EXPIRATION,
    });
  }

  verifyUser(token: string): UserJwtPayload {
    return this.jwt.verify(token, { secret: env.JWT_CUSTOMER_SECRET });
  }
}
