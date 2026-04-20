import { Injectable, UnauthorizedException } from '@nestjs/common';
import { env } from '../config/environment';

@Injectable()
export class AuthService {
  async loginAdmin(email: string, password: string, totpCode?: string) {
    const res = await fetch(`${env.AUTH_SERVICE_URL}/api/v1/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, totpCode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new UnauthorizedException((err as any)?.message ?? 'Login failed');
    }
    return res.json();
  }

  async loginUser(email: string, password: string, totpCode?: string) {
    const res = await fetch(`${env.AUTH_SERVICE_URL}/api/v1/auth/customer/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, totpCode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new UnauthorizedException((err as any)?.message ?? 'Login failed');
    }
    return res.json();
  }

  async refreshAdmin(refreshToken: string) {
    const res = await fetch(`${env.AUTH_SERVICE_URL}/api/v1/auth/admin/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) throw new UnauthorizedException('Session expired');
    return res.json();
  }

  async refreshUser(refreshToken: string) {
    const res = await fetch(`${env.AUTH_SERVICE_URL}/api/v1/auth/customer/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) throw new UnauthorizedException('Session expired');
    return res.json();
  }

  async logoutAdmin(refreshToken: string) {
    await fetch(`${env.AUTH_SERVICE_URL}/api/v1/auth/admin/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }

  async logoutUser(refreshToken: string) {
    await fetch(`${env.AUTH_SERVICE_URL}/api/v1/auth/customer/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }
}
