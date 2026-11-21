import { redis } from '../config/redis.js';
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const CACHE_TTL_SECONDS = {
  authUser: 300,
  organizations: 120,
} as const;

export function authUserCacheKey(userId: string) {
  return `auth:user:${userId}`;
}

export function organizationsCacheKey(userId: string) {
  return `organizations:user:${userId}`;
}

export async function getCached<T>(key: string): Promise<T | null> {
  if (!redis) return null;

  try {
    const value = await redis.get(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch (error: any) {
    console.warn(`Redis cache read failed for ${key}:`, error.message);
    return null;
  }
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (!redis) return;

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (error: any) {
    console.warn(`Redis cache write failed for ${key}:`, error.message);
  }
}

export async function deleteCached(...keys: string[]): Promise<void> {
  if (!redis || keys.length === 0) return;

  try {
    await redis.del(...keys);
  } catch (error: any) {
    console.warn('Redis cache invalidation failed:', error.message);
  }
}

function organizationCachePrefix(organizationId: string) {
  return `cache:org:${organizationId}:`;
}

export async function deleteOrganizationCache(organizationId: string): Promise<void> {
  if (!redis) return;

  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${organizationCachePrefix(organizationId)}*`, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  } catch (error: any) {
    console.warn(`Redis organization cache invalidation failed for ${organizationId}:`, error.message);
  }
}

export function cachedJsonResponse(ttlSeconds: number = 60) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.organizationId) return next();

    const queryHash = crypto
      .createHash('sha256')
      .update(req.originalUrl)
      .digest('hex')
      .slice(0, 16);
    const userScope = req.user?.id ? `user:${req.user.id}:` : '';
    const key = `${organizationCachePrefix(req.organizationId)}${userScope}${req.method}:${req.baseUrl}:${req.route?.path || req.path}:${queryHash}`;
    const cached = await getCached<{ status: number; body: unknown }>(key);

    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(cached.status).json(cached.body);
    }

    const originalJson = res.json.bind(res);
    res.setHeader('X-Cache', 'MISS');
    res.json = (body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        setCached(key, { status: res.statusCode, body }, ttlSeconds);
      }
      return originalJson(body);
    };
    next();
  };
}

export function invalidateOrganizationCacheResponse() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.organizationId) return next();

    const organizationId = req.organizationId;
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        void deleteOrganizationCache(organizationId);
      }
      return originalJson(body);
    };
    next();
  };
}
