/**
 * Unified Queue module
 * Wraps BullMQ for message and status processing
 */
import { Queue, Worker, Job, type ConnectionOptions, type JobsOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { logger } from '../utils/logger.js';

// ------------------------------------------------------------------
// 1.  Redis connection options (plain object — compatible with bullmq)
// ------------------------------------------------------------------
function buildRedisConnection(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is not configured');
  }

  // Return a RedisOptions object that bullmq's ConnectionOptions accepts
  const opts: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };

  // If the URL contains rediss://, enable TLS
  if (redisUrl.startsWith('rediss://')) {
    opts.tls = {};
  }

  return { ...opts, url: redisUrl } as ConnectionOptions;
}

// ------------------------------------------------------------------
// 2.  Job data types
// ------------------------------------------------------------------
export interface WebhookJobData {
  eventId: string;
  phoneNumberId: string;
  payload: Record<string, unknown>;
  timestamp: number;
  attempts?: number;
  priority?: number;
}

export interface StatusJobData {
  statuses: Array<{
    recipientId: string;
    conversationId?: string;
    status: string;
    timestamp: number;
    messageId?: string;
  }>;
  phoneNumberId: string;
  timestamp: number;
}

export interface DlqRetryData {
  originalJobId: string;
  queueName: string;
  data: WebhookJobData;
  errorMessage: string;
  retryCount: number;
}

// ------------------------------------------------------------------
// 3.  Queues
// ------------------------------------------------------------------
const redisConn = buildRedisConnection();

export const messageQueue = new Queue<WebhookJobData>('messages', {
  connection: redisConn,
  defaultJobOptions: {
    removeOnComplete: { count: 500, age: 86400 },
    removeOnFail: { count: 200, age: 604800 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    priority: 5,
  },
});

export const statusQueue = new Queue<StatusJobData>('statuses', {
  connection: redisConn,
  defaultJobOptions: {
    removeOnComplete: { count: 500, age: 86400 },
    removeOnFail: { count: 200, age: 604800 },
    attempts: 2,
    backoff: { type: 'fixed', delay: 500 },
    priority: 3,
  },
});

export const dlqQueue = new Queue<DlqRetryData>('dlq', {
  connection: redisConn,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
    attempts: 3,
    backoff: { type: 'fixed', delay: 5000 },
  },
});

// ------------------------------------------------------------------
// 4.  Job options helpers
// ------------------------------------------------------------------
export function getMessageJobOptions(priority: number = 5, delay?: number): JobsOptions {
  return {
    priority,
    delay,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  };
}

// ------------------------------------------------------------------
// 5.  Queue health check
// ------------------------------------------------------------------
export async function checkQueueHealth(): Promise<{
  messages: { waiting: number; active: number; failed: number };
  statuses: { waiting: number; active: number; failed: number };
  dlq: { waiting: number; active: number; failed: number };
}> {
  const [msgWaiting, msgActive, msgFailed] = await Promise.all([
    messageQueue.getWaitingCount(),
    messageQueue.getActiveCount(),
    messageQueue.getFailedCount(),
  ]);

  const [stsWaiting, stsActive, stsFailed] = await Promise.all([
    statusQueue.getWaitingCount(),
    statusQueue.getActiveCount(),
    statusQueue.getFailedCount(),
  ]);

  const [dlqWaiting, dlqActive, dlqFailed] = await Promise.all([
    dlqQueue.getWaitingCount(),
    dlqQueue.getActiveCount(),
    dlqQueue.getFailedCount(),
  ]);

  return {
    messages: { waiting: msgWaiting, active: msgActive, failed: msgFailed },
    statuses: { waiting: stsWaiting, active: stsActive, failed: stsFailed },
    dlq: { waiting: dlqWaiting, active: dlqActive, failed: dlqFailed },
  };
}

// ------------------------------------------------------------------
// 6.  Job info
// ------------------------------------------------------------------
export async function getJobInfo(jobId: string): Promise<{
  id: string;
  state: string;
  progress: number | object;
  attemptsMade: number;
  failedReason: string | undefined;
} | null> {
  const job = await messageQueue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  return {
    id: job.id ?? jobId,
    state,
    progress: (job.progress ?? 0) as number | object,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason ?? undefined,
  };
}

// ------------------------------------------------------------------
// 7.  Wait for completion
// ------------------------------------------------------------------
export async function waitForCompletion(jobId: string, timeoutMs: number = 30000): Promise<{
  success: boolean;
  result?: unknown;
  error?: string;
}> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await getJobInfo(jobId);
    if (!info) return { success: false, error: 'Job not found' };
    if (info.state === 'completed') return { success: true };
    if (info.state === 'failed') return { success: false, error: info.failedReason };
    await new Promise(r => setTimeout(r, 500));
  }
  return { success: false, error: 'Timeout waiting for job' };
}

// ------------------------------------------------------------------
// 8.  Graceful shutdown
// ------------------------------------------------------------------
export async function closeQueues(): Promise<void> {
  await Promise.all([
    messageQueue.close(),
    statusQueue.close(),
    dlqQueue.close(),
  ]);
  logger.info('All queues closed');
}

// ------------------------------------------------------------------
// 9.  Re-export types
// ------------------------------------------------------------------
export { Worker, Job };
export type { JobsOptions };
