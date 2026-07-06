/**
 * WaxPrep Message Worker — UPDATED with CUGA AI Brain Integration
 *
 * This replaces the placeholder processWithAI() with the full CUGA multi-agent system.
 * CUGA lives BEHIND the queue — never in the webhook handler.
 */

import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { memory } from '../memory/index.js';
import {
  cugaClient,
  analyzeComplexity,
  determineReasoningMode,
  formatForWhatsApp,
  CugaError
} from '../cugaClient.js';
import { Timer } from '../utils/timing.js';
import type { WebhookEvent } from '../types/webhook.js';

// ═══════════════════════════════════════════════════════════════
// QUEUE SETUP
// ═══════════════════════════════════════════════════════════════

const redisConnection = { url: config.redis.url };

const messageQueue = new Queue(`${config.queue.prefix}:messages`, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: config.queue.maxRetries,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

const statusQueue = new Queue(`${config.queue.prefix}:status`, {
  connection: redisConnection,
});

// ═══════════════════════════════════════════════════════════════
// AI PROCESSING WITH CUGA
// ═══════════════════════════════════════════════════════════════

interface ProcessingResult {
  text: string;
  metadata: {
    agent: string;
    subject: string;
    tools: string[];
    confidence: number;
    mode: string;
    complexity: number;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
  };
}

/**
 * Process message with CUGA AI Brain — the heart of the tutoring system */
async function processWithAI(
  message: string,
  userId: string,
): Promise<ProcessingResult> {
  const timer = new Timer();

  // Step 1: Assemble context from YOUR memory system
  const context = await memory.assembleContext(userId, message);

  // Step 2: Analyze complexity MATHEMATICALLY (no hardcoded rules)
  const complexity = analyzeComplexity(message);
  const mode = determineReasoningMode(message);

  logger.info({
    userId,
    complexity: complexity.toFixed(3),
    mode,
    messagePreview: message.substring(0, 80),
  }, 'CUGA complexity analysis');

  // Step 3: Call CUGA AI Brain with full context
  const cugaResponse = await cugaClient.tutor(message, userId, context, mode);

  const latencyMs = timer.elapsedMs();

  // Step 4: Record exchange in YOUR memory system
  await memory.recordExchange(
    userId,
    `msg_${Date.now()}`,
    message,
    cugaResponse.answer,
    {
      tokensIn: cugaResponse.tokens_used.prompt,
      tokensOut: cugaResponse.tokens_used.completion,
      latencyMs,
    }
  );

  // Step 5: Store learning moment if confidence is high
  if (cugaResponse.confidence > 0.85 && cugaResponse.routing?.detected_subject) {
    try {
      await memory.storeFact(
        userId,
        'skill',
        `engagement_${cugaResponse.routing.detected_subject}`,
        'active',
        `Student actively engaged with ${cugaResponse.routing.detected_subject} tutoring via ${cugaResponse.agent_used}`,
        cugaResponse.confidence,
      );
    } catch (e) {
      // Non-critical: don't fail if memory storage fails
      logger.warn({ userId, error: e }, 'Learning moment storage failed');
    }
  }

  // Step 6: Track study streak for gamification
  try {
    await memory.storeFact(
      userId,
      'behavior',
      'last_study_session',
      new Date().toISOString(),
      `Study session at ${new Date().toISOString()}`,
      1.0,
    );
  } catch (e) {
    // Non-critical
  }

  return {
    text: cugaResponse.answer,
    metadata: {
      agent: cugaResponse.agent_used,
      subject: cugaResponse.routing?.detected_subject || 'general',
      tools: cugaResponse.tools_used,
      confidence: cugaResponse.confidence,
      mode: cugaResponse.mode,
      complexity,
      latencyMs,
      tokensIn: cugaResponse.tokens_used.prompt,
      tokensOut: cugaResponse.tokens_used.completion,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// WHATSAPP MESSAGE SENDING
// ═══════════════════════════════════════════════════════════════

interface WhatsAppMessage {
  to: string;
  body: string;
  metadata?: Record<string, any>;
}

/**
 * Send message via Meta Cloud API
 */
async function sendWhatsAppMessage(message: WhatsAppMessage): Promise<void> {
  const url = `https://graph.facebook.com/v18.0/${config.meta.phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: message.to,
    type: 'text',
    text: {
      body: message.body,
      preview_url: false,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.meta.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WhatsApp API error: ${response.status} - ${error}`);
  }
}

/**
 * Send typing indicator (shows "typing..." to user)
 */
async function sendTypingIndicator(to: string): Promise<void> {
  const url = `https://graph.facebook.com/v18.0/${config.meta.phoneNumberId}/messages`;

  await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.meta.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: '' },
    }),
  });
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════

interface MessageJobData {
  event: WebhookEvent;
  sourceIp: string;
  signature: string;
}

/**
 * Handle a single incoming WhatsApp message
 */
async function handleMessage(job: Job<MessageJobData>): Promise<any> {
  const { event, sourceIp } = job.data;
  const userId = event.from;
  const messageText = event.text || '';

  logger.info({
    jobId: job.id,
    userId,
    messagePreview: messageText.substring(0, 60),
    attempt: job.attemptsMade + 1,
  }, 'Processing message with CUGA AI Brain');

  // Skip non-text messages (images, audio, etc. — handle separately)
  if (event.type !== 'text' || !messageText) {
    logger.info({ jobId: job.id, type: event.type }, 'Skipping non-text message');
    return { success: true, skipped: true, reason: 'non-text' };
  }

  try {
    // Step 1: Send typing indicator for UX
    await sendTypingIndicator(userId).catch(() => {});

    // Step 2: Process with CUGA AI Brain
    const result = await processWithAI(messageText, userId);

    // Step 3: Format for WhatsApp
    const whatsappMessage = formatForWhatsApp(result.text);

    // Step 4: Send response
    await sendWhatsAppMessage({
      to: userId,
      body: whatsappMessage,
      metadata: result.metadata,
    });

    // Step 5: Log success
    logger.info({
      jobId: job.id,
      userId,
      agent: result.metadata.agent,
      subject: result.metadata.subject,
      mode: result.metadata.mode,
      confidence: result.metadata.confidence.toFixed(3),
      complexity: result.metadata.complexity.toFixed(3),
      latencyMs: result.metadata.latencyMs,
      tokensIn: result.metadata.tokensIn,
      tokensOut: result.metadata.tokensOut,
    }, 'Message processed successfully');

    return {
      success: true,
      agent: result.metadata.agent,
      subject: result.metadata.subject,
      mode: result.metadata.mode,
      confidence: result.metadata.confidence,
      latencyMs: result.metadata.latencyMs,
    };

  } catch (error) {
    // Handle specific error types
    if (error instanceof CugaError) {
      logger.error({ jobId: job.id, error: error.message }, 'CUGA error');

      // Send fallback message to user
      await sendWhatsAppMessage({
        to: userId,
        body: "I'm having trouble thinking right now. Let me try again in a moment! 🤔",
      }).catch(() => {});

      throw error; // Allow BullMQ retry
    }

    // Network/model errors — send friendly fallback
    if (error instanceof TypeError && error.message.includes('fetch')) {
      logger.error({ jobId: job.id }, 'CUGA service unreachable');

      await sendWhatsAppMessage({
        to: userId,
        body: "I'm taking a quick break. Back in 30 seconds! ⏳",
      }).catch(() => {});

      throw error;
    }

    logger.error({ jobId: job.id, error }, 'Unexpected processing error');

    // Last resort: send generic response so user isn't left hanging
    if (job.attemptsMade >= config.queue.maxRetries - 1) {
      await sendWhatsAppMessage({
        to: userId,
        body: "I apologize, I'm having technical difficulties. Please try again! 🙏",
      }).catch(() => {});
    }

    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// WORKER SETUP
// ═══════════════════════════════════════════════════════════════

export function startMessageWorker(): Worker<MessageJobData> {
  const worker = new Worker(
    `${config.queue.prefix}:messages`,
    handleMessage,
    {
      connection: redisConnection,
      concurrency: config.queue.concurrency,
      limiter: {
        max: 60,        // Max 60 jobs per minute
        duration: 60000,
      },
    }
  );

  // Event handlers
  worker.on('completed', (job, result) => {
    if (!result?.skipped) {
      logger.info({ jobId: job.id, result }, 'Job completed');
    }
  });

  worker.on('failed', (job, error) => {
    logger.error({
      jobId: job?.id,
      error: error.message,
      attempts: job?.attemptsMade,
    }, 'Job failed after all retries');
  });

  worker.on('error', (error) => {
    logger.error({ error }, 'Worker error');
  });

  logger.info('Message worker started with CUGA AI Brain');

  return worker;
}

// ═══════════════════════════════════════════════════════════════
// STATUS WORKER
// ═══════════════════════════════════════════════════════════════

export function startStatusWorker(): Worker {
  const worker = new Worker(
    `${config.queue.prefix}:status`,
    async (job) => {
      const { event } = job.data;
      logger.debug({ event }, 'Status update received');
      // Track message delivery status
      // Update analytics in Supabase
    },
    { connection: redisConnection }
  );

  logger.info('Status worker started');
  return worker;
}

// ═══════════════════════════════════════════════════════════════
// DEAD LETTER QUEUE WORKER
// ═══════════════════════════════════════════════════════════════

export function startDLQWorker(): Worker {
  const worker = new Worker(
    `${config.queue.prefix}:messages:dlq`,
    async (job) => {
      logger.warn({
        jobId: job.id,
        data: job.data,
        failedReason: job.failedReason,
      }, 'Dead letter queue job — manual review needed');

      // Store for manual review
      // Send alert to admin
      // Could trigger fallback to human tutor
    },
    { connection: redisConnection }
  );

  logger.info('DLQ worker started');
  return worker;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export { messageQueue, statusQueue };
