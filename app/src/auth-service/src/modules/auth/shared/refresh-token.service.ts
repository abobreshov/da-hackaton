import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { CacheService } from '../../../cache/cache.service';
import { env } from '../../../config/environment';

interface RefreshTokenData {
  id: number;
  sessionStartedAt: number;
}

@Injectable()
export class RefreshTokenService {
  private readonly TTL = 24 * 60 * 60; // 24h in seconds

  constructor(private readonly cache: CacheService) {}

  private makeToken(type: 'a' | 'u', id: number): string {
    return `${type}:${id}:${randomBytes(32).toString('hex')}`;
  }

  private tokenKey(type: 'a' | 'u', id: number, token: string): string {
    const hash = createHash('sha256').update(token).digest('hex');
    return `refresh:${type}:${id}:${hash}`;
  }

  private trackingKey(type: 'a' | 'u', id: number): string {
    return `refresh:${type}:${id}:tokens`;
  }

  async create(type: 'a' | 'u', id: number): Promise<string> {
    const token = this.makeToken(type, id);
    const key = this.tokenKey(type, id, token);
    const data: RefreshTokenData = { id, sessionStartedAt: Date.now() };
    await this.cache.set(key, JSON.stringify(data), this.TTL);
    await this.cache.sadd(this.trackingKey(type, id), key);
    return token;
  }

  async validateAndRotate(type: 'a' | 'u', id: number, token: string): Promise<string> {
    const key = this.tokenKey(type, id, token);
    const raw = await this.cache.get(key);
    if (!raw) throw new Error('Invalid or expired refresh token');

    const data: RefreshTokenData = JSON.parse(raw);
    const maxMs = env.SESSION_MAX_DURATION_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - data.sessionStartedAt > maxMs) {
      await this.cache.del(key);
      throw new Error('Session expired, please log in again');
    }

    // Rotate: delete old, create new (preserving sessionStartedAt)
    await this.cache.del(key);
    await this.cache.srem(this.trackingKey(type, id), key);

    const newToken = this.makeToken(type, id);
    const newKey = this.tokenKey(type, id, newToken);
    await this.cache.set(newKey, JSON.stringify(data), this.TTL);
    await this.cache.sadd(this.trackingKey(type, id), newKey);
    return newToken;
  }

  async revoke(type: 'a' | 'u', id: number, token: string): Promise<void> {
    const key = this.tokenKey(type, id, token);
    await this.cache.del(key);
    await this.cache.srem(this.trackingKey(type, id), key);
  }

  async revokeAll(type: 'a' | 'u', id: number): Promise<void> {
    const trackKey = this.trackingKey(type, id);
    const keys = await this.cache.smembers(trackKey);
    if (keys.length) await this.cache.del(...keys);
    await this.cache.del(trackKey);
  }
}
