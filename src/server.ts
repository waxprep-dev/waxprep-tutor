/**
 * WaxPrep Main Server — CRASH-SAFE STARTUP
 */

import type { FastifyInstance } from 'fastify';
import { startServer } from './webhook/server.js';
import { logger } from './utils/logger.js';
import { config, validateConfig } from './config/index.js';
import { getRedis, getRedisConnectionConfig, isRedisConnected } from './storage/idempotency.js';

async function main() {
  console.log('[STARTUP] WaxPrep starting...');

  // Step 1: Validate config FIRST
  try {
    validateConfig();
  } catch (err) {
    console.error('[FATAL] Configuration invalid:', (err as Error).message);
    process.exit(1);
  }

  // Step 2: Connect Redis lazily
  let redisAvailable = false;
  try {
    const redis = getRedis();
    await redis.connect(); // lazyConnect = true
    await redis.ping();
    redisAvailable = true;
    logger.info('Redis connection verified');
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Redis unavailable — workers disabled');
  }

  // Step 3: Skip Supabase health check — just verify config exists
  const supabaseAvailable = !!(config.supabase.url && config.supabase.serviceRoleKey);
  if (!supabaseAvailable) {
    logger.error('Supabase URL or key missing — memory layers will fail');
  } else {
    logger.info('Supabase configured (health check skipped due to RLS)');
  }

  // Step 4: Start HTTP server FIRST — this is what Render needs
  let server: FastifyInstance;
  try {
    server = await startServer();
    logger.info({ port: config.server.port }, 'HTTP server started');
  } catch (err) {
    console.error('[FATAL] Failed to start HTTP server:', (err as Error).message);
    process.exit(1);
  }

  // Step 5: Register memory bridge
  if (supabaseAvailable && process.env.ENABLE_MEMORY_BRIDGE !== 'false') {
    try {
      const { registerMemoryBridge } = await import('./bridge/memoryBridge.js');
      await registerMemoryBridge(server);
      logger.info('Memory-CUGA bridge registered');
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Memory bridge failed');
    }
  }

  // Step 6: Start workers ONLY if Redis is healthy
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
      logger.error({ error: (err as Error).message }, 'Worker startup failed');
    }
  } else {
    logger.warn('Workers NOT started — Redis unavailable');
  }

  logger.info('WaxPrep AI Tutor ONLINE');

  // Graceful shutdown
  process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));

  // Keep process alive
  await new Promise(() => {});
}

async function gracefulShutdown(server: FastifyInstance, signal: string) {
  logger.info({ signal }, 'Shutting down...');
  try { await server.close(); } catch (e) { /* ignore */ }
  try {
    const { closeQueues } = await import('./queue/index.js');
    await closeQueues();
  } catch (e) { /* ignore */ }
  try {
    const { closeRedis } = await import('./storage/idempotency.js');
    await closeRedis();
  } catch (e) { /* ignore */ }
  logger.info('Shutdown complete');
  process.exit(0);
}

main().catch((err) => {
  console.error('[FATAL] Failed to start:', err);
  process.exit(1);
});
