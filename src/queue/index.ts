/**
 * Queue Management System
 * BullMQ queues with priority, retries, dead-letter support
 */

import { Queue, Worker, QueueScheduler, Job, QueueEvents, UnrecoverableError } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import { WebhookJobData } from '../types/queue.js';
import { WebhookEvent } from '../types/webhook.js';
import { logEventQueued, logger } from '../utils/logger.js';
import { Timer } from '../utils/timing.js';

// Redis connection for BullMQ
const connection = new Redis(config.redis.url, {
  password: config.redis.password,
  db: config.redis.db,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
});

// Queues
let messageQueue: Queue<WebhookJobData>;
let statusQueue: Queue<WebhookJobData>;
let dlqQueue: Queue<WebhookJobData>;

// Schedulers
let messageQueueScheduler: QueueScheduler;
let statusQueueScheduler: QueueScheduler;

export function initializeQueues(): void {
  // Initialize message queue (for incoming messages)
  messageQueue = new Queue<WebhookJobData>(`${config.queue.prefix}:messages`, {
    connection,
    defaultJobOptions: {
      attempts: config.queue.maxRetries,
      backoff: {
        type: 'exponential',
        delay: 1000, // Start with 1 second
      },
      removeOnComplete: { age: 3600 }, // Remove after 1 hour
      removeOnFail: { age: 24 * 3600 }, // Remove after 24 hours
    },
  });

  // Initialize status queue (for delivery/read receipts)
  statusQueue = new Queue<WebhookJobData>(`${config.queue.prefix}:statuses`, {
    connection,
    defaultJobOptions: {
      attempts: config.queue.maxRetries,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 24 * 3600 },
    },
  });

  // Initialize dead letter queue (for permanently failed events)
  dlqQueue = new Queue<WebhookJobData>(`${config.queue.prefix}:dlq`, {
    connection,
    defaultJobOptions: {
      attempts: 1, // DLQ jobs shouldn't retry
      removeOnComplete: { age: 7 * 24 * 3600 }, // Keep longer for review
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });

  // Initialize schedulers for delayed jobs
  messageQueueScheduler = new QueueScheduler(`${config.queue.prefix}:messages`, { connection });
  statusQueueScheduler = new QueueScheduler(`${config.queue.prefix}:statuses`, { connection });

  logger.info('Queues initialized');
}

export async function enqueueEvent(
  event: WebhookEvent,
  sourceIp: string,
  signature: string
): Promise<string> {
  const timer = new Timer();
  
  let queue: Queue<WebhookJobData>;
  let queueName: string;
  
  switch (event.type) {
    case 'message':
      queue = messageQueue;
      queueName = `${config.queue.prefix}:messages`;
      break;
    case 'status':
      queue = statusQueue;
      queueName = `${config.queue.prefix}:statuses`;
      break;
    default:
      queue = messageQueue; // Default to message queue
      queueName = `${config.queue.prefix}:messages`;
  }

  const jobData: WebhookJobData = {
    event,
    receivedAt: Date.now(),
    sourceIp,
    signature,
    retryCount: 0,
  };

  // Add priority based on event type and urgency
  const opts = {
    priority: event.type === 'message' ? 1 : 2, // Messages have higher priority than status updates
    // Add rate limiting for Meta's API limits
    ...(event.type === 'message' && {
      limiter: {
        max: 80, // Per phone number per minute (Meta's limit)
        duration: 60000,
      }
    })
  };

  const job = await queue.add(`event-${event.id}`, jobData, opts);
  
  const durationMs = timer.elapsedMs();
  logEventQueued(event.id, event.type, queueName);
  
  logger.info({
    eventId: event.id,
    queueName,
    durationMs
  }, 'Event enqueued successfully');
  
  return job.id;
}

export async function enqueueEventWithDelay(
  event: WebhookEvent,
  sourceIp: string,
  signature: string,
  delayMs: number
): Promise<string> {
  const jobData: WebhookJobData = {
    event,
    receivedAt: Date.now(),
    sourceIp,
    signature,
    retryCount: 0,
  };

  const queue = event.type === 'status' ? statusQueue : messageQueue;
  const queueName = event.type === 'status' ? 
    `${config.queue.prefix}:statuses` : 
    `${config.queue.prefix}:messages`;

  const job = await queue.add(
    `delayed-event-${event.id}`,
    jobData,
    { delay: delayMs }
  );

  logEventQueued(event.id, event.type, queueName);
  
  return job.id;
}

export async function moveToDeadLetter(job: Job<WebhookJobData>, reason: string): Promise<void> {
  const jobData = job.data;
  jobData.retryCount = job.attemptsMade;
  
  await dlqQueue.add(
    `dlq-${job.id}`,
    {
      ...jobData,
      event: {
        ...jobData.event,
        metadata: {
          ...jobData.event.metadata,
          failedAt: Date.now(),
          failureReason: reason,
          originalQueue: job.queueName,
        }
      }
    },
    { attempts: 1 }
  );

  logger.error({
    jobId: job.id,
    eventId: jobData.event.id,
    reason,
  }, 'Moved job to dead letter queue');
}

export async function getQueueMetrics(): Promise<import('../types/queue.js').QueueMetrics> {
  if (!messageQueue || !statusQueue) {
    throw new Error('Queues not initialized');
  }

  const [messageMetrics, statusMetrics, dlqMetrics] = await Promise.all([
    Promise.all([
      messageQueue.getWaitingCount(),
      messageQueue.getActiveCount(),
      messageQueue.getCompletedCount(),
      messageQueue.getFailedCount(),
      messageQueue.getDelayedCount(),
      messageQueue.getPausedCount(),
    ]),
    Promise.all([
      statusQueue.getWaitingCount(),
      statusQueue.getActiveCount(),
      statusQueue.getCompletedCount(),
      statusQueue.getFailedCount(),
      statusQueue.getDelayedCount(),
      statusQueue.getPausedCount(),
    ]),
    Promise.all([
      dlqQueue.getWaitingCount(),
      dlqQueue.getActiveCount(),
      dlqQueue.getCompletedCount(),
      dlqQueue.getFailedCount(),
      dlqQueue.getDelayedCount(),
      dlqQueue.getPausedCount(),
    ]),
  ]);

  return {
    waiting: messageMetrics[0] + statusMetrics[0] + dlqMetrics[0],
    active: messageMetrics[1] + statusMetrics[1] + dlqMetrics[1],
    completed: messageMetrics[2] + statusMetrics[2] + dlqMetrics[2],
    failed: messageMetrics[3] + statusMetrics[3] + dlqMetrics[3],
    delayed: messageMetrics[4] + statusMetrics[4] + dlqMetrics[4],
    paused: messageMetrics[5] + statusMetrics[5] + dlqMetrics[5],
  };
}

export async function getQueueLength(queueName: string): Promise<number> {
  switch (queueName) {
    case 'messages':
      return await messageQueue.getWaitingCount();
    case 'statuses':
      return await statusQueue.getWaitingCount();
    case 'dlq':
      return await dlqQueue.getWaitingCount();
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
}

export async function pauseQueue(queueName: string): Promise<void> {
  switch (queueName) {
    case 'messages':
      await messageQueue.pause();
      break;
    case 'statuses':
      await statusQueue.pause();
      break;
    case 'dlq':
      await dlqQueue.pause();
      break;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
}

export async function resumeQueue(queueName: string): Promise<void> {
  switch (queueName) {
    case 'messages':
      await messageQueue.resume();
      break;
    case 'statuses':
      await statusQueue.resume();
      break;
    case 'dlq':
      await dlqQueue.resume();
      break;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
}

export async function cleanQueue(queueName: string, graceMs: number): Promise<void> {
  const queue = getQueueByName(queueName);
  await queue.clean(graceMs, 1000); // Clean up to 1000 jobs
}

function getQueueByName(queueName: string): Queue<WebhookJobData> {
  switch (queueName) {
    case 'messages':
      return messageQueue;
    case 'statuses':
      return statusQueue;
    case 'dlq':
      return dlqQueue;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
}

export async function shutdownQueues(): Promise<void> {
  try {
    if (messageQueue) await messageQueue.close();
    if (statusQueue) await statusQueue.close();
    if (dlqQueue) await dlqQueue.close();
    if (messageQueueScheduler) await messageQueueScheduler.close();
    if (statusQueueScheduler) await statusQueueScheduler.close();
    if (connection) await connection.quit();
    
    logger.info('Queues shut down successfully');
  } catch (error) {
    logger.error({ error }, 'Error shutting down queues');
  }
}

// Export queues for direct access if needed
export { messageQueue, statusQueue, dlqQueue };
