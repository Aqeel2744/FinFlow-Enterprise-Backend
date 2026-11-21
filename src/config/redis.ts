import Redis from 'ioredis';
import { env } from './env.js';

let redisClient: Redis | null = null;

try {
  if (env.REDIS_URL) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      tls: env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
      retryStrategy(times) {
        if (times > 5) {
          console.warn('⚠️ Redis reconnect attempts exceeded max threshold. Operating with fallback.');
          return null; // Stop reconnecting after 5 attempts
        }
        return Math.min(times * 200, 2000);
      },
    });

    redisClient.on('connect', () => {
      console.log('Connected to Upstash Redis');
    });

    redisClient.on('error', (err) => {
      console.warn('Redis Error (operating with graceful degradation):', err.message);
    });
  } else {
    console.warn('REDIS_URL not provided. Operating in-memory fallback for caching.');
  }
} catch (error) {
  console.warn('Could not initialize Redis client:', error);
}

export const redis = redisClient;
