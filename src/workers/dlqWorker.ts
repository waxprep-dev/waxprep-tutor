/**
 * Dead Letter Queue Worker
 * Handles permanently failed events
 * Options: alert, manual review, or automatic replay
 */

import { Worker } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { WebhookJobData } from '../types/queue.js';
import { WebhookEvent } from '../types/webhook.js';
import { getSupabase } from '../storage/supabase.js';

const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || '6379'),
  password: config.redis.password || undefined,
  db: config.redis.db,
};

/**
 * Simple function to mark an event as processed in Supabase
 * This updates the webhook_events table with a processed flag
 */
async function markEventProcessed(eventId: string, errorMessage?: string): Promise<void> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('webhook_events')
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        error_message: errorMessage || null
      })
      .eq('id', eventId);

    if (error) {
      logger.error({ error, eventId }, 'Failed to mark event as processed in DLQ');
    }
  } catch (error) {
    logger.error({ error, eventId }, 'Unexpected error in markEventProcessed');
  }
}

export function startDLQWorker(): Worker<WebhookJobData> {
  const worker = new Worker<WebhookJobData>(
    `${config.queue.prefix}_dlq`,
    async (job) => {
      const event = job.data.event as WebhookEvent;

      logger.error({
        eventId: event.id,
        eventType: event.type,
        source: event.source,
        receivedAt: job.data.receivedAt,
        retryCount: job.data.retryCount || 0,
        payload: event.rawPayload,
      }, 'DEAD LETTER EVENT - requires manual review');

      // ============================================================
      // YOUR TEAM: Add alerting here (PagerDuty, Slack, email)
      // ============================================================

      // Example: Send alert to monitoring system
      // await alertService.send({
      //   severity: 'high',
      //   message: `Webhook event ${event.id} failed after max retries`,
      //   eventId: event.id,
      //   payload: event.rawPayload,
      // });

      // Mark as processed in database despite failure
      await markEventProcessed(event.id, 'Permanently failed after retries');

      // Option: Automatic replay after extended delay
      // await queue.add('replay', job.data, { delay: 3600000 }); // 1 hour

      return { success: true, processedAt: Date.now(), durationMs: 0 };
    },
    {
      connection,
      concurrency: 2, // Low concurrency for DLQ
    }
  );

  console.log('DLQ worker started');
  return worker;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startDLQWorker();
}
