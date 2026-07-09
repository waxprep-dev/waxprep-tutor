/**
 * Redis Connection Manager
 * Singleton with reconnection handling — compatible with BullMQ
 */

import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let redisInstance: Redis | null = null;
let redisConnectionConfig: any = null;

export function getRedisConnectionConfig(): any {
  if (redisConnectionConfig) return redisConnectionConfig;

  const isTls = config.redis.url?.startsWith('rediss://');

  redisConnectionConfig = {
    url: config.redis.url,  // Pass the full URL directly
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: 10000,
    commandTimeout: 5000,
    tls: isTls ? { rejectUnauthorized: false } : undefined,
    retryStrategy(times: number) {
      if (times > 10) {
        logger.error('Redis max retries exceeded — giving up');
        return null;
      }
      const delay = Math.min(times * 100, 3000);
      logger.warn({ attempt: times, delay }, 'Redis reconnecting...');
      return delay;
    },
    reconnectOnError(err: Error) {
      const targetErrors = ['READONLY', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE'];
      const shouldReconnect = targetErrors.some(e => err.message.includes(e));
      if (shouldReconnect) {
        logger.warn({ error: err.message }, 'Redis reconnecting on error');
        return 1;
      }
      return false;
    },
  };
  return redisConnectionConfig;
}

export function getRedis(): Redis {
  if (redisInstance) return redisInstance;

  redisInstance = new Redis(getRedisConnectionConfig());

  redisInstance.on('connect', () => {
    logger.info('Redis connected');
  });

  redisInstance.on('ready', () => {
    logger.info('Redis ready');
  });

  redisInstance.on('error', (err) => {
    logger.error({ error: err.message, code: (err as any).code }, 'Redis error');
  });

  redisInstance.on('close', () => {
    logger.warn('Redis connection closed');
  });

  redisInstance.on('reconnecting', () => {
    logger.info('Redis reconnecting...');
  });

  redisInstance.on('end', () => {
    logger.warn('Redis connection ended');
  });

  return redisInstance;
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}

export function isRedisConnected(): boolean {
  return redisInstance?.status === 'ready';
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
