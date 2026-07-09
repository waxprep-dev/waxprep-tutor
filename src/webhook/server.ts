/**
 * Fastify webhook server for receiving WhatsApp Cloud API events
 */
import Fastify from 'fastify';
import { logger } from '../utils/logger.js';
import { verifySignature } from '../security/signature.js';
import { isDuplicate } from '../storage/idempotency.js';
import { messageQueue, statusQueue } from '../queue/index.js';
import type { WebhookPayload } from '../types/webhook.js';
import { getMessageJobOptions } from '../queue/index.js';

// ------------------------------------------------------------------
// 1.  Raw body plugin (inline — avoids @fastify/raw-body dependency)
// ------------------------------------------------------------------
import type { FastifyInstance } from 'fastify';

async function rawBodyPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request, body: Buffer, done) => {
      done(null, body);
    }
  );
}

// ------------------------------------------------------------------
// 2.  Create server
// ------------------------------------------------------------------
export function startServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  void app.register(rawBodyPlugin);

  // ----------------------------------------------------------------
  // GET /webhook — Meta verification
  // ----------------------------------------------------------------
  app.get('/webhook', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      logger.info('Webhook verified');
      return reply.status(200).send(challenge);
    }

    logger.warn('Webhook verification failed');
    return reply.status(403).send('Forbidden');
  });

  // ----------------------------------------------------------------
  // POST /webhook — Receive events
  // ----------------------------------------------------------------
  app.post('/webhook', async (request, reply) => {
    const rawBody = request.body as Buffer;
    const signature = request.headers['x-hub-signature-256'] as string;

    if (!signature) {
      logger.warn('Missing signature');
      return reply.status(400).send('Missing signature');
    }

    try {
      verifySignature(rawBody.toString(), signature);
    } catch {
      logger.warn('Invalid signature');
      return reply.status(403).send('Invalid signature');
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString()) as WebhookPayload;
    } catch {
      return reply.status(400).send('Invalid JSON');
    }

    if (!payload.entry || !Array.isArray(payload.entry)) {
      return reply.status(200).send({ status: 'no_entries' });
    }

    const events = extractEvents(payload);
    logger.info({ count: events.length }, 'Received webhook events');

    const results: Array<{ eventId: string; queued: boolean; duplicate?: boolean }> = [];

    for (const event of events) {
      const dup = await isDuplicate(event.id);
      if (dup) {
        results.push({ eventId: event.id, queued: false, duplicate: true });
        continue;
      }

      try {
        if (event.type === 'message') {
          await messageQueue.add(
            'process-message',
            {
              eventId: event.id,
              phoneNumberId: event.phoneNumberId,
              payload: event.rawPayload,
              timestamp: event.timestamp,
            },
            getMessageJobOptions(event.priority ?? 5),
          );
        } else if (event.type === 'status') {
          await statusQueue.add('process-status', {
            statuses: [{
              recipientId: event.sourcePhone,
              status: event.subtype,
              timestamp: event.timestamp,
              messageId: event.id,
            }],
            phoneNumberId: event.phoneNumberId,
            timestamp: event.timestamp,
          });
        }

        results.push({ eventId: event.id, queued: true });
      } catch (err) {
        logger.error({ err, eventId: event.id }, 'Failed to queue event');
        results.push({ eventId: event.id, queued: false });
      }
    }

    return reply.status(200).send({ status: 'processed', results });
  });

  // ----------------------------------------------------------------
  // Health check
  // ----------------------------------------------------------------
  app.get('/health', async (_request, reply) => {
    return reply.status(200).send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ----------------------------------------------------------------
  // Start listening — bind to 0.0.0.0 for Render
  // ----------------------------------------------------------------
  const port = parseInt(process.env.PORT || '3000');
  app.listen({ port, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      logger.error({ err }, 'Failed to start server');
      throw err;
    }
    logger.info({ address, port }, 'HTTP server listening');
  });

  return app;
}

// ------------------------------------------------------------------
// 3.  Event extraction from payload
// ------------------------------------------------------------------
interface ExtractedEvent {
  id: string;
  type: 'message' | 'status';
  subtype: string;
  source: string;
  sourcePhone: string;
  phoneNumberId: string;
  timestamp: number;
  rawPayload: Record<string, unknown>;
  priority?: number;
  metadata?: Record<string, unknown>;
}

function extractEvents(payload: WebhookPayload): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id || 'unknown';

      // Messages
      if (value.messages) {
        for (const msg of value.messages) {
          const isText = msg.type === 'text';
          const isInteractive = msg.type === 'interactive';
          const priority = isText ? 5 : isInteractive ? 4 : 3;

          events.push({
            id: msg.id,
            type: 'message',
            subtype: msg.type,
            source: msg.from,
            sourcePhone: msg.from,
            phoneNumberId,
            timestamp: parseInt(msg.timestamp, 10) * 1000,
            rawPayload: msg as unknown as Record<string, unknown>,
            priority,
            metadata: {
              messageType: msg.type,
              hasText: !!msg.text?.body,
              hasMedia: ['image', 'audio', 'video', 'document'].includes(msg.type),
            },
          });
        }
      }

      // Statuses
      if (value.statuses) {
        for (const status of value.statuses) {
          events.push({
            id: status.id,
            type: 'status',
            subtype: status.status,
            source: status.recipient_id,
            sourcePhone: status.recipient_id,
            phoneNumberId,
            timestamp: parseInt(status.timestamp, 10) * 1000,
            rawPayload: status as unknown as Record<string, unknown>,
            metadata: {
              conversationId: status.conversation?.id,
              pricingCategory: status.pricing?.category,
            },
          });
        }
      }
    }
  }

  return events;
}
