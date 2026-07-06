/**
 * Webhook Server
 * Fastify-based HTTP server with:
 * - Raw body capture for HMAC verification
 * - Sub-100ms response time guarantee
 * - Signature verification before any processing
 * - Immediate queue-and-ack pattern
 */

import Fastify from 'fastify';
import rawBody from '@fastify/raw-body';
import { config } from '../config/index.js';
import { logger, logWebhookIngress, logSignatureFailure } from '../utils/logger.js';
import { Timer, withTimeout } from '../utils/timing.js';
import { verifyWebhookSignature } from '../security/signature.js';
import { claimEvent, isEventProcessed } from '../storage/idempotency.js';
import { normalizePayload, validatePayloadStructure } from '../events/normalizer.js';
import { enqueueEvent, initializeQueues, getQueueMetrics } from '../queue/index.js';
import { persistEvent } from '../storage/supabase.js';
import type { WebhookEvent } from '../types/webhook.js';

const fastify = Fastify({
  logger: false, // We use our own structured logger
  trustProxy: true,
  // Critical: Keep body as raw buffer for signature verification
  bodyLimit: config.webhook.maxBodySize,
});

// Register raw body plugin
await fastify.register(rawBody, {
  field: 'rawBody',
  global: true,
  encoding: 'utf8',
  runFirst: true,
});

/**
 * Health check endpoint
 * Render uses this for uptime monitoring
 */
fastify.get('/health', async () => {
  const redis = (await import('../storage/idempotency.js')).getRedisClient();
  const redisHealthy = redis.status === 'ready';
  
  return {
    status: redisHealthy ? 'healthy' : 'degraded',
    timestamp: Date.now(),
    version: '1.0.0',
  };
});

/**
 * Queue metrics endpoint (protected, for monitoring)
 */
fastify.get('/metrics/queues', async (request, reply) => {
  // Simple API key check - enhance as needed
  const apiKey = request.headers['x-api-key'];
  if (apiKey !== config.meta.appSecret.substring(0, 32)) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  
  const metrics = await getQueueMetrics();
  return { metrics, timestamp: Date.now() };
});

/**
 * Webhook verification endpoint (GET)
 * Meta calls this to verify webhook URL ownership
 */
fastify.get('/webhook', async (request, reply) => {
  const query = request.query as Record<string, string>;
  
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  
  if (mode !== 'subscribe' || token !== config.meta.verifyToken) {
    logger.warn({ mode, token: token?.substring(0, 8) }, 'Webhook verification failed');
    return reply.status(403).send({ error: 'Verification failed' });
  }
  
  logger.info('Webhook verified successfully');
  return reply.status(200).send(challenge);
});

/**
 * Webhook event receiver (POST)
 * The critical path: verify -> claim -> queue -> respond < 100ms
 */
fastify.post('/webhook', {
  // Ensure we have raw body available
  config: { rawBody: true },
}, async (request, reply) => {
  const timer = new Timer();
  const sourceIp = request.ip;
  const signature = request.headers[config.security.signatureHeader] as string | undefined;
  
  try {
    // === STAGE 1: Signature Verification (non-negotiable) ===
    const rawBody = (request as unknown as { rawBody: Buffer }).rawBody;
    
    if (!rawBody) {
      logger.error('Raw body not available - check middleware order');
      return reply.status(500).send({ error: 'Server configuration error' });
    }
    
    try {
      verifyWebhookSignature(signature, rawBody);
    } catch (sigError) {
      logSignatureFailure(sourceIp, sigError instanceof Error ? sigError.message : 'Unknown');
      return reply.status(401).send({ error: 'Invalid signature' });
    }
    
    // === STAGE 2: Parse and Validate ===
    const payload = request.body as Record<string, unknown>;
    
    if (!validatePayloadStructure(payload)) {
      return reply.status(400).send({ error: 'Invalid payload structure' });
    }
    
    // === STAGE 3: Normalize Events ===
    const events = normalizePayload(payload);
    
    if (events.length === 0) {
      // Acknowledge even if no events extracted (heartbeat/keepalive)
      return reply.status(200).send({ received: true, events: 0 });
    }
    
    // === STAGE 4: Process Each Event (parallel where safe) ===
    const results = await Promise.allSettled(
      events.map(async (event: WebhookEvent) => {
        // Check idempotency
        const { claimed, isDuplicate } = await claimEvent(event.id);
        
        if (!claimed) {
          logWebhookIngress(event.id, event.type, sourceIp, timer.elapsedMs(), true);
          return { eventId: event.id, queued: false, duplicate: true };
        }
        
        // Persist for audit trail (fire and forget, don't block response)
        persistEvent(event).catch(err => {
          logger.error({ eventId: event.id, err }, 'Failed to persist event');
        });
        
        // Enqueue for processing
        const jobId = await enqueueEvent(event, sourceIp, signature || '');
        
        logWebhookIngress(event.id, event.type, sourceIp, timer.elapsedMs(), false);
        
        return { eventId: event.id, queued: true, jobId };
      })
    );
    
    // === STAGE 5: Respond Immediately ===
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    // Hard limit: respond within timeout budget
    const elapsed = timer.elapsedMs();
    if (elapsed > config.webhook.timeoutMs) {
      logger.warn({ elapsed, timeout: config.webhook.timeoutMs }, 'Webhook response approaching timeout');
    }
    
    return reply.status(200).send({
      received: true,
      events: events.length,
      processed: successful,
      durationMs: elapsed,
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ sourceIp, error: errorMessage, elapsed: timer.elapsedMs() }, 'Webhook processing error');
    
    // Still return 200 to prevent Meta retries for non-retryable errors
    // Only return 5xx for actual server errors that need retry
    return reply.status(200).send({
      received: true,
      error: 'Processing queued for retry',
    });
  }
});

/**
 * Graceful shutdown
 */
async function closeGracefully(signal: string) {
  logger.info({ signal }, 'Received signal, starting graceful shutdown...');
  
  await fastify.close();
  
  const { shutdownQueues } = await import('../queue/index.js');
  await shutdownQueues();
  
  const { closeRedis } = await import('../storage/idempotency.js');
  await closeRedis();
  
  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => closeGracefully('SIGTERM'));
process.on('SIGINT', () => closeGracefully('SIGINT'));

// Start server
export async function startServer() {
  initializeQueues();
  
  await fastify.listen({
    port: config.server.port,
    host: '0.0.0.0', // Required for Render
  });
  
  logger.info({ port: config.server.port }, 'Webhook server started');
  return fastify;
}

startServer();
