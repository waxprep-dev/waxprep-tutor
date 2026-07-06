/**
 * Main Server Entry Point
 * Orchestrates all workers in single process (Render-friendly)
 * For production scale: split workers to separate processes/services
 */

import { startServer } from './webhook/server.js';
import { startMessageWorker } from './workers/messageWorker.js';
import { startStatusWorker } from './workers/statusWorker.js';
import { startDLQWorker } from './workers/dlqWorker.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('Starting WhatsApp Webhook Infrastructure Stage 1...');
  
  // Start HTTP server
  const server = await startServer();
  
  // Start workers (in-process for Render; use separate services at scale)
  const messageWorker = startMessageWorker();
  const statusWorker = startStatusWorker();
  const dlqWorker = startDLQWorker();
  
  logger.info('All systems operational');
  
  // Keep process alive
  await new Promise(() => {}); // Never resolves, process runs until signal
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
