/**
 * Message Worker
 * Processes incoming WhatsApp messages from queue
 * YOUR TEAM: Replace processWithAI() with your Gamma-4 / multi-AI integration
 */

import { Worker } from 'bullmq';
import { config } from '../config/index.js';
import { getRedisClient, markEventCompleted, markEventFailed, releaseEventClaim } from '../storage/idempotency.js';
import { markEventProcessed } from '../storage/supabase.js';
import { logWorkerStart, logWorkerComplete, logWorkerError } from '../utils/logger.js';
import { Timer } from '../utils/timing.js';
import { moveToDeadLetter } from '../queue/index.js';
import type { WebhookJobData, WorkerResult } from '../types/queue.js';
import type { MessageEvent } from '../types/webhook.js';

const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || '6379'),
  password: config.redis.password || undefined,
  db: config.redis.db,
};

/**
 * PLACEHOLDER: Your AI integration goes here
 * 
 * This function receives a normalized message event and should:
 * 1. Call your AI service (Gamma-4, etc.)
 * 2. Handle the response
 * 3. Return success/failure
 * 
 * The worker handles retries, idempotency, and dead-letter queuing.
 */
async function processWithAI(event: MessageEvent): Promise<{
  success: boolean;
  responseText?: string;
  error?: string;
}> {
  // ============================================================
  // YOUR TEAM: REPLACE THIS ENTIRE FUNCTION
  // ============================================================
  
  // Example integration pattern:
  // const aiResponse = await fetch('https://your-gamma4-api.com/chat', {
  //   method: 'POST',
  //   headers: { 'Authorization': `Bearer ${config.ai.apiKey}` },
  //   body: JSON.stringify({
  //     message: event.text,
  //     userId: event.from,
  //     context: await fetchUserContext(event.from), // Your function
  //   }),
  // });
  
  // For now, just log and succeed
  console.log(`[AI PLACEHOLDER] Would process message from ${event.from}: "${event.text?.substring(0, 100)}..."`);
  
  return { success: true };
}

export function startMessageWorker(): Worker<WebhookJobData> {
  const worker = new Worker<WebhookJobData>(
    `${config.queue.prefix}:messages`,
    async (job) => {
      const timer = new Timer();
      const event = job.data.event as MessageEvent;
      
      logWorkerStart(event.id, 'messageWorker', job.attemptsMade + 1);
      
      try {
        // Update state to processing
        await markEventCompleted(event.id); // Re-use function but we'll track state
        
        // Call your AI layer
        const result = await processWithAI(event);
        
        if (!result.success) {
          throw new Error(result.error || 'AI processing failed');
        }
        
        // Mark as processed in database
        await markEventProcessed(event.id);
        
        const durationMs = timer.elapsedMs();
        logWorkerComplete(event.id, 'messageWorker', durationMs);
        
        return { success: true, processedAt: Date.now(), durationMs };
        
      } catch (error) {
        const durationMs = timer.elapsedMs();
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        logWorkerError(event.id, 'messageWorker', error, job.attemptsMade + 1);
        
        // If this is the final attempt, move to DLQ
        if (job.attemptsMade >= (job.opts.attempts || config.queue.maxRetries) - 1) {
          await moveToDeadLetter(job, errorMessage);
          await markEventProcessed(event.id, errorMessage);
        } else {
          // Release claim so another worker can retry
          await releaseEventClaim(event.id);
        }
        
        throw error; // Let BullMQ handle retry with backoff
      }
    },
    {
      connection,
      concurrency: config.queue.concurrency,
      limiter: {
        max: 80, // Meta's default MPS limit per phone number
        duration: 1000,
      },
    }
  );

  worker.on('completed', (job, result) => {
    // Job completed successfully
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err);
  });

  console.log('Message worker started');
  return worker;
}

// Start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startMessageWorker();
}
