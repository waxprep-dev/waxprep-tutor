/**
 * WaxPrep Main Server — UPDATED with CUGA Memory Bridge
 *
 * Orchestrates all workers and registers memory bridge endpoints
 * for the CUGA Python service to access your TypeScript memory system.
 */

import type { FastifyInstance } from 'fastify';
import { startServer } from './webhook/server.js';
import { startMessageWorker } from './workers/messageWorker.js';
import { startStatusWorker } from './workers/statusWorker.js';
import { startDLQWorker } from './workers/dlqWorker.js';
import { startConsolidationWorker } from './memory/workers/consolidationWorker.js';
import { registerMemoryBridge } from './bridge/memoryBridge.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('Starting WaxPrep WhatsApp Infrastructure with CUGA AI Brain...');

  // Start HTTP server (Fastify)
  const server = await startServer();

  // Register memory bridge endpoints for CUGA
  // These allow the Python CUGA service to access YOUR memory
  if (process.env.ENABLE_MEMORY_BRIDGE !== 'false') {
    await registerMemoryBridge(server);
    logger.info('Memory-CUGA bridge registered');
  }

  // Start all workers
  startMessageWorker();
  startStatusWorker();
  startDLQWorker();
  startConsolidationWorker();

  logger.info('WaxPrep AI Tutor with CUGA Brain -- ONLINE');
  logger.info('Webhook Server:  http://localhost:3000');
  logger.info('Memory Bridge:   /memory/* endpoints active');
  logger.info('CUGA Service:    Connects to CUGA_SERVICE_URL');

  // Graceful shutdown
  process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));

  // Keep process alive
  await new Promise(() => {});
}

async function gracefulShutdown(server: FastifyInstance, signal: string) {
  logger.info({ signal }, 'Shutting down gracefully...');

  await server.close();

  const { closeQueues } = await import('./queue/index.js');
  await closeQueues();

  const { closeRedis } = await import('./storage/idempotency.js');
  await closeRedis();

  logger.info('Shutdown complete');
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
