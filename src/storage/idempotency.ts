/**
 * Idempotency Layer
 * Redis-based atomic operations for duplicate prevention and processing state management
 */

import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import { logIdempotencyCheck } from '../utils/logger.js';
import { Timer } from '../utils/timing.js';

let redisClient: Redis;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redis.url, {
      password: config.redis.password,
      db: config.redis.db,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    redisClient.on('error', (error) => {
      console.error('Redis connection error:', error);
    });

    redisClient.on('connect', () => {
      console.log('Connected to Redis');
    });
  }
  return redisClient;
}

/**
 * Attempts to claim an event for processing (atomic operation)
 * Returns whether claim was successful and if it's a duplicate
 */
export async function claimEvent(
  eventId: string,
  ttlSeconds: number = 86400 // 24 hours
): Promise<{ claimed: boolean; isDuplicate: boolean; previousState?: string }> {
  const timer = new Timer();
  const client = getRedisClient();
  
  // Try to set the event ID with NX (only if not exists) and EX (expire)
  const setResult = await client.set(`${config.queue.prefix}:event:${eventId}`, 'processing', 'NX', 'EX', ttlSeconds);
  
  if (setResult === 'OK') {
    // Successfully claimed the event
    logIdempotencyCheck(eventId, false);
    return { claimed: true, isDuplicate: false };
  } else {
    // Key already existed, this is a duplicate
    const previousState = await client.get(`${config.queue.prefix}:event:${eventId}`);
    logIdempotencyCheck(eventId, true);
    return { claimed: false, isDuplicate: true, previousState };
  }
}

/**
 * Mark event as completed processing
 */
export async function markEventCompleted(eventId: string, ttlSeconds: number = 86400): Promise<boolean> {
  const client = getRedisClient();
  
  // Update the key to completed state with new TTL
  await client.setex(`${config.queue.prefix}:event:${eventId}`, ttlSeconds, 'completed');
  
  return true;
}

/**
 * Mark event as failed processing
 */
export async function markEventFailed(eventId: string, errorMessage: string, ttlSeconds: number = 86400): Promise<boolean> {
  const client = getRedisClient();
  
  // Store failure details
  await client.setex(`${config.queue.prefix}:event:${eventId}`, ttlSeconds, `failed:${errorMessage}`);
  
  return true;
}

/**
 * Check if event has already been processed
 */
export async function isEventProcessed(eventId: string): Promise<boolean> {
  const client = getRedisClient();
  
  const state = await client.get(`${config.queue.prefix}:event:${eventId}`);
  
  if (!state) {
    return false; // No record exists
  }
  
  // Consider anything other than 'processing' as processed
  return state !== 'processing';
}

/**
 * Get current state of an event
 */
export async function getEventState(eventId: string): Promise<string | null> {
  const client = getRedisClient();
  
  return await client.get(`${config.queue.prefix}:event:${eventId}`);
}

/**
 * Release a claim on an event (for retries)
 */
export async function releaseEventClaim(eventId: string): Promise<boolean> {
  const client = getRedisClient();
  
  // Only delete if it's in 'processing' state to avoid race conditions
  const luaScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  
  const result = await client.eval(luaScript, 1, `${config.queue.prefix}:event:${eventId}`, 'processing');
  
  return result === 1;
}

/**
 * Extend TTL for long-running operations
 */
export async function extendEventTtl(eventId: string, ttlSeconds: number): Promise<boolean> {
  const client = getRedisClient();
  
  const result = await client.expire(`${config.queue.prefix}:event:${eventId}`, ttlSeconds);
  
  return result === 1;
}

/**
 * Clean up old entries periodically
 */
export async function cleanupOldEntries(prefix: string, maxAgeSeconds: number): Promise<number> {
  const client = getRedisClient();
  
  // In practice, Redis expiration handles most cleanup automatically
  // This is for manual cleanup if needed
  
  // Get keys matching the pattern
  const pattern = `${prefix}:event:*`;
  const keys = await client.keys(pattern);
  
  if (keys.length === 0) return 0;
  
  // Check TTL for each key and delete expired ones
  let deletedCount = 0;
  for (const key of keys) {
    const ttl = await client.ttl(key);
    if (ttl !== -1 && ttl < maxAgeSeconds * -1) {
      await client.del(key);
      deletedCount++;
    }
  }
  
  return deletedCount;
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
  }
}
