/**
 * Status Worker
 * Processes message status updates (sent, delivered, read, failed)
 * Handles out-of-order events using timestamp-based state machine
 */

import { Worker } from 'bullmq';
import { config } from '../config/index.js';
import { getRedisClient, markEventCompleted } from '../storage/idempotency.js';
import { markEventProcessed, updateMessageStatus } from '../storage/supabase.js';
import { logWorkerStart, logWorkerComplete, logWorkerError } from '../utils/logger.js';
import { Timer } from '../utils/timing.js';
import { moveToDeadLetter } from '../queue/index.js';
import type { WebhookJobData } from '../types/queue.js';
import type { StatusEvent } from '../types/webhook.js';

const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || '6379'),
  password: config.redis.password || undefined,
  db: config.redis.db,
};

/**
 * Status state machine with out-of-order handling
 * read implies delivered, delivered implies sent
 */
function resolveEffectiveStatus(
  currentStatus: string | null,
  newStatus: string,
  newTimestamp: number
): { status: string; changed: boolean } {
  const hierarchy: Record<string, number> = {
    sent: 1,
    delivered: 2,
    read: 3,
    failed: 4, // Terminal state, overrides everything
  };

  if (!currentStatus) {
    return { status: newStatus, changed: true };
  }

  // Failed is terminal - never override
  if (currentStatus === 'failed') {
    return { status: 'failed', changed: false };
  }

  const currentRank = hierarchy[currentStatus] || 0;
  const newRank = hierarchy[newStatus] || 0;

  // Higher rank = more advanced status
  if (newRank > currentRank) {
    return { status: newStatus, changed: true };
  }

  // Same rank but newer timestamp - update for accuracy
  if (newRank === currentRank) {
    return { status: newStatus, changed: true }; // Timestamp already validated by caller
  }

  return { status: currentStatus, changed: false };
}

export function startStatusWorker(): Worker<WebhookJobData> {
  const worker = new Worker<WebhookJobData>(
    `${config.queue.prefix}:statuses`,
    async (job) => {
      const timer = new Timer();
      const event = job.data.event as StatusEvent;
      
      logWorkerStart(event.id, 'statusWorker', job.attemptsMade + 1);
      
      try {
        const redis = getRedisClient();
        
        // Track message status in Redis for fast lookups
        const statusKey = `status:${event.messageId}`;
        const existing = await redis.get(statusKey);
        const existingData = existing ? JSON.parse(existing) : null;
        
        const { status: effectiveStatus, changed } = resolveEffectiveStatus(
          existingData?.status || null,
          event.status,
          event.timestamp
        );

        if (!changed) {
          // Out-of-order or duplicate status - safe to ignore
          logWorkerComplete(event.id, 'statusWorker (no-op)', timer.elapsedMs());
          return { success: true, processedAt: Date.now(), durationMs: timer.elapsedMs() };
        }

        // Update status tracking
        await redis.setex(statusKey, 86400 * 7, JSON.stringify({
          status: effectiveStatus,
          timestamp: event.timestamp,
          recipientId: event.recipientId,
          conversationId: event.conversationId,
          pricingCategory: event.pricingCategory,
        }));

        // Update status in persistent storage
        await updateMessageStatus({
          ...event,
          status: effectiveStatus
        });

        // ============================================================
        // YOUR TEAM: Add analytics, billing, user notification here
        // ============================================================
        
        // Example: Update conversation state in your database
        // await updateConversationStatus(event.recipientId, effectiveStatus);
        
        // Example: Track delivery metrics
        // await analytics.track('message_status', {
        //   status: effectiveStatus,
        //   messageId: event.messageId,
        //   pricingCategory: event.pricingCategory,
        // });

        await markEventProcessed(event.id);
        await markEventCompleted(event.id);

        const durationMs = timer.elapsedMs();
        logWorkerComplete(event.id, 'statusWorker', durationMs);
        
        return { success: true, processedAt: Date.now(), durationMs };
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logWorkerError(event.id, 'statusWorker', error, job.attemptsMade + 1);
        
        if (job.attemptsMade >= (job.opts.attempts || config.queue.maxRetries) - 1) {
          await moveToDeadLetter(job, errorMessage);
        }
        
        throw error;
      }
    },
    {
      connection,
      concurrency: config.queue.concurrency * 2, // Status updates are lighter
    }
  );

  console.log('Status worker started');
  return worker;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startStatusWorker();
}
