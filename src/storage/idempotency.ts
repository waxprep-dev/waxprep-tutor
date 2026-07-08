/**
 * Idempotency guard — dedup processing of identical webhook events
 */
import { Redis } from 'ioredis';
import { logger } from '../utils/logger.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (redis) return redis;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is not configured');
  }

  redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  redis.on('error', (err) => {
    logger.error({ err }, 'Redis error');
  });

  return redis;
}

const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours

/**
 * Check if this event has already been processed.
 * Uses SET with NX (only if not exists) + EX (expiry) atomically.
 */
export async function isDuplicate(eventId: string): Promise<boolean> {
  const key = `idempotency:${eventId}`;
  const client = getRedis();

  // set returns 'OK' on success, null when key already exists
  const result = await client.set(key, '1', 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
  return result !== 'OK';
}

/**
 * Mark an event as processed (for manual idempotency tracking).
 */
export async function markProcessed(eventId: string): Promise<void> {
  const key = `idempotency:${eventId}`;
  const client = getRedis();
  await client.set(key, '1', 'EX', IDEMPOTENCY_TTL_SECONDS);
}

/**
 * Get the timestamp when an event was first seen.
 */
export async function getFirstSeenTimestamp(eventId: string): Promise<number | undefined> {
  const key = `idempotency:${eventId}`;
  const client = getRedis();
  const ttl = await client.ttl(key);
  if (ttl < 0) return undefined;
  return Date.now() - (IDEMPOTENCY_TTL_SECONDS - ttl) * 1000;
}

/**
 * Close the Redis connection.
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
