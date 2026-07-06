/**
 * Queue Type Definitions
 * Strict TypeScript interfaces for BullMQ job data structures
 */

import { WebhookEvent } from './webhook.js';

export interface WebhookJobData {
  event: WebhookEvent;
  receivedAt: number;
  sourceIp: string;
  signature: string;
  retryCount?: number;
  tenantId?: string; // For multi-tenancy support
}

export interface WorkerResult {
  success: boolean;
  processedAt: number;
  durationMs: number;
  error?: string;
  additionalData?: Record<string, any>;
}

export interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface QueueConfig {
  prefix: string;
  concurrency: number;
  maxRetries: number;
  backoffStrategy: {
    type: 'fixed' | 'exponential' | 'custom';
    delay: number;
  };
  limiter?: {
    max: number;
    duration: number;
  };
}
