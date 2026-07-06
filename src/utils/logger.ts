/**
 * Structured Logger
 * Pino-based logging with context and performance tracking
 */

import pino, { Logger as PinoLogger } from 'pino';

// Create base logger
const logger: PinoLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    }
  } : undefined,
  formatters: {
    level(label) {
      return { level: label };
    }
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`
});

export { logger };

// Specific logging functions for webhook operations
export function logWebhookIngress(
  eventId: string, 
  eventType: string, 
  sourceIp: string, 
  durationMs: number, 
  isDuplicate: boolean
): void {
  logger.info({
    eventId,
    eventType,
    sourceIp,
    durationMs,
    isDuplicate,
    action: 'webhook_ingress'
  }, 'Webhook event received');
}

export function logSignatureFailure(sourceIp: string, error: string): void {
  logger.warn({
    sourceIp,
    error,
    action: 'signature_verification_failed'
  }, 'Webhook signature verification failed');
}

export function logWorkerStart(eventId: string, workerName: string, attempt: number): void {
  logger.info({
    eventId,
    workerName,
    attempt,
    action: 'worker_start'
  }, 'Worker processing started');
}

export function logWorkerComplete(
  eventId: string, 
  workerName: string, 
  durationMs: number,
  additionalData?: Record<string, any>
): void {
  logger.info({
    eventId,
    workerName,
    durationMs,
    ...additionalData,
    action: 'worker_complete'
  }, 'Worker processing completed');
}

export function logWorkerError(
  eventId: string, 
  workerName: string, 
  error: Error, 
  attempt: number
): void {
  logger.error({
    eventId,
    workerName,
    attempt,
    error: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    action: 'worker_error'
  }, 'Worker processing failed');
}

export function logEventQueued(eventId: string, eventType: string, queueName: string): void {
  logger.info({
    eventId,
    eventType,
    queueName,
    action: 'event_queued'
  }, 'Event queued for processing');
}

export function logIdempotencyCheck(eventId: string, isDuplicate: boolean): void {
  logger.info({
    eventId,
    isDuplicate,
    action: 'idempotency_check'
  }, 'Idempotency check completed');
}

export function logDatabaseOperation(operation: string, table: string, durationMs: number, success: boolean): void {
  logger.info({
    operation,
    table,
    durationMs,
    success,
    action: 'database_operation'
  }, 'Database operation completed');
}
