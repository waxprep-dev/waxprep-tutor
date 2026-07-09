/**
 * Status update worker — processes message delivery status changes from WhatsApp
 */
import { Worker } from 'bullmq';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { getSupabase, updateMessageStatus } from '../storage/supabase.js';
import type { MessageDeliveryStatus } from '../storage/supabase.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../storage/database.types.js';

// Redis connection for worker
const redisConnection = { url: config.redis.url };

interface StatusUpdate {
  id: string;
  recipient_id: string;
  status: string;
  timestamp: string;
  conversation?: {
    id: string;
    origin?: { type: string };
  };
  pricing?: {
    category: string;
    model: string;
  };
  errors?: Array<{ code: number; title: string; message?: string; error_data?: { details: string } }>;
}

interface StatusJobData {
  phoneNumberId: string;
  statuses: StatusUpdate[];
  timestamp: number;
}

/**
 * Process a batch of status updates
 */
async function processStatusUpdate(
  jobData: StatusJobData,
  supabase: SupabaseClient<Database>,
): Promise<{ processed: number; failed: number; details: Array<{ id: string; status: string; result: string }> }> {
  const { statuses } = jobData;
  const results: Array<{ id: string; status: string; result: string }> = [];
  let processed = 0;
  let failed = 0;

  for (const status of statuses) {
    try {
      // Validate status
      const validStatus = validateStatus(status.status);
      if (!validStatus) {
        logger.warn({ status: status.status, id: status.id }, 'Invalid status received');
        failed++;
        results.push({ id: status.id, status: status.status, result: 'invalid_status' });
        continue;
      }

      // Update message status in database
      await updateMessageStatus(
        status.recipient_id,
        validStatus,
        {
          messageId: status.id,
          timestamp: status.timestamp,
          conversationId: status.conversation?.id,
          pricingCategory: status.pricing?.category,
          pricingModel: status.pricing?.model,
          errorDetails: status.errors?.[0],
        }
      );

      // Log status change
      logger.debug({
        messageId: status.id,
        recipientId: status.recipient_id,
        status: validStatus,
        conversationId: status.conversation?.id,
      }, 'Status updated');

      processed++;
      results.push({ id: status.id, status: validStatus, result: 'updated' });

      // Handle failed statuses with error details
      if (validStatus === 'failed' && status.errors && status.errors.length > 0) {
        const error = status.errors[0];
        logger.error({
          messageId: status.id,
          errorCode: error.code,
          errorTitle: error.title,
          errorDetails: error.error_data?.details,
        }, 'Message delivery failed');
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        statusId: status.id,
      }, 'Failed to process status update');
      failed++;
      results.push({ id: status.id, status: status.status, result: 'error' });
    }
  }

  return { processed, failed, details: results };
}

/**
 * Validate and normalize status string
 */
function validateStatus(status: string): MessageDeliveryStatus | null {
  const validStatuses: MessageDeliveryStatus[] = ['sent', 'delivered', 'read', 'failed'];
  const normalized = status.toLowerCase();
  return validStatuses.includes(normalized as MessageDeliveryStatus) ? (normalized as MessageDeliveryStatus) : null;
}

/**
 * Start the status update worker
 */
export function startStatusWorker(): Worker<StatusJobData> {
  const supabase = getSupabase();

  const worker = new Worker<StatusJobData>(
    `${config.queue.prefix}_status`,
    async (job) => {
      logger.info({
        jobId: job.id,
        statusCount: job.data.statuses.length,
      }, 'Processing status updates');

      const result = await processStatusUpdate(job.data, supabase);

      logger.info({
        jobId: job.id,
        processed: result.processed,
        failed: result.failed,
      }, 'Status updates processed');

      return result;
    },
    {
      connection: redisConnection,
      concurrency: 10,
    }
  );

  worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, result }, 'Status job completed');
  });

  worker.on('failed', (job, error) => {
    logger.error({
      jobId: job?.id,
      error: error instanceof Error ? error.message : String(error),
    }, 'Status job failed');
  });

  logger.info('Status worker started');
  return worker;
}
