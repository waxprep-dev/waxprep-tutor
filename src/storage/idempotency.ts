/**
 * Redis Connection Manager
 * Singleton with reconnection handling and graceful degradation
 */

import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let redisInstance: Redis | null = null;
let redisConnected = false;

export function getRedis(): Redis {
  if (redisInstance) {
    return redisInstance;
  }

  const redisUrl = config.redis.url;

  redisInstance = new Redis(redisUrl, {
    password: config.redis.password || undefined,
    db: config.redis.db,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      logger.warn({ attempt: times, delay }, 'Redis reconnecting...');
      return delay;
    },
    reconnectOnError(err: Error) {
      const targetErrors = ['READONLY', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'];
      const shouldReconnect = targetErrors.some(e => err.message.includes(e));
      if (shouldReconnect) {
        logger.warn({ error: err.message }, 'Redis reconnecting on error');
      }
      return shouldReconnect ? 2 : false;
    },
  });

  redisInstance.on('connect', () => {
    redisConnected = true;
    logger.info('Redis connected');
  });

  redisInstance.on('ready', () => {
    logger.info('Redis ready');
  });

  redisInstance.on('error', (err) => {
    logger.error({ error: err.message }, 'Redis error');
    redisConnected = false;
  });

  redisInstance.on('close', () => {
    logger.warn('Redis connection closed');
    redisConnected = false;
  });

  redisInstance.on('reconnecting', () => {
    logger.info('Redis reconnecting...');
  });

  return redisInstance;
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
    redisConnected = false;
  }
}

export function isRedisConnected(): boolean {
  return redisConnected;
}

const IDEMPOTENCY_TTL_SECONDS = 86400;

export async function isDuplicate(eventId: string): Promise<boolean> {
  const key = `idempotency:${eventId}`;
  const client = getRedis();
  const result = await client.set(key, '1', 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
  return result !== 'OK';
}

export async function markProcessed(eventId: string): Promise<void> {
  const key = `idempotency:${eventId}`;
  const client = getRedis();
  await client.set(key, '1', 'EX', IDEMPOTENCY_TTL_SECONDS);
}

export async function getFirstSeenTimestamp(eventId: string): Promise<number | undefined> {
  const key = `idempotency:${eventId}`;
  const client = getRedis();
  const ttl = await client.ttl(key);
  if (ttl < 0) return undefined;
  return Date.now() - (IDEMPOTENCY_TTL_SECONDS - ttl) * 1000;
}
