/**
 * WaxPrep Main Server — CRASH-SAFE STARTUP
 */

import type { FastifyInstance } from 'fastify';
import { startServer } from './webhook/server.js';
import { logger } from './utils/logger.js';
import { config, validateConfig } from './config/index.js';
import { getRedis, isRedisConnected } from './storage/idempotency.js';

async function main() {
  console.log('[STARTUP] WaxPrep starting...');

  // Step 1: Validate config FIRST
  try {
    validateConfig();
  } catch (err) {
    console.error('[FATAL] Configuration invalid:', (err as Error).message);
    process.exit(1);
  }

  // Step 2: Test Redis connection BEFORE starting workers
  let redisAvailable = false;
  try {
    const redis = getRedis();
    await redis.connect();
    await redis.ping();
    redisAvailable = true;
    logger.info('Redis connection verified');
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Redis unavailable — workers will fail');
  }

  // Step 3: Test Supabase connection
  let supabaseAvailable = false;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);
    const { error } = await supabase.from('episodic_memories').select('id').limit(1);
    if (!error || error.code === 'PGRST116') {
      supabaseAvailable = true;
      logger.info('Supabase connection verified');
    } else {
      logger.error({ error: error.message }, 'Supabase connection failed');
    }
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Supabase unavailable');
  }

  // Step 4: Start HTTP server
  let server: FastifyInstance;
  try {
    server = await startServer();
    logger.info({ port: config.server.port }, 'HTTP server started');
  } catch (err) {
    logger.fatal({ error: (err as Error).message }, 'Failed to start HTTP server');
    process.exit(1);
  }

  // Step 5: Register memory bridge
  if (supabaseAvailable && process.env.ENABLE_MEMORY_BRIDGE !== 'false') {
    try {
      const { registerMemoryBridge } = await import('./bridge/memoryBridge.js');
      await registerMemoryBridge(server);
      logger.info('Memory-CUGA bridge registered');
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Memory bridge failed to register');
    }
  }

  // Step 6: Start workers ONLY if Redis is available
  if (redisAvailable) {
    try {
      const { startMessageWorker } = await import('./workers/messageWorker.js');
      const { startStatusWorker } = await import('./workers/statusWorker.js');
      const { startDLQWorker } = await import('./workers/dlqWorker.js');
      const { startConsolidationWorker } = await import('./memory/workers/consolidationWorker.js');

      startMessageWorker();
      startStatusWorker();
      startDLQWorker();
      startConsolidationWorker();

      logger.info('All workers started');
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Some workers failed to start');
    }
  } else {
    logger.warn('Workers NOT started — Redis is unavailable');
  }

  logger.info('WaxPrep AI Tutor ONLINE');
  logger.info(`Webhook Server: http://localhost:${config.server.port}`);

  process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));

  await new Promise(() => {});
}

async function gracefulShutdown(server: FastifyInstance, signal: string) {
  logger.info({ signal }, 'Shutting down gracefully...');

  try {
    await server.close();
  } catch (err) {
    console.error('Error closing server:', err);
  }

  try {
    const { closeQueues } = await import('./queue/index.js');
    await closeQueues();
  } catch (err) {
    console.error('Error closing queues:', err);
  }

  try {
    const { closeRedis } = await import('./storage/idempotency.js');
    await closeRedis();
  } catch (err) {
    console.error('Error closing Redis:', err);
  }

  logger.info('Shutdown complete');
  process.exit(0);
}

main().catch((err) => {
  console.error('[FATAL] Failed to start server:', err);
  process.exit(1);
});
